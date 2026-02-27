const express = require('express');
const router = express.Router();
const journalController = require('../Controllers/journalController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
const rateLimit = require('express-rate-limit');

const JOURNAL_CONFIG = {
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'JOURNAL_RATE_LIMIT',
      },
    }),
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: {
        success: false,
        error: "Trop d'actions sensibles",
        code: 'SENSITIVE_ACTION_LIMIT',
      },
    }),
    export: rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: {
        success: false,
        error: "Trop d'exports",
        code: 'EXPORT_LIMIT',
      },
    }),
  },
  cacheControl: {
    list: 'private, max-age=10',
    imports: 'private, max-age=30',
    stats: 'private, max-age=300',
  },
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

// Middleware de logging
router.use((req, res, next) => {
  console.log(
    `📋 [Journal] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * 🩺 Vérification de santé
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
      'GET /api/journal/actions/annulables',
      'POST /api/journal/:id/annuler',
      'POST /api/journal/annuler-import',
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
    ],
  });
});

/**
 * 🧪 Test du service
 * GET /api/journal/test
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service journal fonctionnel',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// AUTHENTIFICATION
// ============================================

// Authentification requise pour toutes les routes suivantes
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// ============================================
// ROUTES DE CONSULTATION (Admin uniquement)
// ============================================

/**
 * 📋 Liste paginée du journal
 * GET /api/journal
 */
router.get(
  '/',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournal
);

/**
 * 📋 Liste paginée (alias)
 * GET /api/journal/list
 */
router.get(
  '/list',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournal
);

/**
 * 🔍 Détail d'une entrée
 * GET /api/journal/:id
 */
router.get(
  '/:id',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournalById
);

/**
 * 📦 Liste des imports
 * GET /api/journal/imports
 */
router.get(
  '/imports',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getImports
);

/**
 * 📦 Détail d'un import
 * GET /api/journal/imports/:batchId
 */
router.get(
  '/imports/:batchId',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getImportDetails
);

/**
 * 📊 Statistiques du journal
 * GET /api/journal/stats
 */
router.get(
  '/stats',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getStats
);

/**
 * 🔄 Actions pouvant être annulées
 * GET /api/journal/actions/annulables
 */
router.get(
  '/actions/annulables',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getActionsAnnulables
);

// ============================================
// ROUTES D'ACTION (Admin uniquement - rate limiting strict)
// ============================================

/**
 * ❌ Annuler une action
 * POST /api/journal/:id/annuler
 */
router.post(
  '/:id/annuler',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.annulerAction
);

/**
 * ❌ Annuler un import
 * POST /api/journal/annuler-import
 */
router.post(
  '/annuler-import',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.annulerImportation
);

/**
 * 🧹 Nettoyer les vieux logs
 * POST /api/journal/nettoyer
 */
router.post(
  '/nettoyer',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.nettoyerJournal
);

// ============================================
// ROUTES D'EXPORT ET DIAGNOSTIC
// ============================================

/**
 * 📤 Exporter le journal
 * GET /api/journal/export
 */
router.get('/export', role.peutVoirJournal, JOURNAL_CONFIG.rateLimits.export, async (req, res) => {
  req.query.export_all = 'true';
  await journalController.getJournal(req, res);
});

/**
 * 🔧 Diagnostic complet
 * GET /api/journal/diagnostic
 */
router.get(
  '/diagnostic',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.diagnostic
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

/**
 * 🏠 Page d'accueil de l'API journal
 * GET /api/journal/home
 */
router.get('/home', (req, res) => {
  res.json({
    name: 'API Journal GESCARD',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    documentation: '/api/journal/health',
    endpoints: {
      consultation: {
        'GET /': 'Liste paginée (Admin)',
        'GET /list': 'Liste paginée (alias)',
        'GET /imports': 'Liste des imports (Admin)',
        'GET /imports/:batchId': 'Détails import (Admin)',
        'GET /stats': 'Statistiques (Admin)',
        'GET /actions/annulables': 'Actions annulables (Admin)',
      },
      actions: {
        'POST /:id/annuler': 'Annuler action (Admin)',
        'POST /annuler-import': 'Annuler import (Admin)',
        'POST /nettoyer': 'Nettoyer vieux logs (Admin)',
      },
      utilitaires: {
        'GET /export': 'Exporter (Admin)',
        'GET /diagnostic': 'Diagnostic (Admin)',
        'GET /health': 'Santé du service (public)',
        'GET /test': 'Test (public)',
        'GET /home': 'Cette page',
      },
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions sensibles par 15 minutes',
      export: '5 exports par heure',
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
    message: `La route ${req.method} ${req.path} n'existe pas`,
    available_routes: [
      'GET /api/journal/home',
      'GET /api/journal/health',
      'GET /api/journal/test',
      'GET /api/journal',
      'GET /api/journal/list',
      'GET /api/journal/:id',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'GET /api/journal/actions/annulables',
      'POST /api/journal/:id/annuler',
      'POST /api/journal/annuler-import',
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
