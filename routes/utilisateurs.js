const express = require('express');
const router = express.Router();
const utilisateursController = require('../Controllers/utilisateursController');
const { verifyToken, verifyRole } = require('../middleware/auth');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const UTILISATEURS_CONFIG = {
  // Rate limiting spécifique aux utilisateurs
  rateLimits: {
    login: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 tentatives
      skipSuccessfulRequests: true,
      message: {
        success: false,
        error: 'Trop de tentatives de connexion',
        message: 'Veuillez réessayer dans 15 minutes',
        code: 'LOGIN_RATE_LIMIT'
      }
    }),
    
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requêtes par minute
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'STANDARD_RATE_LIMIT'
      }
    }),
    
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles
      message: {
        success: false,
        error: 'Trop d\'actions sensibles',
        code: 'SENSITIVE_RATE_LIMIT'
      }
    })
  },
  
  // Cache control
  cacheControl: {
    list: 'private, max-age=10', // 10 secondes
    details: 'private, max-age=30', // 30 secondes
    search: 'private, max-age=5', // 5 secondes
    stats: 'private, max-age=300' // 5 minutes
  }
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

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(`👥 [Utilisateurs] ${req.method} ${req.url} - User: ${req.user?.NomUtilisateur || 'non authentifié'}`);
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * POST /api/utilisateurs/login - Connexion
 */
router.post('/login', UTILISATEURS_CONFIG.rateLimits.login, utilisateursController.loginUser);

/**
 * POST /api/utilisateurs/logout - Déconnexion
 */
router.post('/logout', verifyToken, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.logoutUser);

/**
 * GET /api/utilisateurs/verify - Vérifier le token
 */
router.get('/verify', verifyToken, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.verifyToken);

// ============================================
// ROUTES PUBLIQUES (information)
// ============================================

/**
 * GET /api/utilisateurs/health - Santé du service
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'utilisateurs',
    timestamp: new Date().toISOString(),
    endpoints: [
      'POST /api/utilisateurs/login',
      'POST /api/utilisateurs/logout',
      'GET /api/utilisateurs/verify',
      'GET /api/utilisateurs/roles',
      'GET /api/utilisateurs/check-username',
      'GET /api/utilisateurs',
      'GET /api/utilisateurs/:id',
      'POST /api/utilisateurs',
      'PUT /api/utilisateurs/:id',
      'POST /api/utilisateurs/:id/reset-password',
      'POST /api/utilisateurs/:id/activate',
      'DELETE /api/utilisateurs/:id',
      'GET /api/utilisateurs/stats',
      'GET /api/utilisateurs/search',
      'GET /api/utilisateurs/:id/history',
      'GET /api/utilisateurs/export',
      'POST /api/utilisateurs/cache/clear',
      'GET /api/utilisateurs/diagnostic'
    ]
  });
});

/**
 * GET /api/utilisateurs/roles - Liste des rôles disponibles
 */
router.get('/roles', UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getRoles);

/**
 * GET /api/utilisateurs/check-username - Vérifier disponibilité nom d'utilisateur
 */
router.get('/check-username', UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.checkUsernameAvailability);

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifyToken);

// ============================================
// ROUTES DE CONSULTATION
// ============================================

/**
 * GET /api/utilisateurs - Liste tous les utilisateurs (admin requis)
 */
router.get('/', verifyRole(['Administrateur', 'Superviseur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getAllUsers);

/**
 * GET /api/utilisateurs/list - Alias pour la liste
 */
router.get('/list', verifyRole(['Administrateur', 'Superviseur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getAllUsers);

/**
 * GET /api/utilisateurs/:id - Détails d'un utilisateur
 */
router.get('/:id', UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getUserById);

/**
 * GET /api/utilisateurs/:id/history - Historique d'un utilisateur
 */
router.get('/:id/history', verifyRole(['Administrateur', 'Superviseur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getUserHistory);

// ============================================
// ROUTES DE RECHERCHE ET STATISTIQUES
// ============================================

/**
 * GET /api/utilisateurs/search - Recherche avancée
 */
router.get('/search', verifyRole(['Administrateur', 'Superviseur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.searchUsers);

/**
 * GET /api/utilisateurs/stats - Statistiques utilisateurs
 */
router.get('/stats', verifyRole(['Administrateur', 'Superviseur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getUserStats);

/**
 * GET /api/utilisateurs/export - Export des utilisateurs
 */
router.get('/export', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.exportUsers);

// ============================================
// ROUTES DE CRÉATION ET MODIFICATION
// ============================================

/**
 * POST /api/utilisateurs - Créer un utilisateur (admin requis)
 */
router.post('/', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.createUser);

/**
 * PUT /api/utilisateurs/:id - Modifier un utilisateur
 */
router.put('/:id', verifyRole(['Administrateur', 'Superviseur']), UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.updateUser);

/**
 * POST /api/utilisateurs/:id/reset-password - Réinitialiser mot de passe
 */
router.post('/:id/reset-password', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.resetPassword);

/**
 * POST /api/utilisateurs/:id/activate - Activer un utilisateur
 */
router.post('/:id/activate', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.activateUser);

/**
 * DELETE /api/utilisateurs/:id - Désactiver un utilisateur
 */
router.delete('/:id', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.deleteUser);

// ============================================
// ROUTES D'ADMINISTRATION
// ============================================

/**
 * POST /api/utilisateurs/cache/clear - Nettoyer le cache des stats
 */
router.post('/cache/clear', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.clearStatsCache);

/**
 * GET /api/utilisateurs/diagnostic - Diagnostic du module
 */
router.get('/diagnostic', verifyRole(['Administrateur']), UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.diagnostic);

// ============================================
// ROUTE DE TEST
// ============================================

/**
 * GET /api/utilisateurs/test - Test du service
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service utilisateurs fonctionnel',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    user: req.user ? {
      id: req.user.id,
      username: req.user.NomUtilisateur,
      role: req.user.Role
    } : null
  });
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: "API Utilisateurs GESCARD",
    description: "Module de gestion des utilisateurs",
    version: "2.0.0-lws",
    timestamp: new Date().toISOString(),
    documentation: '/api/utilisateurs/docs',
    authentification: {
      login: 'POST /api/utilisateurs/login',
      logout: 'POST /api/utilisateurs/logout',
      verify: 'GET /api/utilisateurs/verify'
    },
    endpoints: {
      consultation: {
        'GET /': 'Liste des utilisateurs (admin)',
        'GET /list': 'Liste (alias)',
        'GET /:id': 'Détails utilisateur',
        'GET /:id/history': 'Historique utilisateur'
      },
      recherche: {
        'GET /search': 'Recherche avancée',
        'GET /stats': 'Statistiques',
        'GET /export': 'Export des données',
        'GET /roles': 'Liste des rôles'
      },
      creation: {
        'POST /': 'Créer utilisateur (admin)'
      },
      modification: {
        'PUT /:id': 'Modifier utilisateur',
        'POST /:id/reset-password': 'Réinitialiser mot de passe',
        'POST /:id/activate': 'Activer utilisateur',
        'DELETE /:id': 'Désactiver utilisateur'
      },
      administration: {
        'GET /diagnostic': 'Diagnostic module',
        'POST /cache/clear': 'Nettoyer cache',
        'GET /health': 'Santé service',
        'GET /test': 'Test service'
      },
      utilitaires: {
        'GET /check-username': 'Vérifier disponibilité nom'
      }
    },
    rate_limits: {
      login: '5 tentatives par 15 minutes',
      standard: '30 requêtes par minute',
      sensitive: '10 actions par 15 minutes'
    },
    cache: {
      list: '10 secondes',
      details: '30 secondes',
      search: '5 secondes',
      stats: '5 minutes'
    },
    roles: {
      Administrateur: 'Accès complet',
      Superviseur: 'Accès gestion utilisateurs',
      'Chef d\'équipe': 'Consultation limitée',
      Opérateur: 'Actions basiques',
      Consultant: 'Lecture seule'
    },
    exemples: {
      curl_login: 'curl -X POST -H "Content-Type: application/json" -d "{\"NomUtilisateur\":\"admin\",\"MotDePasse\":\"password\"}" http://localhost:3000/api/utilisateurs/login',
      curl_list: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/utilisateurs?page=1&limit=20',
      curl_search: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/utilisateurs/search?q=jean&role=Operateur"',
      curl_create: 'curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"NomUtilisateur\":\"nouveau\",\"NomComplet\":\"Nouveau User\",\"Role\":\"Operateur\",\"MotDePasse\":\"password123\"}" http://localhost:3000/api/utilisateurs'
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
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API utilisateurs`,
    available_routes: [
      'POST /api/utilisateurs/login',
      'POST /api/utilisateurs/logout',
      'GET /api/utilisateurs/verify',
      'GET /api/utilisateurs/roles',
      'GET /api/utilisateurs/check-username',
      'GET /api/utilisateurs/health',
      'GET /api/utilisateurs/test',
      'GET /api/utilisateurs/',
      'GET /api/utilisateurs/list',
      'GET /api/utilisateurs/:id',
      'GET /api/utilisateurs/:id/history',
      'GET /api/utilisateurs/search',
      'GET /api/utilisateurs/stats',
      'GET /api/utilisateurs/export',
      'POST /api/utilisateurs/',
      'PUT /api/utilisateurs/:id',
      'POST /api/utilisateurs/:id/reset-password',
      'POST /api/utilisateurs/:id/activate',
      'DELETE /api/utilisateurs/:id',
      'POST /api/utilisateurs/cache/clear',
      'GET /api/utilisateurs/diagnostic'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;