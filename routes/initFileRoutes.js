// ============================================================
// routes/initFileRoutes.js
// Route : POST /api/init-file/generate
// Réservé aux Administrateurs
// Génère un fichier .gescard chiffré (compatible avec le client Python)
// ============================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { query } = require('../db/db'); // ← ton module DB existant
const { verifyToken } = require('../middleware/auth'); // ← ton middleware JWT existant

// ── Clé XOR identique au client Python ──────────────────────
const CLE = Buffer.from('GESCARD_INIT_2026_SECURE_KEY_V1__', 'utf8'); // 32 octets

function xorEncrypt(data) {
  const result = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = data[i] ^ CLE[i % CLE.length];
  }
  return result;
}

// ── Formatage date fr dd/mm/yyyy HH:MM ──────────────────────
function fmtDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}
function fmtDateTime(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${fmtDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ============================================================
// POST /api/init-file/generate
// Body : { site_id, validite_jours, include_cards }
// ============================================================
router.post('/generate', verifyToken, async (req, res) => {
  try {
    // 1. Vérification du rôle
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Réservé aux Administrateurs.',
        code: 'FORBIDDEN_ROLE',
      });
    }

    const { site_id, validite_jours = 7, include_cards = false } = req.body;

    if (!site_id) {
      return res.status(400).json({
        success: false,
        message: 'site_id est obligatoire.',
        code: 'MISSING_SITE_ID',
      });
    }

    // 2. Récupérer le site et son api_key depuis PostgreSQL
    const siteResult = await query(
      `SELECT s.id, s.nom, s.api_key, c.nom AS coordination_nom, c.code AS coordination_code
       FROM sites s
       JOIN coordinations c ON c.id = s.coordination_id
       WHERE s.id = $1 AND s.is_active = true`,
      [site_id]
    );

    if (siteResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: `Site "${site_id}" introuvable ou inactif.`,
        code: 'SITE_NOT_FOUND',
      });
    }

    const site = siteResult.rows[0];
    const api_key = site.api_key || '';

    // 3. Récupérer les comptes utilisateurs liés à ce site
    const comptesResult = await query(
      `SELECT u.nomutilisateur  AS username,
              u.motdepasse      AS password_hash,
              u.nomcomplet      AS nom_complet,
              u.role,
              u.agence          AS site,
              u.coordination
       FROM utilisateurs u
       WHERE u.agence = $1
         AND u.nomutilisateur != 'admin'
         AND u.actif = true`,
      [site_id]
    );

    const comptes = comptesResult.rows.map((c) => ({
      username: c.username,
      password_hash: c.password_hash,
      nom_complet: c.nom_complet,
      role: c.role,
      site: c.site,
      coordination: c.coordination,
    }));

    // 4. Récupérer les cartes si demandé
    let cartes = [];
    if (include_cards) {
      const cartesResult = await query(
        `SELECT * FROM cartes
         WHERE "SITE DE RETRAIT" = $1
           AND deleted_at IS NULL`,
        [site_id]
      );
      cartes = cartesResult.rows;
    }

    // 5. Construire le payload (même structure que le client Python)
    const now = new Date();
    const expireDate = new Date(now.getTime() + Number(validite_jours) * 24 * 60 * 60 * 1000);

    const payload = {
      version: '1.0',
      site_id: site.id,
      api_key,
      comptes,
      cartes,
      nb_comptes: comptes.length,
      nb_cartes: cartes.length,
      cree_le: fmtDateTime(now),
      expire_le: fmtDate(expireDate),
      expire_ts: expireDate.getTime() / 1000, // timestamp UNIX (secondes)
      cree_par: req.user.nomUtilisateur || req.user.NomUtilisateur || 'admin',
    };

    // 6. Chiffrement XOR + Base64 (identique au client Python)
    const jsonBytes = Buffer.from(JSON.stringify(payload), 'utf8');
    const chiffre = xorEncrypt(jsonBytes);
    const encoded = chiffre.toString('base64');

    // 7. Checksum SHA-256 (16 premiers caractères, idem Python)
    const checksum = crypto.createHash('sha256').update(jsonBytes).digest('hex').slice(0, 16);

    // 8. Format final du fichier
    const contenuFinal = `GESCARD_INIT_V1|${checksum}|${encoded}`;

    // 9. Envoyer le fichier en téléchargement
    const filename = `${site_id}-init.gescard`;

    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('X-Site-Id', site.id);
    res.setHeader('X-Nb-Comptes', comptes.length);
    res.setHeader('X-Nb-Cartes', cartes.length);
    res.setHeader('X-Expire-Le', fmtDate(expireDate));

    return res.send(contenuFinal);
  } catch (error) {
    console.error('❌ Erreur generate init file:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur lors de la génération du fichier.',
      error: error.message,
    });
  }
});

// ============================================================
// GET /api/init-file/sites
// Retourne la liste des sites actifs (pour le sélecteur)
// ============================================================
router.get('/sites', verifyToken, async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs.' });
    }

    const result = await query(
      `SELECT s.id, s.nom, c.nom AS coordination_nom
       FROM sites s
       JOIN coordinations c ON c.id = s.coordination_id
       WHERE s.is_active = true
       ORDER BY c.nom, s.nom`
    );

    return res.json({ success: true, sites: result.rows });
  } catch (error) {
    console.error('❌ Erreur récupération sites init:', error);
    return res
      .status(500)
      .json({ success: false, message: 'Erreur serveur.', error: error.message });
  }
});

module.exports = router;
