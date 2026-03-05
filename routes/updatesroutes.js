// routes/updatesRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifierToken } = require('../middleware/auth');
const ctrl = require('../Controllers/updatescontroller');

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
 * Utilisé par le logiciel au démarrage
 */
router.get('/check', ctrl.checkVersion);

/**
 * Infos sur la dernière version publiée
 * GET /api/updates/latest
 */
router.get('/latest', ctrl.getLatest);

/**
 * Télécharger le fichier .exe (pas de token requis — URL directe)
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
 * Body: multipart/form-data { file(.exe), version, release_notes, mandatory }
 * Accès: Administrateur uniquement
 */
router.post('/publish', upload.single('file'), ctrl.publishVersion);

/**
 * Historique des versions disponibles
 * GET /api/updates/history
 * Accès: Administrateur uniquement
 */
router.get('/history', ctrl.getHistory);

/**
 * Supprimer une ancienne version
 * DELETE /api/updates/:version
 * Accès: Administrateur uniquement
 */
router.delete('/:version', ctrl.deleteVersion);

/**
 * Diagnostic du système de mises à jour
 * GET /api/updates/diagnostic
 */
router.get('/diagnostic', ctrl.diagnostic);

/**
 * Documentation
 * GET /api/updates
 */
router.get('/', (req, res) => {
  res.json({
    name: 'API Updates GESCARD',
    version: '1.0.0',
    endpoints: {
      publics: {
        'GET /api/updates/check?version=X.X.X': 'Vérifier si mise à jour disponible',
        'GET /api/updates/latest': 'Infos dernière version',
        'GET /api/updates/download': 'Télécharger le .exe',
      },
      admin: {
        'POST /api/updates/publish': 'Publier nouvelle version (.exe + version + notes)',
        'GET /api/updates/history': 'Historique des versions',
        'DELETE /api/updates/:version': 'Supprimer une version',
        'GET /api/updates/diagnostic': 'Diagnostic',
      },
    },
    exemple_check: 'GET /api/updates/check?version=1.0.0',
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
