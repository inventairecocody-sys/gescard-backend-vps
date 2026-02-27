// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// IMPORT DU CONTROLLER
const authController = require('../Controllers/authController');

// IMPORT DU MIDDLEWARE
const { verifyToken } = require('../middleware/auth');

// Vérification du middleware
if (typeof verifyToken !== 'function') {
  console.error("❌ ERREUR: verifyToken n'est pas une fonction!");
  console.error('Vérifiez que le middleware/auth.js exporte bien verifyToken');
  process.exit(1);
} else {
  console.log('✅ Middleware verifyToken chargé avec succès');
}

// Vérification du contrôleur
if (!authController) {
  console.error('❌ ERREUR: authController est undefined');
  process.exit(1);
}

console.log('📦 Contrôleur chargé, fonctions disponibles:', Object.keys(authController));

// Destructuration du contrôleur
const {
  loginUser,
  logoutUser,
  verifyToken: verifyTokenController,
  refreshToken,
  forgotPassword,
  resetPassword,
} = authController;

// Vérification des fonctions du contrôleur
const controllerFunctions = {
  loginUser,
  logoutUser,
  verifyTokenController,
  refreshToken,
  forgotPassword,
  resetPassword,
};

Object.entries(controllerFunctions).forEach(([name, func]) => {
  if (typeof func !== 'function') {
    console.error(`❌ ERREUR: ${name} n'est pas une fonction!`);
    process.exit(1);
  } else {
    console.log(`✅ ${name} est bien une fonction`);
  }
});

// Configuration
const AUTH_CONFIG = {
  loginLimiter: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 tentatives max
    skipSuccessfulRequests: true,
    message: {
      success: false,
      error: 'Trop de tentatives de connexion',
      message: 'Veuillez réessayer dans 15 minutes',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  }),

  validations: {
    login: [
      body('NomUtilisateur')
        .trim()
        .notEmpty()
        .withMessage("Nom d'utilisateur requis")
        .isLength({ min: 3, max: 50 })
        .withMessage("Le nom d'utilisateur doit contenir 3-50 caractères")
        .matches(/^[a-zA-Z0-9._-]+$/)
        .withMessage('Caractères autorisés: lettres, chiffres, . _ -'),

      body('MotDePasse')
        .notEmpty()
        .withMessage('Mot de passe requis')
        .isLength({ min: 6 })
        .withMessage('Le mot de passe doit contenir au moins 6 caractères'),
    ],
  },
};

// Middleware de validation
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Erreur de validation',
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
      code: 'VALIDATION_ERROR',
    });
  }
  next();
};

console.log('🚀 Définition des routes...');

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * Connexion utilisateur
 * POST /api/auth/login
 */
console.log('   → Définition POST /login');
router.post(
  '/login',
  AUTH_CONFIG.loginLimiter,
  AUTH_CONFIG.validations.login,
  validate,
  async (req, res) => {
    try {
      req.loginAttempt = {
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      };
      await loginUser(req, res);
    } catch (error) {
      console.error('❌ Erreur route login:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        message: 'Une erreur est survenue lors de la connexion',
        code: 'SERVER_ERROR',
      });
    }
  }
);

/**
 * Mot de passe oublié
 * POST /api/auth/forgot-password
 */
console.log('   → Définition POST /forgot-password');
router.post('/forgot-password', async (req, res) => {
  try {
    await forgotPassword(req, res);
  } catch (error) {
    console.error('❌ Erreur route forgot-password:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * Réinitialisation mot de passe
 * POST /api/auth/reset-password
 */
console.log('   → Définition POST /reset-password');
router.post('/reset-password', async (req, res) => {
  try {
    await resetPassword(req, res);
  } catch (error) {
    console.error('❌ Erreur route reset-password:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

// ============================================
// ROUTES PROTÉGÉES (NÉCESSITENT UN TOKEN)
// ============================================

/**
 * Déconnexion
 * POST /api/auth/logout
 */
console.log('   → Définition POST /logout');
router.post('/logout', verifyToken, async (req, res) => {
  try {
    await logoutUser(req, res);
  } catch (error) {
    console.error('❌ Erreur route logout:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * Vérification du token
 * GET /api/auth/verify
 */
console.log('   → Définition GET /verify');
router.get('/verify', verifyToken, async (req, res) => {
  try {
    await verifyTokenController(req, res);
  } catch (error) {
    console.error('❌ Erreur route verify:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * Rafraîchissement du token
 * POST /api/auth/refresh
 */
console.log('   → Définition POST /refresh');
router.post('/refresh', verifyToken, async (req, res) => {
  try {
    await refreshToken(req, res);
  } catch (error) {
    console.error('❌ Erreur route refresh:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

// ============================================
// ROUTES DE DIAGNOSTIC (mode développement uniquement)
// ============================================
if (process.env.NODE_ENV !== 'production') {
  console.log('   → Définition GET /test (mode dev)');
  router.get('/test', (req, res) => {
    res.json({
      success: true,
      message: "Routes d'authentification fonctionnelles",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      roles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
      availableEndpoints: [
        'POST /login',
        'POST /logout',
        'GET /verify',
        'POST /refresh',
        'POST /forgot-password',
        'POST /reset-password',
      ],
    });
  });
}

// ============================================
// GESTION 404
// ============================================
console.log('   → Définition middleware 404');
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
      'POST /api/auth/reset-password',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

console.log('✅ Toutes les routes ont été définies avec succès!');
console.log('📊 Nombre total de routes:', router.stack.length);

module.exports = router;
