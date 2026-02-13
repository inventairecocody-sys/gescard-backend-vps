const express = require('express');
const router = express.Router();
const logController = require('../Controllers/logController');
const { verifyToken, verifyRole } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const LOG_CONFIG = {
  // Rate limiting spécifique aux logs
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requêtes par minute
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'STANDARD_RATE_LIMIT'
      }
    }),
    
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles
      message: {
        success: false,
        error: 'Trop d\'actions sensibles',
        code: 'SENSITIVE_RATE_LIMIT'
      }
    }),
    
    export: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 5, // 5 exports par heure
      message: {
        success: false,
        error: 'Trop d\'exports',
        code: 'EXPORT_RATE_LIMIT'
      }
    })
  },
  
  // Cache control
  cacheControl: {
    list: 'private, max-age=5', // 5 secondes
    user: 'private, max-age=10', // 10 secondes
    recent: 'private, max-age=2', // 2 secondes
    stats: 'private, max-age=300' // 5 minutes
  },
  
  // Routes publiques
  publicRoutes: ['/health', '/test']
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = LOG_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(`📝 [Logs] ${req.method} ${req.url} - User: ${req.user?.NomUtilisateur || 'non authentifié'}`);
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * GET /api/logs/health - Santé du service
 */
router.get('/health', LOG_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'logs',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/logs',
      'GET /api/logs/recent',
      'GET /api/logs/user/:utilisateur',
      'GET /api/logs/date-range',
      'GET /api/logs/stats',
      'GET /api/logs/search',
      'GET /api/logs/filtered',
      'GET /api/logs/actions',
      'GET /api/logs/export',
      'GET /api/logs/diagnostic',
      'POST /api/logs',
      'DELETE /api/logs/old',
      'DELETE /api/logs/all'
    ]
  });
});

/**
 * GET /api/logs/test - Test du service
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service logs fonctionnel',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user
  });
});

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifyToken);

// ============================================
// ROUTES DE CONSULTATION
// ============================================

/**
 * GET /api/logs - Récupérer tous les logs
 */
router.get('/', LOG_CONFIG.rateLimits.standard, logController.getAllLogs);

/**
 * GET /api/logs/list - Alias pour la liste
 */
router.get('/list', LOG_CONFIG.rateLimits.standard, logController.getAllLogs);

/**
 * GET /api/logs/recent - Récupérer les logs récents
 */
router.get('/recent', LOG_CONFIG.rateLimits.standard, logController.getRecentLogs);

/**
 * GET /api/logs/user/:utilisateur - Logs par utilisateur
 */
router.get('/user/:utilisateur', LOG_CONFIG.rateLimits.standard, logController.getLogsByUser);

/**
 * GET /api/logs/date-range - Logs par plage de dates
 */
router.get('/date-range', LOG_CONFIG.rateLimits.standard, logController.getLogsByDateRange);

/**
 * GET /api/logs/filtered - Logs avec filtres avancés
 */
router.get('/filtered', LOG_CONFIG.rateLimits.standard, logController.getFilteredLogs);

// ============================================
// ROUTES DE RECHERCHE ET STATISTIQUES
// ============================================

/**
 * GET /api/logs/search - Recherche avancée
 */
router.get('/search', LOG_CONFIG.rateLimits.standard, logController.searchLogs);

/**
 * GET /api/logs/stats - Statistiques des logs
 */
router.get('/stats', LOG_CONFIG.rateLimits.standard, logController.getLogStats);

/**
 * GET /api/logs/actions - Actions fréquentes (auto-complétion)
 */
router.get('/actions', LOG_CONFIG.rateLimits.standard, logController.getCommonActions);

// ============================================
// ROUTES DE CRÉATION
// ============================================

/**
 * POST /api/logs - Créer un nouveau log
 */
router.post('/', LOG_CONFIG.rateLimits.standard, logController.createLog);

// ============================================
// ROUTES DE SUPPRESSION (admin requis)
// ============================================

/**
 * DELETE /api/logs/old - Supprimer les vieux logs
 */
router.delete('/old', verifyRole(['Administrateur']), LOG_CONFIG.rateLimits.sensitive, logController.deleteOldLogs);

/**
 * DELETE /api/logs/all - Supprimer tous les logs (admin uniquement)
 */
router.delete('/all', verifyRole(['Administrateur']), LOG_CONFIG.rateLimits.sensitive, logController.clearAllLogs);

// ============================================
// ROUTES D'EXPORT
// ============================================

/**
 * GET /api/logs/export - Exporter les logs
 */
router.get('/export', LOG_CONFIG.rateLimits.export, logController.exportLogs);

// ============================================
// ROUTES DE DIAGNOSTIC
// ============================================

/**
 * GET /api/logs/diagnostic - Diagnostic du module
 */
router.get('/diagnostic', verifyRole(['Administrateur']), LOG_CONFIG.rateLimits.standard, logController.diagnostic);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: "API Logs GESCARD",
    description: "Module de journalisation système",
    version: "2.0.0-lws",
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    user: req.user ? {
      id: req.user.id,
      username: req.user.NomUtilisateur,
      role: req.user.Role
    } : null,
    documentation: '/api/logs/docs',
    endpoints: {
      consultation: {
        'GET /': 'Liste paginée des logs',
        'GET /list': 'Liste (alias)',
        'GET /recent': 'Logs récents',
        'GET /user/:utilisateur': 'Logs par utilisateur',
        'GET /date-range': 'Logs par plage de dates',
        'GET /filtered': 'Logs avec filtres avancés'
      },
      recherche: {
        'GET /search': 'Recherche avancée',
        'GET /stats': 'Statistiques',
        'GET /actions': 'Actions fréquentes (auto-complétion)'
      },
      creation: {
        'POST /': 'Créer un log'
      },
      suppression: {
        'DELETE /old': 'Supprimer vieux logs (admin)',
        'DELETE /all': 'Supprimer tous les logs (admin)'
      },
      export: {
        'GET /export': 'Exporter les logs (CSV/JSON)'
      },
      diagnostic: {
        'GET /diagnostic': 'Diagnostic module',
        'GET /health': 'Santé service',
        'GET /test': 'Test service'
      }
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions par 15 minutes',
      export: '5 exports par heure'
    },
    cache: {
      list: '5 secondes',
      user: '10 secondes',
      recent: '2 secondes',
      stats: '5 minutes'
    },
    formats_supportes: {
      import: ['CSV'],
      export: ['JSON', 'CSV']
    },
    exemples: {
      curl_liste: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs?page=1&limit=50"',
      curl_user: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/user/admin"',
      curl_search: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/search?q=import&page=1"',
      curl_export: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/export?format=csv"',
      curl_stats: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/stats"'
    }
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API logs`,
    available_routes: [
      'GET /api/logs/',
      'GET /api/logs/list',
      'GET /api/logs/recent',
      'GET /api/logs/user/:utilisateur',
      'GET /api/logs/date-range',
      'GET /api/logs/filtered',
      'GET /api/logs/search',
      'GET /api/logs/stats',
      'GET /api/logs/actions',
      'GET /api/logs/export',
      'GET /api/logs/diagnostic',
      'GET /api/logs/health',
      'GET /api/logs/test',
      'POST /api/logs/',
      'DELETE /api/logs/old',
      'DELETE /api/logs/all'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;