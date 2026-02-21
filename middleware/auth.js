const jwt = require('jsonwebtoken');
const crypto = require('crypto');

// ============================================
// CONFIGURATION
// ============================================

const AUTH_CONFIG = {
  jwtExpiration: process.env.JWT_EXPIRATION || '8h',
  refreshExpiration: process.env.REFRESH_EXPIRATION || '7d',
  tokenBlacklist: new Set(),
  blacklistCleanupInterval: 3600000,

  roles: {
    Administrateur: { level: 100, permissions: ['*'] },
    Superviseur: { level: 80, permissions: ['read', 'write', 'delete', 'export', 'import'] },
    "Chef d'équipe": { level: 60, permissions: ['read', 'write', 'export'] },
    Opérateur: { level: 40, permissions: ['read', 'write'] },
    Consultant: { level: 20, permissions: ['read', 'export'] },
  },
};

// Nettoyage blacklist
setInterval(() => {
  AUTH_CONFIG.tokenBlacklist.clear();
  console.log('🧹 Blacklist nettoyée');
}, AUTH_CONFIG.blacklistCleanupInterval);

// ============================================
// UTILITAIRES
// ============================================

const generateSessionId = () => crypto.randomBytes(16).toString('hex');

const normalizeRole = (role) => {
  if (!role) return null;

  const map = {
    administrateur: 'Administrateur',
    admin: 'Administrateur',
    superviseur: 'Superviseur',
    supervisor: 'Superviseur',
    "chef d'équipe": "Chef d'équipe",
    chef: "Chef d'équipe",
    operateur: 'Opérateur',
    operator: 'Opérateur',
    consultant: 'Consultant',
  };

  return map[role.toLowerCase().trim()] || role;
};

// ============================================
// VERIFY TOKEN (VERSION UNIQUE ET STABLE)
// ============================================

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

    if (AUTH_CONFIG.tokenBlacklist.has(token)) {
      return res.status(401).json({
        success: false,
        message: 'Token révoqué',
        code: 'TOKEN_REVOKED',
      });
    }

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const role = normalizeRole(decoded.Role || decoded.role);

    req.user = {
      id: decoded.id,
      NomUtilisateur: decoded.NomUtilisateur || decoded.username,
      NomComplet: decoded.NomComplet || decoded.username,
      Role: role,
      role: role,
      Agence: decoded.Agence || '',
      Email: decoded.Email || '',
      level: AUTH_CONFIG.roles[role]?.level || 0,
      permissions: AUTH_CONFIG.roles[role]?.permissions || [],
    };

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: error.name === 'TokenExpiredError' ? 'Token expiré' : 'Token invalide',
      code: error.name,
    });
  }
};

// Alias français pour compatibilité
const verifierToken = verifyToken;

// ============================================
// ROLE CHECK
// ============================================

const verifyRole = (roles = []) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Non authentifié' });
    }

    const allowed = roles.map(normalizeRole);

    if (!allowed.includes(req.user.Role)) {
      return res.status(403).json({
        success: false,
        message: 'Rôle non autorisé',
        yourRole: req.user.Role,
        required: roles,
      });
    }

    next();
  };
};

// ============================================
// LEVEL CHECK
// ============================================

const verifyLevel = (requiredLevel = 0) => {
  return (req, res, next) => {
    if ((req.user?.level || 0) < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: 'Niveau insuffisant',
      });
    }
    next();
  };
};

// ============================================
// PERMISSION CHECK
// ============================================

const hasPermission = (permission) => {
  return (req, res, next) => {
    const perms = req.user?.permissions || [];

    if (!perms.includes('*') && !perms.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Permission requise: ${permission}`,
      });
    }

    next();
  };
};

// ============================================
// LOGOUT
// ============================================

const revokeToken = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (token) AUTH_CONFIG.tokenBlacklist.add(token);
  next();
};

// ============================================
// EXPORT FINAL STABLE
// ============================================

module.exports = {
  verifyToken,
  verifierToken, // compatibilité
  verifyRole,
  verifyLevel,
  hasPermission,
  revokeToken,
  AUTH_CONFIG,
  normalizeRole,
  generateSessionId,
};
