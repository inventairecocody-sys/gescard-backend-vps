// ========== UTILITAIRE : RÉPONSES D'ERREUR SÉCURISÉES ==========
// À importer dans tous vos controllers pour éviter la fuite d'info en production
//
// Usage : const { serverError, notFound, forbidden } = require('../utils/errorResponse');

const isDev = process.env.NODE_ENV === 'development';

/**
 * Erreur 500 — Ne jamais exposer error.message en production
 */
const serverError = (res, error, context = '') => {
  // Logger côté serveur avec le contexte complet
  console.error(`❌ ${context || 'Erreur serveur'}:`, error?.message || error);

  return res.status(500).json({
    success: false,
    message: 'Erreur serveur',
    // Seulement en développement
    ...(isDev && { error: error?.message }),
  });
};

/**
 * Erreur 404
 */
const notFound = (res, message = 'Ressource non trouvée') => {
  return res.status(404).json({ success: false, message });
};

/**
 * Erreur 403
 */
const forbidden = (res, message = 'Accès non autorisé') => {
  return res.status(403).json({ success: false, message });
};

/**
 * Erreur 400
 */
const badRequest = (res, message) => {
  return res.status(400).json({ success: false, message });
};

/**
 * Erreur 401
 */
const unauthorized = (res, message = 'Non authentifié') => {
  return res.status(401).json({ success: false, message });
};

module.exports = { serverError, notFound, forbidden, badRequest, unauthorized };

// ========== GUIDE D'APPLICATION ==========
//
// Dans profilController.js, remplacez tous les blocs catch :
//
// AVANT :
//   } catch (error) {
//     res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
//   }
//
// APRÈS :
//   const { serverError } = require('../utils/errorResponse');
//   } catch (error) {
//     return serverError(res, error, 'getProfile');
//   }
//
// Cela s'applique à : profilController.js, utilisateursController.js,
// logController.js, et tous les autres controllers.
//
// Dans utilisateursController.js, la même chose + corriger la query countQuery
// dans searchUsers pour inclure deleted_at IS NULL :
//
// AVANT :
//   const { where: whereC, params: countParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
//   const countQuery = `SELECT COUNT(*) as total FROM utilisateurs ${whereC}`;
//
// APRÈS :
//   const { where: whereC, params: countParams } = buildUserFilter(acteur, [], 'WHERE 1=1 AND (deleted_at IS NULL OR deleted_at IS NOT NULL)');
//   // ou simplement sans filtre deleted_at si votre table ne soft-delete pas les utilisateurs
