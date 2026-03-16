// middleware/auth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { serverError, unauthorized, forbidden } = require('../utils/errorResponse');

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// CONFIGURATION
// ============================================

const AUTH_CONFIG = {
  jwtExpiration: process.env.JWT_EXPIRATION || '8h',
  refreshExpiration: process.env.REFRESH_EXPIRATION || '7d',
  tokenBlacklist: new Set(),
  blacklistCleanupInterval: 3600000, // 1 heure

  roles: {
    Administrateur: { level: 100, permissions: ['*'] },
    Superviseur: { level: 80, permissions: ['read', 'write', 'delete', 'export', 'import'] },
    Gestionnaire: { level: 80, permissions: ['read', 'write', 'delete', 'export', 'import'] },
    "Chef d'équipe": { level: 60, permissions: ['read', 'write', 'export'] },
    Opérateur: { level: 40, permissions: ['read', 'write'] },
    Consultant: { level: 20, permissions: ['read', 'export'] },
  },
};

// Nettoyage périodique de la blacklist
setInterval(() => {
  const size = AUTH_CONFIG.tokenBlacklist.size;
  AUTH_CONFIG.tokenBlacklist.clear();
  if (isDev) console.log(`🧹 Blacklist nettoyée (${size} tokens révoqués purgés)`);
}, AUTH_CONFIG.blacklistCleanupInterval);

// ============================================
// UTILITAIRES
// ============================================

const generateSessionId = () => crypto.randomBytes(16).toString('hex');

const normalizeRole = (role) => {
  if (!role) return null;

  const roleStr = role.toString().toLowerCase().trim();

  const map = {
    administrateur: 'Administrateur',
    admin: 'Administrateur',
    superviseur: 'Gestionnaire',
    supervisor: 'Gestionnaire',
    gestionnaire: 'Gestionnaire',
    "chef d'équipe": "Chef d'équipe",
    "chef d'equipe": "Chef d'équipe",
    chef: "Chef d'équipe",
    operateur: 'Opérateur',
    opérateur: 'Opérateur',
    operator: 'Opérateur',
    consultant: 'Consultant',
  };

  return map[roleStr] || role;
};

// ============================================
// VERIFY TOKEN
// ============================================

const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return unauthorized(res, 'Accès refusé. Veuillez vous connecter.', 'MISSING_TOKEN');
    }

    if (AUTH_CONFIG.tokenBlacklist.has(token)) {
      return unauthorized(res, 'Session révoquée. Veuillez vous reconnecter.', 'TOKEN_REVOKED');
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = normalizeRole(decoded.Role || decoded.role);

    const nomUtilisateur =
      decoded.NomUtilisateur ||
      decoded.nomUtilisateur ||
      decoded.username ||
      decoded.nom_utilisateur ||
      '';

    const nomComplet =
      decoded.NomComplet || decoded.nomComplet || decoded.nom_complet || nomUtilisateur;

    const agence = decoded.Agence || decoded.agence || '';

    // Deux conventions de nommage pour compatibilité controllers/services
    req.user = {
      id: decoded.id,

      // Format MAJUSCULE (ancienne convention)
      NomUtilisateur: nomUtilisateur,
      NomComplet: nomComplet,
      Role: role,
      Agence: agence,
      Email: decoded.Email || decoded.email || '',

      // Format minuscule (convention controllers/services)
      nomUtilisateur: nomUtilisateur,
      nomComplet: nomComplet,
      agence: agence,
      email: decoded.Email || decoded.email || '',

      // Commun
      role: role,
      coordination: decoded.coordination || decoded.Coordination || null,
      coordination_id: decoded.coordination_id || null,
      level: AUTH_CONFIG.roles[role]?.level || 0,
      permissions: AUTH_CONFIG.roles[role]?.permissions || [],
    };

    // Log uniquement en développement
    if (isDev) {
      console.log(
        `✅ [AUTH] ${req.user.nomUtilisateur} (${req.user.role}) → ${req.method} ${req.originalUrl}`
      );
    }

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return unauthorized(
        res,
        'Votre session a expiré. Veuillez vous reconnecter.',
        'TOKEN_EXPIRED'
      );
    }

    if (error.name === 'JsonWebTokenError') {
      return unauthorized(res, 'Session invalide. Veuillez vous reconnecter.', 'INVALID_TOKEN');
    }

    return serverError(res, error, 'AUTH_MIDDLEWARE');
  }
};

const verifierToken = verifyToken; // Alias français pour compatibilité

// ============================================
// ROLE CHECK
// ============================================

const verifyRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return unauthorized(
        res,
        'Veuillez vous connecter pour accéder à cette ressource.',
        'UNAUTHENTICATED'
      );
    }

    const normalizedRoles = roles.map(normalizeRole);

    if (!normalizedRoles.includes(req.user.role)) {
      return forbidden(
        res,
        "Vous n'avez pas les droits nécessaires pour accéder à cette section.",
        'FORBIDDEN_ROLE',
        // Détails visibles uniquement en dev
        isDev ? { yourRole: req.user.role, requiredRoles: roles } : undefined
      );
    }

    next();
  };
};

// ============================================
// LEVEL CHECK
// ============================================

const verifyLevel = (requiredLevel = 0) => {
  return (req, res, next) => {
    if (!req.user) {
      return unauthorized(
        res,
        'Veuillez vous connecter pour accéder à cette ressource.',
        'UNAUTHENTICATED'
      );
    }

    if ((req.user.level || 0) < requiredLevel) {
      return forbidden(
        res,
        "Votre niveau d'accès ne permet pas d'effectuer cette action.",
        'INSUFFICIENT_LEVEL',
        isDev ? { required: requiredLevel, yourLevel: req.user.level || 0 } : undefined
      );
    }

    next();
  };
};

// ============================================
// PERMISSION CHECK
// ============================================

const hasPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return unauthorized(
        res,
        'Veuillez vous connecter pour accéder à cette ressource.',
        'UNAUTHENTICATED'
      );
    }

    const permissions = req.user.permissions || [];

    if (permissions.includes('*') || permissions.includes(permission)) {
      return next();
    }

    return forbidden(
      res,
      "Vous n'avez pas la permission d'effectuer cette action.",
      'MISSING_PERMISSION',
      isDev ? { required: permission, yourPermissions: permissions } : undefined
    );
  };
};

// ============================================
// LOGOUT / REVOKE TOKEN
// ============================================

const revokeToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      AUTH_CONFIG.tokenBlacklist.add(token);
      if (isDev) console.log(`🔒 [AUTH] Token révoqué: ${token.substring(0, 15)}...`);
    }
    next();
  } catch (error) {
    console.error('❌ [AUTH] Erreur révocation token:', error);
    next();
  }
};

// ============================================
// UTILITAIRES COMPLÉMENTAIRES
// ============================================

const getUserFromToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = normalizeRole(decoded.Role || decoded.role);

    return {
      id: decoded.id,
      username: decoded.NomUtilisateur || decoded.nomUtilisateur || decoded.username,
      nomUtilisateur: decoded.NomUtilisateur || decoded.nomUtilisateur || decoded.username,
      role: role,
      level: AUTH_CONFIG.roles[role]?.level || 0,
    };
  } catch (error) {
    return null;
  }
};

const refreshToken = (oldToken) => {
  try {
    const decoded = jwt.verify(oldToken, process.env.JWT_SECRET, { ignoreExpiration: true });
    const { id, NomUtilisateur, role, coordination } = decoded;

    const newToken = jwt.sign({ id, NomUtilisateur, role, coordination }, process.env.JWT_SECRET, {
      expiresIn: AUTH_CONFIG.jwtExpiration,
    });

    return { success: true, token: newToken };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ============================================
// EXPORT
// ============================================

module.exports = {
  verifyToken,
  verifierToken,
  verifyRole,
  verifyLevel,
  hasPermission,
  revokeToken,
  refreshToken,
  getUserFromToken,
  generateSessionId,
  normalizeRole,
  AUTH_CONFIG,
};
