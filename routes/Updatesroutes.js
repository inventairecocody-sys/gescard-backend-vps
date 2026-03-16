// routes/updatesRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifierToken } = require('../middleware/auth');
const ctrl = require('../Controllers/Updatescontroller');

// ============================================
// CONFIGURATION MULTER (upload .exe)
// ============================================
const UPLOAD_TMP = '/tmp/gescard_uploads';
if (!fs.existsSync(UPLOAD_TMP)) fs.mkdirSync(UPLOAD_TMP, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_TMP),
  filename: (req, file, cb) => {
    const ts = Date.now();
    cb(null, `upload_${ts}_${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.exe') {
      return cb(new Error('Seuls les fichiers .exe sont acceptés'));
    }
    cb(null, true);
  },
});

// ============================================
// LOGGING
// ============================================
router.use((req, res, next) => {
  console.log(`🔄 [Updates] ${req.method} ${req.path} - ip=${req.ip}`);
  next();
});

// ============================================
// ROUTES PUBLIQUES (appelées par le logiciel)
// ============================================

/**
 * Vérifier si une mise à jour est disponible
 * GET /api/updates/check?version=1.0.0
 */
router.get('/check', ctrl.checkVersion);

/**
 * Infos sur la dernière version publiée
 * GET /api/updates/latest
 */
router.get('/latest', ctrl.getLatest);

/**
 * Télécharger le fichier .exe
 * GET /api/updates/download
 */
router.get('/download', ctrl.downloadExe);

// ============================================
// ROUTES AUTHENTIFIÉES (Admin)
// ============================================
router.use(verifierToken);

/**
 * Publier une nouvelle version
 * POST /api/updates/publish
 */
router.post('/publish', upload.single('file'), ctrl.publishVersion);

/**
 * Historique des versions disponibles
 * GET /api/updates/history
 */
router.get('/history', ctrl.getHistory);

/**
 * Diagnostic du système de mises à jour
 * GET /api/updates/diagnostic
 */
router.get('/diagnostic', ctrl.diagnostic);

/**
 * Restaurer une ancienne version comme version active
 * POST /api/updates/restore/:version
 * Ex: POST /api/updates/restore/4.0.1
 */
router.post('/restore/:version', ctrl.restoreVersion);

/**
 * Vider toutes les versions (fichiers + version.json)
 * DELETE /api/updates/clear-all
 */
router.delete('/clear-all', ctrl.clearAll);

/**
 * Supprimer une version spécifique
 * DELETE /api/updates/:version
 * ⚠️ Doit être après /clear-all pour éviter le conflit de route
 */
router.delete('/:version', ctrl.deleteVersion);

/**
 * Documentation
 * GET /api/updates
 */
router.get('/', (req, res) => {
  res.json({
    name: 'API Updates GESCARD',
    version: '1.1.0',
    endpoints: {
      publics: {
        'GET /api/updates/check?version=X.X.X': 'Vérifier si mise à jour disponible',
        'GET /api/updates/latest': 'Infos dernière version',
        'GET /api/updates/download': 'Télécharger le .exe',
      },
      admin: {
        'POST /api/updates/publish': 'Publier nouvelle version (.exe + version + notes)',
        'GET /api/updates/history': 'Historique des versions',
        'POST /api/updates/restore/:version': 'Restaurer une ancienne version',
        'DELETE /api/updates/clear-all': 'Vider toutes les versions',
        'DELETE /api/updates/:version': 'Supprimer une version spécifique',
        'GET /api/updates/diagnostic': 'Diagnostic',
      },
    },
    timestamp: new Date().toISOString(),
  });
});

// Gestion erreur multer
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res
      .status(413)
      .json({ success: false, message: 'Fichier trop volumineux (max 500 MB)' });
  }
  if (err.message && err.message.includes('.exe')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
