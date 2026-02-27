// routes/syncRoutes.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const syncController = require('../Controllers/syncController');
const verifySiteToken = require('../middleware/verifySiteToken');

// Validation pour le login
const validateLogin = [
  body('site_id').notEmpty().withMessage('site_id requis'),
  body('api_key').notEmpty().withMessage('api_key requis'),
];

// Validation pour l'upload
const validateUpload = [
  body('modifications').isArray().optional(),
  body('last_sync').optional().isISO8601(),
];

/**
 * Routes publiques (sans token)
 */
router.post('/login', validateLogin, async (req, res) => {
  // Vérifier les erreurs de validation
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  await syncController.login(req, res);
});

/**
 * Routes protégées (nécessitent un token valide)
 */

// Route de test
router.get('/test', verifySiteToken, (req, res) => {
  res.json({
    success: true,
    message: 'Authentification réussie',
    site: req.site,
    timestamp: new Date().toISOString(),
  });
});

// Upload des modifications
router.post('/upload', verifySiteToken, validateUpload, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }

  await syncController.upload(req, res);
});

// Download des mises à jour
router.get('/download', verifySiteToken, async (req, res) => {
  await syncController.download(req, res);
});

// Confirmation de réception
router.post('/confirm', verifySiteToken, async (req, res) => {
  await syncController.confirm(req, res);
});

// Statut du site
router.get('/status', verifySiteToken, async (req, res) => {
  await syncController.status(req, res);
});

module.exports = router;
