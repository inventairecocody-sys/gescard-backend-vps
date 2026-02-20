const express = require('express');
const router = express.Router();
const inventaireController = require('../controllers/inventaireController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const INVENTAIRE_CONFIG = {
  // Rate limiting spécifique à l'inventaire
  rateLimits: {
    search: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 recherches par minute
      message: {
        success: false,
        error: 'Trop de recherches',
        message: 'Veuillez ralentir vos recherches',
        code: 'SEARCH_RATE_LIMIT'
      }
    }),
    
    stats: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 requêtes de stats par minute
      message: {
        success: false,
        error: 'Trop de requêtes de statistiques',
        code: 'STATS_RATE_LIMIT'
      }
    }),
    
    export: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 exports par 15 minutes
      message: {
        success: false,
        error: 'Trop d\'exports',
        message: 'Limite d\'exports atteinte, réessayez dans 15 minutes',
        code: 'EXPORT_RATE_LIMIT'
      }
    })
  },
  
  // Cache control
  cacheControl: {
    search: 'private, max-age=10', // 10 secondes
    stats: 'private, max-age=300', // 5 minutes
    sites: 'public, max-age=3600', // 1 heure
    export: 'private, no-cache'
  }
};

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifierToken);

// Ajouter les infos de rôle à la requête
router.use(role.ajouterInfosRole);

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = INVENTAIRE_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique à l'inventaire
router.use((req, res, next) => {
  console.log(`📦 [Inventaire] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur} (${req.user?.role}) - Coordination: ${req.user?.coordination || 'Aucune'}`);
  next();
});

// ============================================
// ROUTES DE RECHERCHE
// ============================================

/**
 * 🔍 Recherche multicritères avancée
 * GET /api/inventaire/recherche
 * Accessible à tous les rôles (Admin, Gestionnaire, Chef d'équipe, Opérateur)
 */
router.get(
  '/recherche', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search, 
  inventaireController.rechercheCartes
);

/**
 * 🔍 Recherche rapide (barre de recherche globale)
 * GET /api/inventaire/recherche-rapide
 * Accessible à tous les rôles
 */
router.get(
  '/recherche-rapide', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search, 
  inventaireController.rechercheRapide
);

// ============================================
// ROUTES DE STATISTIQUES
// ============================================

/**
 * 📊 Statistiques globales de l'inventaire
 * GET /api/inventaire/stats
 * Accessible selon le rôle (Admin: tout, Gestionnaire: sa coordination)
 */
router.get(
  '/stats', 
  permission.peutVoirStatistiques,
  INVENTAIRE_CONFIG.rateLimits.stats, 
  inventaireController.getStatistiques
);

/**
 * 📊 Statistiques détaillées (avec cache)
 * GET /api/inventaire/statistiques
 * Accessible selon le rôle
 */
router.get(
  '/statistiques', 
  permission.peutVoirStatistiques,
  INVENTAIRE_CONFIG.rateLimits.stats, 
  inventaireController.getStatistiques
);

/**
 * 📊 Rafraîchir le cache des statistiques
 * POST /api/inventaire/cache/refresh
 * Accessible uniquement aux administrateurs
 */
router.post(
  '/cache/refresh', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.stats, 
  inventaireController.refreshCache
);

// ============================================
// ROUTES DE GESTION DES SITES
// ============================================

/**
 * 📋 Liste de tous les sites
 * GET /api/inventaire/sites
 * Accessible à tous les rôles (filtré par coordination pour Gestionnaires/Chefs)
 */
router.get(
  '/sites', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search, 
  inventaireController.getSites
);

/**
 * 🎯 Cartes par site avec pagination
 * GET /api/inventaire/site/:site
 * Accessible à tous les rôles (filtré par coordination)
 */
router.get(
  '/site/:site', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search, 
  inventaireController.getCartesParSite
);

/**
 * 📊 Statistiques détaillées par site
 * GET /api/inventaire/site/:site/stats
 * Accessible selon le rôle (filtré par coordination)
 */
router.get(
  '/site/:site/stats', 
  permission.peutVoirStatistiques,
  INVENTAIRE_CONFIG.rateLimits.stats, 
  inventaireController.getSiteStats
);

// ============================================
// ROUTES D'EXPORT
// ============================================

/**
 * 📤 Exporter les résultats de recherche
 * GET /api/inventaire/export
 * Accessible uniquement aux Admins et Gestionnaires (via importExportController)
 */
router.get(
  '/export', 
  role.peutImporterExporter,
  INVENTAIRE_CONFIG.rateLimits.export, 
  async (req, res) => {
    try {
      // Rediriger vers le contrôleur d'export avec les mêmes filtres
      req.query.export_all = 'true';
      await inventaireController.rechercheCartes(req, res);
    } catch (error) {
      console.error('❌ Erreur export inventaire:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'export',
        details: error.message
      });
    }
  }
);

// ============================================
// ROUTES DE DIAGNOSTIC
// ============================================

/**
 * 🔧 Diagnostic du module inventaire
 * GET /api/inventaire/diagnostic
 * Accessible uniquement aux administrateurs
 */
router.get(
  '/diagnostic', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search, 
  inventaireController.diagnostic
);

/**
 * 📊 Obtenir les types de filtres disponibles
 * GET /api/inventaire/filtres
 * Accessible à tous les rôles
 */
router.get(
  '/filtres', 
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search, 
  (req, res) => {
    res.json({
      success: true,
      filtres_disponibles: [
        { nom: 'nom', type: 'string', description: 'Nom du bénéficiaire' },
        { nom: 'prenom', type: 'string', description: 'Prénom du bénéficiaire' },
        { nom: 'contact', type: 'string', description: 'Numéro de téléphone' },
        { nom: 'siteRetrait', type: 'string', description: 'Site de retrait' },
        { nom: 'lieuNaissance', type: 'string', description: 'Lieu de naissance' },
        { nom: 'dateNaissance', type: 'date', description: 'Date de naissance (YYYY-MM-DD)' },
        { nom: 'rangement', type: 'string', description: 'Code de rangement' },
        { nom: 'delivrance', type: 'string', description: 'Statut de délivrance (OUI/NON)' },
        { nom: 'dateDebut', type: 'date', description: 'Date début pour filtre temporel' },
        { nom: 'dateFin', type: 'date', description: 'Date fin pour filtre temporel' }
      ],
      pagination: {
        page: 'Numéro de page (défaut: 1)',
        limit: 'Nombre de résultats par page (défaut: 50, max: 10000)',
        export_all: 'true pour exporter toutes les données sans pagination'
      },
      roles_autorises: {
        administrateur: 'Accès complet à toutes les données',
        gestionnaire: 'Accès limité à sa coordination',
        chef_equipe: 'Accès limité à sa coordination (lecture seule)',
        operateur: 'Accès limité à sa coordination (lecture seule)'
      },
      exemples: {
        recherche_simple: '/api/inventaire/recherche?nom=KOUAME&prenom=Jean',
        recherche_avancee: '/api/inventaire/recherche?siteRetrait=ADJAME&delivrance=OUI&limit=100',
        export: '/api/inventaire/export?nom=KOUAME&export_all=true'
      },
      timestamp: new Date().toISOString()
    });
  }
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  const roleInfo = req.user ? 
    `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - Coordination: ${req.user.coordination || 'Aucune'}` : 
    'Non authentifié';
  
  res.json({
    name: 'API Inventaire GESCARD',
    description: 'Module de gestion et recherche d\'inventaire',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    roles_autorises: {
      administrateur: 'Accès complet à toutes les données',
      gestionnaire: 'Accès limité à sa coordination',
      chef_equipe: 'Accès limité à sa coordination (lecture seule)',
      operateur: 'Accès limité à sa coordination (lecture seule)'
    },
    endpoints: {
      recherche: {
        'GET /recherche': 'Recherche multicritères avec pagination',
        'GET /recherche-rapide': 'Recherche rapide (barre de recherche)',
        'GET /export': 'Exporter les résultats de recherche'
      },
      statistiques: {
        'GET /stats': 'Statistiques globales (filtrées par rôle)',
        'GET /statistiques': 'Statistiques détaillées (filtrées par rôle)',
        'GET /site/:site/stats': 'Statistiques par site (filtrées par rôle)',
        'POST /cache/refresh': 'Rafraîchir le cache des stats (Admin)'
      },
      sites: {
        'GET /sites': 'Liste des sites (filtrée par rôle)',
        'GET /site/:site': 'Cartes par site avec pagination (filtrée par rôle)'
      },
      utilitaires: {
        'GET /diagnostic': 'Diagnostic du module (Admin)',
        'GET /filtres': 'Liste des filtres disponibles'
      }
    },
    filtres_disponibles: [
      'nom', 'prenom', 'contact', 'siteRetrait', 
      'lieuNaissance', 'dateNaissance', 'rangement', 
      'delivrance', 'dateDebut', 'dateFin'
    ],
    pagination: {
      page: 'Numéro de page',
      limit: 'Nombre de résultats (max 10000)',
      export_all: 'Mode export (ignore la pagination)'
    },
    rate_limits: {
      recherche: '30 requêtes par minute',
      stats: '20 requêtes par minute',
      export: '10 exports par 15 minutes'
    },
    exemples: {
      curl_recherche: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/inventaire/recherche?nom=KOUAME&page=1&limit=50"',
      curl_site: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/inventaire/site/ADJAME"',
      curl_stats: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/inventaire/stats"'
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
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API inventaire`,
    available_routes: [
      'GET /api/inventaire/',
      'GET /api/inventaire/recherche',
      'GET /api/inventaire/recherche-rapide',
      'GET /api/inventaire/stats',
      'GET /api/inventaire/statistiques',
      'GET /api/inventaire/sites',
      'GET /api/inventaire/site/:site',
      'GET /api/inventaire/site/:site/stats',
      'GET /api/inventaire/export',
      'GET /api/inventaire/diagnostic',
      'GET /api/inventaire/filtres',
      'POST /api/inventaire/cache/refresh'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;