const express = require('express');
const router = express.Router();
const utilisateursController = require('../Controllers/utilisateursController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
const rateLimit = require('express-rate-limit');

const UTILISATEURS_CONFIG = {
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'STANDARD_RATE_LIMIT',
      },
    }),
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: {
        success: false,
        error: "Trop d'actions sensibles",
        code: 'SENSITIVE_RATE_LIMIT',
      },
    }),
  },
  cacheControl: {
    list: 'private, max-age=10',
    details: 'private, max-age=30',
    search: 'private, max-age=5',
    stats: 'private, max-age=300',
  },
};

router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = UTILISATEURS_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

router.use((req, res, next) => {
  console.log(
    `👥 [Utilisateurs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// Routes publiques
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'utilisateurs',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/utilisateurs',
      'GET /api/utilisateurs/:id',
      'GET /api/utilisateurs/stats',
      'GET /api/utilisateurs/search',
      'GET /api/utilisateurs/:id/history',
      'GET /api/utilisateurs/export',
      'GET /api/utilisateurs/roles',
      'GET /api/utilisateurs/coordinations',
      'GET /api/utilisateurs/check-username',
      'POST /api/utilisateurs',
      'PUT /api/utilisateurs/:id',
      'POST /api/utilisateurs/:id/reset-password',
      'POST /api/utilisateurs/:id/activate',
      'DELETE /api/utilisateurs/:id',
      'POST /api/utilisateurs/cache/clear',
      'GET /api/utilisateurs/diagnostic',
    ],
  });
});

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service utilisateurs fonctionnel',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
  });
});

// Authentification requise pour toutes les routes suivantes
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// Routes de consultation (Admin uniquement)
router.get(
  '/',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getAllUsers
);
router.get(
  '/list',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getAllUsers
);
router.get(
  '/:id',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getUserById
);
router.get(
  '/:id/history',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getUserHistory
);

// Routes de recherche et statistiques
router.get(
  '/search',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.searchUsers
);
router.get(
  '/stats',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getUserStats
);
router.get(
  '/export',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.exportUsers
);

// Routes de création et modification
router.post(
  '/',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.createUser
);
router.put(
  '/:id',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.updateUser
);
router.post(
  '/:id/reset-password',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.resetPassword
);
router.post(
  '/:id/activate',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.activateUser
);
router.delete(
  '/:id',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.deleteUser
);

// Routes d'administration
router.post(
  '/cache/clear',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.clearStatsCache
);
router.get(
  '/diagnostic',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.diagnostic
);

// Routes utilitaires (publiques après authentification)
router.get('/roles', UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getRoles);
router.get(
  '/coordinations',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getCoordinations
);
router.get(
  '/check-username',
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.checkUsernameAvailability
);

// Route d'accueil
router.get('/', (req, res) => {
  res.json({
    name: 'API Utilisateurs GESCARD',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    endpoints: {
      consultation: {
        'GET /': 'Liste utilisateurs (Admin)',
        'GET /:id': 'Détails utilisateur (Admin)',
        'GET /:id/history': 'Historique (Admin)',
      },
      recherche: {
        'GET /search': 'Recherche avancée (Admin)',
        'GET /stats': 'Statistiques (Admin)',
        'GET /export': 'Export (Admin)',
        'GET /roles': 'Liste des rôles',
        'GET /coordinations': 'Liste coordinations (Admin)',
      },
      creation: {
        'POST /': 'Créer utilisateur (Admin)',
      },
      modification: {
        'PUT /:id': 'Modifier (Admin)',
        'POST /:id/reset-password': 'Réinitialiser mot de passe (Admin)',
        'POST /:id/activate': 'Activer (Admin)',
        'DELETE /:id': 'Désactiver (Admin)',
      },
      administration: {
        'GET /diagnostic': 'Diagnostic (Admin)',
        'POST /cache/clear': 'Nettoyer cache (Admin)',
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
      'GET /api/utilisateurs',
      'GET /api/utilisateurs/:id',
      'GET /api/utilisateurs/:id/history',
      'GET /api/utilisateurs/search',
      'GET /api/utilisateurs/stats',
      'GET /api/utilisateurs/export',
      'GET /api/utilisateurs/roles',
      'GET /api/utilisateurs/coordinations',
      'GET /api/utilisateurs/check-username',
      'GET /api/utilisateurs/health',
      'GET /api/utilisateurs/test',
      'POST /api/utilisateurs',
      'PUT /api/utilisateurs/:id',
      'POST /api/utilisateurs/:id/reset-password',
      'POST /api/utilisateurs/:id/activate',
      'DELETE /api/utilisateurs/:id',
      'POST /api/utilisateurs/cache/clear',
      'GET /api/utilisateurs/diagnostic',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
