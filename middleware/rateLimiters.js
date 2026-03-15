// ========== RATE LIMITERS SPÉCIALISÉS ==========
// Remplace le rate limiter unique dans server.js

const rateLimit = require('express-rate-limit');

// Clé par IP (compatible avec trust proxy)
const keyGenerator = (req) => {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
};

// ── 1. Auth / Login — strictissime ──
// 10 tentatives / 15 min par IP
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator,
  message: {
    success: false,
    error: 'TOO_MANY_AUTH_ATTEMPTS',
    message: 'Trop de tentatives de connexion. Veuillez réessayer dans 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true, // ne compte que les échecs
});

// ── 2. API générale — raisonnable ──
// 300 req / 15 min (au lieu de 5000)
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  keyGenerator,
  message: {
    success: false,
    error: 'RATE_LIMIT_EXCEEDED',
    message: 'Limite de requêtes atteinte. Veuillez réessayer dans 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Exempter les routes de santé
    return ['/api/health', '/api/test-db', '/api/cors-test'].includes(req.path);
  },
});

// ── 3. Upload / Import — limité ──
// 20 uploads / 15 min
const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  keyGenerator,
  message: {
    success: false,
    error: 'UPLOAD_LIMIT_EXCEEDED',
    message: "Trop d'imports en peu de temps. Veuillez patienter.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── 4. Export / Rapports — modéré ──
// 50 exports / heure
const exportLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 50,
  keyGenerator,
  message: {
    success: false,
    error: 'EXPORT_LIMIT_EXCEEDED',
    message: "Limite d'exports atteinte. Réessayez dans une heure.",
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// ── 5. Updates check — très permissif ──
// 100 checks / heure (app desktop qui vérifie souvent)
const updatesLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 100,
  keyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { authLimiter, apiLimiter, uploadLimiter, exportLimiter, updatesLimiter };
