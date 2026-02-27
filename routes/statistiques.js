const express = require('express');
const router = express.Router();
const db = require('../db/db'); // Renommé pour éviter le shadowing
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const STATS_CONFIG = {
  // Cache des statistiques (5 minutes)
  cache: {
    globales: { data: null, timestamp: null, coordination: null },
    sites: { data: null, timestamp: null, coordination: null },
    detail: { data: null, timestamp: null, coordination: null },
  },
  cacheTimeout: 5 * 60 * 1000, // 5 minutes en millisecondes

  // Rate limiting (sera appliqué via middleware global)
  rateLimits: {
    globales: 30, // 30 req/min
    sites: 30,
    detail: 20,
    refresh: 5, // 5 req/heure
  },
};

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Vérifie si le cache est valide pour une coordination donnée
 */
const isCacheValid = (cacheKey, coordination = null) => {
  const cache = STATS_CONFIG.cache[cacheKey];
  if (!cache || !cache.timestamp) return false;

  // Si le cache est pour une coordination différente, invalider
  if (cache.coordination !== coordination) return false;

  const now = Date.now();
  return now - cache.timestamp < STATS_CONFIG.cacheTimeout;
};

/**
 * Ajoute un filtre de coordination à une requête SQL
 */
const ajouterFiltreCoordination = (req, sqlQuery, params = []) => {
  const userRole = req.user?.role;
  const coordination = req.user?.coordination;

  // Admin voit tout
  if (userRole === 'Administrateur') {
    return { query: sqlQuery, params };
  }

  // Gestionnaire et Chef d'équipe: filtrés par coordination
  if ((userRole === 'Gestionnaire' || userRole === "Chef d'équipe") && coordination) {
    return {
      query: sqlQuery + ` AND coordination = $${params.length + 1}`,
      params: [...params, coordination],
    };
  }

  return { query: sqlQuery, params };
};

/**
 * Formate les statistiques globales
 */
const formatGlobales = (row) => ({
  total: parseInt(row.total) || 0,
  retires: parseInt(row.retires) || 0,
  restants: (parseInt(row.total) || 0) - (parseInt(row.retires) || 0),
  tauxRetrait:
    parseInt(row.total) > 0 ? Math.round((parseInt(row.retires) / parseInt(row.total)) * 100) : 0,
});

/**
 * Formate les statistiques par site
 */
const formatSites = (rows) =>
  rows.map((row) => ({
    site: row.site,
    total: parseInt(row.total) || 0,
    retires: parseInt(row.retires) || 0,
    restants: (parseInt(row.total) || 0) - (parseInt(row.retires) || 0),
    tauxRetrait:
      parseInt(row.total) > 0 ? Math.round((parseInt(row.retires) / parseInt(row.total)) * 100) : 0,
  }));

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// Middleware de logging
router.use((req, res, next) => {
  console.log(
    `📊 [Statistiques] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur} (${req.user?.role}) - Coordination: ${req.user?.coordination || 'Aucune'}`
  );
  next();
});

// Middleware de cache-control
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, max-age=300'); // 5 minutes
  next();
});

// ============================================
// ROUTES PRINCIPALES
// ============================================

/**
 * 🔹 STATISTIQUES GLOBALES AVEC CACHE ET FILTRAGE PAR COORDINATION
 * GET /api/statistiques/globales
 */
router.get('/globales', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const { forceRefresh } = req.query;
    const startTime = Date.now();
    const coordination = req.user?.coordination;

    // Vérifier le cache
    if (!forceRefresh && isCacheValid('globales', coordination)) {
      console.log(
        `📦 Statistiques globales servies depuis le cache pour coordination: ${coordination || 'toutes'}`
      );
      return res.json({
        ...STATS_CONFIG.cache.globales.data,
        cached: true,
        cacheAge: Math.round((Date.now() - STATS_CONFIG.cache.globales.timestamp) / 1000) + 's',
        filtres: {
          role: req.user.role,
          coordination: coordination || 'toutes',
        },
        performance: {
          queryTime: 0,
        },
      });
    }

    console.log(
      `📊 Calcul des statistiques globales pour coordination: ${coordination || 'toutes'}...`
    );

    // Construire la requête avec filtre de coordination
    let queryText = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE 
          WHEN delivrance IS NOT NULL 
          AND TRIM(COALESCE(delivrance, '')) != '' 
          AND UPPER(delivrance) != 'NON'
          THEN 1 
        END) as retires,
        MIN(dateimport) as premiere_importation,
        MAX(dateimport) as derniere_importation,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques
      FROM cartes
      WHERE 1=1
    `;

    const { query: finalQuery, params } = ajouterFiltreCoordination(req, queryText, []);

    const result = await db.query(finalQuery, params);

    const stats = formatGlobales(result.rows[0]);

    // Enrichir avec des métadonnées
    const response = {
      ...stats,
      metadata: {
        premiere_importation: result.rows[0].premiere_importation,
        derniere_importation: result.rows[0].derniere_importation,
        sites_actifs: parseInt(result.rows[0].sites_actifs) || 0,
        beneficiaires_uniques: parseInt(result.rows[0].beneficiaires_uniques) || 0,
      },
      filtres: {
        role: req.user.role,
        coordination: coordination || 'toutes',
      },
    };

    // Mettre en cache
    STATS_CONFIG.cache.globales = {
      data: response,
      timestamp: Date.now(),
      coordination: coordination,
    };

    const duration = Date.now() - startTime;
    console.log(`✅ Statistiques globales calculées en ${duration}ms`);

    res.json({
      ...response,
      cached: false,
      performance: {
        queryTime: duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur statistiques globales:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du calcul des statistiques globales',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 🔹 STATISTIQUES PAR SITE AVEC CACHE ET FILTRAGE PAR COORDINATION
 * GET /api/statistiques/sites
 */
router.get('/sites', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const { forceRefresh, limit = 50 } = req.query;
    const startTime = Date.now();
    const actualLimit = Math.min(parseInt(limit), 100);
    const coordination = req.user?.coordination;

    // Vérifier le cache
    if (!forceRefresh && isCacheValid('sites', coordination)) {
      console.log(
        `📦 Statistiques par site servies depuis le cache pour coordination: ${coordination || 'toutes'}`
      );
      return res.json({
        sites: STATS_CONFIG.cache.sites.data,
        cached: true,
        cacheAge: Math.round((Date.now() - STATS_CONFIG.cache.sites.timestamp) / 1000) + 's',
        filtres: {
          role: req.user.role,
          coordination: coordination || 'toutes',
        },
        performance: {
          queryTime: 0,
        },
      });
    }

    console.log(
      `🏢 Calcul des statistiques par site pour coordination: ${coordination || 'toutes'}...`
    );

    // Construire la requête avec filtre de coordination
    let queryText = `
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total,
        COUNT(CASE 
          WHEN delivrance IS NOT NULL 
          AND TRIM(COALESCE(delivrance, '')) != '' 
          AND UPPER(delivrance) != 'NON'
          THEN 1 
        END) as retires,
        MIN(dateimport) as premier_import,
        MAX(dateimport) as dernier_import,
        COUNT(DISTINCT nom) as beneficiaires_uniques
      FROM cartes
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      AND TRIM(COALESCE("SITE DE RETRAIT", '')) != ''
    `;

    const { query: finalQuery, params } = ajouterFiltreCoordination(req, queryText, []);

    // Ajouter GROUP BY et ORDER BY après le filtre
    const finalQueryWithGroup =
      finalQuery +
      `
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total DESC
      LIMIT $${params.length + 1}
    `;

    const result = await db.query(finalQueryWithGroup, [...params, actualLimit]);

    const stats = formatSites(result.rows);

    // Ajouter des totaux
    const totals = stats.reduce(
      (acc, site) => ({
        total: acc.total + site.total,
        retires: acc.retires + site.retires,
        restants: acc.restants + site.restants,
      }),
      { total: 0, retires: 0, restants: 0 }
    );

    const response = {
      sites: stats,
      totals: {
        ...totals,
        tauxRetraitGlobal: totals.total > 0 ? Math.round((totals.retires / totals.total) * 100) : 0,
      },
      count: stats.length,
      filtres: {
        role: req.user.role,
        coordination: coordination || 'toutes',
      },
    };

    // Mettre en cache
    STATS_CONFIG.cache.sites = {
      data: response,
      timestamp: Date.now(),
      coordination: coordination,
    };

    const duration = Date.now() - startTime;
    console.log(`✅ ${stats.length} sites analysés en ${duration}ms`);

    res.json({
      ...response,
      cached: false,
      performance: {
        queryTime: duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur statistiques sites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du calcul des statistiques par site',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 🔹 STATISTIQUES DÉTAILLÉES (tout en un) AVEC FILTRAGE
 * GET /api/statistiques/detail
 */
router.get('/detail', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const { forceRefresh } = req.query;
    const startTime = Date.now();
    const coordination = req.user?.coordination;

    // Vérifier le cache
    if (!forceRefresh && isCacheValid('detail', coordination)) {
      console.log(
        `📦 Statistiques détaillées servies depuis le cache pour coordination: ${coordination || 'toutes'}`
      );
      return res.json({
        ...STATS_CONFIG.cache.detail.data,
        cached: true,
        cacheAge: Math.round((Date.now() - STATS_CONFIG.cache.detail.timestamp) / 1000) + 's',
        filtres: {
          role: req.user.role,
          coordination: coordination || 'toutes',
        },
        performance: {
          queryTime: 0,
        },
      });
    }

    // Construire les requêtes avec filtres
    let globalesQuery = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE 
          WHEN delivrance IS NOT NULL 
          AND TRIM(COALESCE(delivrance, '')) != '' 
          AND UPPER(delivrance) != 'NON'
          THEN 1 
        END) as retires,
        MIN(dateimport) as premiere_importation,
        MAX(dateimport) as derniere_importation,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques
      FROM cartes
      WHERE 1=1
    `;

    let sitesQuery = `
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total,
        COUNT(CASE 
          WHEN delivrance IS NOT NULL 
          AND TRIM(COALESCE(delivrance, '')) != '' 
          AND UPPER(delivrance) != 'NON'
          THEN 1 
        END) as retires
      FROM cartes
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      AND TRIM(COALESCE("SITE DE RETRAIT", '')) != ''
    `;

    let evolutionQuery = `
      SELECT 
        DATE_TRUNC('day', dateimport) as jour,
        COUNT(*) as imports,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_concernes
      FROM cartes
      WHERE dateimport > NOW() - INTERVAL '30 days'
    `;

    // Appliquer les filtres de coordination
    const { query: finalGlobales, params: globalesParams } = ajouterFiltreCoordination(
      req,
      globalesQuery,
      []
    );
    const { query: finalSites, params: sitesParams } = ajouterFiltreCoordination(
      req,
      sitesQuery,
      []
    );
    const { query: finalEvolution, params: evolutionParams } = ajouterFiltreCoordination(
      req,
      evolutionQuery,
      []
    );

    // Ajouter GROUP BY pour les requêtes qui en ont besoin
    const finalSitesWithGroup = finalSites + ` GROUP BY "SITE DE RETRAIT" ORDER BY total DESC`;
    const finalEvolutionWithGroup =
      finalEvolution + ` GROUP BY DATE_TRUNC('day', dateimport) ORDER BY jour DESC`;

    // Exécuter les requêtes en parallèle
    const [globalesResult, sitesResult, evolutionResult] = await Promise.all([
      db.query(finalGlobales, globalesParams),
      db.query(finalSitesWithGroup, sitesParams),
      db.query(finalEvolutionWithGroup, evolutionParams),
    ]);

    const globales = formatGlobales(globalesResult.rows[0]);
    const sites = formatSites(sitesResult.rows);

    const response = {
      globales: {
        ...globales,
        metadata: {
          premiere_importation: globalesResult.rows[0].premiere_importation,
          derniere_importation: globalesResult.rows[0].derniere_importation,
          sites_actifs: parseInt(globalesResult.rows[0].sites_actifs) || 0,
          beneficiaires_uniques: parseInt(globalesResult.rows[0].beneficiaires_uniques) || 0,
        },
      },
      sites: sites,
      evolution: evolutionResult.rows.map((row) => ({
        jour: row.jour,
        imports: parseInt(row.imports),
        sites_concernes: parseInt(row.sites_concernes),
      })),
      resume: {
        total_sites: sites.length,
        total_imports_30j: evolutionResult.rows.reduce(
          (acc, row) => acc + parseInt(row.imports),
          0
        ),
        moyenne_quotidienne:
          evolutionResult.rows.length > 0
            ? Math.round(
                evolutionResult.rows.reduce((acc, row) => acc + parseInt(row.imports), 0) /
                  evolutionResult.rows.length
              )
            : 0,
      },
      filtres: {
        role: req.user.role,
        coordination: coordination || 'toutes',
      },
    };

    // Mettre en cache
    STATS_CONFIG.cache.detail = {
      data: response,
      timestamp: Date.now(),
      coordination: coordination,
    };

    const duration = Date.now() - startTime;
    console.log(`✅ Statistiques détaillées calculées en ${duration}ms`);

    res.json({
      ...response,
      cached: false,
      performance: {
        queryTime: duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur statistiques détail:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du calcul des statistiques détaillées',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 🔥 FORCER LE REFRESH DU CACHE
 * POST /api/statistiques/refresh
 */
router.post('/refresh', permission.peutVoirStatistiques, async (req, res) => {
  try {
    console.log('🔄 Forçage du recalcul des statistiques...');

    // Vider le cache
    STATS_CONFIG.cache.globales = { data: null, timestamp: null, coordination: null };
    STATS_CONFIG.cache.sites = { data: null, timestamp: null, coordination: null };
    STATS_CONFIG.cache.detail = { data: null, timestamp: null, coordination: null };

    res.json({
      success: true,
      message: 'Cache des statistiques vidé avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur refresh statistiques:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors du refresh des statistiques',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

/**
 * 🔹 STATISTIQUES TEMPORELLES AVEC FILTRAGE
 * GET /api/statistiques/evolution?periode=30
 */
router.get('/evolution', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const { periode = 30, interval = 'day' } = req.query;
    const jours = Math.min(parseInt(periode), 365);

    let intervalSql;
    switch (interval) {
      case 'hour':
        intervalSql = 'hour';
        break;
      case 'week':
        intervalSql = 'week';
        break;
      case 'month':
        intervalSql = 'month';
        break;
      default:
        intervalSql = 'day';
    }

    // Construire la requête avec filtre
    let queryText = `
      SELECT 
        DATE_TRUNC($1, dateimport) as periode,
        COUNT(*) as total_imports,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT importbatchid) as batches
      FROM cartes
      WHERE dateimport > NOW() - INTERVAL '${jours} days'
    `;

    const { query: finalQuery, params } = ajouterFiltreCoordination(req, queryText, [intervalSql]);

    const finalQueryWithGroup =
      finalQuery +
      `
      GROUP BY DATE_TRUNC($1, dateimport)
      ORDER BY periode DESC
    `;

    const result = await db.query(finalQueryWithGroup, params);

    res.json({
      success: true,
      evolution: result.rows.map((row) => ({
        periode: row.periode,
        imports: parseInt(row.total_imports),
        sites_actifs: parseInt(row.sites_actifs),
        batches: parseInt(row.batches),
      })),
      parametres: {
        periode_jours: jours,
        intervalle: interval,
        points: result.rows.length,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur statistiques évolution:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔹 STATISTIQUES RAPIDES (pour tableaux de bord)
 * GET /api/statistiques/quick
 */
router.get('/quick', permission.peutVoirStatistiques, async (req, res) => {
  try {
    // Construire la requête avec filtre
    let queryText = `
      SELECT 
        COUNT(*) as total,
        COUNT(CASE 
          WHEN delivrance IS NOT NULL 
          AND TRIM(COALESCE(delivrance, '')) != '' 
          AND UPPER(delivrance) != 'NON'
          THEN 1 
        END) as retires,
        COUNT(CASE 
          WHEN dateimport > NOW() - INTERVAL '24 hours' THEN 1 
        END) as imports_24h,
        COUNT(CASE 
          WHEN dateimport > NOW() - INTERVAL '7 days' THEN 1 
        END) as imports_7j
      FROM cartes
      WHERE 1=1
    `;

    const { query: finalQuery, params } = ajouterFiltreCoordination(req, queryText, []);

    const result = await db.query(finalQuery, params);

    const stats = result.rows[0];

    res.json({
      success: true,
      stats: {
        total: parseInt(stats.total) || 0,
        retires: parseInt(stats.retires) || 0,
        restants: (parseInt(stats.total) || 0) - (parseInt(stats.retires) || 0),
        imports_24h: parseInt(stats.imports_24h) || 0,
        imports_7j: parseInt(stats.imports_7j) || 0,
      },
      filtres: {
        role: req.user.role,
        coordination: req.user.coordination || 'toutes',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur stats rapides:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔹 STATISTIQUES PAR LOT D'IMPORT AVEC FILTRAGE
 * GET /api/statistiques/imports
 */
router.get('/imports', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const { limit = 10 } = req.query;
    const actualLimit = Math.min(parseInt(limit), 50);

    // Construire la requête avec filtre
    let queryText = `
      SELECT 
        importbatchid,
        COUNT(*) as total_cartes,
        MIN(dateimport) as date_debut,
        MAX(dateimport) as date_fin,
        COUNT(CASE 
          WHEN delivrance IS NOT NULL 
          AND TRIM(COALESCE(delivrance, '')) != '' 
          AND UPPER(delivrance) != 'NON'
          THEN 1 
        END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_concernes,
        MIN(coordination) as coordination
      FROM cartes
      WHERE importbatchid IS NOT NULL
    `;

    const { query: finalQuery, params } = ajouterFiltreCoordination(req, queryText, []);

    const finalQueryWithGroup =
      finalQuery +
      `
      GROUP BY importbatchid
      ORDER BY date_debut DESC
      LIMIT $${params.length + 1}
    `;

    const result = await db.query(finalQueryWithGroup, [...params, actualLimit]);

    res.json({
      success: true,
      imports: result.rows.map((row) => ({
        batch_id: row.importbatchid,
        total_cartes: parseInt(row.total_cartes),
        cartes_retirees: parseInt(row.cartes_retirees),
        taux_retrait:
          row.total_cartes > 0 ? Math.round((row.cartes_retirees / row.total_cartes) * 100) : 0,
        date_debut: row.date_debut,
        date_fin: row.date_fin,
        sites_concernes: parseInt(row.sites_concernes),
        coordination: row.coordination,
        duree_minutes:
          row.date_debut && row.date_fin
            ? Math.round((new Date(row.date_fin) - new Date(row.date_debut)) / 60000)
            : 0,
      })),
      filtres: {
        role: req.user.role,
        coordination: req.user.coordination || 'toutes',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur stats imports:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔹 DIAGNOSTIC DES STATISTIQUES
 * GET /api/statistiques/diagnostic
 */
router.get('/diagnostic', role.peutAccederPage('statistiques'), async (req, res) => {
  try {
    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_distincts,
        COUNT(DISTINCT importbatchid) as batches_distincts,
        COUNT(DISTINCT coordination) as coordinations_distinctes,
        MIN(dateimport) as premiere_carte,
        MAX(dateimport) as derniere_carte,
        pg_total_relation_size('cartes') as table_size,
        pg_size_pretty(pg_total_relation_size('cartes')) as table_size_pretty
      FROM cartes
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'statistiques',
      utilisateur: {
        role: req.user.role,
        coordination: req.user.coordination,
      },
      statistiques: {
        total_cartes: parseInt(stats.total_cartes),
        sites_distincts: parseInt(stats.sites_distincts),
        batches_distincts: parseInt(stats.batches_distincts),
        coordinations_distinctes: parseInt(stats.coordinations_distinctes),
        premiere_carte: stats.premiere_carte,
        derniere_carte: stats.derniere_carte,
      },
      stockage: {
        taille_table: stats.table_size_pretty,
        taille_bytes: parseInt(stats.table_size),
      },
      cache: {
        globales: STATS_CONFIG.cache.globales.timestamp ? 'actif' : 'inactif',
        sites: STATS_CONFIG.cache.sites.timestamp ? 'actif' : 'inactif',
        detail: STATS_CONFIG.cache.detail.timestamp ? 'actif' : 'inactif',
        age_globales: STATS_CONFIG.cache.globales.timestamp
          ? Math.round((Date.now() - STATS_CONFIG.cache.globales.timestamp) / 1000) + 's'
          : null,
        coordination_courante: STATS_CONFIG.cache.globales.coordination || 'toutes',
      },
      performance: {
        queryTime: Date.now() - startTime,
      },
      endpoints: [
        '/api/statistiques/globales',
        '/api/statistiques/sites',
        '/api/statistiques/detail',
        '/api/statistiques/evolution',
        '/api/statistiques/quick',
        '/api/statistiques/imports',
        '/api/statistiques/refresh',
        '/api/statistiques/diagnostic',
      ],
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 🔹 ROUTE D'ACCUEIL
 * GET /api/statistiques
 */
router.get('/', (req, res) => {
  const roleInfo = req.user
    ? `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - Coordination: ${req.user.coordination || 'toutes'}`
    : 'Non authentifié';

  res.json({
    name: 'API Statistiques GESCARD',
    description: 'Module de statistiques et analytics',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    roles_autorises: {
      administrateur: '✅ Accès à toutes les statistiques (non filtrées)',
      gestionnaire: '✅ Accès aux statistiques de sa coordination',
      chef_equipe: '✅ Accès aux statistiques de sa coordination',
      operateur: '✅ Accès aux statistiques de sa coordination',
    },
    cache: {
      duree: '5 minutes',
      methodes: ['globales', 'sites', 'detail'],
      refresh: 'POST /api/statistiques/refresh',
    },
    endpoints: {
      globales: {
        path: '/api/statistiques/globales',
        description: 'Statistiques globales (total, retirés, restants) - filtrées par rôle',
        params: '?forceRefresh=true',
      },
      sites: {
        path: '/api/statistiques/sites',
        description: 'Statistiques détaillées par site - filtrées par rôle',
        params: '?limit=50&forceRefresh=true',
      },
      detail: {
        path: '/api/statistiques/detail',
        description: 'Statistiques complètes (globales + sites + évolution) - filtrées',
      },
      evolution: {
        path: '/api/statistiques/evolution',
        description: 'Évolution temporelle - filtrée',
        params: '?periode=30&interval=day',
      },
      quick: {
        path: '/api/statistiques/quick',
        description: 'Statistiques rapides pour tableaux de bord - filtrées',
      },
      imports: {
        path: '/api/statistiques/imports',
        description: "Statistiques par lot d'import - filtrées",
        params: '?limit=10',
      },
      refresh: {
        path: '/api/statistiques/refresh',
        method: 'POST',
        description: 'Forcer le rafraîchissement du cache',
      },
      diagnostic: {
        path: '/api/statistiques/diagnostic',
        description: 'Diagnostic du module',
      },
    },
    exemples: {
      curl_globales:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/statistiques/globales"',
      curl_sites:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/statistiques/sites?limit=10"',
      curl_detail:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/statistiques/detail"',
      curl_refresh:
        'curl -X POST -H "Authorization: Bearer <token>" "http://localhost:3000/api/statistiques/refresh"',
    },
  });
});

module.exports = router;
