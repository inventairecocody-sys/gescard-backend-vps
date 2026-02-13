// ============================================
// MIDDLEWARE GLOBAL - OPTIMISÉ POUR LWS
// ============================================

const fs = require('fs');
const path = require('path');
const os = require('os');

// ============================================
// CONFIGURATION
// ============================================
const CONFIG = {
  // Journalisation
  logToFile: process.env.NODE_ENV === 'production',
  logDirectory: path.join(__dirname, '../logs'),
  maxLogSize: 10 * 1024 * 1024, // 10MB
  maxLogFiles: 5,
  
  // Performance
  slowRequestThreshold: 1000, // ms
  verySlowRequestThreshold: 5000, // ms
  
  // Sécurité
  maskSensitiveData: true,
  sensitiveHeaders: ['authorization', 'cookie', 'x-api-token'],
  sensitiveFields: ['password', 'token', 'MotDePasse', 'newPassword'],
  
  // Monitoring
  trackMemory: true,
  memoryWarningThreshold: 80, // % d'utilisation
  trackCPU: true
};

// Assurer que le dossier de logs existe
if (CONFIG.logToFile && !fs.existsSync(CONFIG.logDirectory)) {
  fs.mkdirSync(CONFIG.logDirectory, { recursive: true });
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Formate la durée en millisecondes
 */
function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}min`;
}

/**
 * Masque les données sensibles
 */
function maskSensitiveData(obj, depth = 0) {
  if (!obj || typeof obj !== 'object' || depth > 3) return obj;
  
  const masked = Array.isArray(obj) ? [...obj] : { ...obj };
  
  for (const key in masked) {
    if (CONFIG.sensitiveFields.includes(key)) {
      masked[key] = '********';
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskSensitiveData(masked[key], depth + 1);
    }
  }
  
  return masked;
}

/**
 * Formate les headers pour le log (masque les sensibles)
 */
function formatHeaders(headers) {
  const safeHeaders = { ...headers };
  CONFIG.sensitiveHeaders.forEach(header => {
    if (safeHeaders[header]) {
      safeHeaders[header] = '********';
    }
  });
  return safeHeaders;
}

/**
 * Obtient les statistiques mémoire
 */
function getMemoryStats() {
  const memUsage = process.memoryUsage();
  const totalMemory = os.totalmem();
  const freeMemory = os.freemem();
  
  return {
    heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
    heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
    rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
    external: `${Math.round(memUsage.external / 1024 / 1024)}MB`,
    systemTotal: `${Math.round(totalMemory / 1024 / 1024)}MB`,
    systemFree: `${Math.round(freeMemory / 1024 / 1024)}MB`,
    systemUsedPercent: Math.round(((totalMemory - freeMemory) / totalMemory) * 100)
  };
}

/**
 * Écrit un log dans le fichier
 */
function writeToFile(logEntry) {
  if (!CONFIG.logToFile) return;
  
  const date = new Date().toISOString().split('T')[0];
  const logFile = path.join(CONFIG.logDirectory, `app-${date}.log`);
  
  // Vérifier la taille du fichier
  if (fs.existsSync(logFile)) {
    const stats = fs.statSync(logFile);
    if (stats.size > CONFIG.maxLogSize) {
      // Rotation du fichier
      const files = fs.readdirSync(CONFIG.logDirectory)
        .filter(f => f.startsWith(`app-${date}`))
        .sort();
      
      if (files.length >= CONFIG.maxLogFiles) {
        // Supprimer le plus ancien
        const oldest = files[0];
        fs.unlinkSync(path.join(CONFIG.logDirectory, oldest));
      }
      
      // Renommer le fichier actuel
      const newName = `app-${date}-${Date.now()}.log`;
      fs.renameSync(logFile, path.join(CONFIG.logDirectory, newName));
    }
  }
  
  fs.appendFileSync(logFile, logEntry + '\n');
}

// ============================================
// MIDDLEWARE PRINCIPAL - LOGGER
// ============================================

/**
 * Logger principal avec métriques avancées
 */
function logger(req, res, next) {
  const startTime = process.hrtime();
  const requestId = Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  
  // Stocker l'ID de requête pour les middlewares suivants
  req.requestId = requestId;
  
  // Capturer les informations de base
  const logData = {
    requestId,
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.headers['user-agent'],
    referer: req.headers.referer || req.headers.referrer,
    origin: req.headers.origin
  };

  // Capturer les stats système au début
  const startMemory = CONFIG.trackMemory ? process.memoryUsage() : null;
  const startCpu = CONFIG.trackCPU ? process.cpuUsage() : null;

  // Journalisation de la requête entrante
  console.log(`📥 [${requestId}] ${req.method} ${req.url} - IP: ${logData.ip}`);

  // Écrire dans le fichier si nécessaire
  if (CONFIG.logToFile) {
    writeToFile(`REQ ${JSON.stringify({
      ...logData,
      headers: formatHeaders(req.headers),
      query: CONFIG.maskSensitiveData ? maskSensitiveData(req.query) : req.query,
      body: req.method !== 'GET' && CONFIG.maskSensitiveData ? maskSensitiveData(req.body) : undefined
    })}`);
  }

  // Capturer la réponse
  const originalEnd = res.end;
  const originalJson = res.json;
  const originalSend = res.send;

  let responseBody = null;
  let responseSize = 0;

  // Intercepter res.json
  res.json = function(data) {
    responseBody = data;
    responseSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    return originalJson.apply(this, arguments);
  };

  // Intercepter res.send
  res.send = function(data) {
    responseBody = data;
    if (typeof data === 'string') {
      responseSize = Buffer.byteLength(data, 'utf8');
    } else if (Buffer.isBuffer(data)) {
      responseSize = data.length;
    } else {
      responseSize = Buffer.byteLength(JSON.stringify(data), 'utf8');
    }
    return originalSend.apply(this, arguments);
  };

  // Intercepter res.end
  res.end = function(chunk, encoding) {
    // Calculer la durée
    const diff = process.hrtime(startTime);
    const durationMs = (diff[0] * 1e9 + diff[1]) / 1e6;
    
    // Calculer les stats de fin
    const endMemory = CONFIG.trackMemory ? process.memoryUsage() : null;
    const endCpu = CONFIG.trackCPU ? process.cpuUsage(startCpu) : null;
    
    // Préparer les métriques
    const metrics = {
      duration: formatDuration(durationMs),
      durationMs: Math.round(durationMs * 100) / 100,
      statusCode: res.statusCode,
      responseSize: responseSize ? `${(responseSize / 1024).toFixed(2)}KB` : '0KB'
    };

    // Ajouter les métriques mémoire si activé
    if (CONFIG.trackMemory && startMemory && endMemory) {
      metrics.memory = {
        heapUsedDelta: `${Math.round((endMemory.heapUsed - startMemory.heapUsed) / 1024 / 1024)}MB`,
        heapUsedFinal: `${Math.round(endMemory.heapUsed / 1024 / 1024)}MB`
      };
      
      // Alerte si mémoire trop utilisée
      const memoryPercent = Math.round((endMemory.heapUsed / endMemory.heapTotal) * 100);
      if (memoryPercent > CONFIG.memoryWarningThreshold) {
        console.warn(`⚠️ [${requestId}] Mémoire élevée: ${memoryPercent}%`);
      }
    }

    // Ajouter les métriques CPU si activé
    if (CONFIG.trackCPU && endCpu) {
      metrics.cpu = {
        user: `${Math.round(endCpu.user / 1000)}ms`,
        system: `${Math.round(endCpu.system / 1000)}ms`
      };
    }

    // Détecter les requêtes lentes
    if (durationMs > CONFIG.verySlowRequestThreshold) {
      console.warn(`🐢 [${requestId}] REQUÊTE TRÈS LENTE: ${metrics.duration}`);
      metrics.slowWarning = 'VERY_SLOW';
    } else if (durationMs > CONFIG.slowRequestThreshold) {
      console.warn(`🐢 [${requestId}] Requête lente: ${metrics.duration}`);
      metrics.slowWarning = 'SLOW';
    }

    // Journalisation de la réponse
    const logLevel = res.statusCode >= 500 ? '❌' : 
                     res.statusCode >= 400 ? '⚠️' : 
                     '✅';
    
    console.log(`${logLevel} [${requestId}] ${req.method} ${req.url} - ${res.statusCode} - ${metrics.duration} - ${metrics.responseSize}`);

    // Logs détaillés pour les erreurs
    if (res.statusCode >= 400) {
      console.log(`📋 [${requestId}] Détails erreur:`, {
        method: req.method,
        url: req.url,
        status: res.statusCode,
        user: req.user?.NomUtilisateur || req.user?.nomUtilisateur || 'anonymous',
        ip: req.ip
      });
    }

    // Écrire dans le fichier si nécessaire
    if (CONFIG.logToFile) {
      writeToFile(`RES ${JSON.stringify({
        requestId,
        ...metrics,
        user: req.user?.NomUtilisateur || req.user?.nomUtilisateur
      })}`);
    }

    originalEnd.call(this, chunk, encoding);
  };

  next();
}

// ============================================
// MIDDLEWARES COMPLÉMENTAIRES
// ============================================

/**
 * Middleware de compression des réponses
 */
function compressionMiddleware(req, res, next) {
  const acceptEncoding = req.headers['accept-encoding'] || '';
  
  if (acceptEncoding.includes('gzip')) {
    res.setHeader('Content-Encoding', 'gzip');
    // Note: La compression réelle doit être faite par compression() de Express
  }
  
  next();
}

/**
 * Middleware de cache-control
 */
function cacheControl(duration = 0) {
  return (req, res, next) => {
    if (duration > 0) {
      res.setHeader('Cache-Control', `public, max-age=${duration}`);
    } else {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
    next();
  };
}

/**
 * Middleware de limitation de taille de requête
 */
function requestSizeLimiter(maxSize = '10mb') {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0');
    const maxBytes = parseSize(maxSize);
    
    if (contentLength > maxBytes) {
      return res.status(413).json({
        success: false,
        error: 'Requête trop volumineuse',
        message: `Taille maximum: ${maxSize}`,
        received: `${(contentLength / 1024 / 1024).toFixed(2)}MB`
      });
    }
    
    next();
  };
}

/**
 * Parse une taille en bytes
 */
function parseSize(size) {
  const units = {
    'b': 1,
    'kb': 1024,
    'mb': 1024 * 1024,
    'gb': 1024 * 1024 * 1024
  };
  
  const match = size.toLowerCase().match(/^(\d+)([a-z]+)$/);
  if (!match) return 10 * 1024 * 1024; // 10MB par défaut
  
  const [, value, unit] = match;
  return parseInt(value) * (units[unit] || units['mb']);
}

/**
 * Middleware de validation de type de contenu
 */
function expectContentType(contentType) {
  return (req, res, next) => {
    if (req.method === 'POST' || req.method === 'PUT') {
      const receivedType = req.headers['content-type'] || '';
      
      if (!receivedType.includes(contentType)) {
        return res.status(415).json({
          success: false,
          error: 'Type de contenu non supporté',
          message: `Content-Type doit être ${contentType}`,
          received: receivedType
        });
      }
    }
    next();
  };
}

/**
 * Middleware de santé du serveur
 */
function healthCheck(req, res, next) {
  if (req.path === '/health' || req.path === '/api/health') {
    const memory = getMemoryStats();
    const uptime = process.uptime();
    
    return res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      memory,
      nodeVersion: process.version,
      environment: process.env.NODE_ENV || 'development'
    });
  }
  
  next();
}

/**
 * Middleware de nettoyage des requêtes
 */
function sanitizeRequest(req, res, next) {
  // Nettoyer les paramètres de requête
  if (req.query) {
    Object.keys(req.query).forEach(key => {
      if (typeof req.query[key] === 'string') {
        req.query[key] = req.query[key].trim();
      }
    });
  }
  
  // Nettoyer le corps de la requête
  if (req.body && typeof req.body === 'object') {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = req.body[key].trim();
      }
    });
  }
  
  next();
}

/**
 * Middleware de monitoring des performances
 */
function performanceMonitor(req, res, next) {
  const startMemory = process.memoryUsage();
  
  res.on('finish', () => {
    const endMemory = process.memoryUsage();
    const memoryDiff = {
      heapUsed: endMemory.heapUsed - startMemory.heapUsed,
      heapTotal: endMemory.heapTotal - startMemory.heapTotal
    };
    
    // Alerte si consommation mémoire anormale
    if (memoryDiff.heapUsed > 50 * 1024 * 1024) { // 50MB
      console.warn(`⚠️ Forte consommation mémoire pour ${req.method} ${req.url}:`, {
        diff: `${Math.round(memoryDiff.heapUsed / 1024 / 1024)}MB`
      });
    }
  });
  
  next();
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  // Middleware principal
  logger,
  
  // Middlewares complémentaires
  compressionMiddleware,
  cacheControl,
  requestSizeLimiter,
  expectContentType,
  healthCheck,
  sanitizeRequest,
  performanceMonitor,
  
  // Utilitaires
  getMemoryStats,
  formatDuration,
  CONFIG
};