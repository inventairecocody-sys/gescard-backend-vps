const express = require('express');
const router = express.Router();
const inventaireController = require('../Controllers/inventaireController');
const { verifyToken } = require('../middleware/auth');
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
router.use(verifyToken);

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = INVENTAIRE_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique à l'inventaire
router.use((req, res, next) => {
  console.log(`📦 [Inventaire] ${req.method} ${req.url} - User: ${req.user?.NomUtilisateur}`);
  next();
});

// ============================================
// ROUTES DE RECHERCHE
// ============================================

/**
 * 🔍 Recherche multicritères avancée
 * GET /api/inventaire/recherche
 */
router.get('/recherche', INVENTAIRE_CONFIG.rateLimits.search, inventaireController.rechercheCartes);

/**
 * 🔍 Recherche rapide (barre de recherche globale)
 * GET /api/inventaire/recherche-rapide
 */
router.get('/recherche-rapide', INVENTAIRE_CONFIG.rateLimits.search, inventaireController.rechercheRapide);

// ============================================
// ROUTES DE STATISTIQUES
// ============================================

/**
 * 📊 Statistiques globales de l'inventaire
 * GET /api/inventaire/stats
 */
router.get('/stats', INVENTAIRE_CONFIG.rateLimits.stats, inventaireController.getStatistiques);

/**
 * 📊 Statistiques détaillées (avec cache)
 * GET /api/inventaire/statistiques
 */
router.get('/statistiques', INVENTAIRE_CONFIG.rateLimits.stats, inventaireController.getStatistiques);

/**
 * 📊 Rafraîchir le cache des statistiques
 * POST /api/inventaire/cache/refresh
 */
router.post('/cache/refresh', INVENTAIRE_CONFIG.rateLimits.stats, inventaireController.refreshCache);

// ============================================
// ROUTES DE GESTION DES SITES
// ============================================

/**
 * 📋 Liste de tous les sites
 * GET /api/inventaire/sites
 */
router.get('/sites', INVENTAIRE_CONFIG.rateLimits.search, inventaireController.getSites);

/**
 * 🎯 Cartes par site avec pagination
 * GET /api/inventaire/site/:site
 */
router.get('/site/:site', INVENTAIRE_CONFIG.rateLimits.search, inventaireController.getCartesParSite);

/**
 * 📊 Statistiques détaillées par site
 * GET /api/inventaire/site/:site/stats
 */
router.get('/site/:site/stats', INVENTAIRE_CONFIG.rateLimits.stats, inventaireController.getSiteStats);

// ============================================
// ROUTES D'EXPORT
// ============================================

/**
 * 📤 Exporter les résultats de recherche
 * GET /api/inventaire/export
 */
router.get('/export', INVENTAIRE_CONFIG.rateLimits.export, async (req, res) => {
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
});

// ============================================
// ROUTES DE DIAGNOSTIC
// ============================================

/**
 * 🔧 Diagnostic du module inventaire
 * GET /api/inventaire/diagnostic
 */
router.get('/diagnostic', INVENTAIRE_CONFIG.rateLimits.search, inventaireController.diagnostic);

/**
 * 📊 Obtenir les types de filtres disponibles
 * GET /api/inventaire/filtres
 */
router.get('/filtres', INVENTAIRE_CONFIG.rateLimits.search, (req, res) => {
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
    exemples: {
      recherche_simple: '/api/inventaire/recherche?nom=KOUAME&prenom=Jean',
      recherche_avancee: '/api/inventaire/recherche?siteRetrait=ADJAME&delivrance=OUI&limit=100',
      export: '/api/inventaire/export?nom=KOUAME&export_all=true'
    },
    timestamp: new Date().toISOString()
  });
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: 'API Inventaire GESCARD',
    description: 'Module de gestion et recherche d\'inventaire',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    endpoints: {
      recherche: {
        'GET /recherche': 'Recherche multicritères avec pagination',
        'GET /recherche-rapide': 'Recherche rapide (barre de recherche)',
        'GET /export': 'Exporter les résultats de recherche'
      },
      statistiques: {
        'GET /stats': 'Statistiques globales',
        'GET /statistiques': 'Statistiques détaillées',
        'GET /site/:site/stats': 'Statistiques par site',
        'POST /cache/refresh': 'Rafraîchir le cache des stats'
      },
      sites: {
        'GET /sites': 'Liste des sites',
        'GET /site/:site': 'Cartes par site avec pagination'
      },
      utilitaires: {
        'GET /diagnostic': 'Diagnostic du module',
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