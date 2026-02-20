const express = require('express');
const router = express.Router();
const utilisateursController = require('../Controllers/utilisateursController'); // Note: import depuis authController
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
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
  console.log(`👥 [Utilisateurs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`);
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
router.post('/logout', verifierToken, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.logoutUser);

/**
 * GET /api/utilisateurs/verify - Vérifier le token
 */
router.get('/verify', verifierToken, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.verifyToken);

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
    version: '3.0.0-lws',
    roles_autorises: {
      administrateur: '✅ Accès complet à toutes les fonctionnalités',
      gestionnaire: '❌ Pas d\'accès à la gestion des utilisateurs',
      chef_equipe: '❌ Pas d\'accès à la gestion des utilisateurs',
      operateur: '❌ Pas d\'accès à la gestion des utilisateurs'
    },
    endpoints: [
      'POST /api/utilisateurs/login',
      'POST /api/utilisateurs/logout',
      'GET /api/utilisateurs/verify',
      'GET /api/utilisateurs/roles',
      'GET /api/utilisateurs/coordinations',
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
 * GET /api/utilisateurs/coordinations - Liste des coordinations disponibles (Admin uniquement)
 */
router.get('/coordinations', verifierToken, role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getCoordinations);

/**
 * GET /api/utilisateurs/check-username - Vérifier disponibilité nom d'utilisateur
 */
router.get('/check-username', verifierToken, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.checkUsernameAvailability);

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// ============================================
// ROUTES DE CONSULTATION (Admin uniquement)
// ============================================

/**
 * GET /api/utilisateurs - Liste tous les utilisateurs (admin requis)
 */
router.get('/', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getAllUsers);

/**
 * GET /api/utilisateurs/list - Alias pour la liste
 */
router.get('/list', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getAllUsers);

/**
 * GET /api/utilisateurs/:id - Détails d'un utilisateur (admin requis)
 */
router.get('/:id', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getUserById);

/**
 * GET /api/utilisateurs/:id/history - Historique d'un utilisateur (admin requis)
 */
router.get('/:id/history', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getUserHistory);

// ============================================
// ROUTES DE RECHERCHE ET STATISTIQUES (Admin uniquement)
// ============================================

/**
 * GET /api/utilisateurs/search - Recherche avancée
 */
router.get('/search', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.searchUsers);

/**
 * GET /api/utilisateurs/stats - Statistiques utilisateurs
 */
router.get('/stats', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.getUserStats);

/**
 * GET /api/utilisateurs/export - Export des utilisateurs (admin uniquement)
 */
router.get('/export', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.exportUsers);

// ============================================
// ROUTES DE CRÉATION ET MODIFICATION (Admin uniquement)
// ============================================

/**
 * POST /api/utilisateurs - Créer un utilisateur (admin requis)
 */
router.post('/', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.createUser);

/**
 * PUT /api/utilisateurs/:id - Modifier un utilisateur (admin requis)
 */
router.put('/:id', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.updateUser);

/**
 * POST /api/utilisateurs/:id/reset-password - Réinitialiser mot de passe (admin requis)
 */
router.post('/:id/reset-password', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.resetPassword);

/**
 * POST /api/utilisateurs/:id/activate - Activer un utilisateur (admin requis)
 */
router.post('/:id/activate', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.activateUser);

/**
 * DELETE /api/utilisateurs/:id - Désactiver un utilisateur (admin requis)
 */
router.delete('/:id', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.sensitive, utilisateursController.deleteUser);

// ============================================
// ROUTES D'ADMINISTRATION (Admin uniquement)
// ============================================

/**
 * POST /api/utilisateurs/cache/clear - Nettoyer le cache des stats (admin requis)
 */
router.post('/cache/clear', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.clearStatsCache);

/**
 * GET /api/utilisateurs/diagnostic - Diagnostic du module (admin requis)
 */
router.get('/diagnostic', role.peutGererComptes, UTILISATEURS_CONFIG.rateLimits.standard, utilisateursController.diagnostic);

// ============================================
// ROUTE DE TEST
// ============================================

/**
 * GET /api/utilisateurs/test - Test du service
 */
router.get('/test', (req, res) => {
  const roleInfo = req.user ? 
    `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - ${req.user.role === 'Administrateur' ? '✅ Accès autorisé' : '❌ Accès restreint'}` : 
    'Non authentifié';
  
  res.json({
    success: true,
    message: 'Service utilisateurs fonctionnel',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    user: req.user ? {
      id: req.user.id,
      username: req.user.nomUtilisateur,
      role: req.user.role,
      coordination: req.user.coordination
    } : null,
    roles_autorises: {
      consultation: 'Administrateur uniquement',
      creation: 'Administrateur uniquement',
      modification: 'Administrateur uniquement',
      suppression: 'Administrateur uniquement'
    }
  });
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  const roleInfo = req.user ? 
    `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - ${req.user.role === 'Administrateur' ? '✅ Accès autorisé' : '❌ Accès restreint'}` : 
    'Non authentifié';
  
  res.json({
    name: "API Utilisateurs GESCARD",
    description: "Module de gestion des utilisateurs",
    version: "3.0.0-lws",
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    roles_autorises: {
      administrateur: "✅ Accès complet à toutes les fonctionnalités",
      gestionnaire: "❌ Non autorisé (pas d'accès à la gestion des utilisateurs)",
      chef_equipe: "❌ Non autorisé (pas d'accès à la gestion des utilisateurs)",
      operateur: "❌ Non autorisé (pas d'accès à la gestion des utilisateurs)"
    },
    documentation: '/api/utilisateurs/docs',
    authentification: {
      login: 'POST /api/utilisateurs/login',
      logout: 'POST /api/utilisateurs/logout',
      verify: 'GET /api/utilisateurs/verify'
    },
    endpoints: {
      consultation: {
        'GET /': '📋 Liste des utilisateurs (Admin)',
        'GET /list': '📋 Liste (alias - Admin)',
        'GET /:id': '👤 Détails utilisateur (Admin)',
        'GET /:id/history': '📜 Historique utilisateur (Admin)'
      },
      recherche: {
        'GET /search': '🔍 Recherche avancée (Admin)',
        'GET /stats': '📊 Statistiques (Admin)',
        'GET /export': '📤 Export des données (Admin)',
        'GET /roles': '🔧 Liste des rôles (public)',
        'GET /coordinations': '🏢 Liste des coordinations (Admin)'
      },
      creation: {
        'POST /': '➕ Créer utilisateur (Admin)'
      },
      modification: {
        'PUT /:id': '✏️ Modifier utilisateur (Admin)',
        'POST /:id/reset-password': '🔄 Réinitialiser mot de passe (Admin)',
        'POST /:id/activate': '✅ Activer utilisateur (Admin)',
        'DELETE /:id': '❌ Désactiver utilisateur (Admin)'
      },
      administration: {
        'GET /diagnostic': '🔧 Diagnostic module (Admin)',
        'POST /cache/clear': '🧹 Nettoyer cache (Admin)',
        'GET /health': '🩺 Santé service (public)',
        'GET /test': '🧪 Test service (public)'
      },
      utilitaires: {
        'GET /check-username': '✅ Vérifier disponibilité nom (authentifié)'
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
      Administrateur: '✅ Accès complet',
      Gestionnaire: '❌ Pas d\'accès',
      'Chef d\'équipe': '❌ Pas d\'accès',
      Opérateur: '❌ Pas d\'accès'
    },
    nouvelles_fonctionnalites: {
      coordination: 'Gestion de la coordination des utilisateurs',
      filtres: 'Recherche et filtrage par coordination',
      export: 'Export CSV/JSON des utilisateurs'
    },
    exemples: {
      curl_login: 'curl -X POST -H "Content-Type: application/json" -d "{\"NomUtilisateur\":\"admin\",\"MotDePasse\":\"password\"}" http://localhost:3000/api/utilisateurs/login',
      curl_list: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/utilisateurs?page=1&limit=20',
      curl_search: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/utilisateurs/search?q=jean&role=Gestionnaire"',
      curl_create: 'curl -X POST -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\"NomUtilisateur\":\"nouveau\",\"NomComplet\":\"Nouveau User\",\"Role\":\"Gestionnaire\",\"Coordination\":\"Abidjan\",\"MotDePasse\":\"password123\"}" http://localhost:3000/api/utilisateurs',
      curl_coordinations: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/utilisateurs/coordinations'
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
      'GET /api/utilisateurs/coordinations',
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