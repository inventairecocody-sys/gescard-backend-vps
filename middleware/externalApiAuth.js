// ========== MIDDLEWARE AUTH API EXTERNE ==========
// À appliquer sur /api/external/sync et autres routes sensibles

const crypto = require('crypto');

/**
 * Vérifie la présence et la validité d'une API key pour les routes externes.
 *
 * Configuration requise dans .env :
 *   EXTERNAL_API_KEY=votre_cle_secrete_longue_et_aleatoire
 *
 * Générer une clé : node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * Usage côté client Python :
 *   headers = { 'X-API-Key': 'votre_cle' }
 */
const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.headers['x-api-token'];

  if (!apiKey) {
    console.warn(`🚫 API externe sans clé: ${req.ip} → ${req.path}`);
    return res.status(401).json({
      success: false,
      message: 'Authentification requise',
      code: 'MISSING_API_KEY',
    });
  }

  const validKey = process.env.EXTERNAL_API_KEY;

  if (!validKey) {
    console.error('❌ EXTERNAL_API_KEY non définie dans .env');
    return res.status(500).json({ success: false, message: 'Configuration serveur incorrecte' });
  }

  // ✅ Comparaison en temps constant (évite timing attacks)
  const provided = Buffer.from(apiKey);
  const expected = Buffer.from(validKey);

  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    console.warn(`🚫 API externe clé invalide: ${req.ip} → ${req.path}`);
    return res.status(401).json({
      success: false,
      message: 'Clé API invalide',
      code: 'INVALID_API_KEY',
    });
  }

  next();
};

/**
 * Middleware optionnel : limiter les routes externes à des IPs connues.
 * Mettre dans .env : EXTERNAL_ALLOWED_IPS=1.2.3.4,5.6.7.8
 */
const requireAllowedIP = (req, res, next) => {
  const allowedIPs = process.env.EXTERNAL_ALLOWED_IPS?.split(',').map((ip) => ip.trim()) || [];

  if (allowedIPs.length === 0) return next(); // Pas de restriction si non configuré

  const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';

  if (!allowedIPs.includes(clientIP)) {
    console.warn(`🚫 IP non autorisée pour API externe: ${clientIP}`);
    return res.status(403).json({
      success: false,
      message: 'Accès interdit',
      code: 'IP_NOT_ALLOWED',
    });
  }

  next();
};

module.exports = { requireApiKey, requireAllowedIP };
