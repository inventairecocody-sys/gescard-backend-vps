const express = require('express');
const router = express.Router();
const profilController = require('../Controllers/profilController'); // ✅ CORRECT
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const PROFIL_CONFIG = {
  // Rate limiting spécifique au profil
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

    password: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 3, // 3 tentatives de changement de mot de passe par heure
      message: {
        success: false,
        error: 'Trop de tentatives de changement de mot de passe',
        code: 'PASSWORD_RATE_LIMIT',
      },
    }),
  },

  // Cache control
  cacheControl: {
    profile: 'private, max-age=60', // 1 minute
    stats: 'private, max-age=300', // 5 minutes
    activity: 'private, max-age=30', // 30 secondes
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/')[1]; // profile, activity, stats, etc.
  const cacheControl = PROFIL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(
    `👤 [Profil] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * GET /api/profil/health - Santé du service
 */
router.get('/health', PROFIL_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'profil',
    timestamp: new Date().toISOString(),
    version: '2.0.0-lws',
    endpoints: [
      'GET /api/profil',
      'GET /api/profil/:userId',
      'POST /api/profil/change-password',
      'GET /api/profil/activity',
      'GET /api/profil/:userId/activity',
      'GET /api/profil/check-username',
      'PUT /api/profil/username',
      'GET /api/profil/stats',
      'POST /api/profil/deactivate',
      'POST /api/profil/reactivate/:userId',
      'GET /api/profil/export',
      'GET /api/profil/sessions',
      'POST /api/profil/logout-others',
      'POST /api/profil/cache/clear',
      'GET /api/profil/diagnostic',
    ],
  });
});

/**
 * GET /api/profil/test - Test du service
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service profil fonctionnel',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
  });
});

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifierToken);

// ============================================
// ROUTES DE PROFIL (utilisateur connecté)
// ============================================

/**
 * GET /api/profil - Récupérer le profil de l'utilisateur connecté
 */
router.get('/', PROFIL_CONFIG.rateLimits.standard, profilController.getProfile);

/**
 * PUT /api/profil - Mettre à jour le profil
 */
router.put('/', PROFIL_CONFIG.rateLimits.standard, profilController.updateProfile);

/**
 * POST /api/profil/change-password - Changer le mot de passe
 */
router.post('/change-password', PROFIL_CONFIG.rateLimits.password, profilController.changePassword);

/**
 * GET /api/profil/activity - Activité de l'utilisateur connecté
 */
router.get('/activity', PROFIL_CONFIG.rateLimits.standard, profilController.getUserActivity);

/**
 * GET /api/profil/check-username - Vérifier disponibilité du nom d'utilisateur
 */
router.get(
  '/check-username',
  PROFIL_CONFIG.rateLimits.standard,
  profilController.checkUsernameAvailability
);

/**
 * PUT /api/profil/username - Mettre à jour le nom d'utilisateur
 */
router.put('/username', PROFIL_CONFIG.rateLimits.sensitive, profilController.updateUsername);

/**
 * GET /api/profil/stats - Statistiques du profil
 */
router.get('/stats', PROFIL_CONFIG.rateLimits.standard, profilController.getProfileStats);

/**
 * POST /api/profil/deactivate - Désactiver le compte
 */
router.post('/deactivate', PROFIL_CONFIG.rateLimits.sensitive, profilController.deactivateAccount);

/**
 * GET /api/profil/export - Exporter les données du profil
 */
router.get('/export', PROFIL_CONFIG.rateLimits.standard, profilController.exportProfileData);

/**
 * GET /api/profil/sessions - Sessions actives
 */
router.get('/sessions', PROFIL_CONFIG.rateLimits.standard, profilController.getActiveSessions);

/**
 * POST /api/profil/logout-others - Déconnecter les autres sessions
 */
router.post(
  '/logout-others',
  PROFIL_CONFIG.rateLimits.sensitive,
  profilController.logoutOtherSessions
);

/**
 * POST /api/profil/cache/clear - Nettoyer le cache utilisateur
 */
router.post('/cache/clear', PROFIL_CONFIG.rateLimits.standard, profilController.clearUserCache);

// ============================================
// ROUTES ADMINISTRATEUR (Admin uniquement)
// ============================================

/**
 * GET /api/profil/:userId - Récupérer le profil d'un utilisateur (Admin uniquement)
 */
router.get(
  '/:userId',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.standard,
  profilController.getUserProfile
);

/**
 * GET /api/profil/:userId/activity - Activité d'un utilisateur (Admin uniquement)
 */
router.get(
  '/:userId/activity',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.standard,
  profilController.getUserActivityById
);

/**
 * POST /api/profil/reactivate/:userId - Réactiver un compte (Admin uniquement)
 */
router.post(
  '/reactivate/:userId',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.sensitive,
  profilController.reactivateAccount
);

/**
 * GET /api/profil/diagnostic - Diagnostic du module (Admin uniquement)
 */
router.get(
  '/diagnostic',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.standard,
  profilController.diagnostic
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: 'API Profil GESCARD',
    description: 'Module de gestion des profils utilisateurs',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    documentation: {
      mon_profil: '/api/profil/me - Mon profil',
      modifier: '/api/profil - PUT - Modifier mon profil',
      mot_de_passe: '/api/profil/change-password - POST - Changer mot de passe',
      activite: '/api/profil/activity - Mon activité',
      statistiques: '/api/profil/stats - Mes statistiques',
      exporter: '/api/profil/export - Exporter mes données',
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
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API profil`,
    available_routes: [
      'GET /api/profil',
      'GET /api/profil/:userId',
      'GET /api/profil/activity',
      'GET /api/profil/:userId/activity',
      'GET /api/profil/check-username',
      'GET /api/profil/stats',
      'GET /api/profil/export',
      'GET /api/profil/sessions',
      'GET /api/profil/diagnostic',
      'GET /api/profil/health',
      'GET /api/profil/test',
      'PUT /api/profil',
      'PUT /api/profil/username',
      'POST /api/profil/change-password',
      'POST /api/profil/deactivate',
      'POST /api/profil/reactivate/:userId',
      'POST /api/profil/logout-others',
      'POST /api/profil/cache/clear',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
