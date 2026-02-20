/**
 * Middleware d'authentification pour l'API externe
 * Optimisé pour LWS avec sécurité renforcée
 * Version adaptée avec les nouveaux rôles et coordination
 */

const crypto = require('crypto');
const journalController = require('../Controllers/journalController');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const API_CONFIG = {
  // Tokens autorisés (à charger depuis les variables d'environnement)
  allowedTokens: (process.env.API_TOKENS || "CARTES_API_2025_SECRET_TOKEN_NOV").split(',').map(t => t.trim()),
  
  // Rate limiting
  maxRequestsPerMinute: parseInt(process.env.API_RATE_LIMIT) || 100,
  rateLimitWindow: 60000, // 1 minute en millisecondes
  maxRequestsPerHour: parseInt(process.env.API_RATE_LIMIT_HOUR) || 1000,
  hourWindow: 3600000, // 1 heure en millisecondes
  
  // Sécurité
  minTokenLength: 32,
  tokenRotationDays: 30,
  enableLogging: process.env.NODE_ENV !== 'test',
  
  // Routes publiques (accessibles sans token)
  publicRoutes: [
    'health', 
    'sites', 
    'changes', 
    'cors-test',
    'diagnostic'
  ],
  
  // Routes protégées (nécessitent authentification)
  protectedRoutes: [
    'sync',
    'cartouches',
    'stats',
    'modifications',
    'cartes'
  ],
  
  // Niveaux d'accès par token (pour future extension)
  tokenLevels: {
    'read': ['cartes', 'sites', 'changes', 'stats'],
    'write': ['sync', 'modifications'],
    'admin': ['*']
  }
};

// Stockage pour le rate limiting (IP -> {minute: timestamps[], hour: timestamps[]})
const rateLimitStore = new Map();

// Cache des tokens valides (pour vérification rapide)
const validTokens = new Set(API_CONFIG.allowedTokens);

// Cache des niveaux d'accès par token (si on veut différencier)
const tokenAccessLevel = new Map();

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Nettoie les entrées expirées du rate limiting
 */
const cleanupRateLimit = (clientIP) => {
  const now = Date.now();
  const minuteAgo = now - API_CONFIG.rateLimitWindow;
  const hourAgo = now - API_CONFIG.hourWindow;

  if (rateLimitStore.has(clientIP)) {
    const records = rateLimitStore.get(clientIP);
    
    // Nettoyer les requêtes de plus d'une minute
    records.minute = records.minute.filter(time => time > minuteAgo);
    
    // Nettoyer les requêtes de plus d'une heure
    records.hour = records.hour.filter(time => time > hourAgo);
    
    // Supprimer l'entrée si plus aucune requête
    if (records.minute.length === 0 && records.hour.length === 0) {
      rateLimitStore.delete(clientIP);
    } else {
      rateLimitStore.set(clientIP, records);
    }
  }
};

/**
 * Vérifie les limites de rate
 */
const checkRateLimit = (clientIP) => {
  const now = Date.now();
  
  // Initialiser ou récupérer les enregistrements
  if (!rateLimitStore.has(clientIP)) {
    rateLimitStore.set(clientIP, {
      minute: [],
      hour: []
    });
  }
  
  const records = rateLimitStore.get(clientIP);
  
  // Vérifier limite minute
  if (records.minute.length >= API_CONFIG.maxRequestsPerMinute) {
    return { 
      allowed: false, 
      reason: 'minute',
      limit: API_CONFIG.maxRequestsPerMinute,
      resetTime: records.minute[0] + API_CONFIG.rateLimitWindow
    };
  }
  
  // Vérifier limite heure
  if (records.hour.length >= API_CONFIG.maxRequestsPerHour) {
    return { 
      allowed: false, 
      reason: 'hour',
      limit: API_CONFIG.maxRequestsPerHour,
      resetTime: records.hour[0] + API_CONFIG.hourWindow
    };
  }
  
  // Ajouter la requête actuelle
  records.minute.push(now);
  records.hour.push(now);
  rateLimitStore.set(clientIP, records);
  
  return { allowed: true };
};

/**
 * Génère un nouveau token API (pour l'admin)
 */
const generateApiToken = () => {
  return crypto.randomBytes(32).toString('hex');
};

/**
 * Journalise un accès API
 */
const logAPIAccess = async (req, status, details = {}) => {
  if (!API_CONFIG.enableLogging) return;
  
  try {
    await journalController.logAction({
      utilisateurId: null,
      nomUtilisateur: 'API_EXTERNAL',
      nomComplet: 'API Externe',
      role: 'API',
      agence: null,
      coordination: null,
      action: `Accès API ${req.method} ${req.path}`,
      actionType: 'API_ACCESS',
      tableName: 'api_logs',
      recordId: null,
      oldValue: null,
      newValue: JSON.stringify({
        method: req.method,
        path: req.path,
        query: req.query,
        status,
        ...details
      }),
      ip: req.ip || req.connection.remoteAddress,
      details: `Accès API: ${status}`
    });
  } catch (error) {
    console.error('❌ Erreur journalisation API:', error.message);
  }
};

// ============================================
// MIDDLEWARE PRINCIPAL D'AUTHENTIFICATION API
// ============================================

exports.authenticateAPI = (req, res, next) => {
  const startTime = Date.now();
  const clientIP = req.ip || req.connection.remoteAddress;
  const token = req.headers['x-api-token'] || req.query.api_token;
  
  // Journalisation de la tentative
  console.log('🔐 Tentative d\'accès API externe:', {
    ip: clientIP,
    method: req.method,
    url: req.url,
    path: req.path,
    tokenPresent: !!token,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin || 'undefined',
    timestamp: new Date().toISOString()
  });

  // ✅ ROUTES PUBLIQUES - Identification par pattern
  const pathParts = req.path.split('/').filter(part => part.length > 0);
  const lastSegment = pathParts[pathParts.length - 1] || '';
  const isPublicRoute = API_CONFIG.publicRoutes.includes(lastSegment) || 
                        req.path.includes('/health') || 
                        req.path.includes('/cors-test') ||
                        req.path.includes('/sites');

  // Nettoyage périodique du rate limiting (toutes les 100 requêtes environ)
  if (Math.random() < 0.01) { // 1% de chance
    const keysToClean = Array.from(rateLimitStore.keys());
    keysToClean.forEach(cleanupRateLimit);
  }

  if (isPublicRoute) {
    console.log('✅ Route publique détectée - accès autorisé sans token');
    
    // Même pour les routes publiques, on applique un rate limiting basique
    const rateCheck = checkRateLimit(clientIP);
    if (!rateCheck.allowed) {
      const waitTime = Math.ceil((rateCheck.resetTime - Date.now()) / 1000);
      console.log(`❌ Rate limit public dépassé pour ${clientIP}`);
      
      // Journaliser le dépassement
      logAPIAccess(req, 'RATE_LIMIT_EXCEEDED', { reason: rateCheck.reason });
      
      return res.status(429).json({
        success: false,
        error: 'Trop de requêtes',
        message: `Limite de ${rateCheck.limit} requêtes par ${rateCheck.reason} dépassée`,
        retryAfter: waitTime,
        limit: rateCheck.limit,
        period: rateCheck.reason
      });
    }
    
    // Ajouter des informations de contexte
    req.apiClient = {
      authenticated: false,
      clientType: 'public',
      ip: clientIP,
      timestamp: new Date().toISOString()
    };
    
    // Journaliser l'accès public
    logAPIAccess(req, 'PUBLIC_ACCESS');
    
    return next();
  }

  // Pour les routes protégées, vérifier le token
  if (!token) {
    console.log('❌ Accès API refusé: token manquant');
    
    // Journaliser le refus
    logAPIAccess(req, 'MISSING_TOKEN');
    
    return res.status(401).json({
      success: false,
      error: 'Token API manquant',
      message: 'Utilisez le header X-API-Token ou le paramètre api_token',
      code: 'MISSING_TOKEN'
    });
  }

  // Vérifier la longueur minimale du token
  if (token.length < API_CONFIG.minTokenLength) {
    console.log('❌ Token trop court:', token.length);
    
    logAPIAccess(req, 'INVALID_TOKEN_FORMAT');
    
    return res.status(403).json({
      success: false,
      error: 'Token API invalide',
      message: 'Format de token incorrect',
      code: 'INVALID_TOKEN_FORMAT'
    });
  }

  // Vérifier la validité du token (avec cache)
  if (!validTokens.has(token)) {
    console.log('❌ Accès API refusé: token invalide');
    
    // Journaliser la tentative avec token invalide
    console.warn('⚠️ Tentative avec token invalide:', {
      ip: clientIP,
      token: token.substring(0, 10) + '...',
      path: req.path
    });
    
    logAPIAccess(req, 'INVALID_TOKEN', { tokenPrefix: token.substring(0, 10) });
    
    return res.status(403).json({
      success: false,
      error: 'Token API invalide',
      message: 'Le token fourni n\'est pas reconnu',
      code: 'INVALID_TOKEN'
    });
  }

  // Rate limiting pour les requêtes authentifiées
  const rateCheck = checkRateLimit(clientIP);
  if (!rateCheck.allowed) {
    const waitTime = Math.ceil((rateCheck.resetTime - Date.now()) / 1000);
    console.log(`❌ Rate limit API dépassé pour ${clientIP}`);
    
    logAPIAccess(req, 'RATE_LIMIT_EXCEEDED', { reason: rateCheck.reason });
    
    return res.status(429).json({
      success: false,
      error: 'Trop de requêtes',
      message: `Limite de ${rateCheck.limit} requêtes par ${rateCheck.reason} dépassée`,
      retryAfter: waitTime,
      limit: rateCheck.limit,
      period: rateCheck.reason,
      code: 'RATE_LIMIT_EXCEEDED'
    });
  }

  const duration = Date.now() - startTime;
  
  console.log('✅ Accès API autorisé - Stats:', {
    ip: clientIP,
    requestsThisMinute: rateLimitStore.get(clientIP)?.minute.length || 0,
    requestsThisHour: rateLimitStore.get(clientIP)?.hour.length || 0,
    duration: `${duration}ms`
  });
  
  // Ajouter des informations de contexte à la requête
  req.apiClient = {
    authenticated: true,
    clientType: 'external_api',
    ip: clientIP,
    token: token.substring(0, 8) + '...', // Pour logging uniquement
    timestamp: new Date().toISOString(),
    level: tokenAccessLevel.get(token) || 'read' // Niveau d'accès par défaut
  };

  // Vérifier le niveau d'accès pour cette route
  const routeLevel = API_CONFIG.protectedRoutes.includes(lastSegment) ? 'write' : 'read';
  if (routeLevel === 'write' && req.apiClient.level === 'read') {
    console.log('❌ Niveau d\'accès insuffisant');
    
    logAPIAccess(req, 'INSUFFICIENT_ACCESS', { required: 'write', actual: 'read' });
    
    return res.status(403).json({
      success: false,
      error: 'Niveau d\'accès insuffisant',
      message: 'Ce token n\'a pas les droits d\'écriture',
      code: 'INSUFFICIENT_ACCESS'
    });
  }

  // Journaliser l'accès réussi
  logAPIAccess(req, 'AUTHORIZED');

  next();
};

// ============================================
// MIDDLEWARE DE LOGGING DES ACCÈS API
// ============================================

exports.logAPIAccess = (req, res, next) => {
  const startTime = Date.now();
  const clientIP = req.ip || req.connection.remoteAddress;
  
  // Capturer la méthode json originale
  const originalJson = res.json;
  
  res.json = function(data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;
    
    // Ne logger que si le logging est activé
    if (API_CONFIG.enableLogging) {
      const logLevel = statusCode >= 400 ? 'warn' : 'info';
      const logMessage = statusCode >= 400 ? '⚠️' : '📊';
      
      console.log(`${logMessage} Accès API externe:`, {
        method: req.method,
        url: req.url,
        statusCode,
        duration: `${duration}ms`,
        clientIP,
        authenticated: req.apiClient?.authenticated || false,
        userAgent: req.headers['user-agent']?.substring(0, 50),
        timestamp: new Date().toISOString()
      });
      
      // Logs plus détaillés pour les erreurs
      if (statusCode >= 500) {
        console.error('❌ Erreur serveur API:', {
          error: data?.error || 'Unknown error',
          path: req.path,
          clientIP
        });
      }
    }
    
    // Ajouter des headers de rate limiting
    if (req.apiClient) {
      const records = rateLimitStore.get(clientIP);
      if (records) {
        res.setHeader('X-RateLimit-Limit-Minute', API_CONFIG.maxRequestsPerMinute);
        res.setHeader('X-RateLimit-Remaining-Minute', Math.max(0, API_CONFIG.maxRequestsPerMinute - records.minute.length));
        res.setHeader('X-RateLimit-Limit-Hour', API_CONFIG.maxRequestsPerHour);
        res.setHeader('X-RateLimit-Remaining-Hour', Math.max(0, API_CONFIG.maxRequestsPerHour - records.hour.length));
      }
    }
    
    // Ajouter des headers de sécurité
    res.setHeader('X-API-Version', '3.0.0-lws');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    
    // Ajouter timestamp à la réponse
    if (data && typeof data === 'object') {
      data.serverTimestamp = new Date().toISOString();
    }
    
    return originalJson.call(this, data);
  };
  
  next();
};

// ============================================
// MIDDLEWARE DE VALIDATION DES PARAMÈTRES API
// ============================================

exports.validateApiParams = (req, res, next) => {
  const { site, limit, page, since } = req.query;
  
  // Valider le paramètre site si présent
  if (site && typeof site === 'string') {
    // Nettoyer le site
    req.query.site = site.trim();
    
    // Vérifier que le site n'est pas vide après nettoyage
    if (req.query.site === '') {
      delete req.query.site;
    }
  }
  
  // Valider le paramètre limit
  if (limit) {
    const limitNum = parseInt(limit);
    if (isNaN(limitNum) || limitNum <= 0) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre limit invalide',
        message: 'Le paramètre limit doit être un nombre positif',
        code: 'INVALID_LIMIT'
      });
    }
    
    // Limiter à une valeur raisonnable
    req.query.limit = Math.min(limitNum, 10000);
  }
  
  // Valider le paramètre page
  if (page) {
    const pageNum = parseInt(page);
    if (isNaN(pageNum) || pageNum < 1) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre page invalide',
        message: 'Le paramètre page doit être un nombre >= 1',
        code: 'INVALID_PAGE'
      });
    }
  }
  
  // Valider le paramètre since (date)
  if (since) {
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre since invalide',
        message: 'Le paramètre since doit être une date valide (ISO 8601)',
        code: 'INVALID_DATE'
      });
    }
  }
  
  next();
};

// ============================================
// MIDDLEWARE DE SÉCURITÉ SUPPLÉMENTAIRE
// ============================================

exports.securityHeaders = (req, res, next) => {
  // Ajouter des en-têtes de sécurité
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  
  // Cache control pour les réponses API
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  
  // CORS pour les routes API
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Token');
  
  next();
};

// ============================================
// MIDDLEWARE DE GESTION DES ERREURS API
// ============================================

exports.errorHandler = (err, req, res, next) => {
  console.error('❌ Erreur API:', err);
  
  // Journaliser l'erreur
  logAPIAccess(req, 'ERROR', { error: err.message });
  
  res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Une erreur est survenue',
    code: 'INTERNAL_ERROR',
    requestId: req.id
  });
};

// ============================================
// FONCTIONS ADMINISTRATIVES (pour gestion des tokens)
// ============================================

/**
 * Ajouter un nouveau token (admin uniquement)
 */
exports.addToken = (newToken, level = 'read') => {
  if (newToken && newToken.length >= API_CONFIG.minTokenLength) {
    validTokens.add(newToken);
    tokenAccessLevel.set(newToken, level);
    
    // Mettre à jour la configuration
    if (!API_CONFIG.allowedTokens.includes(newToken)) {
      API_CONFIG.allowedTokens.push(newToken);
    }
    
    console.log(`✅ Nouveau token API ajouté (niveau: ${level})`);
    return true;
  }
  return false;
};

/**
 * Révoquer un token (admin uniquement)
 */
exports.revokeToken = (token) => {
  if (validTokens.has(token)) {
    validTokens.delete(token);
    tokenAccessLevel.delete(token);
    
    // Retirer de la liste des tokens autorisés
    const index = API_CONFIG.allowedTokens.indexOf(token);
    if (index > -1) {
      API_CONFIG.allowedTokens.splice(index, 1);
    }
    
    console.log('✅ Token API révoqué');
    return true;
  }
  return false;
};

/**
 * Générer un nouveau token aléatoire
 */
exports.generateToken = generateApiToken;

/**
 * Obtenir les statistiques d'utilisation
 */
exports.getStats = () => {
  const stats = {
    totalActiveTokens: validTokens.size,
    activeIPs: rateLimitStore.size,
    requestsLastMinute: 0,
    requestsLastHour: 0,
    topIPs: []
  };
  
  // Calculer les requêtes totales
  rateLimitStore.forEach((records, ip) => {
    stats.requestsLastMinute += records.minute.length;
    stats.requestsLastHour += records.hour.length;
    
    stats.topIPs.push({
      ip,
      requestsMinute: records.minute.length,
      requestsHour: records.hour.length
    });
  });
  
  // Trier par requêtes
  stats.topIPs.sort((a, b) => b.requestsHour - a.requestsHour);
  stats.topIPs = stats.topIPs.slice(0, 10);
  
  return stats;
};

/**
 * Nettoyer le rate limiting pour une IP
 */
exports.clearRateLimit = (ip) => {
  if (ip) {
    rateLimitStore.delete(ip);
  } else {
    rateLimitStore.clear();
  }
  console.log('✅ Rate limit nettoyé');
};

// Exporter la configuration pour utilisation externe
exports.API_CONFIG = API_CONFIG;