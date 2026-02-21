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

router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = JOURNAL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

router.use((req, res, next) => {
  console.log(
    `📋 [Journal] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// Routes publiques
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
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
    ],
  });
});

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service journal fonctionnel',
    timestamp: new Date().toISOString(),
  });
});

// Authentification requise
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// Routes principales (Admin uniquement)
router.get(
  '/',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournal
);
router.get(
  '/list',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournal
);
router.get(
  '/:id',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournalById
);
router.get(
  '/imports',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getImports
);
router.get(
  '/imports/:batchId',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getImportDetails
);
router.get(
  '/stats',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getStats
);
router.get(
  '/actions/annulables',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getActionsAnnulables
);

// Routes d'action
router.post(
  '/:id/annuler',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.annulerAction
);
router.post(
  '/annuler-import',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.annulerImportation
);
router.post(
  '/nettoyer',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.nettoyerJournal
);

// Routes d'export et diagnostic
router.get('/export', role.peutVoirJournal, JOURNAL_CONFIG.rateLimits.export, async (req, res) => {
  req.query.export_all = 'true';
  await journalController.getJournal(req, res);
});
router.get(
  '/diagnostic',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.diagnostic
);

// Route d'accueil
router.get('/', (req, res) => {
  res.json({
    name: 'API Journal GESCARD',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    endpoints: {
      consultation: {
        'GET /': 'Liste paginée (Admin)',
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
      },
    },
  });
});

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas`,
    available_routes: [
      'GET /api/journal',
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
      'GET /api/journal/health',
      'GET /api/journal/test',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
