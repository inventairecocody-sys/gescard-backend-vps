// routes/Cartes.js
const express = require('express');
const router = express.Router();
const db = require('../db/db');
const { verifyToken: verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const colonnes = require('../middleware/filtreColonnes');
const permission = require('../middleware/permission');
const cartesController = require('../Controllers/cartesController');

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================

const authMiddleware = (req, res, next) => {
  if (typeof verifierToken === 'function') {
    return verifierToken(req, res, next);
  }

  console.error("❌ ERREUR CRITIQUE: verifierToken n'est pas une fonction!");
  console.error('Type reçu:', typeof verifierToken);
  console.error('Valeur:', verifierToken);
  console.error('Vérifiez que le fichier middleware/auth.js exporte bien verifyToken');

  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️ MODE DÉVELOPPEMENT: Authentification désactivée');
    req.user = {
      id: 1,
      NomUtilisateur: 'dev_user',
      NomComplet: 'Développeur',
      Role: 'Administrateur',
      role: 'Administrateur',
      Agence: 'DEV',
      permissions: ['*'],
      level: 100,
    };
    return next();
  }

  return res.status(500).json({
    success: false,
    message: 'Erreur de configuration du serveur',
    error: "Middleware d'authentification manquant",
    timestamp: new Date().toISOString(),
  });
};

router.use(authMiddleware);

// ============================================
// ROUTES LÉGÈRES (sans paramètre :id) — DOIVENT être avant /:id
// ============================================

/**
 * Vérification de santé de l'API
 * GET /api/cartes/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API Cartes opérationnelle',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * ✅ NOUVEAU — Liste des coordinations distinctes (pour CoordinationDropdown)
 * GET /api/cartes/coordinations
 * - Administrateur : toutes les coordinations
 * - Gestionnaire / Chef d'équipe / Opérateur : leur coordination uniquement
 */
router.get('/coordinations', cartesController.getCoordinations);

/**
 * Récupérer les changements depuis une date
 * GET /api/cartes/changes?since=2024-01-01T00:00:00
 */
router.get('/changes', async (req, res) => {
  try {
    const { since } = req.query;

    if (!since) {
      return res.status(400).json({ success: false, message: 'Paramètre "since" requis' });
    }

    const result = await db.query(
      `SELECT * FROM cartes 
       WHERE dateimport > $1 
       ORDER BY dateimport DESC`,
      [since]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Synchronisation des données
 * POST /api/cartes/sync
 */
router.post('/sync', async (req, res) => {
  try {
    const { data, lastSync } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        message: 'Données de synchronisation invalides',
      });
    }

    let itemsToSync = data;

    if (lastSync) {
      itemsToSync = data.filter((item) => {
        return !item.dateimport || new Date(item.dateimport) > new Date(lastSync);
      });
      console.log(
        `📅 Synchronisation depuis ${lastSync}: ${itemsToSync.length} éléments à traiter`
      );
    }

    const results = { inserted: 0, updated: 0, errors: 0, lastSync: new Date().toISOString() };

    for (const item of itemsToSync) {
      try {
        const existing = await db.query('SELECT id FROM cartes WHERE id = $1', [item.id]);

        if (existing.rows.length > 0) {
          await db.query(
            `UPDATE cartes SET 
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
             coordination = $12,
             dateimport = NOW()
             WHERE id = $13`,
            [
              item["LIEU D'ENROLEMENT"],
              item['SITE DE RETRAIT'],
              item.rangement,
              item.nom,
              item.prenoms,
              item['DATE DE NAISSANCE'],
              item['LIEU NAISSANCE'],
              item.contact,
              item.delivrance,
              item['CONTACT DE RETRAIT'],
              item['DATE DE DELIVRANCE'],
              item.coordination,
              item.id,
            ]
          );
          results.updated++;
        } else {
          await db.query(
            `INSERT INTO cartes (
              id, "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement,
              nom, prenoms, "DATE DE NAISSANCE", "LIEU NAISSANCE",
              contact, delivrance, "CONTACT DE RETRAIT", "DATE DE DELIVRANCE",
              coordination, dateimport
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
            [
              item.id,
              item["LIEU D'ENROLEMENT"],
              item['SITE DE RETRAIT'],
              item.rangement,
              item.nom,
              item.prenoms,
              item['DATE DE NAISSANCE'],
              item['LIEU NAISSANCE'],
              item.contact,
              item.delivrance,
              item['CONTACT DE RETRAIT'],
              item['DATE DE DELIVRANCE'],
              item.coordination,
            ]
          );
          results.inserted++;
        }
      } catch (err) {
        console.error('❌ Erreur synchronisation item:', err);
        results.errors++;
      }
    }

    res.json({
      success: true,
      message: 'Synchronisation terminée',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur sync:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Récupérer les sites configurés
 * GET /api/cartes/sites
 */
router.get('/sites', (req, res) => {
  const sites = ['ADJAME', "CHU D'ANGRE", 'UNIVERSITE DE COCODY', 'LYCEE HOTELIER', 'BINGERVILLE'];

  res.json({
    success: true,
    data: sites,
    count: sites.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Statistiques détaillées
 * GET /api/cartes/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const total = await db.query('SELECT COUNT(*) as count FROM cartes');

    const parSite = await db.query(`
      SELECT 
        COALESCE("SITE DE RETRAIT", 'Non défini') as site,
        COUNT(*) as nombre
      FROM cartes
      GROUP BY "SITE DE RETRAIT"
      ORDER BY nombre DESC
    `);

    const parMois = await db.query(`
      SELECT 
        TO_CHAR(dateimport, 'YYYY-MM') as mois,
        COUNT(*) as nombre
      FROM cartes
      WHERE dateimport IS NOT NULL
      GROUP BY TO_CHAR(dateimport, 'YYYY-MM')
      ORDER BY mois DESC
      LIMIT 12
    `);

    res.json({
      success: true,
      data: {
        total: parseInt(total.rows[0].count),
        parSite: parSite.rows,
        parMois: parMois.rows,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Modifications par site
 * GET /api/cartes/modifications
 */
router.get('/modifications', async (req, res) => {
  try {
    const { site, dateDebut, dateFin } = req.query;

    let query = `
      SELECT 
        "SITE DE RETRAIT",
        COUNT(*) as total,
        MIN(dateimport) as premiere_modification,
        MAX(dateimport) as derniere_modification
      FROM cartes
      WHERE 1=1
    `;

    const params = [];

    if (site) {
      params.push(site);
      query += ` AND "SITE DE RETRAIT" = $${params.length}`;
    }
    if (dateDebut) {
      params.push(dateDebut);
      query += ` AND dateimport >= $${params.length}`;
    }
    if (dateFin) {
      params.push(dateFin);
      query += ` AND dateimport <= $${params.length}`;
    }

    query += ` GROUP BY "SITE DE RETRAIT" ORDER BY total DESC`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur modifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Récupérer les cartes avec filtres
 * GET /api/cartes
 */
router.get('/', async (req, res) => {
  try {
    const {
      nom,
      prenoms,
      siteRetrait,
      lieuEnrolement,
      rangement,
      dateNaissance,
      lieuNaissance,
      contact,
      contactRetrait,
      delivrance,
      dateDelivrance,
      coordination,
      site,
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(parseInt(limit) || 50, 500);
    const offset = (pageNum - 1) * limitNum;

    let dataQuery = `
      SELECT
        id,
        coordination,
        "LIEU D'ENROLEMENT"     AS "lieuEnrolement",
        "SITE DE RETRAIT"       AS "siteRetrait",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') AS "dateNaissance",
        "LIEU NAISSANCE"        AS "lieuNaissance",
        contact,
        delivrance,
        "CONTACT DE RETRAIT"    AS "contactRetrait",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') AS "dateDelivrance",
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') AS "dateCreation"
      FROM cartes
      WHERE 1=1
    `;

    const params = [];

    if (nom) {
      params.push(`%${nom}%`);
      dataQuery += ` AND nom ILIKE $${params.length}`;
    }
    if (prenoms) {
      params.push(`%${prenoms}%`);
      dataQuery += ` AND prenoms ILIKE $${params.length}`;
    }
    if (siteRetrait || site) {
      params.push(`%${siteRetrait || site}%`);
      dataQuery += ` AND "SITE DE RETRAIT" ILIKE $${params.length}`;
    }
    if (lieuEnrolement) {
      params.push(`%${lieuEnrolement}%`);
      dataQuery += ` AND "LIEU D'ENROLEMENT" ILIKE $${params.length}`;
    }
    if (rangement) {
      params.push(`%${rangement}%`);
      dataQuery += ` AND rangement ILIKE $${params.length}`;
    }
    if (dateNaissance) {
      params.push(dateNaissance);
      dataQuery += ` AND "DATE DE NAISSANCE" = $${params.length}`;
    }
    if (lieuNaissance) {
      params.push(`%${lieuNaissance}%`);
      dataQuery += ` AND "LIEU NAISSANCE" ILIKE $${params.length}`;
    }
    if (contact) {
      params.push(`%${contact}%`);
      dataQuery += ` AND contact ILIKE $${params.length}`;
    }
    if (contactRetrait) {
      params.push(`%${contactRetrait}%`);
      dataQuery += ` AND "CONTACT DE RETRAIT" ILIKE $${params.length}`;
    }
    if (delivrance !== undefined && delivrance !== '') {
      if (delivrance === true || delivrance === 'true' || delivrance === 'oui') {
        dataQuery += ` AND delivrance IS NOT NULL AND TRIM(COALESCE(delivrance,'')) != '' AND UPPER(delivrance) != 'NON'`;
      } else if (delivrance === false || delivrance === 'false' || delivrance === 'non') {
        dataQuery += ` AND (delivrance IS NULL OR TRIM(COALESCE(delivrance,'')) = '' OR UPPER(delivrance) = 'NON')`;
      }
    }
    if (dateDelivrance) {
      params.push(dateDelivrance);
      dataQuery += ` AND "DATE DE DELIVRANCE" = $${params.length}`;
    }
    if (coordination) {
      params.push(coordination);
      dataQuery += ` AND coordination = $${params.length}`;
    }

    // Filtre automatique par coordination selon le rôle
    if (req.user?.role === 'Gestionnaire' && req.user?.coordination && !coordination) {
      params.push(req.user.coordination);
      dataQuery += ` AND coordination = $${params.length}`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM cartes WHERE 1=1${dataQuery.split('WHERE 1=1')[1]}`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    dataQuery += ` ORDER BY nom, prenoms LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await db.query(dataQuery, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getCartes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ROUTES CRUD POUR L'APPLICATION WEB
// ============================================

/**
 * Récupérer toutes les cartes (pagination avancée) - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/list
 */
router.get('/list', role.peutAccederPage('inventaire'), async (req, res) => {
  try {
    const { page = 1, limit = 50, recherche = '' } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM cartes WHERE 1=1';
    const params = [];

    if (recherche) {
      params.push(`%${recherche}%`);
      query += ` AND (nom ILIKE $1 OR prenoms ILIKE $1)`;
    }

    if (req.user?.role === 'Gestionnaire' && req.user?.coordination) {
      params.push(req.user.coordination);
      const paramIndex = recherche ? params.length : 1;
      query += ` AND coordination = $${paramIndex}`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM cartes WHERE 1=1${query.split('WHERE')[1]}`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY nom, prenoms LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getCartesList:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Statistiques globales - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/statistiques
 */
router.get('/statistiques', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const userRole = req.user?.role;
    const coordination = req.user?.coordination;

    let query = `
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs
      FROM cartes
      WHERE 1=1
    `;

    const params = [];

    if (userRole === 'Gestionnaire' && coordination) {
      params.push(coordination);
      query += ` AND coordination = $1`;
    }

    const result = await db.query(query, params);
    const stats = result.rows[0];
    stats.taux_retrait =
      stats.total_cartes > 0 ? Math.round((stats.cartes_retirees / stats.total_cartes) * 100) : 0;

    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Erreur statistiques:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Mise à jour batch de cartes - PROTÉGÉ PAR RÔLE
 * PUT /api/cartes/batch
 */
router.put('/batch', role.peutImporterExporter, async (req, res) => {
  try {
    const { cartes } = req.body;

    if (!cartes || !Array.isArray(cartes)) {
      return res.status(400).json({ success: false, message: 'Liste de cartes invalide' });
    }

    const results = { success: 0, errors: 0 };

    for (const carte of cartes) {
      try {
        await db.query(
          `UPDATE cartes SET
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
              coordination = COALESCE($12, coordination),
              dateimport = NOW()
            WHERE id = $13`,
          [
            carte["LIEU D'ENROLEMENT"],
            carte['SITE DE RETRAIT'],
            carte.rangement,
            carte.nom,
            carte.prenoms,
            carte['DATE DE NAISSANCE'],
            carte['LIEU NAISSANCE'],
            carte.contact,
            carte.delivrance,
            carte['CONTACT DE RETRAIT'],
            carte['DATE DE DELIVRANCE'],
            carte.coordination,
            carte.id,
          ]
        );
        results.success++;
      } catch (err) {
        console.error('❌ Erreur mise à jour batch:', err);
        results.errors++;
      }
    }

    res.json({
      success: true,
      message: 'Mise à jour batch terminée',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur batch update:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Test de connexion
 * GET /api/cartes/test/connection
 */
router.get('/test/connection', async (req, res) => {
  try {
    const result = await db.query('SELECT version() as version, NOW() as time');

    res.json({
      success: true,
      message: 'Connexion à la base de données réussie',
      database: { version: result.rows[0].version, server_time: result.rows[0].time },
      server: {
        time: new Date().toISOString(),
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
    });
  } catch (error) {
    console.error('❌ Erreur test connexion:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur de connexion à la base de données',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// ROUTES AVEC PARAMÈTRE :id — DOIVENT être après les routes nommées
// ============================================

/**
 * Récupérer une carte par ID - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/:id
 */
router.get('/:id', role.peutAccederPage('inventaire'), cartesController.getCarteParId);

/**
 * Créer une nouvelle carte - PROTÉGÉ PAR RÔLE
 * POST /api/cartes
 */
router.post('/', role.peutModifierCarte, colonnes.filtrerColonnes, cartesController.createCarte);

/**
 * Mettre à jour une carte - PROTÉGÉ PAR RÔLE AVEC FILTRAGE
 * PUT /api/cartes/:id
 */
router.put('/:id', role.peutModifierCarte, colonnes.filtrerColonnes, cartesController.updateCarte);

/**
 * Supprimer une carte - PROTÉGÉ PAR RÔLE
 * DELETE /api/cartes/:id
 */
router.delete('/:id', role.peutModifierCarte, cartesController.deleteCarte);

module.exports = router;
