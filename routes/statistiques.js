// routes/statistiques.js
const express = require('express');
const router = express.Router();
const { verifierToken } = require('../middleware/auth');
const permission = require('../middleware/permission');
const role = require('../middleware/verificationRole');
const statistiquesController = require('../Controllers/StatistiquesController');

// Vérification que le contrôleur est bien chargé
console.log(
  '📊 Contrôleur statistiques chargé, méthodes disponibles:',
  Object.keys(statistiquesController)
);

// ============================================
// MIDDLEWARE GLOBAUX
// ============================================

router.use(verifierToken);

router.use((req, res, next) => {
  console.log(
    `📊 [Stats] ${req.method} ${req.path} - ${req.user?.nomUtilisateur} (${req.user?.role}) - ${req.user?.coordination || 'toutes coordinations'}`
  );
  next();
});

router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  next();
});

// ============================================
// ROUTES LECTURE
// ============================================

/** Totaux généraux filtrés selon le rôle */
router.get('/globales', permission.peutVoirStatistiques, statistiquesController.globales);

/** Statistiques par site */
router.get('/sites', permission.peutVoirStatistiques, statistiquesController.parSite);

/** Statistiques complètes (globales + sites) */
router.get('/detail', permission.peutVoirStatistiques, statistiquesController.detail);

/** Stats rapides pour widgets */
router.get('/quick', permission.peutVoirStatistiques, statistiquesController.quick);

/**
 * GET /api/statistiques/temporel
 * Évolution des retraits basée sur "DATE DE DELIVRANCE"
 * Params : ?granularite=jour|semaine|mois &niveau=global|coordination|agence|site &id=... &periodes=12
 */
router.get('/temporel', permission.peutVoirStatistiques, statistiquesController.temporel);

/** Évolution ancienne (conservée pour compatibilité) - Remplacée par temporel */
router.get('/evolution', permission.peutVoirStatistiques, (req, res) => {
  // Redirection vers temporel avec granularité mois par défaut
  res.json({
    success: true,
    message: 'Cette route est dépréciée. Utilisez /api/statistiques/temporel à la place',
    data: null,
    redirect: '/api/statistiques/temporel?granularite=mois',
  });
});

/** Par lot d'import */
router.get('/imports', permission.peutVoirStatistiques, statistiquesController.parImport);

/**
 * GET /api/statistiques/agences
 * Admin → toutes | Gestionnaire → sa coordination | Chef d'équipe → son agence
 * Param optionnel : ?coordination_id=X pour drill-down
 */
router.get('/agences', permission.peutVoirStatistiques, statistiquesController.parAgence);

/**
 * GET /api/statistiques/coordinations
 * Admin → toutes | Gestionnaire → la sienne
 */
router.get(
  '/coordinations',
  permission.peutVoirStatistiques,
  statistiquesController.parCoordination
);

/** Diagnostic technique */
router.get('/diagnostic', role.peutAccederPage('statistiques'), statistiquesController.diagnostic);

// ============================================
// ROUTES ÉCRITURE
// ============================================

/** Vider le cache manuellement */
router.post('/refresh', permission.peutVoirStatistiques, statistiquesController.refresh);

// ============================================
// DOCUMENTATION API
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: 'API Statistiques GESCARD',
    version: '3.1.0',
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
      {
        method: 'GET',
        path: '/api/statistiques/coordinations',
        description: 'Par coordination avec classement',
      },
      {
        method: 'GET',
        path: '/api/statistiques/agences',
        description: 'Par agence — param optionnel: ?coordination_id=X',
      },
      {
        method: 'GET',
        path: '/api/statistiques/temporel',
        description: 'Évolution retraits — params: granularite, niveau, id, periodes',
      },
      { method: 'GET', path: '/api/statistiques/detail', description: 'Tout en un' },
      { method: 'GET', path: '/api/statistiques/quick', description: 'Widgets tableau de bord' },
      { method: 'GET', path: '/api/statistiques/imports', description: "Par lot d'import" },
      {
        method: 'GET',
        path: '/api/statistiques/evolution',
        description: 'Évolution imports (dépréciée) - redirigée vers temporel',
      },
      { method: 'POST', path: '/api/statistiques/refresh', description: 'Vider le cache' },
      { method: 'GET', path: '/api/statistiques/diagnostic', description: 'Diagnostic technique' },
    ],
  });
});

module.exports = router;
