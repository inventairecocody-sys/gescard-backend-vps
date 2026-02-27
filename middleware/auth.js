// middleware/auth.js
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

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
    "Chef d'équipe": { level: 60, permissions: ['read', 'write', 'export'] },
    Opérateur: { level: 40, permissions: ['read', 'write'] },
    Consultant: { level: 20, permissions: ['read', 'export'] },
  },
};

// Nettoyage périodique de la blacklist
setInterval(() => {
  const size = AUTH_CONFIG.tokenBlacklist.size;
  AUTH_CONFIG.tokenBlacklist.clear();
  console.log(`🧹 Blacklist nettoyée (${size} tokens révoqués purgés)`);
}, AUTH_CONFIG.blacklistCleanupInterval);

// ============================================
// UTILITAIRES
// ============================================

/**
 * Génère un identifiant de session unique
 */
const generateSessionId = () => crypto.randomBytes(16).toString('hex');

/**
 * Normalise un rôle (gère les variations)
 */
const normalizeRole = (role) => {
  if (!role) return null;

  const roleStr = role.toString().toLowerCase().trim();

  const map = {
    administrateur: 'Administrateur',
    admin: 'Administrateur',
    superviseur: 'Superviseur',
    supervisor: 'Superviseur',
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
// VERIFY TOKEN (VERSION UNIQUE ET STABLE)
// ============================================

/**
 * Vérifie la validité du token JWT
 */
const verifyToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.split(' ')[1];

    if (!token) {
      return res.status(401).json({
        success: false,
        message: 'Token manquant',
        code: 'MISSING_TOKEN',
      });
    }

    // Vérifier si le token est révoqué
    if (AUTH_CONFIG.tokenBlacklist.has(token)) {
      return res.status(401).json({
        success: false,
        message: 'Token révoqué',
        code: 'TOKEN_REVOKED',
      });
    }

    // Décoder et vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Normaliser le rôle
    const role = normalizeRole(decoded.Role || decoded.role);

    // Construire l'objet utilisateur
    req.user = {
      id: decoded.id,
      NomUtilisateur: decoded.NomUtilisateur || decoded.nomUtilisateur || decoded.username,
      NomComplet:
        decoded.NomComplet || decoded.nomComplet || decoded.NomUtilisateur || decoded.username,
      Role: role,
      role: role, // Les deux formats pour compatibilité
      Agence: decoded.Agence || decoded.agence || '',
      Email: decoded.Email || decoded.email || '',
      coordination: decoded.coordination || decoded.Coordination || null,
      level: AUTH_CONFIG.roles[role]?.level || 0,
      permissions: AUTH_CONFIG.roles[role]?.permissions || [],
    };

    next();
  } catch (error) {
    // Gestion spécifique des erreurs JWT
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expiré',
        code: 'TOKEN_EXPIRED',
      });
    }

    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Token invalide',
        code: 'INVALID_TOKEN',
      });
    }

    // Erreur inattendue
    console.error('❌ Erreur auth middleware:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      code: 'AUTH_ERROR',
    });
  }
};

// Alias français pour compatibilité avec le code existant
const verifierToken = verifyToken;

// ============================================
// ROLE CHECK
// ============================================

/**
 * Vérifie que l'utilisateur a un des rôles autorisés
 */
const verifyRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Non authentifié',
        code: 'UNAUTHENTICATED',
      });
    }

    const normalizedRoles = roles.map(normalizeRole);

    if (!normalizedRoles.includes(req.user.Role)) {
      return res.status(403).json({
        success: false,
        message: 'Rôle non autorisé',
        yourRole: req.user.Role,
        requiredRoles: roles,
        code: 'FORBIDDEN_ROLE',
      });
    }

    next();
  };
};

// ============================================
// LEVEL CHECK
// ============================================

/**
 * Vérifie que l'utilisateur a un niveau suffisant
 */
const verifyLevel = (requiredLevel = 0) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Non authentifié',
        code: 'UNAUTHENTICATED',
      });
    }

    if ((req.user.level || 0) < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: 'Niveau insuffisant',
        required: requiredLevel,
        yourLevel: req.user.level || 0,
        code: 'INSUFFICIENT_LEVEL',
      });
    }

    next();
  };
};

// ============================================
// PERMISSION CHECK
// ============================================

/**
 * Vérifie que l'utilisateur a une permission spécifique
 */
const hasPermission = (permission) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Non authentifié',
        code: 'UNAUTHENTICATED',
      });
    }

    const permissions = req.user.permissions || [];

    // '*' signifie toutes les permissions
    if (permissions.includes('*') || permissions.includes(permission)) {
      return next();
    }

    return res.status(403).json({
      success: false,
      message: `Permission requise: ${permission}`,
      yourPermissions: permissions,
      code: 'MISSING_PERMISSION',
    });
  };
};

// ============================================
// LOGOUT / REVOKE TOKEN
// ============================================

/**
 * Révoque un token (ajout à la blacklist)
 */
const revokeToken = (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (token) {
      AUTH_CONFIG.tokenBlacklist.add(token);
      console.log(`🔒 Token révoqué: ${token.substring(0, 15)}...`);
    }
    next();
  } catch (error) {
    console.error('❌ Erreur révocation token:', error);
    next();
  }
};

// ============================================
// UTILITAIRES COMPLÉMENTAIRES
// ============================================

/**
 * Récupère les informations utilisateur depuis le token
 */
const getUserFromToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const role = normalizeRole(decoded.Role || decoded.role);

    return {
      id: decoded.id,
      username: decoded.NomUtilisateur || decoded.nomUtilisateur || decoded.username,
      role: role,
      level: AUTH_CONFIG.roles[role]?.level || 0,
    };
  } catch (error) {
    return null;
  }
};

/**
 * Rafraîchit un token
 */
const refreshToken = (oldToken) => {
  try {
    const decoded = jwt.verify(oldToken, process.env.JWT_SECRET, { ignoreExpiration: true });
    const { id, NomUtilisateur, role, coordination } = decoded;

    // Générer un nouveau token
    const newToken = jwt.sign({ id, NomUtilisateur, role, coordination }, process.env.JWT_SECRET, {
      expiresIn: AUTH_CONFIG.jwtExpiration,
    });

    return { success: true, token: newToken };
  } catch (error) {
    return { success: false, error: error.message };
  }
};

// ============================================
// EXPORT FINAL STABLE
// ============================================

module.exports = {
  // Fonction principale
  verifyToken,
  verifierToken, // Alias français pour compatibilité

  // Vérifications
  verifyRole,
  verifyLevel,
  hasPermission,

  // Gestion des tokens
  revokeToken,
  refreshToken,
  getUserFromToken,
  generateSessionId,

  // Utilitaires
  normalizeRole,
  AUTH_CONFIG,
};
