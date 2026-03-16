// ========== RATE LIMITERS SPÉCIALISÉS ==========

const rateLimit = require('express-rate-limit');

const isDev = process.env.NODE_ENV === 'development';

// Clé par IP (compatible avec trust proxy)
const keyGenerator = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
};

/**
 * Handler personnalisé — calcule le temps restant réel
 * au lieu d'afficher un délai fixe (ex: "15 min" même si
 * il ne reste que 2 minutes).
 */
const makeHandler = (code, getMessage) => (req, res, next, options) => {
  const retryAfterMs = options.windowMs - (Date.now() % options.windowMs);
  const retryAfterMin = Math.ceil(retryAfterMs / 1000 / 60);
  const retryAfterSec = Math.ceil(retryAfterMs / 1000);

  if (isDev) {
    console.warn(`⚠️ [RATE LIMIT] ${code} — IP: ${keyGenerator(req)} — Retry in ${retryAfterSec}s`);
  }

  res.status(429).json({
    success: false,
    code,
    message: getMessage(retryAfterMin),
    retryAfter: retryAfterSec, // secondes — utile pour le frontend
  });
};

// ── 1. Auth / Login — strictissime ──
// 10 tentatives / 15 min par IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // ne compte que les échecs
  handler: makeHandler(
    'TOO_MANY_AUTH_ATTEMPTS',
    (min) => `Trop de tentatives de connexion. Réessayez dans ${min} minute${min > 1 ? 's' : ''}.`
  ),
});

// ── 2. API générale — raisonnable ──
// 300 req / 15 min
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['/api/health', '/api/test-db', '/api/cors-test'].includes(req.path),
  handler: makeHandler(
    'RATE_LIMIT_EXCEEDED',
    (min) => `Trop de requêtes. Réessayez dans ${min} minute${min > 1 ? 's' : ''}.`
  ),
});

// ── 3. Upload / Import — limité ──
// 20 uploads / 15 min
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeHandler(
    'UPLOAD_LIMIT_EXCEEDED',
    (min) => `Trop d'imports en peu de temps. Réessayez dans ${min} minute${min > 1 ? 's' : ''}.`
  ),
});

// ── 4. Export / Rapports — modéré ──
// 50 exports / heure
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeHandler(
    'EXPORT_LIMIT_EXCEEDED',
    (min) => `Limite d'exports atteinte. Réessayez dans ${min} minute${min > 1 ? 's' : ''}.`
  ),
});

// ── 5. Updates check — très permissif ──
// 100 checks / heure
const updatesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  handler: makeHandler(
    'UPDATES_LIMIT_EXCEEDED',
    (min) =>
      `Vérification des mises à jour limitée. Réessayez dans ${min} minute${min > 1 ? 's' : ''}.`
  ),
});

module.exports = { authLimiter, apiLimiter, uploadLimiter, exportLimiter, updatesLimiter };
