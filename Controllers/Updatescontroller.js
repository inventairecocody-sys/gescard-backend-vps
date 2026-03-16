// Controllers/updatesController.js

const fs = require('fs');
const path = require('path');

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

    console.log(
      `📡 [Updates] Check: client=${clientVersion} latest=${versionData.version} update=${updateAvailable} ip=${req.ip}`
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
      `📥 [Updates] Téléchargement: ${versionData.filename} v${versionData.version} ip=${req.ip}`
    );

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    console.error('❌ Erreur download:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// UPLOAD NOUVELLE VERSION — Admin
// POST /api/updates/publish
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

    if (!version || !version.match(/^\d+\.\d+(\.\d+)?$/)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Version invalide. Format attendu: 1.2.3 ou 1.2',
      });
    }

    // Normaliser la version en 3 parties (ex: "4.1" → "4.1.0")
    const versionNormalisee = version.split('.').length === 2 ? `${version}.0` : version;

    // Vérifier que la nouvelle version est supérieure
    const versionActuelle = lireVersion();
    if (versionActuelle && !comparerVersions(versionNormalisee, versionActuelle.version)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Version ${versionNormalisee} doit être supérieure à la version actuelle ${versionActuelle.version}`,
      });
    }

    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(req.file.path);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const filename = `gescard_v${versionNormalisee}.exe`;
    const destPath = path.join(DOWNLOADS_DIR, filename);
    const latestPath = path.join(DOWNLOADS_DIR, 'gescard_latest.exe');

    fs.renameSync(req.file.path, destPath);
    fs.copyFileSync(destPath, latestPath);

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${baseUrl}/api/updates/download`;

    const versionData = {
      version: versionNormalisee,
      filename,
      download_url: downloadUrl,
      release_notes: release_notes || `Version ${versionNormalisee}`,
      mandatory: mandatory === 'true' || mandatory === true,
      published_at: new Date().toISOString(),
      published_by: acteur.nomUtilisateur || acteur.nomComplet,
      file_size: fs.statSync(destPath).size,
      checksum_sha256: checksum,
    };

    ecrireVersion(versionData);

    try {
      const journalService = require('../Services/journalService');
      await journalService.logAction({
        utilisateurId: acteur.id,
        nomUtilisateur: acteur.nomUtilisateur,
        nomComplet: acteur.nomComplet,
        role: acteur.role,
        action: `Publication version logiciel: v${versionNormalisee}`,
        actionType: 'PUBLISH_UPDATE',
        tableName: 'Updates',
        recordId: versionNormalisee,
        newValue: JSON.stringify({ version: versionNormalisee, filename, mandatory }),
        details: `Nouvelle version publiée: ${versionNormalisee} — ${release_notes}`,
        ip: req.ip,
      });
    } catch (e) {
      console.warn('⚠️ Journal non écrit:', e.message);
    }

    console.log(`🚀 [Updates] Version publiée: v${versionNormalisee} par ${acteur.nomUtilisateur}`);

    res.json({
      success: true,
      message: `Version ${versionNormalisee} publiée avec succès`,
      version: versionData.version,
      filename: versionData.filename,
      file_size: versionData.file_size,
      checksum,
      download_url: downloadUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_e) {
        /* nettoyage silencieux */
      }
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

    const current = lireVersion();
    if (current && current.version === version) {
      return res.status(400).json({
        success: false,
        message:
          "Impossible de supprimer la version courante publiée. Restaurez une ancienne version d'abord.",
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Fichier introuvable' });
    }

    fs.unlinkSync(filePath);
    console.log(`🗑️ [Updates] Version supprimée: v${version} par ${acteur.nomUtilisateur}`);

    res.json({
      success: true,
      message: `Version ${version} supprimée avec succès.`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur suppression version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// RESTORE VERSION — restaurer une ancienne version
// POST /api/updates/restore/:version
// ============================================
const restoreVersion = async (req, res) => {
  try {
    const acteur = req.user;
    if (acteur.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const { version } = req.params;
    const filename = `gescard_v${version}.exe`;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: `Version ${version} introuvable dans les archives.`,
      });
    }

    const current = lireVersion();
    if (current && current.version === version) {
      return res.status(400).json({
        success: false,
        message: `La version ${version} est déjà la version active.`,
      });
    }

    // Copier comme latest
    const latestPath = path.join(DOWNLOADS_DIR, 'gescard_latest.exe');
    fs.copyFileSync(filePath, latestPath);

    // Recalculer le checksum
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(filePath);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${baseUrl}/api/updates/download`;

    // Écrire le nouveau version.json
    const versionData = {
      version,
      filename,
      download_url: downloadUrl,
      release_notes: `Restauration de la version ${version}`,
      mandatory: false, // restauration jamais obligatoire
      published_at: new Date().toISOString(),
      published_by: acteur.nomUtilisateur || acteur.nomComplet,
      file_size: fs.statSync(filePath).size,
      checksum_sha256: checksum,
      restored: true,
      restored_at: new Date().toISOString(),
      previous_version: current?.version || null,
    };

    ecrireVersion(versionData);

    try {
      const journalService = require('../Services/journalService');
      await journalService.logAction({
        utilisateurId: acteur.id,
        nomUtilisateur: acteur.nomUtilisateur,
        nomComplet: acteur.nomComplet,
        role: acteur.role,
        action: `Restauration version logiciel: v${version}`,
        actionType: 'RESTORE_UPDATE',
        tableName: 'Updates',
        recordId: version,
        details: `Version restaurée: ${version} (précédente: ${current?.version || '—'})`,
        ip: req.ip,
      });
    } catch (e) {
      console.warn('⚠️ Journal non écrit:', e.message);
    }

    console.log(`♻️ [Updates] Version restaurée: v${version} par ${acteur.nomUtilisateur}`);

    res.json({
      success: true,
      message: `Version ${version} restaurée avec succès. Les logiciels terrain recevront cette version.`,
      version,
      previous_version: current?.version || null,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur restauration version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// CLEAR ALL — vider toutes les versions
// DELETE /api/updates/clear-all
// ============================================
const clearAll = async (req, res) => {
  try {
    const acteur = req.user;
    if (acteur.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    if (!fs.existsSync(DOWNLOADS_DIR)) {
      return res.json({ success: true, message: 'Aucun fichier à supprimer.', deleted: 0 });
    }

    const files = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter(
        (f) =>
          f.match(/^gescard_v[\d.]+\.exe$/) || f === 'gescard_latest.exe' || f === 'version.json'
      );

    let deleted = 0;
    for (const file of files) {
      try {
        fs.unlinkSync(path.join(DOWNLOADS_DIR, file));
        deleted++;
      } catch (e) {
        console.warn(`⚠️ Impossible de supprimer ${file}:`, e.message);
      }
    }

    console.log(
      `🧹 [Updates] Tout effacé: ${deleted} fichiers supprimés par ${acteur.nomUtilisateur}`
    );

    try {
      const journalService = require('../Services/journalService');
      await journalService.logAction({
        utilisateurId: acteur.id,
        nomUtilisateur: acteur.nomUtilisateur,
        nomComplet: acteur.nomComplet,
        role: acteur.role,
        action: 'Suppression totale des versions logiciel',
        actionType: 'CLEAR_UPDATES',
        tableName: 'Updates',
        recordId: 'all',
        details: `${deleted} fichiers supprimés`,
        ip: req.ip,
      });
    } catch (e) {
      console.warn('⚠️ Journal non écrit:', e.message);
    }

    res.json({
      success: true,
      message: `Toutes les versions ont été supprimées (${deleted} fichiers).`,
      deleted,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur clear all:', error);
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
  restoreVersion,
  clearAll,
  diagnostic,
};
