// Controllers/updatesController.js

const fs = require('fs');
const path = require('path');
const db = require('../db/db');

const DOWNLOADS_DIR = '/var/www/downloads';
const VERSION_FILE = path.join(DOWNLOADS_DIR, 'version.json');

// ============================================
// UTILITAIRES
// ============================================

const lireVersion = () => {
  try {
    if (!fs.existsSync(VERSION_FILE)) return null;
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch {
    return null;
  }
};

const ecrireVersion = (data) => {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2), 'utf8');
};

const comparerVersions = (v1, v2) => {
  // Retourne true si v1 > v2
  const p1 = v1.replace(/^v/, '').split('.').map(Number);
  const p2 = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) > (p2[i] || 0)) return true;
    if ((p1[i] || 0) < (p2[i] || 0)) return false;
  }
  return false;
};

// ============================================
// CHECK VERSION — appelé par le logiciel
// GET /api/updates/check?version=1.0.0
// ============================================
const checkVersion = async (req, res) => {
  try {
    const clientVersion = req.query.version || '0.0.0';
    const versionData = lireVersion();

    if (!versionData) {
      return res.json({
        success: true,
        update_available: false,
        message: 'Aucune version publiée',
        current_version: clientVersion,
      });
    }

    const updateAvailable = comparerVersions(versionData.version, clientVersion);

    res.json({
      success: true,
      update_available: updateAvailable,
      current_version: clientVersion,
      latest_version: versionData.version,
      download_url: updateAvailable ? versionData.download_url : null,
      release_notes: updateAvailable ? versionData.release_notes : null,
      published_at: versionData.published_at,
      published_by: versionData.published_by,
      file_size: versionData.file_size || null,
      checksum_sha256: updateAvailable ? versionData.checksum_sha256 : null,
      mandatory: versionData.mandatory || false,
    });

    // Log de la vérification
    console.log(
      `📡 [Updates] Check version: client=${clientVersion} latest=${versionData.version} update=${updateAvailable} ip=${req.ip}`
    );
  } catch (error) {
    console.error('❌ Erreur check version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET INFO VERSION — infos publiques
// GET /api/updates/latest
// ============================================
const getLatest = async (req, res) => {
  try {
    const versionData = lireVersion();

    if (!versionData) {
      return res.json({ success: true, version: null, message: 'Aucune version publiée' });
    }

    res.json({
      success: true,
      version: versionData.version,
      release_notes: versionData.release_notes,
      published_at: versionData.published_at,
      published_by: versionData.published_by,
      file_size: versionData.file_size,
      mandatory: versionData.mandatory || false,
      download_url: versionData.download_url,
    });
  } catch (error) {
    console.error('❌ Erreur get latest:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DOWNLOAD — télécharger le fichier .exe
// GET /api/updates/download
// ============================================
const downloadExe = async (req, res) => {
  try {
    const versionData = lireVersion();
    if (!versionData || !versionData.filename) {
      return res.status(404).json({ success: false, message: 'Aucun fichier disponible' });
    }

    const filePath = path.join(DOWNLOADS_DIR, versionData.filename);
    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, message: 'Fichier introuvable sur le serveur' });
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gescard_${versionData.version}.exe"`
    );
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Version', versionData.version);

    console.log(
      `📥 [Updates] Téléchargement: ${versionData.filename} v${versionData.version} par ip=${req.ip}`
    );

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    console.error('❌ Erreur download:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// UPLOAD NOUVELLE VERSION — Admin ou SCP
// POST /api/updates/publish
// Body: multipart/form-data { file, version, release_notes, mandatory }
// ============================================
const publishVersion = async (req, res) => {
  try {
    const acteur = req.user;
    if (acteur.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Fichier .exe requis' });
    }

    const { version, release_notes, mandatory = false } = req.body;

    if (!version || !version.match(/^\d+\.\d+\.\d+$/)) {
      // Supprimer le fichier uploadé si version invalide
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Version invalide. Format attendu: 1.2.3',
      });
    }

    // Vérifier que la nouvelle version est supérieure
    const versionActuelle = lireVersion();
    if (versionActuelle && !comparerVersions(version, versionActuelle.version)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Version ${version} doit être supérieure à la version actuelle ${versionActuelle.version}`,
      });
    }

    // S'assurer que le dossier downloads existe
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    // Calculer le checksum SHA256
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(req.file.path);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Nom du fichier versionné
    const filename = `gescard_v${version}.exe`;
    const destPath = path.join(DOWNLOADS_DIR, filename);
    const latestPath = path.join(DOWNLOADS_DIR, 'gescard_latest.exe');

    // Déplacer le fichier uploadé
    fs.renameSync(req.file.path, destPath);

    // Copier en tant que "latest"
    fs.copyFileSync(destPath, latestPath);

    // URL de téléchargement
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${baseUrl}/api/updates/download`;

    // Écrire version.json
    const versionData = {
      version,
      filename,
      download_url: downloadUrl,
      release_notes: release_notes || `Version ${version}`,
      mandatory: mandatory === 'true' || mandatory === true,
      published_at: new Date().toISOString(),
      published_by: acteur.nomUtilisateur || acteur.nomComplet,
      file_size: fs.statSync(destPath).size,
      checksum_sha256: checksum,
    };

    ecrireVersion(versionData);

    // Journaliser
    try {
      const journalService = require('../Services/journalService');
      await journalService.logAction({
        utilisateurId: acteur.id,
        nomUtilisateur: acteur.nomUtilisateur,
        nomComplet: acteur.nomComplet,
        role: acteur.role,
        action: `Publication version logiciel: v${version}`,
        actionType: 'PUBLISH_UPDATE',
        tableName: 'Updates',
        recordId: version,
        newValue: JSON.stringify({ version, filename, mandatory }),
        details: `Nouvelle version publiée: ${version} — ${release_notes}`,
        ip: req.ip,
      });
    } catch (e) {
      console.warn('⚠️ Journal non écrit:', e.message);
    }

    console.log(`🚀 [Updates] Nouvelle version publiée: v${version} par ${acteur.nomUtilisateur}`);

    res.json({
      success: true,
      message: `Version ${version} publiée avec succès`,
      version: versionData.version,
      filename: versionData.filename,
      file_size: versionData.file_size,
      checksum: checksum,
      download_url: downloadUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Nettoyer le fichier uploadé en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch {}
    }
    console.error('❌ Erreur publication version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// LISTE DES VERSIONS — historique
// GET /api/updates/history
// ============================================
const getHistory = async (req, res) => {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      return res.json({ success: true, versions: [] });
    }

    const files = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter((f) => f.match(/^gescard_v[\d.]+\.exe$/))
      .map((f) => {
        const stat = fs.statSync(path.join(DOWNLOADS_DIR, f));
        const version = f.replace('gescard_v', '').replace('.exe', '');
        return { filename: f, version, size: stat.size, created_at: stat.mtime };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const current = lireVersion();

    res.json({
      success: true,
      current_version: current?.version || null,
      versions: files,
      count: files.length,
    });
  } catch (error) {
    console.error('❌ Erreur historique versions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DELETE VERSION — supprimer une version
// DELETE /api/updates/:version
// ============================================
const deleteVersion = async (req, res) => {
  try {
    const acteur = req.user;
    if (acteur.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const { version } = req.params;
    const filename = `gescard_v${version}.exe`;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    // Ne pas supprimer la version courante
    const current = lireVersion();
    if (current && current.version === version) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de supprimer la version courante publiée',
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Fichier introuvable' });
    }

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: `Version ${version} supprimée`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur suppression version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DIAGNOSTIC
// GET /api/updates/diagnostic
// ============================================
const diagnostic = async (req, res) => {
  try {
    const versionData = lireVersion();
    const dirExists = fs.existsSync(DOWNLOADS_DIR);
    const files = dirExists ? fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.endsWith('.exe')) : [];

    let fileOk = false;
    if (versionData && versionData.filename) {
      fileOk = fs.existsSync(path.join(DOWNLOADS_DIR, versionData.filename));
    }

    res.json({
      success: true,
      service: 'updates',
      downloads_dir: DOWNLOADS_DIR,
      dir_exists: dirExists,
      version_file: VERSION_FILE,
      current_version: versionData?.version || null,
      file_present: fileOk,
      exe_files: files,
      exe_count: files.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  checkVersion,
  getLatest,
  downloadExe,
  publishVersion,
  getHistory,
  deleteVersion,
  diagnostic,
};
