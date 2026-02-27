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
    roles: 'public, max-age=3600', // 1 heure
    coordinations: 'private, max-age=300', // 5 minutes
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = UTILISATEURS_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging
router.use((req, res, next) => {
  console.log(
    `👥 [Utilisateurs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * 🩺 Vérification de santé
 * GET /api/utilisateurs/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'utilisateurs',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/utilisateurs/list',
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
      'GET /api/utilisateurs/home',
    ],
  });
});

/**
 * 🧪 Test du service
 * GET /api/utilisateurs/test
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service utilisateurs fonctionnel',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
  });
});

// ============================================
// AUTHENTIFICATION (requise pour toutes les routes suivantes)
// ============================================
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// ============================================
// ROUTES DE CONSULTATION (Admin uniquement)
// ============================================

/**
 * 📋 Liste paginée des utilisateurs
 * GET /api/utilisateurs/list
 */
router.get(
  '/list',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getAllUsers
);

/**
 * 📋 Alias pour la liste (compatibilité)
 * GET /api/utilisateurs
 */
router.get(
  '/',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getAllUsers
);

/**
 * 🔍 Détail d'un utilisateur
 * GET /api/utilisateurs/:id
 */
router.get(
  '/:id',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getUserById
);

/**
 * 📜 Historique d'un utilisateur
 * GET /api/utilisateurs/:id/history
 */
router.get(
  '/:id/history',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getUserHistory
);

// ============================================
// ROUTES DE RECHERCHE ET STATISTIQUES (Admin uniquement)
// ============================================

/**
 * 🔍 Recherche avancée
 * GET /api/utilisateurs/search
 */
router.get(
  '/search',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.searchUsers
);

/**
 * 📊 Statistiques des utilisateurs
 * GET /api/utilisateurs/stats
 */
router.get(
  '/stats',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getUserStats
);

/**
 * 📤 Exporter les utilisateurs
 * GET /api/utilisateurs/export
 */
router.get(
  '/export',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.exportUsers
);

// ============================================
// ROUTES DE CRÉATION ET MODIFICATION (Admin uniquement)
// ============================================

/**
 * ➕ Créer un utilisateur
 * POST /api/utilisateurs
 */
router.post(
  '/',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.createUser
);

/**
 * ✏️ Modifier un utilisateur
 * PUT /api/utilisateurs/:id
 */
router.put(
  '/:id',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.updateUser
);

/**
 * 🔑 Réinitialiser le mot de passe
 * POST /api/utilisateurs/:id/reset-password
 */
router.post(
  '/:id/reset-password',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.resetPassword
);

/**
 * ✅ Activer un utilisateur
 * POST /api/utilisateurs/:id/activate
 */
router.post(
  '/:id/activate',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.activateUser
);

/**
 * ❌ Désactiver un utilisateur
 * DELETE /api/utilisateurs/:id
 */
router.delete(
  '/:id',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.sensitive,
  utilisateursController.deleteUser
);

// ============================================
// ROUTES D'ADMINISTRATION (Admin uniquement)
// ============================================

/**
 * 🧹 Nettoyer le cache des statistiques
 * POST /api/utilisateurs/cache/clear
 */
router.post(
  '/cache/clear',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.clearStatsCache
);

/**
 * 🔧 Diagnostic complet
 * GET /api/utilisateurs/diagnostic
 */
router.get(
  '/diagnostic',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.diagnostic
);

// ============================================
// ROUTES UTILITAIRES (authentifiées mais non-admin)
// ============================================

/**
 * 📋 Liste des rôles disponibles
 * GET /api/utilisateurs/roles
 */
router.get('/roles', UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getRoles);

/**
 * 📋 Liste des coordinations
 * GET /api/utilisateurs/coordinations
 */
router.get(
  '/coordinations',
  role.peutGererComptes,
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.getCoordinations
);

/**
 * ✅ Vérifier disponibilité du nom d'utilisateur
 * GET /api/utilisateurs/check-username
 */
router.get(
  '/check-username',
  UTILISATEURS_CONFIG.rateLimits.standard,
  utilisateursController.checkUsernameAvailability
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

/**
 * 🏠 Page d'accueil documentée
 * GET /api/utilisateurs/home
 */
router.get('/home', (req, res) => {
  res.json({
    name: 'API Utilisateurs GESCARD',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    documentation: '/api/utilisateurs/health',
    endpoints: {
      consultation: {
        'GET /list': 'Liste utilisateurs (Admin)',
        'GET /': 'Liste (alias - Admin)',
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
      publiques: {
        'GET /health': 'Santé du service',
        'GET /test': 'Test',
        'GET /home': 'Cette page',
      },
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions sensibles par 15 minutes',
    },
    exemples: {
      curl_liste:
        'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/utilisateurs/list?page=1&limit=20',
      curl_details:
        'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/utilisateurs/1',
      curl_creation:
        'curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d @user.json http://localhost:3000/api/utilisateurs',
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
      'GET /api/utilisateurs/home',
      'GET /api/utilisateurs/health',
      'GET /api/utilisateurs/test',
      'GET /api/utilisateurs/list',
      'GET /api/utilisateurs/',
      'GET /api/utilisateurs/:id',
      'GET /api/utilisateurs/:id/history',
      'GET /api/utilisateurs/search',
      'GET /api/utilisateurs/stats',
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
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
