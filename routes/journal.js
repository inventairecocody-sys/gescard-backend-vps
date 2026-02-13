const express = require('express');
const router = express.Router();
const journalController = require('../Controllers/journalController');
const { verifyToken } = require('../middleware/auth');
const journalAccess = require('../middleware/journalAccess');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const JOURNAL_CONFIG = {
  // Rate limiting spécifique au journal
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requêtes par minute
      message: {
        success: false,
        error: 'Trop de requêtes',
        message: 'Veuillez ralentir vos requêtes au journal',
        code: 'JOURNAL_RATE_LIMIT'
      }
    }),
    
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles par 15 minutes
      message: {
        success: false,
        error: 'Trop d\'actions sensibles',
        message: 'Limite d\'actions sensibles atteinte',
        code: 'SENSITIVE_ACTION_LIMIT'
      }
    }),
    
    export: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 5, // 5 exports par heure
      message: {
        success: false,
        error: 'Trop d\'exports',
        message: 'Limite d\'exports du journal atteinte',
        code: 'EXPORT_LIMIT'
      }
    })
  },
  
  // Cache control
  cacheControl: {
    list: 'private, max-age=10', // 10 secondes
    imports: 'private, max-age=30', // 30 secondes
    stats: 'private, max-age=300' // 5 minutes
  },
  
  // Routes publiques (sans authentification)
  publicRoutes: ['/health', '/test']
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = JOURNAL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique au journal
router.use((req, res, next) => {
  console.log(`📋 [Journal] ${req.method} ${req.url} - User: ${req.user?.NomUtilisateur || 'non authentifié'}`);
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * 🩺 Santé du service journal
 * GET /api/journal/health
 */
router.get('/health', JOURNAL_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'journal',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/journal',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'POST /api/journal/annuler-import',
      'POST /api/journal/undo/:id',
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic'
    ]
  });
});

/**
 * 🧪 Test du journal
 * GET /api/journal/test
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service journal fonctionnel',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString()
  });
});

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION (pour toutes les routes suivantes)
// ============================================
router.use(verifyToken);
router.use(journalAccess);

// ============================================
// ROUTES PRINCIPALES
// ============================================

/**
 * 📋 Récupérer le journal avec filtres et pagination
 * GET /api/journal
 */
router.get('/', JOURNAL_CONFIG.rateLimits.standard, (req, res) => 
  journalController.getJournal(req, res)
);

/**
 * 📋 Version alternative (pour compatibilité)
 * GET /api/journal/list
 */
router.get('/list', JOURNAL_CONFIG.rateLimits.standard, (req, res) => 
  journalController.getJournal(req, res)
);

/**
 * 📋 Récupérer la liste des imports groupés
 * GET /api/journal/imports
 */
router.get('/imports', JOURNAL_CONFIG.rateLimits.standard, (req, res) => 
  journalController.getImports(req, res)
);

/**
 * 📋 Détails d'un import spécifique
 * GET /api/journal/imports/:batchId
 */
router.get('/imports/:batchId', JOURNAL_CONFIG.rateLimits.standard, (req, res) => 
  journalController.getImportDetails(req, res)
);

/**
 * 📊 Statistiques d'activité
 * GET /api/journal/stats
 */
router.get('/stats', JOURNAL_CONFIG.rateLimits.standard, (req, res) => 
  journalController.getStats(req, res)
);

// ============================================
// ROUTES D'ACTION (rate limiting plus strict)
// ============================================

/**
 * 🔄 Annuler une importation
 * POST /api/journal/annuler-import
 */
router.post('/annuler-import', JOURNAL_CONFIG.rateLimits.sensitive, (req, res) => 
  journalController.annulerImportation(req, res)
);

/**
 * ↩️ Annuler une action (modification/création/suppression)
 * POST /api/journal/undo/:id
 */
router.post('/undo/:id', JOURNAL_CONFIG.rateLimits.sensitive, (req, res) => 
  journalController.undoAction(req, res)
);

/**
 * 🧹 Nettoyer le journal (supprimer les vieilles entrées)
 * POST /api/journal/nettoyer
 */
router.post('/nettoyer', JOURNAL_CONFIG.rateLimits.sensitive, (req, res) => 
  journalController.nettoyerJournal(req, res)
);

/**
 * 🧹 Version alternative
 * DELETE /api/journal/cleanup
 */
router.delete('/cleanup', JOURNAL_CONFIG.rateLimits.sensitive, (req, res) => 
  journalController.nettoyerJournal(req, res)
);

// ============================================
// ROUTES D'EXPORT ET DIAGNOSTIC
// ============================================

/**
 * 📤 Exporter le journal
 * GET /api/journal/export
 */
router.get('/export', JOURNAL_CONFIG.rateLimits.export, async (req, res) => {
  try {
    // Forcer le mode export
    req.query.export_all = 'true';
    await journalController.getJournal(req, res);
  } catch (error) {
    console.error('❌ Erreur export journal:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de l\'export',
      details: error.message
    });
  }
});

/**
 * 🔧 Diagnostic du journal
 * GET /api/journal/diagnostic
 */
router.get('/diagnostic', JOURNAL_CONFIG.rateLimits.standard, async (req, res) => {
  try {
    await journalController.diagnostic(req, res);
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================
// ROUTE UTILITAIRE DE JOURNALISATION
// ============================================

/**
 * 📝 Journaliser une action (utilitaire pour autres contrôleurs)
 * POST /api/journal/log
 */
router.post('/log', JOURNAL_CONFIG.rateLimits.standard, (req, res) => {
  journalController.logAction(req.body)
    .then(() => res.json({ 
      success: true, 
      message: 'Action journalisée',
      timestamp: new Date().toISOString()
    }))
    .catch(error => res.status(500).json({ 
      success: false,
      error: 'Erreur journalisation',
      details: error.message 
    }));
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: 'API Journal GESCARD',
    description: 'Module de journalisation et d\'audit',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    documentation: '/api/journal/docs',
    endpoints: {
      consultation: {
        'GET /': 'Liste paginée du journal',
        'GET /list': 'Liste paginée (alias)',
        'GET /imports': 'Liste des imports groupés',
        'GET /imports/:batchId': 'Détails d\'un import',
        'GET /stats': 'Statistiques d\'activité'
      },
      actions: {
        'POST /annuler-import': 'Annuler une importation',
        'POST /undo/:id': 'Annuler une action spécifique',
        'POST /nettoyer': 'Nettoyer les vieilles entrées',
        'DELETE /cleanup': 'Nettoyer (alias)'
      },
      utilitaires: {
        'GET /export': 'Exporter le journal',
        'GET /diagnostic': 'Diagnostic du module',
        'POST /log': 'Journaliser une action (interne)'
      },
      publiques: {
        'GET /health': 'Santé du service',
        'GET /test': 'Test du service'
      }
    },
    filtres_disponibles: {
      page: 'Numéro de page',
      pageSize: 'Nombre d\'entrées par page',
      dateDebut: 'Date de début (YYYY-MM-DD)',
      dateFin: 'Date de fin (YYYY-MM-DD)',
      utilisateur: 'Nom d\'utilisateur',
      actionType: 'Type d\'action',
      tableName: 'Table concernée',
      importBatchID: 'ID du batch d\'import'
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions par 15 minutes',
      export: '5 exports par heure'
    },
    exemples: {
      curl_liste: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal?page=1&pageSize=50"',
      curl_imports: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/imports"',
      curl_stats: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/stats"',
      curl_undo: 'curl -X POST -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/undo/123"'
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
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API journal`,
    available_routes: [
      'GET /api/journal/',
      'GET /api/journal/list',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'POST /api/journal/annuler-import',
      'POST /api/journal/undo/:id',
      'POST /api/journal/nettoyer',
      'DELETE /api/journal/cleanup',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
      'POST /api/journal/log',
      'GET /api/journal/health',
      'GET /api/journal/test'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;