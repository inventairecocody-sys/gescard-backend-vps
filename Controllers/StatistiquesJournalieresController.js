// Controllers/StatistiquesJournalieresController.js
const { query } = require('../db/db');

// ✅ Définition de la constante (identique à celle utilisée dans RapportController.js)
const CONDITION_RETIRES = `delivrance IS NOT NULL AND TRIM(delivrance) != '' AND UPPER(TRIM(delivrance)) != 'NON'`;

exports.getStatistiquesParDate = async (req, res) => {
  try {
    const { date, coordination_id, agence_id, site } = req.query;
    const user = req.user;

    let params = [];
    let conditions = [];

    // Filtre par date (obligatoire)
    if (!date) {
      return res.status(400).json({ error: 'La date est requise' });
    }
    params.push(date);
    conditions.push(`DATE(c.date_import) = $${params.length}`);

    // Filtres selon les droits utilisateur
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Statistiques globales du jour
    const globalQuery = `
      SELECT 
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES}) AS retraits_jour,
        COUNT(*) AS total_concernes
      FROM cartes c
      LEFT JOIN sites s ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom))
      LEFT JOIN agences a ON s.agence_id = a.id
      LEFT JOIN coordinations co ON a.coordination_id = co.id
      ${whereClause}
    `;

    // Statistiques par coordination
    const coordQuery = `
      SELECT 
        co.id,
        co.nom AS coordination,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES}) AS retraits_jour,
        COUNT(*) AS total_concernes
      FROM cartes c
      LEFT JOIN sites s ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom))
      LEFT JOIN agences a ON s.agence_id = a.id
      LEFT JOIN coordinations co ON a.coordination_id = co.id
      ${whereClause}
      GROUP BY co.id, co.nom
      ORDER BY retraits_jour DESC
    `;

    // Statistiques par agence
    const agenceQuery = `
      SELECT 
        a.id AS agence_id,
        a.nom AS agence,
        co.nom AS coordination,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES}) AS retraits_jour,
        COUNT(*) AS total_concernes
      FROM cartes c
      LEFT JOIN sites s ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom))
      LEFT JOIN agences a ON s.agence_id = a.id
      LEFT JOIN coordinations co ON a.coordination_id = co.id
      ${whereClause}
      GROUP BY a.id, a.nom, co.nom
      ORDER BY retraits_jour DESC
    `;

    // Statistiques par site
    const siteQuery = `
      SELECT 
        c."SITE DE RETRAIT" AS site,
        c.coordination,
        a.nom AS agence,
        COUNT(*) FILTER (WHERE ${CONDITION_RETIRES}) AS retraits_jour,
        COUNT(*) AS total_concernes
      FROM cartes c
      LEFT JOIN sites s ON LOWER(TRIM(c."SITE DE RETRAIT")) = LOWER(TRIM(s.nom))
      LEFT JOIN agences a ON s.agence_id = a.id
      ${whereClause}
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
      global: global.rows[0] || { retraits_jour: 0, total_concernes: 0 },
      coordinations: coords.rows,
      agences: agences.rows,
      sites: sites.rows,
    });
  } catch (error) {
    console.error('[Statistiques Journalières]', error);
    res.status(500).json({ error: error.message });
  }
};
