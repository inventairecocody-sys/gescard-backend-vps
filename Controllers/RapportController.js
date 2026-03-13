/**
 * Controllers/RapportController.js
 * Génère les rapports Word et Excel à partir des données statistiques
 */

const { execSync } = require('child_process');
const path = require('path');
const { query } = require('../db/db');

// Chemin vers les scripts de génération
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts', 'rapports');

// ─── Condition retrait (cohérente avec StatistiquesController) ───────────────
const CONDITION_RETIRES = `delivrance IS NOT NULL AND TRIM(delivrance) != '' AND UPPER(TRIM(delivrance)) != 'NON'`;

// ─── Récupération des données consolidées ────────────────────────────────────
async function collecterDonnees(user) {
  const isAdmin = user.role === 'Administrateur';

  // Filtre coordination
  let filtreCoord = '';
  const params = [];
  if (!isAdmin) {
    if (user.coordination) {
      params.push(user.coordination);
      filtreCoord = `AND coordination = $${params.length}`;
    }
  }

  // ── Globales ──────────────────────────────────────────────────────────────
  const gRes = await query(
    `
    SELECT
      COUNT(*)                                        AS total,
      COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})    AS retires,
      COUNT(*) FILTER (WHERE NOT (${CONDITION_RETIRES})) AS restants
    FROM cartes
    WHERE deleted_at IS NULL ${filtreCoord}
  `,
    params
  );

  const g = gRes.rows[0];
  const total = parseInt(g.total);
  const retires = parseInt(g.retires);
  const restants = parseInt(g.restants);

  // ── Par coordination ──────────────────────────────────────────────────────
  let coords = [];
  if (isAdmin) {
    const cRes = await query(`
      SELECT
        coordination,
        COUNT(*)                                        AS total,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})    AS retires,
        COUNT(*) FILTER (WHERE NOT (${CONDITION_RETIRES})) AS restants
      FROM cartes
      WHERE deleted_at IS NULL AND coordination IS NOT NULL AND TRIM(coordination) != ''
      GROUP BY coordination
      ORDER BY total DESC
    `);
    coords = cRes.rows.map((r) => ({
      coordination: r.coordination,
      total: parseInt(r.total),
      retires: parseInt(r.retires),
      restants: parseInt(r.restants),
      tauxRetrait:
        parseInt(r.total) > 0 ? Math.round((parseInt(r.retires) / parseInt(r.total)) * 100) : 0,
    }));
  } else if (user.coordination) {
    coords = [
      {
        coordination: user.coordination,
        total,
        retires,
        restants,
        tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
      },
    ];
  }

  // ── Par agence ────────────────────────────────────────────────────────────
  let agences = [];
  try {
    let agQuery = `
      SELECT
        ag.id                AS agence_id,
        ag.nom               AS agence_nom,
        co.nom               AS coordination_nom,
        co.id                AS coordination_id,
        COUNT(DISTINCT s.id) AS nombre_sites,
        COUNT(DISTINCT u.id) AS nombre_agents,
        COUNT(c.id)          AS total_cartes,
        COUNT(c.id) FILTER (WHERE ${CONDITION_RETIRES}) AS cartes_retirees
      FROM agences ag
      JOIN coordinations co ON ag.coordination_id = co.id
      LEFT JOIN sites s  ON s.agence_id = ag.id
      LEFT JOIN cartes c ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom)) AND c.deleted_at IS NULL
      LEFT JOIN utilisateurs u ON u.agence_id = ag.id
      WHERE ag.is_active = true
    `;
    const agParams = [];
    if (!isAdmin && user.coordination) {
      agParams.push(user.coordination);
      agQuery += ` AND co.nom = $1`;
    }
    agQuery += ` GROUP BY ag.id, ag.nom, co.nom, co.id ORDER BY total_cartes DESC`;

    const agRes = await query(agQuery, agParams);
    agences = agRes.rows.map((r) => ({
      agence_id: parseInt(r.agence_id),
      agence_nom: r.agence_nom,
      coordination_nom: r.coordination_nom,
      coordination_id: parseInt(r.coordination_id),
      nombre_sites: parseInt(r.nombre_sites),
      nombre_agents: parseInt(r.nombre_agents),
      total_cartes: parseInt(r.total_cartes),
      cartes_retirees: parseInt(r.cartes_retirees),
      cartes_restantes: parseInt(r.total_cartes) - parseInt(r.cartes_retirees),
      taux_retrait:
        parseInt(r.total_cartes) > 0
          ? Math.round((parseInt(r.cartes_retirees) / parseInt(r.total_cartes)) * 100)
          : 0,
    }));
  } catch (e) {
    console.warn('[Rapport] Agences indisponibles:', e.message);
  }

  // ── Par site ──────────────────────────────────────────────────────────────
  const sRes = await query(
    `
    SELECT
      "SITE DE RETRAIT"                                    AS site,
      coordination,
      COUNT(*)                                             AS total,
      COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})         AS retires,
      COUNT(*) FILTER (WHERE NOT (${CONDITION_RETIRES}))   AS restants
    FROM cartes
    WHERE deleted_at IS NULL
      AND "SITE DE RETRAIT" IS NOT NULL
      AND TRIM("SITE DE RETRAIT") != ''
      ${filtreCoord}
    GROUP BY "SITE DE RETRAIT", coordination
    ORDER BY total DESC
  `,
    params
  );

  const sites = sRes.rows.map((r) => ({
    site: r.site,
    coordination: r.coordination || '',
    total: parseInt(r.total),
    retires: parseInt(r.retires),
    restants: parseInt(r.restants),
    tauxRetrait:
      parseInt(r.total) > 0 ? Math.round((parseInt(r.retires) / parseInt(r.total)) * 100) : 0,
  }));

  return {
    total,
    retires,
    restants,
    tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
    metadata: { nb_coordinations: coords.length },
    coordinations: coords,
    agences,
    sites,
  };
}

// ─── Controller ───────────────────────────────────────────────────────────────
exports.genererExcel = async (req, res) => {
  try {
    const data = await collecterDonnees(req.user);
    const dataStr = JSON.stringify(data);
    const script = path.join(SCRIPTS_DIR, 'generer_rapport_excel.py');

    const b64 = execSync(`python3 "${script}" '${dataStr.replace(/'/g, "'\\''")}'`, {
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    })
      .toString()
      .trim();

    const buf = Buffer.from(b64, 'base64');
    const now = new Date().toISOString().slice(0, 10);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="GESCARD_Rapport_${now}.xlsx"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);

    console.log(
      `📊 [Rapport Excel] ${req.user.nomUtilisateur} — ${data.sites.length} sites — ${buf.length} octets`
    );
  } catch (err) {
    console.error('[Rapport Excel]', err.message);
    res
      .status(500)
      .json({ success: false, message: 'Erreur génération rapport Excel', error: err.message });
  }
};

exports.genererWord = async (req, res) => {
  try {
    const data = await collecterDonnees(req.user);
    const dataStr = JSON.stringify(data);
    const script = path.join(SCRIPTS_DIR, 'generer_rapport_word.js');

    const b64 = execSync(`node "${script}" '${dataStr.replace(/'/g, "'\\''")}'`, {
      timeout: 30000,
      maxBuffer: 50 * 1024 * 1024,
    })
      .toString()
      .trim();

    const buf = Buffer.from(b64, 'base64');
    const now = new Date().toISOString().slice(0, 10);

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    );
    res.setHeader('Content-Disposition', `attachment; filename="GESCARD_Rapport_${now}.docx"`);
    res.setHeader('Content-Length', buf.length);
    res.send(buf);

    console.log(
      `📄 [Rapport Word] ${req.user.nomUtilisateur} — ${data.sites.length} sites — ${buf.length} octets`
    );
  } catch (err) {
    console.error('[Rapport Word]', err.message);
    res
      .status(500)
      .json({ success: false, message: 'Erreur génération rapport Word', error: err.message });
  }
};
