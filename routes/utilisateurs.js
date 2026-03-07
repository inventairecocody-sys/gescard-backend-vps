// routes/utilisateurs.js

const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/utilisateursController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const rateLimit = require('express-rate-limit');

const RATE = {
  standard: rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: 'Trop de requêtes', code: 'STANDARD_RATE_LIMIT' },
  }),
  sensitive: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: "Trop d'actions sensibles", code: 'SENSITIVE_RATE_LIMIT' },
  }),
};

// ============================================
// MIDDLEWARE LOGGING
// ============================================
router.use((req, res, next) => {
  console.log(
    `👥 [Utilisateurs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'utilisateurs',
    timestamp: new Date().toISOString(),
  });
});

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service utilisateurs fonctionnel',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// AUTHENTIFICATION (requise pour toutes les routes suivantes)
// ============================================
router.use(verifierToken);

// ============================================
// ROUTES UTILITAIRES (tous les rôles authentifiés)
// ============================================

/**
 * Liste des rôles disponibles — tous les rôles
 * GET /api/utilisateurs/roles
 */
router.get('/roles', RATE.standard, ctrl.getRoles);

/**
 * Vérifier disponibilité du nom d'utilisateur — tous les rôles
 * GET /api/utilisateurs/check-username
 */
router.get('/check-username', RATE.standard, ctrl.checkUsernameAvailability);

// ============================================
// MIDDLEWARE RÔLE — Admin, Gestionnaire, Chef d'équipe
// (appliqué à toutes les routes suivantes)
// ============================================
router.use(role.peutGererComptes);

// ============================================
// ROUTES DE CONSULTATION
// ============================================

/**
 * Liste paginée — filtrée selon le rôle
 * GET /api/utilisateurs
 * GET /api/utilisateurs/list
 */
router.get('/', RATE.standard, ctrl.getAllUsers);
router.get('/list', RATE.standard, ctrl.getAllUsers);

/**
 * Recherche avancée — filtrée selon le rôle
 * GET /api/utilisateurs/search
 */
router.get('/search', RATE.standard, ctrl.searchUsers);

/**
 * Statistiques — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/stats
 */
router.get('/stats', RATE.standard, ctrl.getUserStats);

/**
 * Export — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/export
 */
router.get('/export', RATE.sensitive, ctrl.exportUsers);

/**
 * Liste des coordinations — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/coordinations
 */
router.get('/coordinations', RATE.standard, ctrl.getCoordinations);

/**
 * Liste des sites pour le formulaire utilisateur — filtrée selon le rôle
 * GET /api/utilisateurs/sites-list
 */
router.get('/sites-list', RATE.standard, ctrl.getSitesList);

/**
 * Diagnostic — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/diagnostic
 */
router.get('/diagnostic', RATE.standard, ctrl.diagnostic);

/**
 * Nettoyer le cache — Administrateur uniquement (vérifié dans le contrôleur)
 * POST /api/utilisateurs/cache/clear
 */
router.post('/cache/clear', RATE.standard, ctrl.clearStatsCache);

/**
 * Page d'accueil documentée
 * GET /api/utilisateurs/home
 */
router.get('/home', (req, res) => {
  res.json({
    name: 'API Utilisateurs GESCARD',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    utilisateur: req.user ? `${req.user.nomUtilisateur} (${req.user.role})` : 'Non authentifié',
    acces_par_role: {
      Administrateur: 'Gère tous les utilisateurs',
      Gestionnaire: 'Gère les utilisateurs de sa coordination',
      "Chef d'équipe": 'Gère les utilisateurs de son site — crée uniquement des Opérateurs',
      Opérateur: 'Accès lecture seule au profil',
    },
    endpoints: {
      consultation: {
        'GET /': 'Liste (filtrée selon rôle)',
        'GET /list': 'Liste (alias)',
        'GET /:id': 'Détail utilisateur',
        'GET /:id/history': 'Historique (Admin)',
        'GET /search': 'Recherche avancée',
        'GET /stats': 'Statistiques (Admin)',
        'GET /export': 'Export CSV/JSON (Admin)',
        'GET /coordinations': 'Liste coordinations (Admin)',
        'GET /sites-list': 'Liste sites (filtrée selon rôle)',
      },
      creation_modification: {
        'POST /': 'Créer utilisateur',
        'PUT /:id': 'Modifier utilisateur',
        'POST /:id/reset-password': 'Réinitialiser mot de passe',
        'POST /:id/activate': 'Activer',
        'DELETE /:id': 'Désactiver',
      },
      utilitaires: {
        'GET /roles': 'Liste des rôles valides',
        'GET /check-username': 'Vérifier disponibilité',
        'POST /cache/clear': 'Vider cache (Admin)',
        'GET /diagnostic': 'Diagnostic (Admin)',
        'GET /health': 'Santé du service',
      },
    },
    rate_limits: {
      standard: '30 requêtes / minute',
      sensitive: '10 actions / 15 minutes',
    },
  });
});

// ============================================
// ROUTES AVEC PARAMÈTRE :id
// (doivent être après les routes nommées fixes)
// ============================================

/**
 * Détail utilisateur
 * GET /api/utilisateurs/:id
 */
router.get('/:id', RATE.standard, ctrl.getUserById);

/**
 * Historique d'un utilisateur — Administrateur uniquement
 * GET /api/utilisateurs/:id/history
 */
router.get('/:id/history', RATE.standard, ctrl.getUserHistory);

/**
 * Créer utilisateur
 * POST /api/utilisateurs
 */
router.post('/', RATE.sensitive, ctrl.createUser);

/**
 * Modifier utilisateur
 * PUT /api/utilisateurs/:id
 */
router.put('/:id', RATE.sensitive, ctrl.updateUser);

/**
 * Réinitialiser le mot de passe
 * POST /api/utilisateurs/:id/reset-password
 */
router.post('/:id/reset-password', RATE.sensitive, ctrl.resetPassword);

/**
 * Activer un utilisateur
 * POST /api/utilisateurs/:id/activate
 */
router.post('/:id/activate', RATE.sensitive, ctrl.activateUser);

/**
 * Désactiver un utilisateur
 * DELETE /api/utilisateurs/:id
 */
router.delete('/:id', RATE.sensitive, ctrl.deleteUser);

// ============================================
// 404
// ============================================
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas`,
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
