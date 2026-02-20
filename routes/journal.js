const express = require('express');
const router = express.Router();
const journalController = require('../Controllers/journalController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const permission = require('../middleware/permission');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const JOURNAL_CONFIG = {
  // Rate limiting spécifique au journal
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requêtes par minute
      message: {
        success: false,
        error: 'Trop de requêtes',
        message: 'Veuillez ralentir vos requêtes au journal',
        code: 'JOURNAL_RATE_LIMIT'
      }
    }),
    
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles par 15 minutes
      message: {
        success: false,
        error: 'Trop d\'actions sensibles',
        message: 'Limite d\'actions sensibles atteinte',
        code: 'SENSITIVE_ACTION_LIMIT'
      }
    }),
    
    export: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 5, // 5 exports par heure
      message: {
        success: false,
        error: 'Trop d\'exports',
        message: 'Limite d\'exports du journal atteinte',
        code: 'EXPORT_LIMIT'
      }
    })
  },
  
  // Cache control
  cacheControl: {
    list: 'private, max-age=10', // 10 secondes
    imports: 'private, max-age=30', // 30 secondes
    stats: 'private, max-age=300' // 5 minutes
  },
  
  // Routes publiques (sans authentification)
  publicRoutes: ['/health', '/test']
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = JOURNAL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique au journal
router.use((req, res, next) => {
  console.log(`📋 [Journal] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`);
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * 🩺 Santé du service journal
 * GET /api/journal/health
 */
router.get('/health', JOURNAL_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'journal',
    timestamp: new Date().toISOString(),
    version: '3.0.0-lws',
    roles_autorises: {
      consultation: 'Administrateur uniquement',
      actions: 'Administrateur uniquement',
      export: 'Administrateur uniquement'
    },
    endpoints: [
      'GET /api/journal',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'GET /api/journal/actions/annulables',
      'POST /api/journal/:id/annuler',
      'POST /api/journal/annuler-import',
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic'
    ]
  });
});

/**
 * 🧪 Test du journal
 * GET /api/journal/test
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service journal fonctionnel',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    roles_autorises: {
      consultation: 'Administrateur uniquement',
      actions: 'Administrateur uniquement'
    }
  });
});

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION (pour toutes les routes suivantes)
// ============================================
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles); // Pour masquer IP et anciennes valeurs

// ============================================
// ROUTES PRINCIPALES (Admin uniquement)
// ============================================

/**
 * 📋 Récupérer le journal avec filtres et pagination
 * GET /api/journal
 * Admin uniquement
 */
router.get(
  '/', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard, 
  journalController.getJournal
);

/**
 * 📋 Version alternative (pour compatibilité)
 * GET /api/journal/list
 * Admin uniquement
 */
router.get(
  '/list', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard, 
  journalController.getJournal
);

/**
 * 📋 Récupérer la liste des imports groupés
 * GET /api/journal/imports
 * Admin uniquement
 */
router.get(
  '/imports', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard, 
  journalController.getImports
);

/**
 * 📋 Détails d'un import spécifique
 * GET /api/journal/imports/:batchId
 * Admin uniquement
 */
router.get(
  '/imports/:batchId', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard, 
  journalController.getImportDetails
);

/**
 * 📊 Statistiques d'activité
 * GET /api/journal/stats
 * Admin uniquement
 */
router.get(
  '/stats', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard, 
  journalController.getStats
);

/**
 * 📋 Lister les actions annulables (Admin uniquement)
 * GET /api/journal/actions/annulables
 * Admin uniquement
 */
router.get(
  '/actions/annulables', 
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.listerActionsAnnulables
);

// ============================================
// ROUTES D'ACTION (Admin uniquement - rate limiting plus strict)
// ============================================

/**
 * ↩️ Annuler une action (Admin uniquement)
 * POST /api/journal/:id/annuler
 */
router.post(
  '/:id/annuler', 
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive, 
  journalController.annulerAction
);

/**
 * 🔄 Annuler une importation (Admin uniquement)
 * POST /api/journal/annuler-import
 */
router.post(
  '/annuler-import', 
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive, 
  journalController.annulerImportation
);

/**
 * ↩️ Annuler une action (version legacy - Admin uniquement)
 * POST /api/journal/undo/:id
 */
router.post(
  '/undo/:id', 
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive, 
  journalController.undoAction
);

/**
 * 🧹 Nettoyer le journal (supprimer les vieilles entrées - Admin uniquement)
 * POST /api/journal/nettoyer
 */
router.post(
  '/nettoyer', 
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive, 
  journalController.nettoyerJournal
);

/**
 * 🧹 Version alternative
 * DELETE /api/journal/cleanup
 */
router.delete(
  '/cleanup', 
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive, 
  journalController.nettoyerJournal
);

// ============================================
// ROUTES D'EXPORT ET DIAGNOSTIC
// ============================================

/**
 * 📤 Exporter le journal (Admin uniquement)
 * GET /api/journal/export
 */
router.get(
  '/export', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.export, 
  async (req, res) => {
    try {
      // Forcer le mode export
      req.query.export_all = 'true';
      await journalController.getJournal(req, res);
    } catch (error) {
      console.error('❌ Erreur export journal:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de l\'export',
        details: error.message
      });
    }
  }
);

/**
 * 🔧 Diagnostic du journal (Admin uniquement)
 * GET /api/journal/diagnostic
 */
router.get(
  '/diagnostic', 
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard, 
  journalController.diagnostic
);

// ============================================
// ROUTE UTILITAIRE DE JOURNALISATION
// ============================================

/**
 * 📝 Journaliser une action (utilitaire pour autres contrôleurs - protégé)
 * POST /api/journal/log
 */
router.post(
  '/log', 
  role.peutVoirJournal, // Même condition que consultation
  JOURNAL_CONFIG.rateLimits.standard, 
  (req, res) => {
    journalController.logAction(req.body)
      .then(() => res.json({ 
        success: true, 
        message: 'Action journalisée',
        timestamp: new Date().toISOString()
      }))
      .catch(error => res.status(500).json({ 
        success: false,
        error: 'Erreur journalisation',
        details: error.message 
      }));
  }
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  const roleInfo = req.user ? 
    `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - ${req.user.role === 'Administrateur' ? '✅ Accès autorisé' : '❌ Accès restreint'}` : 
    'Non authentifié';
  
  res.json({
    name: 'API Journal GESCARD',
    description: 'Module de journalisation et d\'audit',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    roles_autorises: {
      administrateur: '✅ Accès complet à toutes les fonctionnalités',
      gestionnaire: '❌ Non autorisé (pas d\'accès au journal)',
      chef_equipe: '❌ Non autorisé (pas d\'accès au journal)',
      operateur: '❌ Non autorisé (pas d\'accès au journal)'
    },
    endpoints: {
      consultation: {
        'GET /': '📋 Liste paginée du journal (Admin)',
        'GET /list': '📋 Liste paginée (alias - Admin)',
        'GET /imports': '📦 Liste des imports groupés (Admin)',
        'GET /imports/:batchId': '📦 Détails d\'un import (Admin)',
        'GET /stats': '📊 Statistiques d\'activité (Admin)',
        'GET /actions/annulables': '🔄 Actions pouvant être annulées (Admin)'
      },
      actions: {
        'POST /:id/annuler': '↩️ Annuler une action spécifique (Admin)',
        'POST /annuler-import': '🔄 Annuler une importation (Admin)',
        'POST /nettoyer': '🧹 Nettoyer les vieilles entrées (Admin)',
        'DELETE /cleanup': '🧹 Nettoyer (alias - Admin)'
      },
      utilitaires: {
        'GET /export': '📤 Exporter le journal (Admin)',
        'GET /diagnostic': '🔧 Diagnostic du module (Admin)',
        'POST /log': '📝 Journaliser une action (interne)'
      },
      publiques: {
        'GET /health': '🩺 Santé du service (public)',
        'GET /test': '🧪 Test du service (public)'
      }
    },
    nouvelles_fonctionnalites: {
      annulation: {
        description: 'Annulation d\'actions avec restauration',
        routes: [
          'GET /actions/annulables - Voir les actions annulables',
          'POST /:id/annuler - Annuler une action spécifique'
        ],
        colonnes_ajoutees: [
          'anciennes_valeurs (JSON)',
          'nouvelles_valeurs (JSON)',
          'annulee (BOOLEAN)',
          'annulee_par (INT)',
          'date_annulation (TIMESTAMP)',
          'coordination (VARCHAR)'
        ]
      }
    },
    filtres_disponibles: {
      page: 'Numéro de page',
      pageSize: 'Nombre d\'entrées par page',
      dateDebut: 'Date de début (YYYY-MM-DD)',
      dateFin: 'Date de fin (YYYY-MM-DD)',
      utilisateur: 'Nom d\'utilisateur',
      actionType: 'Type d\'action',
      tableName: 'Table concernée',
      importBatchID: 'ID du batch d\'import',
      coordination: 'Filtrer par coordination',
      annulee: 'Filtrer les actions annulées (true/false)'
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions par 15 minutes',
      export: '5 exports par heure'
    },
    exemples: {
      curl_liste: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal?page=1&pageSize=50"',
      curl_imports: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/imports"',
      curl_stats: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/stats"',
      curl_annulables: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/actions/annulables"',
      curl_annuler: 'curl -X POST -H "Authorization: Bearer <token>" "http://localhost:3000/api/journal/123/annuler"'
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
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API journal`,
    available_routes: [
      'GET /api/journal/',
      'GET /api/journal/list',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'GET /api/journal/actions/annulables',
      'POST /api/journal/:id/annuler',
      'POST /api/journal/annuler-import',
      'POST /api/journal/undo/:id',
      'POST /api/journal/nettoyer',
      'DELETE /api/journal/cleanup',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
      'POST /api/journal/log',
      'GET /api/journal/health',
      'GET /api/journal/test'
    ],
    code: 'ROUTE_NOT_FOUND'
  });
});

module.exports = router;