const jwt = require("jsonwebtoken");
const crypto = require('crypto');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const AUTH_CONFIG = {
  jwtExpiration: process.env.JWT_EXPIRATION || '8h',
  refreshExpiration: process.env.REFRESH_EXPIRATION || '7d',
  tokenBlacklist: new Set(), // Pour les tokens révoqués
  blacklistCleanupInterval: 3600000, // 1 heure
  
  // Rôles et permissions
  roles: {
    Administrateur: {
      level: 100,
      permissions: ['*'] // Toutes les permissions
    },
    Superviseur: {
      level: 80,
      permissions: ['read', 'write', 'delete', 'export', 'import']
    },
    "Chef d'équipe": {
      level: 60,
      permissions: ['read', 'write', 'export']
    },
    Opérateur: {
      level: 40,
      permissions: ['read', 'write']
    },
    Consultant: {
      level: 20,
      permissions: ['read', 'export']
    }
  },
  
  // Colonnes modifiables par rôle
  roleColumns: {
    Administrateur: [
      "LIEU D'ENROLEMENT", "SITE DE RETRAIT", "RANGEMENT",
      "NOM", "PRENOMS", "DATE DE NAISSANCE", "LIEU NAISSANCE",
      "CONTACT", "DELIVRANCE", "CONTACT DE RETRAIT", "DATE DE DELIVRANCE",
      "IMPORTBATCHID", "SOURCEIMPORT"
    ],
    Superviseur: [
      "LIEU D'ENROLEMENT", "SITE DE RETRAIT", "RANGEMENT",
      "NOM", "PRENOMS", "DATE DE NAISSANCE", "LIEU NAISSANCE",
      "CONTACT", "DELIVRANCE", "CONTACT DE RETRAIT", "DATE DE DELIVRANCE"
    ],
    "Chef d'équipe": [
      "LIEU D'ENROLEMENT", "SITE DE RETRAIT", "RANGEMENT",
      "NOM", "PRENOMS", "DATE DE NAISSANCE", "LIEU NAISSANCE",
      "CONTACT", "DELIVRANCE", "CONTACT DE RETRAIT", "DATE DE DELIVRANCE"
    ],
    Opérateur: [
      "DELIVRANCE", "CONTACT DE RETRAIT", "DATE DE DELIVRANCE"
    ],
    Consultant: [] // Lecture seule
  }
};

// Nettoyage périodique de la blacklist
setInterval(() => {
  AUTH_CONFIG.tokenBlacklist.clear();
  console.log('🧹 Blacklist des tokens nettoyée');
}, AUTH_CONFIG.blacklistCleanupInterval);

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Génère un ID de session unique
 */
const generateSessionId = () => {
  return crypto.randomBytes(16).toString('hex');
};

/**
 * Normalise le rôle (gère les cas où le rôle est en minuscule/majuscule)
 */
const normalizeRole = (role) => {
  if (!role) return null;
  
  // Mapping des variations de rôles
  const roleMap = {
    'administrateur': 'Administrateur',
    'admin': 'Administrateur',
    'superviseur': 'Superviseur',
    'supervisor': 'Superviseur',
    'chef d\'équipe': "Chef d'équipe",
    'chef': "Chef d'équipe",
    'operateur': 'Opérateur',
    'operator': 'Opérateur',
    'consultant': 'Consultant'
  };
  
  const normalized = role.toLowerCase().trim();
  return roleMap[normalized] || role;
};

// ============================================
// MIDDLEWARE PRINCIPAL DE VÉRIFICATION JWT
// ============================================

/**
 * Vérifie le token JWT - VERSION OPTIMISÉE POUR LWS
 */
exports.verifyToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  const requestId = generateSessionId();

  if (!token) {
    console.log(`❌ [${requestId}] Accès refusé : token manquant`, {
      path: req.path,
      method: req.method,
      ip: req.ip
    });
    
    return res.status(401).json({ 
      success: false,
      message: "Accès refusé : token manquant",
      code: "MISSING_TOKEN",
      requestId
    });
  }

  // Vérifier si le token est blacklisté
  if (AUTH_CONFIG.tokenBlacklist.has(token)) {
    console.log(`❌ [${requestId}] Token révoqué`, {
      path: req.path,
      ip: req.ip
    });
    
    return res.status(401).json({ 
      success: false,
      message: "Token révoqué",
      code: "TOKEN_REVOKED",
      requestId
    });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Normaliser le rôle
    const normalizedRole = normalizeRole(decoded.Role || decoded.role);
    
    // Structure enrichie de l'utilisateur
    req.user = {
      id: decoded.id,
      NomUtilisateur: decoded.NomUtilisateur || decoded.username,
      NomComplet: decoded.NomComplet || decoded.NomUtilisateur || decoded.username,
      Role: normalizedRole,
      role: normalizedRole, // Compatibilité
      Agence: decoded.Agence || decoded.agence || '',
      Email: decoded.Email || decoded.email,
      sessionId: decoded.sessionId || requestId,
      permissions: AUTH_CONFIG.roles[normalizedRole]?.permissions || ['read'],
      level: AUTH_CONFIG.roles[normalizedRole]?.level || 0,
      tokenIssuedAt: decoded.iat ? new Date(decoded.iat * 1000).toISOString() : null,
      tokenExpiresAt: decoded.exp ? new Date(decoded.exp * 1000).toISOString() : null
    };
    
    // Ajouter des métadonnées à la requête
    req.auth = {
      authenticated: true,
      method: 'jwt',
      tokenExpiresIn: decoded.exp ? decoded.exp - Math.floor(Date.now() / 1000) : null,
      requestId
    };
    
    console.log(`✅ [${requestId}] Token vérifié - User: ${req.user.NomUtilisateur}, Role: ${req.user.Role}`);
    
    next();
  } catch (error) {
    const errorMessage = error.name === 'TokenExpiredError' 
      ? 'Token expiré' 
      : error.name === 'JsonWebTokenError'
        ? 'Token invalide'
        : 'Erreur d\'authentification';
    
    console.error(`❌ [${requestId}] ${errorMessage}:`, error.message);
    
    return res.status(403).json({ 
      success: false,
      message: errorMessage,
      code: error.name,
      requestId
    });
  }
};

// ============================================
// MIDDLEWARE DE GESTION DES RÔLES
// ============================================

/**
 * Vérifie que le rôle de l'utilisateur fait partie des rôles autorisés
 */
exports.verifyRole = (rolesAutorises = []) => {
  return (req, res, next) => {
    const requestId = req.auth?.requestId || generateSessionId();
    const userRole = req.user?.Role || req.user?.role;
    
    if (!req.user || !userRole) {
      console.log(`❌ [${requestId}] Utilisateur non authentifié`);
      return res.status(401).json({ 
        success: false,
        message: "Utilisateur non authentifié",
        code: "UNAUTHENTICATED",
        requestId
      });
    }

    // Normaliser les rôles autorisés
    const normalizedAllowed = rolesAutorises.map(role => normalizeRole(role));
    
    if (!normalizedAllowed.includes(userRole)) {
      console.log(`❌ [${requestId}] Rôle non autorisé: ${userRole}`, {
        required: normalizedAllowed,
        userRole
      });
      
      return res.status(403).json({ 
        success: false,
        message: "Accès interdit : rôle non autorisé",
        required: rolesAutorises,
        yourRole: userRole,
        code: "FORBIDDEN_ROLE",
        requestId
      });
    }

    console.log(`✅ [${requestId}] Rôle vérifié: ${userRole}`);
    next();
  };
};

/**
 * Vérifie que l'utilisateur a un niveau de permission suffisant
 */
exports.verifyLevel = (requiredLevel = 0) => {
  return (req, res, next) => {
    const userLevel = req.user?.level || 0;
    
    if (userLevel < requiredLevel) {
      return res.status(403).json({
        success: false,
        message: "Niveau de permission insuffisant",
        required: requiredLevel,
        yourLevel: userLevel,
        code: "INSUFFICIENT_LEVEL"
      });
    }
    
    next();
  };
};

/**
 * Vérifie une permission spécifique
 */
exports.hasPermission = (permission) => {
  return (req, res, next) => {
    const permissions = req.user?.permissions || [];
    
    if (!permissions.includes('*') && !permissions.includes(permission)) {
      return res.status(403).json({
        success: false,
        message: `Permission requise: ${permission}`,
        code: "MISSING_PERMISSION"
      });
    }
    
    next();
  };
};

// ============================================
// MIDDLEWARE DE CONTRÔLE DES COLONNES
// ============================================

/**
 * Middleware spécialisé : contrôle des colonnes modifiables selon le rôle
 */
exports.canEditColumns = (req, res, next) => {
  const requestId = req.auth?.requestId || generateSessionId();
  const role = req.user?.Role || req.user?.role;

  if (!role) {
    return res.status(401).json({ 
      success: false,
      message: "Rôle non défini",
      code: "UNDEFINED_ROLE",
      requestId
    });
  }

  // Récupérer les colonnes autorisées pour ce rôle
  const allowedColumns = AUTH_CONFIG.roleColumns[role] || [];
  
  // Si le corps de la requête contient des données, filtrer les colonnes
  if (req.body && (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH')) {
    const originalBody = { ...req.body };
    const filteredBody = {};
    
    // Pour les mises à jour massives (tableau)
    if (Array.isArray(req.body)) {
      req.body = req.body.map(item => {
        const filtered = {};
        Object.keys(item).forEach(key => {
          if (allowedColumns.includes(key) || allowedColumns.includes(key.toUpperCase())) {
            filtered[key] = item[key];
          }
        });
        return filtered;
      });
    } 
    // Pour les mises à jour simples (objet)
    else {
      Object.keys(req.body).forEach(key => {
        if (allowedColumns.includes(key) || allowedColumns.includes(key.toUpperCase())) {
          filteredBody[key] = req.body[key];
        }
      });
      req.body = filteredBody;
    }
    
    // Log des colonnes filtrées
    const filteredKeys = Object.keys(originalBody).filter(k => !allowedColumns.includes(k) && !allowedColumns.includes(k.toUpperCase()));
    if (filteredKeys.length > 0) {
      console.log(`ℹ️ [${requestId}] Colonnes filtrées pour ${role}:`, filteredKeys);
    }
  }

  req.allowedColumns = allowedColumns;
  
  console.log(`✅ [${requestId}] Contrôle colonnes OK - ${role} peut modifier:`, allowedColumns.length, 'colonnes');
  next();
};

// ============================================
// MIDDLEWARE DE RAFRAÎCHISSEMENT DE TOKEN
// ============================================

/**
 * Rafraîchit le token si nécessaire (à utiliser avec verifyToken)
 */
exports.refreshTokenIfNeeded = (req, res, next) => {
  const oldToken = req.headers["authorization"]?.split(" ")[1];
  
  if (!oldToken || !req.user) {
    return next();
  }
  
  // Rafraîchir si le token expire dans moins de 30 minutes
  const timeUntilExpiry = req.auth?.tokenExpiresIn || 0;
  const refreshThreshold = 30 * 60; // 30 minutes en secondes
  
  if (timeUntilExpiry > 0 && timeUntilExpiry < refreshThreshold) {
    try {
      const newToken = jwt.sign(
        {
          id: req.user.id,
          NomUtilisateur: req.user.NomUtilisateur,
          NomComplet: req.user.NomComplet,
          Role: req.user.Role,
          Agence: req.user.Agence
        },
        process.env.JWT_SECRET,
        { expiresIn: AUTH_CONFIG.jwtExpiration }
      );
      
      req.newToken = newToken;
      res.setHeader('X-New-Token', newToken);
      console.log(`🔄 Token rafraîchi pour ${req.user.NomUtilisateur}`);
    } catch (error) {
      console.warn('⚠️ Erreur rafraîchissement token:', error.message);
    }
  }
  
  next();
};

// ============================================
// MIDDLEWARE DE RÉVOCATION DE TOKEN (LOGOUT)
// ============================================

/**
 * Révoque le token actuel (à utiliser pour le logout)
 */
exports.revokeToken = (req, res, next) => {
  const token = req.headers["authorization"]?.split(" ")[1];
  
  if (token) {
    AUTH_CONFIG.tokenBlacklist.add(token);
    console.log(`🔒 Token révoqué pour ${req.user?.NomUtilisateur || 'utilisateur inconnu'}`);
  }
  
  next();
};

// ============================================
// MIDDLEWARE DE VALIDATION DE SESSION
// ============================================

/**
 * Valide que la session est toujours active
 */
exports.validateSession = async (req, res, next) => {
  const sessionId = req.user?.sessionId;
  
  if (!sessionId) {
    return next();
  }
  
  // Ici, vous pouvez vérifier en base de données si la session est toujours valide
  // Par exemple: SELECT * FROM sessions WHERE session_id = $1 AND expires_at > NOW()
  
  // Pour l'instant, on passe simplement
  next();
};

// ============================================
// EXPORT DE LA CONFIGURATION
// ============================================

exports.AUTH_CONFIG = AUTH_CONFIG;
exports.normalizeRole = normalizeRole;
exports.generateSessionId = generateSessionId;