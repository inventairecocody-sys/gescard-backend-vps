const express = require("express");
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { 
  loginUser,
  logoutUser,
  verifyToken,
  refreshToken,
  forgotPassword,
  resetPassword
} = require("../Controllers/utilisateursController");
const { verifyToken: verifyTokenMiddleware } = require("../middleware/auth");

// ============================================
// CONFIGURATION OPTIMISÉE POUR VPS
// ============================================
const AUTH_CONFIG = {
  // Rate limiting pour login
  loginLimiter: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 tentatives max (augmenté pour VPS)
    skipSuccessfulRequests: true,
    message: {
      success: false,
      error: 'Trop de tentatives de connexion',
      message: 'Veuillez réessayer dans 15 minutes',
      code: 'RATE_LIMIT_EXCEEDED'
    },
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Utiliser l'IP + username pour un rate limiting plus précis
      return `${req.ip}_${req.body?.NomUtilisateur || 'anonymous'}`;
    }
  }),

  // Rate limiting pour forgot password
  forgotLimiter: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 5, // 5 demandes max par heure (augmenté)
    message: {
      success: false,
      error: 'Trop de demandes',
      message: 'Vous avez atteint la limite de demandes de réinitialisation',
      code: 'RATE_LIMIT_FORGOT'
    }
  }),

  // Rate limiting pour reset password
  resetLimiter: rateLimit({
    windowMs: 60 * 60 * 1000, // 1 heure
    max: 10, // 10 tentatives max par heure (augmenté)
    message: {
      success: false,
      error: 'Trop de tentatives',
      message: 'Trop de tentatives de réinitialisation',
      code: 'RATE_LIMIT_RESET'
    }
  }),

  // Validation des entrées
  validations: {
    login: [
      body('NomUtilisateur')
        .trim()
        .notEmpty().withMessage("Nom d'utilisateur requis")
        .isLength({ min: 3, max: 50 }).withMessage("Le nom d'utilisateur doit contenir 3-50 caractères")
        .matches(/^[a-zA-Z0-9._-]+$/).withMessage("Caractères autorisés: lettres, chiffres, . _ -"),
      
      body('MotDePasse')
        .notEmpty().withMessage("Mot de passe requis")
        .isLength({ min: 6 }).withMessage("Le mot de passe doit contenir au moins 6 caractères")
    ],

    forgotPassword: [
      body('email')
        .trim()
        .notEmpty().withMessage("Email requis")
        .isEmail().withMessage("Email invalide")
        .normalizeEmail()
    ],

    resetPassword: [
      body('token')
        .notEmpty().withMessage("Token requis"),
      
      body('newPassword')
        .notEmpty().withMessage("Nouveau mot de passe requis")
        .isLength({ min: 8 }).withMessage("Le mot de passe doit contenir au moins 8 caractères")
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/).withMessage("Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre")
    ],

    refreshToken: [
      body('refreshToken')
        .notEmpty().withMessage("Refresh token requis")
    ]
  }
};

// ============================================
// MIDDLEWARE DE VALIDATION
// ============================================

/**
 * Middleware de validation des erreurs
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Erreur de validation',
      errors: errors.array().map(err => ({
        field: err.path,
        message: err.msg
      })),
      code: 'VALIDATION_ERROR'
    });
  }
  next();
};

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * Route de connexion avec validation et rate limiting
 * POST /api/auth/login
 */
router.post(
  "/login",
  AUTH_CONFIG.loginLimiter,
  AUTH_CONFIG.validations.login,
  validate,
  async (req, res) => {
    try {
      // Ajouter des métadonnées à la requête
      req.loginAttempt = {
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent']
      };

      await loginUser(req, res);
    } catch (error) {
      console.error('❌ Erreur route login:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        message: 'Une erreur est survenue lors de la connexion',
        code: 'SERVER_ERROR'
      });
    }
  }
);

/**
 * Route de déconnexion
 * POST /api/auth/logout
 */
router.post("/logout", verifyTokenMiddleware, async (req, res) => {
  try {
    await logoutUser(req, res);
  } catch (error) {
    console.error('❌ Erreur route logout:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * Vérification du token
 * GET /api/auth/verify
 */
router.get("/verify", verifyTokenMiddleware, async (req, res) => {
  try {
    await verifyToken(req, res);
  } catch (error) {
    console.error('❌ Erreur route verify:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR'
    });
  }
});

/**
 * Rafraîchissement du token
 * POST /api/auth/refresh
 */
router.post(
  "/refresh",
  AUTH_CONFIG.resetLimiter,
  AUTH_CONFIG.validations.refreshToken,
  validate,
  async (req, res) => {
    try {
      await refreshToken(req, res);
    } catch (error) {
      console.error('❌ Erreur route refresh:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        code: 'SERVER_ERROR'
      });
    }
  }
);

/**
 * Mot de passe oublié
 * POST /api/auth/forgot-password
 */
router.post(
  "/forgot-password",
  AUTH_CONFIG.forgotLimiter,
  AUTH_CONFIG.validations.forgotPassword,
  validate,
  async (req, res) => {
    try {
      await forgotPassword(req, res);
    } catch (error) {
      console.error('❌ Erreur route forgot-password:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        code: 'SERVER_ERROR'
      });
    }
  }
);

/**
 * Réinitialisation du mot de passe
 * POST /api/auth/reset-password
 */
router.post(
  "/reset-password",
  AUTH_CONFIG.resetLimiter,
  AUTH_CONFIG.validations.resetPassword,
  validate,
  async (req, res) => {
    try {
      await resetPassword(req, res);
    } catch (error) {
      console.error('❌ Erreur route reset-password:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        code: 'SERVER_ERROR'
      });
    }
  }
);

// ============================================
// ROUTES DE DIAGNOSTIC (développement uniquement)
// ============================================

if (process.env.NODE_ENV !== 'production') {
  /**
   * Route de test pour vérifier le bon fonctionnement
   * GET /api/auth/test
   */
  router.get("/test", (req, res) => {
    res.json({
      success: true,
      message: "Routes d'authentification fonctionnelles",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      availableEndpoints: [
        'POST /login',
        'POST /logout',
        'GET /verify',
        'POST /refresh',
        'POST /forgot-password',
        'POST /reset-password'
      ]
    });
  });

  /**
   * Route de configuration
   * GET /api/auth/config
   */
  router.get("/config", (req, res) => {
    res.json({
      success: true,
      config: {
        rateLimiting: {
          login: '10 per 15 minutes',
          forgot: '5 per hour',
          reset: '10 per hour'
        },
        validation: {
          passwordMinLength: 8,
          usernamePattern: '^[a-zA-Z0-9._-]{3,50}$'
        },
        jwtExpiration: process.env.JWT_EXPIRATION || '8h',
        environment: process.env.NODE_ENV || 'development'
      }
    });
  });
}

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas`,
    availableRoutes: [
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET /api/auth/verify',
      'POST /api/auth/refresh',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;