const express = require('express');
const router = express.Router();
const apiController = require('../Controllers/apiController');
const {
  authenticateAPI,
  logAPIAccess,
  validateApiParams,
  securityHeaders,
} = require('../middleware/apiAuth');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const API_CONFIG = {
  // Rate limiting spécifique à l'API externe
  rateLimits: {
    public: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 60, // 60 requêtes par minute
      message: {
        success: false,
        error: 'Rate limit atteint',
        message: "Trop de requêtes vers l'API externe",
        code: 'RATE_LIMIT_EXCEEDED',
      },
      standardHeaders: true,
      legacyHeaders: false,
    }),

    sync: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 sync par minute
      message: {
        success: false,
        error: 'Rate limit sync atteint',
        message: 'Trop de requêtes de synchronisation',
        code: 'SYNC_RATE_LIMIT_EXCEEDED',
      },
    }),

    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requêtes par 15 min
      message: {
        success: false,
        error: 'Rate limit atteint',
        message: 'Trop de requêtes sensibles',
        code: 'SENSITIVE_RATE_LIMIT_EXCEEDED',
      },
    }),
  },

  // Cache pour les routes fréquentes
  cacheControl: {
    health: 'no-cache',
    cartes: 'private, max-age=60',
    stats: 'private, max-age=300',
    sites: 'public, max-age=3600',
    changes: 'private, max-age=60',
    'columns-config': 'public, max-age=3600',
    diagnostic: 'no-cache',
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware global pour l'API externe
router.use(securityHeaders);
router.use(logAPIAccess);
router.use(authenticateAPI);

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(`🌐 [API Externe] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = API_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// ============================================
// ROUTES PUBLIQUES (rate limiting modéré)
// ============================================

/**
 * 📊 Vérification de santé
 * GET /api/external/health
 */
router.get('/health', API_CONFIG.rateLimits.public, async (req, res) => {
  try {
    await apiController.healthCheck(req, res);
  } catch (error) {
    console.error('❌ Erreur health:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'HEALTH_CHECK_FAILED',
    });
  }
});

/**
 * 📋 Liste des sites disponibles
 * GET /api/external/sites
 */
router.get('/sites', API_CONFIG.rateLimits.public, validateApiParams, async (req, res) => {
  try {
    await apiController.getSites(req, res);
  } catch (error) {
    console.error('❌ Erreur sites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération sites',
      code: 'SITES_FETCH_FAILED',
    });
  }
});

/**
 * 🧪 Test CORS
 * GET /api/external/cors-test
 */
router.get('/cors-test', API_CONFIG.rateLimits.public, (req, res) => {
  res.json({
    success: true,
    message: 'API externe accessible via CORS',
    origin: req.headers.origin || 'undefined',
    timestamp: new Date().toISOString(),
    headers: {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-API-Token',
    },
  });
});

// ============================================
// ROUTES DE DONNÉES (rate limiting standard)
// ============================================

/**
 * 📊 Récupérer les cartes avec filtres
 * GET /api/external/cartes
 */
router.get('/cartes', API_CONFIG.rateLimits.sensitive, validateApiParams, async (req, res) => {
  try {
    await apiController.getCartes(req, res);
  } catch (error) {
    console.error('❌ Erreur getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération cartes',
      code: 'CARTES_FETCH_FAILED',
    });
  }
});

/**
 * 📊 Statistiques
 * GET /api/external/stats
 */
router.get('/stats', API_CONFIG.rateLimits.public, validateApiParams, async (req, res) => {
  try {
    await apiController.getStats(req, res);
  } catch (error) {
    console.error('❌ Erreur getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération statistiques',
      code: 'STATS_FETCH_FAILED',
    });
  }
});

// ============================================
// ROUTES DE SYNCHRONISATION (rate limiting strict)
// ============================================

/**
 * 🔄 Récupérer les changements depuis une date
 * GET /api/external/changes
 */
router.get('/changes', API_CONFIG.rateLimits.sync, validateApiParams, async (req, res) => {
  try {
    // Ajouter des métadonnées
    req.syncRequest = {
      timestamp: new Date().toISOString(),
      clientIp: req.ip,
      userAgent: req.headers['user-agent'],
    };

    await apiController.getChanges(req, res);
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération changements',
      code: 'CHANGES_FETCH_FAILED',
    });
  }
});

/**
 * 🔄 Synchronisation avec fusion intelligente
 * POST /api/external/sync
 */
router.post('/sync', API_CONFIG.rateLimits.sync, validateApiParams, async (req, res) => {
  try {
    // Validation basique du payload
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Payload invalide',
        message: 'Le corps de la requête doit être un objet JSON',
        code: 'INVALID_PAYLOAD',
      });
    }

    // Ajouter des métadonnées
    req.syncRequest = {
      timestamp: new Date().toISOString(),
      clientIp: req.ip,
      userAgent: req.headers['user-agent'],
      dataSize: JSON.stringify(req.body).length,
      recordCount: req.body.donnees?.length || 0,
    };

    // Log de la tentative de sync
    console.log(`🔄 [Sync] Tentative de ${req.body.donnees?.length || 0} enregistrements`);

    await apiController.syncData(req, res);
  } catch (error) {
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur synchronisation',
      details: error.message,
      code: 'SYNC_FAILED',
    });
  }
});

// ============================================
// ROUTES DE MODIFICATIONS (rate limiting standard)
// ============================================

/**
 * 🔄 Récupérer les modifications par site
 * GET /api/external/modifications
 */
router.get(
  '/modifications',
  API_CONFIG.rateLimits.sensitive,
  validateApiParams,
  async (req, res) => {
    try {
      // Valider les paramètres requis
      const { site, derniereSync } = req.query;

      if (!site || !derniereSync) {
        return res.status(400).json({
          success: false,
          error: 'Paramètres manquants',
          message: 'Les paramètres site et derniereSync sont requis',
          code: 'MISSING_PARAMETERS',
        });
      }

      await apiController.getModifications(req, res);
    } catch (error) {
      console.error('❌ Erreur getModifications:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur récupération modifications',
        code: 'MODIFICATIONS_FETCH_FAILED',
      });
    }
  }
);

// ============================================
// ROUTES DE DIAGNOSTIC
// ============================================

/**
 * 🔧 Diagnostic complet de l'API
 * GET /api/external/diagnostic
 */
router.get('/diagnostic', API_CONFIG.rateLimits.public, validateApiParams, async (req, res) => {
  try {
    await apiController.diagnostic(req, res);
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur diagnostic',
      code: 'DIAGNOSTIC_FAILED',
    });
  }
});

/**
 * 📋 Configuration des colonnes
 * GET /api/external/columns-config
 */
router.get('/columns-config', API_CONFIG.rateLimits.public, validateApiParams, (req, res) => {
  try {
    const config = apiController.getColonnesAFusionner();
    res.json({
      success: true,
      config,
      description: 'Configuration des colonnes pour la fusion intelligente',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur columns-config:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération configuration',
      code: 'CONFIG_FETCH_FAILED',
    });
  }
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: 'API Externe GESCARD',
    version: '3.0.0-lws',
    description: 'API publique pour synchronisation externe',
    documentation: '/api/external/docs',
    timestamp: new Date().toISOString(),
    endpoints: {
      public: {
        health: {
          method: 'GET',
          path: '/api/external/health',
          description: 'Vérification de santé',
        },
        sites: { method: 'GET', path: '/api/external/sites', description: 'Liste des sites' },
        stats: { method: 'GET', path: '/api/external/stats', description: 'Statistiques globales' },
        'columns-config': {
          method: 'GET',
          path: '/api/external/columns-config',
          description: 'Configuration des colonnes',
        },
        diagnostic: {
          method: 'GET',
          path: '/api/external/diagnostic',
          description: 'Diagnostic complet',
        },
        'cors-test': { method: 'GET', path: '/api/external/cors-test', description: 'Test CORS' },
      },
      protected: {
        cartes: {
          method: 'GET',
          path: '/api/external/cartes',
          description: 'Récupérer les cartes avec filtres',
        },
        changes: {
          method: 'GET',
          path: '/api/external/changes',
          description: 'Changements depuis une date',
        },
        sync: {
          method: 'POST',
          path: '/api/external/sync',
          description: 'Synchronisation avec fusion intelligente',
        },
        modifications: {
          method: 'GET',
          path: '/api/external/modifications',
          description: 'Modifications par site',
        },
      },
    },
    rate_limits: {
      public: '60 requêtes par minute',
      sync: '20 requêtes par minute',
      sensitive: '100 requêtes par 15 minutes',
    },
    authentication: {
      type: 'API Token',
      header: 'X-API-Token',
      query_param: 'api_token',
    },
    examples: {
      get_changes: '/api/external/changes?since=2024-01-01T00:00:00',
      get_cartes: '/api/external/cartes?site=ADJAME&limit=100',
      sync_data: 'POST /api/external/sync avec payload JSON',
    },
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API externe`,
    available_routes: [
      'GET /api/external/health',
      'GET /api/external/sites',
      'GET /api/external/cartes',
      'GET /api/external/stats',
      'GET /api/external/changes',
      'POST /api/external/sync',
      'GET /api/external/modifications',
      'GET /api/external/columns-config',
      'GET /api/external/diagnostic',
      'GET /api/external/cors-test',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
