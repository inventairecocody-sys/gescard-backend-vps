// ========== UTILITAIRE : RÉPONSES D'ERREUR SÉCURISÉES ==========
// Usage : const { serverError, notFound, forbidden, ... } = require('../utils/errorResponse');

const isDev = process.env.NODE_ENV === 'development';

// ── Logger interne ──────────────────────────────────────────────
const log = (context, error) => {
  const timestamp = new Date().toISOString();
  console.error(`[${timestamp}] ❌ ${context}:`, error?.message || error);
  if (isDev && error?.stack) console.error(error.stack);
};

// ── 400 Bad Request ─────────────────────────────────────────────
const badRequest = (res, message = 'Requête invalide', code = 'BAD_REQUEST') => {
  return res.status(400).json({ success: false, code, message });
};

// ── 401 Non authentifié ─────────────────────────────────────────
const unauthorized = (res, message = 'Veuillez vous reconnecter.', code = 'UNAUTHORIZED') => {
  return res.status(401).json({ success: false, code, message });
};

// ── 403 Accès interdit ──────────────────────────────────────────
const forbidden = (
  res,
  message = "Vous n'avez pas les droits pour effectuer cette action.",
  code = 'FORBIDDEN'
) => {
  return res.status(403).json({ success: false, code, message });
};

// ── 404 Introuvable ─────────────────────────────────────────────
const notFound = (res, message = 'La ressource demandée est introuvable.', code = 'NOT_FOUND') => {
  return res.status(404).json({ success: false, code, message });
};

// ── 409 Conflit (doublon) ───────────────────────────────────────
// Exemple : nom d'utilisateur ou email déjà utilisé
const conflict = (res, message = 'Cette ressource existe déjà.', code = 'CONFLICT') => {
  return res.status(409).json({ success: false, code, message });
};

// ── 422 Erreur de validation ────────────────────────────────────
// `errors` peut être :
//   - une string  : message simple
//   - un objet    : { NomUtilisateur: 'Requis', MotDePasse: 'Trop court' }
//   - un tableau  : [{ field: 'email', message: 'Format invalide' }]
const validationError = (res, errors, code = 'VALIDATION_ERROR') => {
  const message =
    typeof errors === 'string' ? errors : 'Certaines informations saisies sont invalides.';

  return res.status(422).json({
    success: false,
    code,
    message,
    ...(typeof errors !== 'string' && { errors }),
  });
};

// ── 429 Trop de requêtes ────────────────────────────────────────
const tooManyRequests = (
  res,
  message = 'Trop de tentatives. Veuillez patienter quelques instants.',
  code = 'TOO_MANY_REQUESTS'
) => {
  return res.status(429).json({ success: false, code, message });
};

// ── 500 Erreur serveur ──────────────────────────────────────────
// Ne jamais exposer error.message en production
const serverError = (res, error, context = 'Erreur serveur') => {
  log(context, error);

  return res.status(500).json({
    success: false,
    code: 'SERVER_ERROR',
    message: 'Une erreur inattendue est survenue. Réessayez dans un moment.',
    ...(isDev && { debug: error?.message }),
  });
};

module.exports = {
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  validationError,
  tooManyRequests,
  serverError,
};
