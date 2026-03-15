// ========== PATCH ROUTES API EXTERNE ==========
// Modifiez votre fichier routes/externalApi.js pour ajouter l'auth sur /sync
//
// AVANT (routes/externalApi.js) :
//   router.post('/sync', externalApiController.syncData);
//
// APRÈS :
//   const { requireApiKey, requireAllowedIP } = require('../middleware/externalApiAuth');
//   router.post('/sync', requireAllowedIP, requireApiKey, externalApiController.syncData);
//   router.get('/changes', requireApiKey, externalApiController.getChanges);
//   router.get('/modifications', requireApiKey, externalApiController.getModifications);
//
// Routes qui peuvent rester publiques (lecture seule, pas de données sensibles) :
//   router.get('/health', externalApiController.healthCheck);
//   router.get('/sites', externalApiController.getSites);
//   router.get('/stats', requireApiKey, externalApiController.getStats);  ← données sensibles → protéger
//   router.get('/cartes', requireApiKey, externalApiController.getCartes); ← données sensibles → protéger
//   router.get('/diagnostic', requireApiKey, externalApiController.diagnostic);

// ========== EXEMPLE COMPLET routes/externalApi.js ==========

const express = require('express');
const router = express.Router();
const externalApiController = require('../Controllers/externalApiController');
const { requireApiKey, requireAllowedIP } = require('../middleware/externalApiAuth');
const rateLimit = require('express-rate-limit');

// Rate limiter spécifique pour l'API externe (plus permissif car app Python)
const externalLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 60, // 60 req/min max
  message: { success: false, message: "Rate limit atteint pour l'API externe" },
});

// ── Routes publiques (monitoring) ──
router.get('/health', externalLimiter, externalApiController.healthCheck);
router.get('/sites', externalLimiter, externalApiController.getSites);

// ── Routes protégées par API key ──
router.get('/changes', externalLimiter, requireApiKey, externalApiController.getChanges);
router.get('/cartes', externalLimiter, requireApiKey, externalApiController.getCartes);
router.get('/stats', externalLimiter, requireApiKey, externalApiController.getStats);
router.get(
  '/modifications',
  externalLimiter,
  requireApiKey,
  externalApiController.getModifications
);
router.get('/diagnostic', externalLimiter, requireApiKey, externalApiController.diagnostic);

// ── Route d'écriture : API key + whitelist IP optionnelle ──
router.post(
  '/sync',
  externalLimiter,
  requireAllowedIP,
  requireApiKey,
  externalApiController.syncData
);

module.exports = router;
