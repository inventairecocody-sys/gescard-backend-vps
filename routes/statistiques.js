// routes/statistiques.js
const express = require('express');
const router = express.Router();
const { verifierToken } = require('../middleware/auth');
const permission = require('../middleware/permission');
const role = require('../middleware/verificationRole');
const ctrl = require('../Controllers/StatistiquesController');

// ============================================
// MIDDLEWARE GLOBAUX
// ============================================

// Authentification obligatoire sur toutes les routes
router.use(verifierToken);

// Logging
router.use((req, res, next) => {
  console.log(
    `📊 [Stats] ${req.method} ${req.path} - ${req.user?.nomUtilisateur} (${req.user?.role}) - ${req.user?.coordination || 'toutes coordinations'}`
  );
  next();
});

// Cache-Control navigateur
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  next();
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/statistiques/globales
 * Totaux généraux filtrés selon le rôle
 * Accès : Administrateur, Gestionnaire, Chef d'équipe, Opérateur
 */
router.get('/globales', permission.peutVoirStatistiques, ctrl.globales);

/**
 * GET /api/statistiques/sites
 * Statistiques par site filtrées selon le rôle
 * Accès : Administrateur, Gestionnaire, Chef d'équipe, Opérateur
 */
router.get('/sites', permission.peutVoirStatistiques, ctrl.parSite);

/**
 * GET /api/statistiques/detail
 * Statistiques complètes (globales + sites + évolution)
 * Accès : Administrateur, Gestionnaire, Chef d'équipe, Opérateur
 */
router.get('/detail', permission.peutVoirStatistiques, ctrl.detail);

/**
 * GET /api/statistiques/quick
 * Stats rapides pour tableau de bord
 * Accès : tous les rôles
 */
router.get('/quick', permission.peutVoirStatistiques, ctrl.quick);

/**
 * GET /api/statistiques/evolution
 * Évolution temporelle des imports
 * Paramètres : ?periode=30&interval=day|week|month
 * Accès : Administrateur, Gestionnaire, Chef d'équipe
 */
router.get('/evolution', permission.peutVoirStatistiques, ctrl.evolution);

/**
 * GET /api/statistiques/imports
 * Statistiques par lot d'import
 * Paramètres : ?limit=10
 * Accès : Administrateur, Gestionnaire, Chef d'équipe
 */
router.get('/imports', permission.peutVoirStatistiques, ctrl.parImport);

/**
 * GET /api/statistiques/agences
 * Statistiques par agence (total cartes, retirées, restantes, taux, sites, agents)
 * Accès : Administrateur (tout), Gestionnaire (sa coordination), Chef d'équipe (son agence)
 */
router.get('/agences', permission.peutVoirStatistiques, ctrl.parAgence); // ✅ AJOUT

/**
 * GET /api/statistiques/coordinations
 * Comparaison entre coordinations
 * Accès : Administrateur uniquement
 */
router.get('/coordinations', permission.peutVoirStatistiques, ctrl.parCoordination);

/**
 * POST /api/statistiques/refresh
 * Vider le cache manuellement
 * Accès : Administrateur, Gestionnaire
 */
router.post('/refresh', permission.peutVoirStatistiques, ctrl.refresh);

/**
 * GET /api/statistiques/diagnostic
 * Diagnostic technique complet
 * Accès : Administrateur uniquement
 */
router.get('/diagnostic', role.peutAccederPage('statistiques'), ctrl.diagnostic);

/**
 * GET /api/statistiques
 * Documentation de l'API
 */
router.get('/', (req, res) => {
  res.json({
    name: 'API Statistiques GESCARD',
    version: '3.0.0',
    description: 'Module de statistiques avec filtrage par rôle',
    timestamp: new Date().toISOString(),
    utilisateur: req.user ? `${req.user.nomUtilisateur} (${req.user.role})` : 'Non authentifié',
    acces_par_role: {
      Administrateur: 'Toutes les coordinations, toutes les statistiques',
      Gestionnaire: 'Sa coordination uniquement',
      "Chef d'équipe": 'Sa coordination uniquement',
      Opérateur: 'Son site uniquement',
    },
    endpoints: [
      { method: 'GET', path: '/api/statistiques/globales', description: 'Totaux globaux' },
      { method: 'GET', path: '/api/statistiques/sites', description: 'Par site' },
      { method: 'GET', path: '/api/statistiques/detail', description: 'Tout en un' },
      { method: 'GET', path: '/api/statistiques/quick', description: 'Tableau de bord' },
      { method: 'GET', path: '/api/statistiques/evolution', description: 'Évolution temporelle' },
      { method: 'GET', path: '/api/statistiques/imports', description: "Par lot d'import" },
      {
        method: 'GET',
        path: '/api/statistiques/agences',
        description: 'Par agence (Admin/Gest/Chef)',
      }, // ✅ AJOUT
      {
        method: 'GET',
        path: '/api/statistiques/coordinations',
        description: 'Par coordination (Admin)',
      },
      { method: 'POST', path: '/api/statistiques/refresh', description: 'Vider le cache' },
      { method: 'GET', path: '/api/statistiques/diagnostic', description: 'Diagnostic technique' },
    ],
  });
});

module.exports = router;
