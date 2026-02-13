const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const ACCESS_CONFIG = {
  // Tokens API externes (multiples possibles)
  externalApiTokens: (process.env.EXTERNAL_API_TOKENS || '').split(',').map(t => t.trim()).filter(Boolean),
  
  // Limites par défaut
  defaultLimits: {
    maxFileSize: '10MB',
    maxRowsPerImport: 10000,
    maxRowsPerExport: 50000
  },
  
  // Configuration rate limiting avancée
  rateLimits: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    admin: { bulk: 20, stream: 50, other: 200 },
    superviseur: { bulk: 10, stream: 30, other: 100 },
    chef: { bulk: 5, stream: 15, other: 50 },
    operateur: { bulk: 0, stream: 10, other: 30 },
    consultant: { bulk: 0, stream: 5, other: 20 }
  },
  
  // Routes exemptées de rate limiting
  exemptRoutes: [
    '/health',
    '/test-db',
    '/cors-test',
    '/diagnostic',
    '/template',
    '/status',
    '/sites-list'
  ],
  
  // Mapping des types de routes
  routeTypes: {
    'bulk-import': ['bulk-import', 'bulk', 'mass-import'],
    'import': ['import', 'upload', 'csv', 'excel'],
    'smart-sync': ['smart-sync', 'smart', 'sync'],
    'stream': ['stream', 'chunk', 'partial'],
    'optimized': ['optimized', 'fast', 'quick'],
    'export': ['export', 'download', 'extract'],
    'filtered': ['filtered', 'search', 'query'],
    'admin': ['admin', 'manage', 'config'],
    'monitoring': ['monitoring', 'stats', 'status', 'progress'],
    'diagnostic': ['diagnostic', 'test', 'check']
  }
};

// Cache pour le rate limiting personnalisé
const requestTracker = new Map();

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Nettoie les entrées expirées du tracker
 */
const cleanupTracker = () => {
  const now = Date.now();
  const windowMs = ACCESS_CONFIG.rateLimits.windowMs;
  
  for (const [key, data] of requestTracker.entries()) {
    data.timestamps = data.timestamps.filter(t => t > now - windowMs);
    if (data.timestamps.length === 0) {
      requestTracker.delete(key);
    } else {
      requestTracker.set(key, data);
    }
  }
};

// Nettoyage périodique
setInterval(cleanupTracker, 60000); // Toutes les minutes

/**
 * Déterminer le type de route avec détection avancée
 */
function getRouteType(url, method) {
  const urlPath = url.toLowerCase();
  const pathParts = urlPath.split('/').filter(p => p.length > 0);
  const lastSegment = pathParts[pathParts.length - 1] || '';
  
  // Vérifier chaque type de route
  for (const [type, patterns] of Object.entries(ACCESS_CONFIG.routeTypes)) {
    for (const pattern of patterns) {
      if (urlPath.includes(pattern) || lastSegment.includes(pattern)) {
        // Cas spéciaux
        if (type === 'bulk-import' && method !== 'POST') return 'monitoring';
        if (type === 'export' && method === 'POST') return 'filtered';
        return type;
      }
    }
  }
  
  // Détection par méthode HTTP
  if (method === 'POST' && urlPath.includes('import')) return 'import';
  if (method === 'GET' && urlPath.includes('export')) return 'export';
  
  return 'unknown';
}

/**
 * Obtenir le rôle requis avec message explicatif
 */
function getRequiredRoleForRoute(routeType) {
  const requirements = {
    'bulk-import': { roles: ['Administrateur', 'Superviseur'], message: 'imports massifs' },
    'import': { roles: ['Administrateur', 'Superviseur'], message: 'imports de données' },
    'smart-sync': { roles: ['Administrateur', 'Superviseur'], message: 'synchronisation intelligente' },
    'stream': { roles: ['Administrateur', 'Superviseur', 'Chef d\'équipe'], message: 'exports streaming' },
    'optimized': { roles: ['Administrateur', 'Superviseur', 'Chef d\'équipe'], message: 'exports optimisés' },
    'admin': { roles: ['Administrateur'], message: 'fonctions d\'administration' },
    'filtered': { roles: ['Administrateur', 'Superviseur'], message: 'exports filtrés avancés' },
    'management': { roles: ['Administrateur', 'Superviseur'], message: 'gestion des imports' },
    'monitoring': { roles: ['Administrateur', 'Superviseur', 'Chef d\'équipe'], message: 'monitoring' },
    'diagnostic': { roles: ['Administrateur', 'Superviseur'], message: 'diagnostic' },
    'export': { roles: ['Administrateur', 'Superviseur', 'Chef d\'équipe', 'Opérateur', 'Consultant'], message: 'exports' }
  };
  
  return requirements[routeType] || { roles: ['Administrateur'], message: 'cette action' };
}

/**
 * Normalise un rôle
 */
function normalizeRole(role) {
  if (!role) return null;
  
  const roleLower = role.toLowerCase().trim();
  
  if (roleLower.includes('admin')) return 'Administrateur';
  if (roleLower.includes('superviseur') || roleLower.includes('supervisor')) return 'Superviseur';
  if (roleLower.includes('chef') || roleLower.includes('equipe') || roleLower.includes('équipe')) return 'Chef d\'équipe';
  if (roleLower.includes('operateur') || roleLower.includes('opérateur')) return 'Opérateur';
  if (roleLower.includes('consultant')) return 'Consultant';
  
  return role; // Retourner le rôle original si non reconnu
}

// ============================================
// MIDDLEWARE PRINCIPAL D'ACCÈS
// ============================================

const importExportAccess = (req, res, next) => {
  const requestId = req.requestId || Date.now().toString(36);
  const clientIP = req.ip || req.connection.remoteAddress;
  const apiToken = req.headers['x-api-token'] || req.query.api_token;
  const authHeader = req.headers['authorization'];
  
  console.log(`🔐 [${requestId}] Vérification accès import/export:`, {
    url: req.url,
    method: req.method,
    ip: clientIP,
    hasToken: !!apiToken,
    hasAuth: !!authHeader
  });

  // 1. VÉRIFIER LE TOKEN D'API EXTERNE
  if (apiToken) {
    // Vérifier si le token est valide
    const isValidToken = ACCESS_CONFIG.externalApiTokens.includes(apiToken);
    
    if (isValidToken) {
      console.log(`🔑 [${requestId}] Accès API externe autorisé`);
      
      // Ajouter des métadonnées pour l'API externe
      req.apiClient = {
        authenticated: true,
        clientType: 'external_api',
        ip: clientIP,
        token: apiToken.substring(0, 8) + '...',
        bypassPermissions: true,
        limits: {
          maxFileSize: '100MB',
          maxRowsPerImport: 100000
        }
      };
      
      // Appliquer un rate limiting spécifique pour l'API externe
      const rateKey = `ext:${clientIP}`;
      const now = Date.now();
      const windowMs = 60000; // 1 minute
      
      if (!requestTracker.has(rateKey)) {
        requestTracker.set(rateKey, { timestamps: [now] });
      } else {
        const data = requestTracker.get(rateKey);
        data.timestamps = data.timestamps.filter(t => t > now - windowMs);
        data.timestamps.push(now);
        
        if (data.timestamps.length > 60) { // Max 60 req/min pour API externe
          return res.status(429).json({
            success: false,
            error: 'Rate limit API externe',
            message: 'Trop de requêtes (max 60/minute)',
            retryAfter: 60
          });
        }
        requestTracker.set(rateKey, data);
      }
      
      return next();
    }
  }

  // 2. VÉRIFIER L'AUTHENTIFICATION UTILISATEUR
  if (!req.user) {
    console.log(`❌ [${requestId}] Utilisateur non authentifié`);
    return res.status(401).json({ 
      success: false,
      error: 'Authentification requise',
      message: 'Veuillez vous connecter pour accéder à cette fonctionnalité',
      code: 'UNAUTHENTICATED',
      requestId
    });
  }

  // 3. RÉCUPÉRER ET NORMALISER LE RÔLE
  const rawRole = req.user?.role || req.user?.Role || req.headers['x-user-role'];
  const userRole = normalizeRole(rawRole);
  
  if (!userRole) {
    console.log(`❌ [${requestId}] Rôle utilisateur non défini`);
    return res.status(403).json({ 
      success: false,
      error: 'Rôle non défini',
      message: 'Votre compte ne possède pas de rôle défini. Contactez un administrateur.',
      code: 'UNDEFINED_ROLE',
      requestId
    });
  }

  // 4. DÉFINIR LES PERMISSIONS PAR RÔLE (version enrichie)
  const rolePermissions = {
    'Administrateur': {
      allowed: ['bulk-import', 'import', 'smart-sync', 'filtered', 'admin', 'stream', 'optimized', 'export', 'monitoring', 'diagnostic', 'management'],
      description: 'Accès complet à toutes les fonctionnalités',
      limits: { maxFileSize: '100MB', maxRowsPerImport: 500000, maxRowsPerExport: 1000000 }
    },
    'Superviseur': {
      allowed: ['bulk-import', 'import', 'smart-sync', 'filtered', 'stream', 'optimized', 'export', 'monitoring', 'management'],
      description: 'Import/export avancé et gestion',
      limits: { maxFileSize: '50MB', maxRowsPerImport: 200000, maxRowsPerExport: 500000 }
    },
    'Chef d\'équipe': {
      allowed: ['export', 'stream', 'optimized', 'filtered', 'monitoring'],
      description: 'Export seulement avec options avancées',
      limits: { maxFileSize: '25MB', maxRowsPerImport: 0, maxRowsPerExport: 100000 }
    },
    'Opérateur': {
      allowed: ['export', 'stream'],
      description: 'Export limité',
      limits: { maxFileSize: '10MB', maxRowsPerImport: 0, maxRowsPerExport: 50000 }
    },
    'Consultant': {
      allowed: ['export'],
      description: 'Export simple',
      limits: { maxFileSize: '5MB', maxRowsPerImport: 0, maxRowsPerExport: 10000 }
    }
  };

  // 5. OBTENIR LES PERMISSIONS DU RÔLE
  const userPerms = rolePermissions[userRole] || rolePermissions['Consultant']; // Fallback
  
  // 6. DÉTERMINER LE TYPE DE ROUTE
  const routeType = getRouteType(req.url, req.method);
  
  // 7. VÉRIFIER LES PERMISSIONS SPÉCIFIQUES
  if (!userPerms.allowed.includes('all') && !userPerms.allowed.includes(routeType)) {
    const requirement = getRequiredRoleForRoute(routeType);
    
    console.log(`❌ [${requestId}] Permission refusée: ${userRole} ne peut pas ${routeType}`);
    
    const errorMessages = {
      'bulk-import': 'Les imports massifs sont réservés aux administrateurs et superviseurs.',
      'import': 'Les imports sont réservés aux administrateurs et superviseurs.',
      'smart-sync': 'La synchronisation intelligente est réservée aux administrateurs et superviseurs.',
      'stream': 'L\'export streaming est réservé aux administrateurs, superviseurs et chefs d\'équipe.',
      'optimized': 'L\'export optimisé est réservé aux administrateurs, superviseurs et chefs d\'équipe.',
      'filtered': 'Les exports filtrés avancés sont réservés aux administrateurs et superviseurs.',
      'admin': 'Les fonctionnalités d\'administration sont réservées aux administrateurs.',
      'management': 'La gestion des imports est réservée aux administrateurs et superviseurs.',
      'monitoring': 'Le monitoring est réservé aux administrateurs, superviseurs et chefs d\'équipe.',
      'diagnostic': 'Le diagnostic est réservé aux administrateurs et superviseurs.'
    };
    
    return res.status(403).json({ 
      success: false,
      error: 'Permission refusée',
      message: errorMessages[routeType] || `Votre rôle (${userRole}) ne vous permet pas d'effectuer cette action.`,
      yourRole: userRole,
      requiredRoles: requirement.roles,
      yourPermissions: userPerms.allowed,
      actionType: routeType,
      code: 'FORBIDDEN_ACTION',
      requestId
    });
  }

  // 8. AJOUTER LES INFORMATIONS DE PERMISSIONS
  req.userPermissions = {
    role: userRole,
    rawRole: rawRole,
    allowedActions: userPerms.allowed,
    description: userPerms.description,
    limits: {
      maxFileSize: userPerms.limits.maxFileSize,
      maxRowsPerImport: userPerms.limits.maxRowsPerImport,
      maxRowsPerExport: userPerms.limits.maxRowsPerExport
    }
  };

  console.log(`✅ [${requestId}] Accès autorisé: ${userRole} - ${routeType}`);
  next();
};

// ============================================
// MIDDLEWARE DE RATE LIMITING ADAPTATIF
// ============================================

const applyRateLimit = (req, res, next) => {
  const userRole = normalizeRole(req.user?.role || req.user?.Role);
  const routeType = getRouteType(req.url, req.method);
  const clientIP = req.ip || req.connection.remoteAddress;
  const isExternalApi = !!req.apiClient;
  
  // Routes exemptées
  const isExempt = ACCESS_CONFIG.exemptRoutes.some(route => req.url.includes(route));
  if (isExempt) {
    return next();
  }

  // Pas de rate limiting pour les admins sur certaines routes
  if (userRole === 'Administrateur' && (routeType === 'diagnostic' || routeType === 'monitoring')) {
    return next();
  }

  // Rate limiting adaptatif
  const rateKey = isExternalApi ? `ext:${clientIP}` : `${userRole}:${clientIP}`;
  const now = Date.now();
  const windowMs = ACCESS_CONFIG.rateLimits.windowMs;

  // Obtenir les limites selon le rôle
  let limits;
  if (isExternalApi) {
    limits = { bulk: 10, stream: 30, other: 60 };
  } else {
    const roleMap = {
      'Administrateur': ACCESS_CONFIG.rateLimits.admin,
      'Superviseur': ACCESS_CONFIG.rateLimits.superviseur,
      'Chef d\'équipe': ACCESS_CONFIG.rateLimits.chef,
      'Opérateur': ACCESS_CONFIG.rateLimits.operateur,
      'Consultant': ACCESS_CONFIG.rateLimits.consultant
    };
    limits = roleMap[userRole] || ACCESS_CONFIG.rateLimits.consultant;
  }

  // Déterminer la limite pour ce type de route
  let maxRequests;
  if (routeType === 'bulk-import') maxRequests = limits.bulk;
  else if (routeType === 'stream' || routeType === 'optimized') maxRequests = limits.stream;
  else maxRequests = limits.other;

  // Gérer le compteur
  if (!requestTracker.has(rateKey)) {
    requestTracker.set(rateKey, { timestamps: [now] });
  } else {
    const data = requestTracker.get(rateKey);
    data.timestamps = data.timestamps.filter(t => t > now - windowMs);
    
    if (data.timestamps.length >= maxRequests) {
      const oldest = data.timestamps[0];
      const resetTime = Math.ceil((oldest + windowMs - now) / 1000);
      
      return res.status(429).json({
        success: false,
        error: 'Rate limit dépassé',
        message: `Limite de ${maxRequests} requêtes par 15 minutes atteinte`,
        retryAfter: resetTime,
        limit: maxRequests,
        windowMinutes: 15,
        code: 'RATE_LIMIT_EXCEEDED'
      });
    }
    
    data.timestamps.push(now);
    requestTracker.set(rateKey, data);
  }

  // Ajouter des headers de rate limit
  const data = requestTracker.get(rateKey);
  res.setHeader('X-RateLimit-Limit', maxRequests);
  res.setHeader('X-RateLimit-Remaining', maxRequests - data.timestamps.length);
  res.setHeader('X-RateLimit-Reset', Math.ceil((data.timestamps[0] + windowMs) / 1000));

  next();
};

// ============================================
// MIDDLEWARE DE VALIDATION DES FICHIERS
// ============================================

const validateFileUpload = (req, res, next) => {
  // Vérifier seulement pour les routes d'upload
  if (!req.url.includes('import') || req.method !== 'POST') {
    return next();
  }

  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'Aucun fichier fourni',
      message: 'Veuillez sélectionner un fichier à importer',
      code: 'NO_FILE'
    });
  }

  // Vérifier le type de fichier
  const allowedTypes = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv'
  ];
  
  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: 'Type de fichier non supporté',
      message: 'Seuls les fichiers Excel (.xlsx, .xls) et CSV sont acceptés',
      fileType: req.file.mimetype,
      code: 'INVALID_FILE_TYPE'
    });
  }

  // Vérifier la taille
  const userPerms = req.userPermissions || req.apiClient?.limits || ACCESS_CONFIG.defaultLimits;
  const maxSizeStr = userPerms.maxFileSize || '10MB';
  const maxSizeMB = parseInt(maxSizeStr);
  const fileSizeMB = req.file.size / 1024 / 1024;

  if (fileSizeMB > maxSizeMB) {
    console.log('❌ Fichier trop volumineux:', {
      fileSize: `${fileSizeMB.toFixed(2)}MB`,
      maxAllowed: `${maxSizeMB}MB`,
      user: req.user?.nomUtilisateur || 'external'
    });

    return res.status(400).json({
      success: false,
      error: 'Fichier trop volumineux',
      message: `La taille maximale autorisée est de ${maxSizeMB}MB`,
      fileSize: `${fileSizeMB.toFixed(2)}MB`,
      maxAllowed: `${maxSizeMB}MB`,
      advice: fileSizeMB > 100 ? 'Contactez un administrateur pour les très gros fichiers' : 'Divisez votre fichier en plusieurs parties',
      code: 'FILE_TOO_LARGE'
    });
  }

  // Ajouter des métadonnées
  req.fileMetadata = {
    sizeMB: fileSizeMB,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    uploadTime: new Date().toISOString()
  };

  next();
};

// ============================================
// MIDDLEWARE DE JOURNALISATION
// ============================================

const logImportExportAccess = (req, res, next) => {
  const startTime = Date.now();
  const requestId = req.requestId || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  
  req.requestId = requestId;

  // Journalisation initiale
  console.log(`📨 [${requestId}] Requête import/export:`, {
    method: req.method,
    url: req.url,
    user: req.user?.nomUtilisateur || req.user?.NomUtilisateur || req.apiClient?.clientType || 'anonymous',
    role: req.userPermissions?.role || 'unknown',
    ip: req.ip,
    file: req.file?.originalname || null,
    timestamp: new Date().toISOString()
  });

  // Capturer la réponse
  const originalJson = res.json;
  res.json = function(data) {
    const duration = Date.now() - startTime;
    
    // Journaliser les requêtes importantes
    const isImportant = duration > 2000 || 
                       res.statusCode >= 400 || 
                       req.url.includes('bulk-import') ||
                       req.url.includes('stream') ||
                       (data?.stats?.imported || 0) > 1000;

    if (isImportant) {
      console.log(`📤 [${requestId}] Réponse import/export:`, {
        status: res.statusCode,
        duration: `${duration}ms`,
        success: data?.success || false,
        imported: data?.stats?.imported || 0,
        updated: data?.stats?.updated || 0,
        exported: data?.rowsExported || data?.stats?.exported || 0,
        fileSize: req.fileMetadata?.sizeMB ? `${req.fileMetadata.sizeMB.toFixed(2)}MB` : null,
        user: req.user?.nomUtilisateur || 'anonymous'
      });
    }

    // Ajouter des métadonnées à la réponse
    if (data && typeof data === 'object') {
      data.requestId = requestId;
      data.serverTime = new Date().toISOString();
    }

    return originalJson.call(this, data);
  };

  next();
};

// ============================================
// MIDDLEWARE DE VALIDATION DES PARAMÈTRES
// ============================================

const validateImportParams = (req, res, next) => {
  if (req.method !== 'POST' || !req.url.includes('import')) {
    return next();
  }

  const { source, smartSync } = req.body;

  // Valider la source
  if (source && !['excel', 'csv', 'api', 'manual'].includes(source)) {
    return res.status(400).json({
      success: false,
      error: 'Source invalide',
      message: 'La source doit être excel, csv, api ou manual',
      code: 'INVALID_SOURCE'
    });
  }

  // Valider smartSync
  if (smartSync !== undefined && typeof smartSync !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'Paramètre smartSync invalide',
      message: 'smartSync doit être true ou false',
      code: 'INVALID_SMART_SYNC'
    });
  }

  next();
};

// ============================================
// EXPORTS
// ============================================

module.exports = {
  importExportAccess,
  importExportRateLimit: applyRateLimit,
  logImportExportAccess,
  validateFileUpload,
  validateImportParams,
  
  // Utilitaires exportés
  getRouteType,
  normalizeRole,
  ACCESS_CONFIG
};