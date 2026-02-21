const express = require('express');
const router = express.Router();
const logController = require('../Controllers/logController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
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
        code: 'STANDARD_RATE_LIMIT',
      },
    }),

    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles
      message: {
        success: false,
        error: "Trop d'actions sensibles",
        code: 'SENSITIVE_RATE_LIMIT',
      },
    }),

    export: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 5, // 5 exports par heure
      message: {
        success: false,
        error: "Trop d'exports",
        code: 'EXPORT_RATE_LIMIT',
      },
    }),
  },

  // Cache control
  cacheControl: {
    list: 'private, max-age=5', // 5 secondes
    user: 'private, max-age=10', // 10 secondes
    recent: 'private, max-age=2', // 2 secondes
    stats: 'private, max-age=300', // 5 minutes
  },

  // Routes publiques
  publicRoutes: ['/health', '/test'],
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
  console.log(
    `📝 [Logs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
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
    version: '3.0.0-lws',
    roles_autorises: {
      consultation: 'Administrateur uniquement (redirigé vers journal)',
      actions: 'Administrateur uniquement',
      export: 'Administrateur uniquement',
    },
    redirection:
      '⚠️ Ce module est maintenu pour compatibilité. Utilisez /api/journal pour les nouvelles fonctionnalités.',
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
      'DELETE /api/logs/all',
    ],
  });
});

/**
 * GET /api/logs/test - Test du service
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service logs fonctionnel',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    redirection:
      '⚠️ Ce module est maintenu pour compatibilité. Utilisez /api/journal pour les nouvelles fonctionnalités.',
    roles_autorises: {
      consultation: 'Administrateur uniquement',
      actions: 'Administrateur uniquement',
    },
  });
});

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// ============================================
// ROUTES DE CONSULTATION (Admin uniquement)
// ============================================

/**
 * GET /api/logs - Récupérer tous les logs
 * Admin uniquement - redirigé vers journal
 */
router.get('/', role.peutVoirJournal, LOG_CONFIG.rateLimits.standard, logController.getAllLogs);

/**
 * GET /api/logs/list - Alias pour la liste
 * Admin uniquement - redirigé vers journal
 */
router.get('/list', role.peutVoirJournal, LOG_CONFIG.rateLimits.standard, logController.getAllLogs);

/**
 * GET /api/logs/recent - Récupérer les logs récents
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/recent',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getRecentLogs
);

/**
 * GET /api/logs/user/:utilisateur - Logs par utilisateur
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/user/:utilisateur',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getLogsByUser
);

/**
 * GET /api/logs/date-range - Logs par plage de dates
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/date-range',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getLogsByDateRange
);

/**
 * GET /api/logs/filtered - Logs avec filtres avancés
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/filtered',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getFilteredLogs
);

// ============================================
// ROUTES DE RECHERCHE ET STATISTIQUES (Admin uniquement)
// ============================================

/**
 * GET /api/logs/search - Recherche avancée
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/search',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.searchLogs
);

/**
 * GET /api/logs/stats - Statistiques des logs
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/stats',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getLogStats
);

/**
 * GET /api/logs/actions - Actions fréquentes (auto-complétion)
 * Admin uniquement
 */
router.get(
  '/actions',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getCommonActions
);

// ============================================
// ROUTES DE CRÉATION (Admin uniquement)
// ============================================

/**
 * POST /api/logs - Créer un nouveau log
 * Admin uniquement
 */
router.post('/', role.peutVoirJournal, LOG_CONFIG.rateLimits.standard, logController.createLog);

// ============================================
// ROUTES DE SUPPRESSION (Admin uniquement)
// ============================================

/**
 * DELETE /api/logs/old - Supprimer les vieux logs
 * Admin uniquement - redirigé vers journal
 */
router.delete(
  '/old',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.sensitive,
  logController.deleteOldLogs
);

/**
 * DELETE /api/logs/all - Supprimer tous les logs
 * Admin uniquement - redirigé vers journal
 */
router.delete(
  '/all',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.sensitive,
  logController.clearAllLogs
);

// ============================================
// ROUTES D'EXPORT (Admin uniquement)
// ============================================

/**
 * GET /api/logs/export - Exporter les logs
 * Admin uniquement - redirigé vers journal
 */
router.get('/export', role.peutVoirJournal, LOG_CONFIG.rateLimits.export, logController.exportLogs);

// ============================================
// ROUTES DE DIAGNOSTIC (Admin uniquement)
// ============================================

/**
 * GET /api/logs/diagnostic - Diagnostic du module
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/diagnostic',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.diagnostic
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  const roleInfo = req.user
    ? `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - ${req.user.role === 'Administrateur' ? '✅ Accès autorisé' : '❌ Accès restreint'}`
    : 'Non authentifié';

  res.json({
    name: 'API Logs GESCARD',
    description: 'Module de journalisation système (maintenu pour compatibilité)',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    redirection:
      '⚠️ Ce module est maintenu pour compatibilité ascendante. Pour les nouvelles fonctionnalités (annulation, coordination), utilisez /api/journal',
    roles_autorises: {
      administrateur: '✅ Accès complet (redirigé vers journal)',
      gestionnaire: "❌ Non autorisé (pas d'accès aux logs)",
      chef_equipe: "❌ Non autorisé (pas d'accès aux logs)",
      operateur: "❌ Non autorisé (pas d'accès aux logs)",
    },
    compatibilite: {
      statut: '✅ Maintenu pour compatibilité ascendante',
      redirection_vers: '/api/journal',
      fonctionnalites_nouvelles: [
        "Annulation d'actions",
        'Support de la coordination',
        'Journalisation enrichie (JSON)',
        'Filtrage avancé',
      ],
    },
    user: req.user
      ? {
          id: req.user.id,
          username: req.user.nomUtilisateur,
          role: req.user.role,
          coordination: req.user.coordination,
        }
      : null,
    endpoints: {
      consultation: {
        'GET /': 'Liste paginée des logs (Admin)',
        'GET /list': 'Liste (alias - Admin)',
        'GET /recent': 'Logs récents (Admin)',
        'GET /user/:utilisateur': 'Logs par utilisateur (Admin)',
        'GET /date-range': 'Logs par plage de dates (Admin)',
        'GET /filtered': 'Logs avec filtres avancés (Admin)',
      },
      recherche: {
        'GET /search': 'Recherche avancée (Admin)',
        'GET /stats': 'Statistiques (Admin)',
        'GET /actions': 'Actions fréquentes (Admin)',
      },
      creation: {
        'POST /': 'Créer un log (Admin)',
      },
      suppression: {
        'DELETE /old': 'Supprimer vieux logs (Admin)',
        'DELETE /all': 'Supprimer tous les logs (Admin)',
      },
      export: {
        'GET /export': 'Exporter les logs (Admin)',
      },
      diagnostic: {
        'GET /diagnostic': 'Diagnostic module (Admin)',
        'GET /health': 'Santé service (public)',
        'GET /test': 'Test service (public)',
      },
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions par 15 minutes',
      export: '5 exports par heure',
    },
    cache: {
      list: '5 secondes',
      user: '10 secondes',
      recent: '2 secondes',
      stats: '5 minutes',
    },
    formats_supportes: {
      import: ['CSV'],
      export: ['JSON', 'CSV'],
    },
    migration: {
      recommandation:
        'Pour bénéficier des nouvelles fonctionnalités (annulation, coordination), migrez vers /api/journal',
      documentation: "/api/journal/ pour plus d'informations",
    },
    exemples: {
      curl_liste:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs?page=1&limit=50"',
      curl_user:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/user/admin"',
      curl_search:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/search?q=import&page=1"',
      curl_export:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/export?format=csv"',
      curl_stats: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/stats"',
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
      'DELETE /api/logs/all',
    ],
    redirection: 'Pour les nouvelles fonctionnalités, utilisez /api/journal',
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
