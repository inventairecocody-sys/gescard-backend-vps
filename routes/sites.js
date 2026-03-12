// ============================================
// routes/sites.js
// ============================================

const express = require('express');
const router = express.Router();
const ctrl = require('../Controllers/sitesController');
const { verifierToken } = require('../middleware/auth');
const role = require('../middleware/verificationRole');
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION
// ============================================
const SITES_CONFIG = {
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 60,
      message: { success: false, error: 'Trop de requêtes', code: 'RATE_LIMIT' },
    }),
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 20,
      message: { success: false, error: "Trop d'actions sensibles", code: 'SENSITIVE_RATE_LIMIT' },
    }),
  },
  cacheControl: {
    list: 'private, max-age=60', // 1 minute
    detail: 'private, max-age=30', // 30 secondes
    diagnostic: 'no-cache',
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Cache-control dynamique
router.use((req, res, next) => {
  const segment = req.path.split('/').pop();
  const cache = SITES_CONFIG.cacheControl[segment] || 'private, no-cache';
  res.setHeader('Cache-Control', cache);
  next();
});

// Logging
router.use((req, res, next) => {
  console.log(
    `🏢 [Sites] ${req.method} ${req.url} — User: ${req.user?.nomUtilisateur || 'non auth'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * GET /api/sites/health — Santé du service
 */
router.get('/health', SITES_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'sites',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    endpoints: [
      'GET    /api/sites',
      'GET    /api/sites/:id',
      'POST   /api/sites              (Admin)',
      'PUT    /api/sites/:id          (Admin)',
      'DELETE /api/sites/:id          (Admin)',
      'PATCH  /api/sites/:id/toggle   (Admin)',
      'POST   /api/sites/:id/refresh  (Admin)',
      'GET    /api/sites/diagnostic   (Admin)',
    ],
  });
});

// ============================================
// ROUTES PROTÉGÉES (token requis)
// ============================================
router.use(verifierToken);

// ============================================
// LECTURE — tous les rôles autorisés (filtrage interne)
// ============================================

/**
 * GET /api/sites — Liste des sites (filtrée selon le rôle)
 * Query params optionnels : coordination_id, is_active, search
 */
router.get('/', SITES_CONFIG.rateLimits.standard, ctrl.getAllSites);

/**
 * GET /api/sites/diagnostic — Diagnostic (Admin uniquement)
 * ⚠️  Doit être avant /:id pour ne pas être capturé comme id="diagnostic"
 */
router.get('/diagnostic', role.peutGererComptes, SITES_CONFIG.rateLimits.standard, ctrl.diagnostic);

/**
 * GET /api/sites/:id — Détail d'un site
 */
router.get('/:id', SITES_CONFIG.rateLimits.standard, ctrl.getSiteById);

// ============================================
// ÉCRITURE — Admin uniquement
// ============================================

/**
 * POST /api/sites — Créer un site
 * Body : { Nom, CoordinationId, Adresse?, Telephone?, Email?,
 *          ResponsableNom?, ResponsableEmail?, SyncFrequency? }
 */
router.post('/', role.peutGererComptes, SITES_CONFIG.rateLimits.sensitive, ctrl.createSite);

/**
 * PUT /api/sites/:id — Modifier un site
 * Body : champs à modifier (tous optionnels sauf id en param)
 */
router.put('/:id', role.peutGererComptes, SITES_CONFIG.rateLimits.sensitive, ctrl.updateSite);

/**
 * PATCH /api/sites/:id/toggle — Activer / Désactiver un site
 */
router.patch(
  '/:id/toggle',
  role.peutGererComptes,
  SITES_CONFIG.rateLimits.sensitive,
  ctrl.toggleSiteActif
);

/**
 * POST /api/sites/:id/refresh — Recalculer les stats d'un site
 */
router.post(
  '/:id/refresh',
  role.peutGererComptes,
  SITES_CONFIG.rateLimits.standard,
  ctrl.refreshSiteStats
);

/**
 * DELETE /api/sites/:id — Supprimer un site
 * Bloqué si des cartes ou des utilisateurs y sont liés
 */
router.delete('/:id', role.peutGererComptes, SITES_CONFIG.rateLimits.sensitive, ctrl.deleteSite);

// ============================================
// 404
// ============================================
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API sites`,
    available_routes: [
      'GET    /api/sites',
      'GET    /api/sites/diagnostic',
      'GET    /api/sites/:id',
      'POST   /api/sites',
      'PUT    /api/sites/:id',
      'PATCH  /api/sites/:id/toggle',
      'POST   /api/sites/:id/refresh',
      'DELETE /api/sites/:id',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;
