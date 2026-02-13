const express = require("express");
const router = express.Router();
const db = require("../db/db");
const { verifyToken } = require("../middleware/auth");
const { canEditColumns } = require("../middleware/auth");
const journalController = require("../Controllers/journalController");

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CARTES_CONFIG = {
  defaultLimit: 100,
  maxLimit: 10000,
  maxBatchSize: 1000,
  
  // Colonnes de la table cartes
  columns: [
    "id",
    "LIEU D'ENROLEMENT",
    "SITE DE RETRAIT",
    "rangement",
    "nom",
    "prenoms",
    "DATE DE NAISSANCE",
    "LIEU NAISSANCE",
    "contact",
    "delivrance",
    "CONTACT DE RETRAIT",
    "DATE DE DELIVRANCE",
    "dateimport",
    "importbatchid",
    "sourceimport"
  ],
  
  // Mapping des noms de colonnes (PostgreSQL vs API)
  columnMapping: {
    "id": "ID",
    "LIEU D'ENROLEMENT": "LIEU D'ENROLEMENT",
    "SITE DE RETRAIT": "SITE DE RETRAIT",
    "rangement": "RANGEMENT",
    "nom": "NOM",
    "prenoms": "PRENOMS",
    "DATE DE NAISSANCE": "DATE DE NAISSANCE",
    "LIEU NAISSANCE": "LIEU NAISSANCE",
    "contact": "CONTACT",
    "delivrance": "DELIVRANCE",
    "CONTACT DE RETRAIT": "CONTACT DE RETRAIT",
    "DATE DE DELIVRANCE": "DATE DE DELIVRANCE"
  },
  
  // Sites configurés
  sites: [
    "ADJAME",
    "CHU D'ANGRE", 
    "UNIVERSITE DE COCODY",
    "LYCEE HOTELIER",
    "BINGERVILLE",
    "SITE_6",
    "SITE_7",
    "SITE_8", 
    "SITE_9",
    "SITE_10"
  ]
};

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifyToken);

// ============================================
// ROUTES API DE SYNCHRONISATION
// ============================================

/**
 * Vérification de santé de l'API
 * GET /api/cartes/health
 */
router.get("/health", async (req, res) => {
  try {
    const result = await db.query('SELECT 1 as test, NOW() as time');
    
    res.json({
      success: true,
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur health:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Récupérer les changements depuis une date
 * GET /api/cartes/changes?since=2024-01-01T00:00:00
 */
router.get("/changes", async (req, res) => {
  try {
    const { since, limit = CARTES_CONFIG.maxLimit } = req.query;
    
    const sinceDate = since 
      ? new Date(since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const actualLimit = Math.min(parseInt(limit), CARTES_CONFIG.maxLimit);

    const result = await db.query(`
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      WHERE dateimport > $1
      ORDER BY dateimport ASC
      LIMIT $2
    `, [sinceDate, actualLimit]);

    const derniereModification = result.rows.length > 0
      ? result.rows[result.rows.length - 1].dateimport
      : sinceDate.toISOString();

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification,
      since: sinceDate.toISOString(),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des changements',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Synchronisation des données
 * POST /api/cartes/sync
 */
router.post("/sync", async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');
    
    const { donnees, source = 'api', batch_id } = req.body;

    if (!donnees || !Array.isArray(donnees)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Format invalide',
        message: 'Le champ "donnees" doit être un tableau'
      });
    }

    console.log(`🔄 Synchronisation: ${donnees.length} enregistrements depuis ${source}`);

    let imported = 0;
    let updated = 0;
    let errors = 0;
    const errorDetails = [];

    // Traitement par lots
    const BATCH_SIZE = 500;
    for (let i = 0; i < donnees.length; i += BATCH_SIZE) {
      const batch = donnees.slice(i, i + BATCH_SIZE);
      
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const index = i + j;

        try {
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Enregistrement ${index}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item["SITE DE RETRAIT"]?.toString().trim() || '';

          // Vérifier si la carte existe
          const existing = await client.query(`
            SELECT id FROM cartes 
            WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3
          `, [nom, prenoms, siteRetrait]);

          if (existing.rows.length > 0) {
            // Mise à jour
            await client.query(`
              UPDATE cartes SET
                "LIEU D'ENROLEMENT" = $1,
                "SITE DE RETRAIT" = $2,
                rangement = $3,
                nom = $4,
                prenoms = $5,
                "DATE DE NAISSANCE" = $6,
                "LIEU NAISSANCE" = $7,
                contact = $8,
                delivrance = $9,
                "CONTACT DE RETRAIT" = $10,
                "DATE DE DELIVRANCE" = $11,
                dateimport = NOW(),
                sourceimport = $12,
                batch_id = $13
              WHERE id = $14
            `, [
              item["LIEU D'ENROLEMENT"]?.toString().trim() || '',
              siteRetrait,
              item["RANGEMENT"]?.toString().trim() || '',
              nom,
              prenoms,
              item["DATE DE NAISSANCE"] ? new Date(item["DATE DE NAISSANCE"]) : null,
              item["LIEU NAISSANCE"]?.toString().trim() || '',
              item["CONTACT"]?.toString().trim() || '',
              item["DELIVRANCE"]?.toString().trim() || '',
              item["CONTACT DE RETRAIT"]?.toString().trim() || '',
              item["DATE DE DELIVRANCE"] ? new Date(item["DATE DE DELIVRANCE"]) : null,
              source,
              batch_id || null,
              existing.rows[0].id
            ]);
            updated++;
          } else {
            // Insertion
            await client.query(`
              INSERT INTO cartes (
                "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
                "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
                "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", sourceimport, batch_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
              item["LIEU D'ENROLEMENT"]?.toString().trim() || '',
              siteRetrait,
              item["RANGEMENT"]?.toString().trim() || '',
              nom,
              prenoms,
              item["DATE DE NAISSANCE"] ? new Date(item["DATE DE NAISSANCE"]) : null,
              item["LIEU NAISSANCE"]?.toString().trim() || '',
              item["CONTACT"]?.toString().trim() || '',
              item["DELIVRANCE"]?.toString().trim() || '',
              item["CONTACT DE RETRAIT"]?.toString().trim() || '',
              item["DATE DE DELIVRANCE"] ? new Date(item["DATE DE DELIVRANCE"]) : null,
              source,
              batch_id || null
            ]);
            imported++;
          }

        } catch (error) {
          errors++;
          errorDetails.push(`Enregistrement ${index}: ${error.message}`);
          console.error(`❌ Erreur enregistrement ${index}:`, error.message);
        }
      }
    }

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    // Journalisation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.NomUtilisateur,
      actionType: 'SYNC_CARTES',
      details: `Sync: ${imported} importés, ${updated} mis à jour, ${errors} erreurs`,
      tableName: 'cartes',
      importBatchID: batch_id
    });

    res.json({
      success: true,
      message: 'Synchronisation réussie',
      stats: {
        imported,
        updated,
        errors,
        totalProcessed: donnees.length
      },
      performance: {
        duration_ms: duration,
        records_per_second: Math.round(donnees.length / (duration / 1000))
      },
      batch_info: {
        batch_id: batch_id || 'N/A',
        source,
        timestamp: new Date().toISOString()
      },
      errorDetails: errorDetails.slice(0, 10)
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la synchronisation',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * Statistiques détaillées
 * GET /api/cartes/stats
 */
router.get("/stats", async (req, res) => {
  try {
    const globalStats = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques,
        MIN(dateimport) as premiere_importation,
        MAX(dateimport) as derniere_importation,
        COUNT(DISTINCT batch_id) as total_batches
      FROM cartes
    `);

    const topSites = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      data: {
        global: {
          ...globalStats.rows[0],
          total_cartes: parseInt(globalStats.rows[0].total_cartes),
          cartes_retirees: parseInt(globalStats.rows[0].cartes_retirees),
          sites_actifs: parseInt(globalStats.rows[0].sites_actifs),
          beneficiaires_uniques: parseInt(globalStats.rows[0].beneficiaires_uniques)
        },
        top_sites: topSites.rows,
        sites_configures: CARTES_CONFIG.sites
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Récupérer les sites configurés
 * GET /api/cartes/sites
 */
router.get("/sites", async (req, res) => {
  try {
    // Récupérer aussi les sites avec données
    const sitesActifs = await db.query(`
      SELECT DISTINCT "SITE DE RETRAIT" as site
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      ORDER BY site
    `);

    res.json({
      success: true,
      sites: CARTES_CONFIG.sites,
      sites_actifs: sitesActifs.rows.map(row => row.site),
      total_configures: CARTES_CONFIG.sites.length,
      total_actifs: sitesActifs.rows.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur getSites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Récupérer les cartes avec filtres
 * GET /api/cartes
 */
router.get("/", async (req, res) => {
  try {
    const {
      nom,
      prenom,
      contact,
      siteRetrait,
      lieuNaissance,
      dateDebut,
      dateFin,
      delivrance,
      page = 1,
      limit = CARTES_CONFIG.defaultLimit,
      export_all = 'false'
    } = req.query;

    const actualLimit = export_all === 'true' 
      ? CARTES_CONFIG.maxLimit
      : Math.min(parseInt(limit), CARTES_CONFIG.maxLimit);
    
    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    // Filtres
    if (nom && nom.trim()) {
      paramCount++;
      query += ` AND nom ILIKE $${paramCount}`;
      params.push(`%${nom.trim()}%`);
    }

    if (prenom && prenom.trim()) {
      paramCount++;
      query += ` AND prenoms ILIKE $${paramCount}`;
      params.push(`%${prenom.trim()}%`);
    }

    if (contact && contact.trim()) {
      paramCount++;
      const contactClean = contact.trim().replace(/\D/g, '');
      query += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
      params.push(`%${contactClean}%`, `%${contact.trim()}%`);
      paramCount++;
    }

    if (siteRetrait && siteRetrait.trim()) {
      paramCount++;
      query += ` AND "SITE DE RETRAIT" ILIKE $${paramCount}`;
      params.push(`%${siteRetrait.trim()}%`);
    }

    if (lieuNaissance && lieuNaissance.trim()) {
      paramCount++;
      query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
      params.push(`%${lieuNaissance.trim()}%`);
    }

    if (dateDebut) {
      paramCount++;
      query += ` AND dateimport >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dateimport <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }

    if (delivrance && delivrance.trim()) {
      paramCount++;
      query += ` AND delivrance ILIKE $${paramCount}`;
      params.push(`%${delivrance.trim()}%`);
    }

    // Pagination
    query += ` ORDER BY id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    const result = await db.query(query, params);

    // Compter le total
    let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    // Réappliquer les mêmes filtres pour le count
    if (nom && nom.trim()) {
      countParamCount++;
      countQuery += ` AND nom ILIKE $${countParamCount}`;
      countParams.push(`%${nom.trim()}%`);
    }
    if (prenom && prenom.trim()) {
      countParamCount++;
      countQuery += ` AND prenoms ILIKE $${countParamCount}`;
      countParams.push(`%${prenom.trim()}%`);
    }
    if (contact && contact.trim()) {
      countParamCount++;
      const contactClean = contact.trim().replace(/\D/g, '');
      countQuery += ` AND (contact ILIKE $${countParamCount} OR contact ILIKE $${countParamCount + 1})`;
      countParams.push(`%${contactClean}%`, `%${contact.trim()}%`);
      countParamCount++;
    }
    if (siteRetrait && siteRetrait.trim()) {
      countParamCount++;
      countQuery += ` AND "SITE DE RETRAIT" ILIKE $${countParamCount}`;
      countParams.push(`%${siteRetrait.trim()}%`);
    }
    if (lieuNaissance && lieuNaissance.trim()) {
      countParamCount++;
      countQuery += ` AND "LIEU NAISSANCE" ILIKE $${countParamCount}`;
      countParams.push(`%${lieuNaissance.trim()}%`);
    }
    if (dateDebut) {
      countParamCount++;
      countQuery += ` AND dateimport >= $${countParamCount}`;
      countParams.push(new Date(dateDebut));
    }
    if (dateFin) {
      countParamCount++;
      countQuery += ` AND dateimport <= $${countParamCount}`;
      countParams.push(new Date(dateFin + ' 23:59:59'));
    }
    if (delivrance && delivrance.trim()) {
      countParamCount++;
      countQuery += ` AND delivrance ILIKE $${countParamCount}`;
      countParams.push(`%${delivrance.trim()}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1
      },
      filters: {
        nom: nom || null,
        prenom: prenom || null,
        contact: contact || null,
        siteRetrait: siteRetrait || null,
        lieuNaissance: lieuNaissance || null,
        dateDebut: dateDebut || null,
        dateFin: dateFin || null,
        delivrance: delivrance || null
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des cartes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Modifications par site
 * GET /api/cartes/modifications
 */
router.get("/modifications", async (req, res) => {
  try {
    const { site, derniereSync, limit = 1000 } = req.query;

    if (!site || !derniereSync) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres manquants: site et derniereSync requis',
        timestamp: new Date().toISOString()
      });
    }

    const actualLimit = Math.min(parseInt(limit), CARTES_CONFIG.maxLimit);

    const result = await db.query(`
      SELECT * FROM cartes 
      WHERE "SITE DE RETRAIT" = $1 
      AND dateimport > $2
      ORDER BY dateimport ASC
      LIMIT $3
    `, [site, new Date(derniereSync), actualLimit]);

    let derniereModification = derniereSync;
    if (result.rows.length > 0) {
      derniereModification = result.rows[result.rows.length - 1].dateimport;
    }

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification,
      site,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur getModifications:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des modifications',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// ============================================
// ROUTES CRUD POUR L'APPLICATION WEB
// ============================================

/**
 * Récupérer toutes les cartes (avec pagination)
 * GET /api/cartes/all
 */
router.get("/all", async (req, res) => {
  try {
    const { page = 1, limit = CARTES_CONFIG.defaultLimit } = req.query;

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), CARTES_CONFIG.maxLimit);
    const offset = (actualPage - 1) * actualLimit;

    const result = await db.query(`
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      ORDER BY id DESC
      LIMIT $1 OFFSET $2
    `, [actualLimit, offset]);

    const countResult = await db.query('SELECT COUNT(*) as total FROM cartes');
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur GET /cartes/all:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des cartes",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Statistiques globales
 * GET /api/cartes/statistiques/total
 */
router.get("/statistiques/total", async (req, res) => {
  try {
    const totalResult = await db.query(`
      SELECT COUNT(*) as total FROM cartes
    `);

    const sitesResult = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
    `);

    const retireesResult = await db.query(`
      SELECT COUNT(*) as total FROM cartes 
      WHERE delivrance IS NOT NULL AND delivrance != ''
    `);

    const total = parseInt(totalResult.rows[0].total);
    const retirees = parseInt(retireesResult.rows[0].total);

    res.json({
      success: true,
      data: {
        total_cartes: total,
        cartes_retirees: retirees,
        taux_retrait: total > 0 ? Math.round((retirees / total) * 100) : 0,
        sites_repartition: sitesResult.rows,
        sites_configures: CARTES_CONFIG.sites
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur GET /cartes/statistiques/total:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération des statistiques",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Récupérer une carte par ID
 * GET /api/cartes/:id
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(`
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      WHERE id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "Carte non trouvée",
        timestamp: new Date().toISOString()
      });
    }

    res.json({
      success: true,
      data: result.rows[0],
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error(`❌ Erreur GET /cartes/${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la récupération de la carte",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Créer une nouvelle carte
 * POST /api/cartes
 */
router.post("/", canEditColumns, async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    const carte = req.body;

    // Validation
    if (!carte.NOM || !carte.PRENOMS) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: "Les champs NOM et PRENOMS sont obligatoires",
        timestamp: new Date().toISOString()
      });
    }

    const result = await client.query(`
      INSERT INTO cartes (
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        sourceimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING id
    `, [
      carte["LIEU D'ENROLEMENT"]?.toString().trim() || '',
      carte["SITE DE RETRAIT"]?.toString().trim() || '',
      carte.RANGEMENT?.toString().trim() || '',
      carte.NOM.toString().trim(),
      carte.PRENOMS.toString().trim(),
      carte["DATE DE NAISSANCE"] ? new Date(carte["DATE DE NAISSANCE"]) : null,
      carte["LIEU NAISSANCE"]?.toString().trim() || '',
      carte.CONTACT?.toString().trim() || '',
      carte.DELIVRANCE?.toString().trim() || '',
      carte["CONTACT DE RETRAIT"]?.toString().trim() || '',
      carte["DATE DE DELIVRANCE"] ? new Date(carte["DATE DE DELIVRANCE"]) : null,
      'web_app'
    ]);

    const newId = result.rows[0].id;

    // Journalisation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.NomUtilisateur,
      actionType: 'CREATE_CARTE',
      tableName: 'cartes',
      recordId: newId.toString(),
      details: `Création carte: ${carte.NOM} ${carte.PRENOMS}`,
      ip: req.ip
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: "Carte créée avec succès",
      data: {
        id: newId,
        nom: carte.NOM,
        prenoms: carte.PRENOMS
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur POST /cartes:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la création de la carte",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * Mise à jour batch de cartes
 * PUT /api/cartes/batch
 */
router.put("/batch", canEditColumns, async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    const { cartes } = req.body;

    if (!Array.isArray(cartes) || cartes.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: "Aucune carte reçue",
        timestamp: new Date().toISOString()
      });
    }

    // Filtrer les cartes valides
    const cartesValides = cartes.filter(c => c.id || c.ID);
    
    console.log(`📥 ${cartesValides.length}/${cartes.length} cartes valides à traiter`);

    let updated = 0;
    const details = [];

    for (const carte of cartesValides) {
      const id = carte.id || carte.ID;

      // Vérifier que la carte existe
      const existing = await client.query(
        'SELECT id FROM cartes WHERE id = $1',
        [id]
      );

      if (existing.rows.length === 0) {
        console.warn(`⚠️ Carte ID ${id} non trouvée`);
        continue;
      }

      await client.query(`
        UPDATE cartes SET
          "LIEU D'ENROLEMENT" = COALESCE($1, "LIEU D'ENROLEMENT"),
          "SITE DE RETRAIT" = COALESCE($2, "SITE DE RETRAIT"),
          rangement = COALESCE($3, rangement),
          nom = COALESCE($4, nom),
          prenoms = COALESCE($5, prenoms),
          "DATE DE NAISSANCE" = COALESCE($6, "DATE DE NAISSANCE"),
          "LIEU NAISSANCE" = COALESCE($7, "LIEU NAISSANCE"),
          contact = COALESCE($8, contact),
          delivrance = COALESCE($9, delivrance),
          "CONTACT DE RETRAIT" = COALESCE($10, "CONTACT DE RETRAIT"),
          "DATE DE DELIVRANCE" = COALESCE($11, "DATE DE DELIVRANCE"),
          dateimport = NOW()
        WHERE id = $12
      `, [
        carte["LIEU D'ENROLEMENT"]?.toString().trim() || null,
        carte["SITE DE RETRAIT"]?.toString().trim() || null,
        carte.RANGEMENT?.toString().trim() || null,
        carte.NOM?.toString().trim() || null,
        carte.PRENOMS?.toString().trim() || null,
        carte["DATE DE NAISSANCE"] ? new Date(carte["DATE DE NAISSANCE"]) : null,
        carte["LIEU NAISSANCE"]?.toString().trim() || null,
        carte.CONTACT?.toString().trim() || null,
        carte.DELIVRANCE?.toString().trim() || null,
        carte["CONTACT DE RETRAIT"]?.toString().trim() || null,
        carte["DATE DE DELIVRANCE"] ? new Date(carte["DATE DE DELIVRANCE"]) : null,
        id
      ]);

      updated++;
      details.push(`ID ${id}: ${carte.NOM} ${carte.PRENOMS}`);
    }

    // Journalisation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.NomUtilisateur,
      actionType: 'BATCH_UPDATE_CARTES',
      tableName: 'cartes',
      details: `Mise à jour batch: ${updated} cartes modifiées`,
      ip: req.ip
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `${updated} cartes mises à jour avec succès`,
      stats: {
        updated,
        ignored: cartes.length - cartesValides.length,
        total: cartes.length
      },
      details: details.slice(0, 20), // Limiter à 20 pour la réponse
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur PUT /cartes/batch:', error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la mise à jour des cartes",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * Mettre à jour une carte
 * PUT /api/cartes/:id
 */
router.put("/:id", canEditColumns, async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    const { id } = req.params;
    const carte = req.body;

    // Vérifier que la carte existe
    const existing = await client.query(
      'SELECT * FROM cartes WHERE id = $1',
      [id]
    );

    if (existing.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        success: false,
        error: "Carte non trouvée",
        timestamp: new Date().toISOString()
      });
    }

    const oldCarte = existing.rows[0];

    await client.query(`
      UPDATE cartes SET
        "LIEU D'ENROLEMENT" = $1,
        "SITE DE RETRAIT" = $2,
        rangement = $3,
        nom = $4,
        prenoms = $5,
        "DATE DE NAISSANCE" = $6,
        "LIEU NAISSANCE" = $7,
        contact = $8,
        delivrance = $9,
        "CONTACT DE RETRAIT" = $10,
        "DATE DE DELIVRANCE" = $11,
        dateimport = NOW()
      WHERE id = $12
    `, [
      carte["LIEU D'ENROLEMENT"]?.toString().trim() || oldCarte["LIEU D'ENROLEMENT"],
      carte["SITE DE RETRAIT"]?.toString().trim() || oldCarte["SITE DE RETRAIT"],
      carte.RANGEMENT?.toString().trim() || oldCarte.rangement,
      carte.NOM?.toString().trim() || oldCarte.nom,
      carte.PRENOMS?.toString().trim() || oldCarte.prenoms,
      carte["DATE DE NAISSANCE"] ? new Date(carte["DATE DE NAISSANCE"]) : oldCarte["DATE DE NAISSANCE"],
      carte["LIEU NAISSANCE"]?.toString().trim() || oldCarte["LIEU NAISSANCE"],
      carte.CONTACT?.toString().trim() || oldCarte.contact,
      carte.DELIVRANCE?.toString().trim() || oldCarte.delivrance,
      carte["CONTACT DE RETRAIT"]?.toString().trim() || oldCarte["CONTACT DE RETRAIT"],
      carte["DATE DE DELIVRANCE"] ? new Date(carte["DATE DE DELIVRANCE"]) : oldCarte["DATE DE DELIVRANCE"],
      id
    ]);

    // Journalisation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.NomUtilisateur,
      actionType: 'UPDATE_CARTE',
      tableName: 'cartes',
      recordId: id,
      oldValue: JSON.stringify(oldCarte),
      newValue: JSON.stringify(carte),
      details: `Modification carte ID ${id}`,
      ip: req.ip
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: "Carte mise à jour avec succès",
      data: {
        id,
        nom: carte.NOM || oldCarte.nom,
        prenoms: carte.PRENOMS || oldCarte.prenoms
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Erreur PUT /cartes/${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la mise à jour de la carte",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * Supprimer une carte
 * DELETE /api/cartes/:id
 */
router.delete("/:id", async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');
    
    const { id } = req.params;

    // Récupérer les infos avant suppression
    const carteResult = await client.query(
      'SELECT nom, prenoms FROM cartes WHERE id = $1',
      [id]
    );

    if (carteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        success: false,
        error: "Carte non trouvée",
        timestamp: new Date().toISOString()
      });
    }

    const carte = carteResult.rows[0];

    await client.query(
      'DELETE FROM cartes WHERE id = $1',
      [id]
    );

    // Journalisation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.NomUtilisateur,
      actionType: 'DELETE_CARTE',
      tableName: 'cartes',
      recordId: id,
      details: `Suppression carte ID ${id}: ${carte.nom} ${carte.prenoms}`,
      ip: req.ip
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: "Carte supprimée avec succès",
      data: {
        id,
        nom: carte.nom,
        prenoms: carte.prenoms
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error(`❌ Erreur DELETE /cartes/${req.params.id}:`, error);
    res.status(500).json({
      success: false,
      error: "Erreur lors de la suppression de la carte",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  } finally {
    client.release();
  }
});

/**
 * Test de connexion
 * GET /api/cartes/test/connection
 */
router.get("/test/connection", async (req, res) => {
  try {
    const result = await db.query('SELECT version() as version');
    
    res.json({
      success: true,
      message: "Connexion à la base de données réussie",
      version: result.rows[0].version,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur test connexion:', error);
    res.status(500).json({
      success: false,
      error: "Erreur de connexion à la base de données",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;