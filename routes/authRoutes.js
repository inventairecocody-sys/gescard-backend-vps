const express = require("express");
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');
const { 
  loginUser,
  logoutUser,
  verifyToken
} = require("../Controllers/utilisateursController");
const { verifierToken } = require("../middleware/auth");
const journalRequetes = require("../middleware/journalRequetes");

// ============================================
// CONFIGURATION OPTIMISÉE POUR VPS/LWS
// ============================================
const AUTH_CONFIG = {
  // Rate limiting pour login
  loginLimiter: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 tentatives max
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

  // Validation des entrées avec les nouveaux rôles
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
router.post("/logout", verifierToken, async (req, res) => {
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
router.get("/verify", verifierToken, async (req, res) => {
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
      roles: [
        'Administrateur',
        'Gestionnaire',
        'Chef d\'équipe',
        'Opérateur'
      ],
      availableEndpoints: [
        'POST /login',
        'POST /logout',
        'GET /verify'
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
          login: '10 per 15 minutes'
        },
        validation: {
          passwordMinLength: 8,
          usernamePattern: '^[a-zA-Z0-9._-]{3,50}$'
        },
        jwtExpiration: process.env.JWT_EXPIRATION || '8h',
        roles: [
          'Administrateur',
          'Gestionnaire',
          'Chef d\'équipe',
          'Opérateur'
        ],
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
      'GET /api/auth/verify'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;