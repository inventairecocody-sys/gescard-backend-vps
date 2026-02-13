const express = require("express");
const router = express.Router();
const { verifyToken } = require("../middleware/auth");
const { 
  getProfile, 
  changePassword, 
  updateProfile,
  getUserActivity,
  checkUsernameAvailability,
  updateUsername,
  getProfileStats,
  deactivateAccount,
  exportProfileData,
  clearUserCache,
  diagnostic
} = require("../Controllers/profilController");
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
        message: 'Veuillez ralentir vos requêtes',
        code: 'PROFILE_RATE_LIMIT'
      }
    }),
    
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 actions sensibles par 15 minutes
      message: {
        success: false,
        error: 'Trop d\'actions sensibles',
        message: 'Limite d\'actions sensibles atteinte',
        code: 'SENSITIVE_ACTION_LIMIT'
      }
    }),
    
    password: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 3, // 3 tentatives de changement de mot de passe par heure
      message: {
        success: false,
        error: 'Trop de tentatives',
        message: 'Limite de changement de mot de passe atteinte',
        code: 'PASSWORD_CHANGE_LIMIT'
      }
    })
  },
  
  // Cache control
  cacheControl: {
    profile: 'private, max-age=30', // 30 secondes
    activity: 'private, max-age=60', // 1 minute
    stats: 'private, max-age=300' // 5 minutes
  }
};

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifyToken);

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = PROFIL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique au profil
router.use((req, res, next) => {
  console.log(`👤 [Profil] ${req.method} ${req.url} - User: ${req.user?.NomUtilisateur}`);
  next();
});

// ============================================
// ROUTES PRINCIPALES
// ============================================

/**
 * GET /api/profil - Récupérer les infos du profil
 */
router.get("/", PROFIL_CONFIG.rateLimits.standard, getProfile);

/**
 * GET /api/profil/info - Alias pour la route principale
 */
router.get("/info", PROFIL_CONFIG.rateLimits.standard, getProfile);

/**
 * PUT /api/profil - Mettre à jour le profil
 */
router.put("/", PROFIL_CONFIG.rateLimits.standard, updateProfile);

/**
 * PUT /api/profil/password - Modifier le mot de passe
 */
router.put("/password", PROFIL_CONFIG.rateLimits.password, changePassword);

/**
 * PUT /api/profil/username - Modifier le nom d'utilisateur
 */
router.put("/username", PROFIL_CONFIG.rateLimits.sensitive, updateUsername);

/**
 * GET /api/profil/activity - Récupérer l'activité de l'utilisateur
 */
router.get("/activity", PROFIL_CONFIG.rateLimits.standard, getUserActivity);

/**
 * GET /api/profil/stats - Statistiques du profil
 */
router.get("/stats", PROFIL_CONFIG.rateLimits.standard, getProfileStats);

/**
 * GET /api/profil/check-username - Vérifier disponibilité nom d'utilisateur
 */
router.get("/check-username", PROFIL_CONFIG.rateLimits.standard, checkUsernameAvailability);

/**
 * POST /api/profil/deactivate - Désactiver le compte
 */
router.post("/deactivate", PROFIL_CONFIG.rateLimits.sensitive, deactivateAccount);

/**
 * GET /api/profil/export - Exporter les données du profil
 */
router.get("/export", PROFIL_CONFIG.rateLimits.standard, exportProfileData);

/**
 * POST /api/profil/cache/clear - Nettoyer le cache utilisateur
 */
router.post("/cache/clear", PROFIL_CONFIG.rateLimits.standard, clearUserCache);

/**
 * GET /api/profil/diagnostic - Diagnostic du module
 */
router.get("/diagnostic", PROFIL_CONFIG.rateLimits.standard, diagnostic);

// ============================================
// ROUTES DE SANTÉ ET TEST
// ============================================

/**
 * GET /api/profil/health - Santé du service
 */
router.get("/health", (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'profil',
    timestamp: new Date().toISOString(),
    user: req.user ? {
      id: req.user.id,
      username: req.user.NomUtilisateur,
      role: req.user.Role
    } : null
  });
});

/**
 * GET /api/profil/test - Test du service
 */
router.get("/test", (req, res) => {
  res.json({
    success: true,
    message: 'Service profil fonctionnel',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/profil',
      'GET /api/profil/info',
      'PUT /api/profil',
      'PUT /api/profil/password',
      'PUT /api/profil/username',
      'GET /api/profil/activity',
      'GET /api/profil/stats',
      'GET /api/profil/check-username',
      'POST /api/profil/deactivate',
      'GET /api/profil/export',
      'POST /api/profil/cache/clear',
      'GET /api/profil/diagnostic',
      'GET /api/profil/health',
      'GET /api/profil/test'
    ]
  });
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get("/", (req, res) => {
  res.json({
    name: "API Profil GESCARD",
    description: "Module de gestion du profil utilisateur",
    version: "2.0.0-lws",
    user: req.user ? {
      id: req.user.id,
      username: req.user.NomUtilisateur,
      role: req.user.Role
    } : null,
    timestamp: new Date().toISOString(),
    documentation: '/api/profil/docs',
    endpoints: {
      consultation: {
        'GET /': 'Informations du profil',
        'GET /info': 'Informations (alias)',
        'GET /activity': 'Historique des activités',
        'GET /stats': 'Statistiques du profil',
        'GET /check-username': 'Vérifier disponibilité nom'
      },
      modification: {
        'PUT /': 'Mettre à jour le profil',
        'PUT /password': 'Changer le mot de passe',
        'PUT /username': 'Changer le nom d\'utilisateur'
      },
      gestion: {
        'POST /deactivate': 'Désactiver le compte',
        'GET /export': 'Exporter les données',
        'POST /cache/clear': 'Nettoyer le cache'
      },
      diagnostic: {
        'GET /diagnostic': 'Diagnostic module',
        'GET /health': 'Santé du service',
        'GET /test': 'Test du service'
      }
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '5 actions par 15 minutes',
      password: '3 tentatives par heure'
    },
    cache: {
      profile: '30 secondes',
      activity: '1 minute',
      stats: '5 minutes'
    },
    exemples: {
      curl_profile: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/profil',
      curl_password: 'curl -X PUT -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"currentPassword\":\"old\",\"newPassword\":\"new\"}" http://localhost:3000/api/profil/password',
      curl_activity: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/profil/activity?limit=20',
      curl_export: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/profil/export'
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
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API profil`,
    available_routes: [
      'GET /api/profil/',
      'GET /api/profil/info',
      'PUT /api/profil/',
      'PUT /api/profil/password',
      'PUT /api/profil/username',
      'GET /api/profil/activity',
      'GET /api/profil/stats',
      'GET /api/profil/check-username',
      'POST /api/profil/deactivate',
      'GET /api/profil/export',
      'POST /api/profil/cache/clear',
      'GET /api/profil/diagnostic',
      'GET /api/profil/health',
      'GET /api/profil/test'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;