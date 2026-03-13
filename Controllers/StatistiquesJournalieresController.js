// Controllers/StatistiquesJournalieresController.js
const { query } = require('../db/db');

const CONDITION_RETIRES = `delivrance IS NOT NULL AND TRIM(delivrance) != '' AND UPPER(TRIM(delivrance)) != 'NON'`;

// Un retrait du jour = carte retirée dont "DATE DE DELIVRANCE" = date demandée
const CONDITION_RETRAIT_JOUR = (param) =>
  `${CONDITION_RETIRES} AND DATE("DATE DE DELIVRANCE") = $${param}`;

exports.getStatistiquesParDate = async (req, res) => {
  try {
    const { date, coordination_id, agence_id, site } = req.query;
    const user = req.user;

    if (!date) {
      return res.status(400).json({ error: 'La date est requise (format : YYYY-MM-DD)' });
    }

    // Paramètre 1 = date
    const params = [date];
    const conditions = [`c.deleted_at IS NULL`];

    // Sécurité rôle
    if (user.role !== 'Administrateur') {
      if (user.coordination) {
        params.push(user.coordination);
        conditions.push(`c.coordination = $${params.length}`);
      }
    }

    // Filtres optionnels
    if (coordination_id) {
      params.push(coordination_id);
      conditions.push(`co.id = $${params.length}`);
    }
    if (agence_id) {
      params.push(agence_id);
      conditions.push(`a.id = $${params.length}`);
    }
    if (site) {
      params.push(site);
      conditions.push(`c."SITE DE RETRAIT" = $${params.length}`);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const retraitJour = CONDITION_RETRAIT_JOUR(1); // $1 = date

    const joinsSites = `
      LEFT JOIN sites s        ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom))
      LEFT JOIN agences a      ON s.agence_id = a.id
      LEFT JOIN coordinations co ON a.coordination_id = co.id
    `;

    // ── Global du jour ────────────────────────────────────────────────────────
    const globalQuery = `
      SELECT
        COUNT(*) FILTER (WHERE ${retraitJour})  AS retraits_jour,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES}) AS total_retires_cumul,
        COUNT(*)                                 AS total_cartes
      FROM cartes c
      ${joinsSites}
      ${where}
    `;

    // ── Par coordination ───────────────────────────────────────────────────────
    const coordQuery = `
      SELECT
        co.id,
        co.nom                                           AS coordination,
        COUNT(*) FILTER (WHERE ${retraitJour})           AS retraits_jour,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})     AS total_retires_cumul,
        COUNT(*)                                         AS total_cartes
      FROM cartes c
      ${joinsSites}
      ${where}
      GROUP BY co.id, co.nom
      ORDER BY retraits_jour DESC
    `;

    // ── Par agence ─────────────────────────────────────────────────────────────
    const agenceQuery = `
      SELECT
        a.id                                             AS agence_id,
        a.nom                                            AS agence,
        co.nom                                           AS coordination,
        COUNT(*) FILTER (WHERE ${retraitJour})           AS retraits_jour,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})     AS total_retires_cumul,
        COUNT(*)                                         AS total_cartes
      FROM cartes c
      ${joinsSites}
      ${where}
      GROUP BY a.id, a.nom, co.nom
      ORDER BY retraits_jour DESC
    `;

    // ── Par site ───────────────────────────────────────────────────────────────
    const siteQuery = `
      SELECT
        c."SITE DE RETRAIT"                              AS site,
        c.coordination,
        a.nom                                            AS agence,
        COUNT(*) FILTER (WHERE ${retraitJour})           AS retraits_jour,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})     AS total_retires_cumul,
        COUNT(*)                                         AS total_cartes
      FROM cartes c
      LEFT JOIN sites s        ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom))
      LEFT JOIN agences a      ON s.agence_id = a.id
      ${where}
      GROUP BY c."SITE DE RETRAIT", c.coordination, a.nom
      ORDER BY retraits_jour DESC
    `;

    const [global, coords, agences, sites] = await Promise.all([
      query(globalQuery, params),
      query(coordQuery, params),
      query(agenceQuery, params),
      query(siteQuery, params),
    ]);

    res.json({
      date,
      global: global.rows[0] || { retraits_jour: 0, total_retires_cumul: 0, total_cartes: 0 },
      coordinations: coords.rows,
      agences: agences.rows,
      sites: sites.rows,
    });
  } catch (error) {
    console.error('[Statistiques Journalières]', error);
    res.status(500).json({ error: error.message });
  }
};
