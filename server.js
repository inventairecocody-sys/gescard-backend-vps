// ========== SERVER.JS (SÉCURISÉ) ==========
const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const compression = require('compression');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

dotenv.config();

const { query } = require('./db/db');

// Import des middlewares
const journalRequetes = require('./middleware/journalRequetes');
const { securityHeaders } = require('./middleware/apiAuth');
const { securityMiddleware, getSecurityStats } = require('./middleware/securityMiddleware');
const {
  authLimiter,
  apiLimiter,
  uploadLimiter,
  exportLimiter,
  updatesLimiter,
} = require('./middleware/rateLimiters');

// Import des routes
const authRoutes = require('./routes/authRoutes');
const cartesRoutes = require('./routes/Cartes');
const importExportRoutes = require('./routes/ImportExport');
const journalRoutes = require('./routes/journal');
const logRoutes = require('./routes/log');
const utilisateursRoutes = require('./routes/utilisateurs');
const profilRoutes = require('./routes/profils');
const inventaireRoutes = require('./routes/Inventaire');
const statistiquesRoutes = require('./routes/statistiques');
const externalApiRoutes = require('./routes/externalApi');
const backupRoutes = require('./routes/backupRoutes');
const syncRoutes = require('./routes/syncRoutes');
const updatesRoutes = require('./routes/Updatesroutes');
const coordinationsRoutes = require('./routes/coordinations');
const sitesRoutes = require('./routes/sites');
const agencesRoutes = require('./routes/agences');
const initFileRoutes = require('./routes/initFileRoutes');
const rapportsRoutes = require('./routes/rapports_routes');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('trust proxy', 1);

// ========== CRÉATION DES DOSSIERS NÉCESSAIRES ==========
const dirs = ['uploads', 'logs', 'backups'];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Dossier ${dir} créé`);
  }
});

// ========== CONFIGURATION BACKUP AUTOMATIQUE ==========
async function setupBackupSystem() {
  console.log('🔧 Configuration du système de backup...');

  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_REFRESH_TOKEN) {
    console.log('⚠️  Système de backup désactivé (tokens Google manquants)');
    return;
  }

  try {
    const PostgreSQLBackup = require('./backup-postgres');
    const backupService = new PostgreSQLBackup();

    const { Client } = require('pg');
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    await client.connect();
    const result = await client.query('SELECT COUNT(*) as count FROM cartes');
    const carteCount = parseInt(result.rows[0].count);
    await client.end();

    console.log(`📊 Base de données: ${carteCount} cartes trouvées`);

    cron.schedule('0 2 * * *', async () => {
      console.log('⏰ Backup automatique programmé...');
      try {
        await backupService.executeBackup();
        console.log('✅ Backup automatique réussi');
      } catch (error) {
        console.error('❌ Backup automatique échoué:', error.message);
      }
    });

    console.log('✅ Système de backup configuré (tous les jours à 2h)');
  } catch (error) {
    console.error('⚠️ Erreur configuration backup:', error.message);
  }
}

// ========== 1. JOURNAL DES REQUÊTES (PREMIER, TOUJOURS) ==========
app.use(journalRequetes);

// ========== 2. SÉCURITÉ — BLOCAGE IMMÉDIAT (AVANT TOUT) ==========
// Doit être AVANT helmet/cors pour intercepter les scanners sans overhead
app.use(securityMiddleware);

// ========== 3. HELMET — HEADERS HTTP SÉCURISÉS ==========
app.use(
  helmet({
    // CSP activé (désactivé avant — risque XSS)
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // unsafe-inline nécessaire pour certains frameworks
        imgSrc: ["'self'", 'data:', 'blob:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    hidePoweredBy: true,
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  })
);

app.use(securityHeaders);

// ========== 4. COMPRESSION ==========
app.use(
  compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
      if (req.headers['x-no-compression']) return false;
      if (req.url.includes('/export') && req.method === 'GET') return false;
      return compression.filter(req, res);
    },
  })
);

// ========== 5. RATE LIMITING PAR ROUTE ==========
// Auth — strictissime (anti brute-force)
app.use('/api/auth', authLimiter);

// Updates — permissif (app desktop)
app.use('/api/updates', updatesLimiter);

// Upload/Import — limité
app.use('/api/import-export', uploadLimiter);
app.use('/api/sync/upload', uploadLimiter);

// Export/Rapports — modéré
app.use('/api/rapports', exportLimiter);
app.use('/api/import-export/export', exportLimiter);

// Toutes les autres routes API — raisonnable (300/15min au lieu de 5000)
app.use('/api', apiLimiter);

// ========== 6. CONFIGURATION CORS ==========
const allowedOrigins = [
  'https://gescardcocody.netlify.app',
  'http://gescardcocody.com',
  'https://gescardcocody.com',
  'http://www.gescardcocody.com',
  'https://www.gescardcocody.com',
  /\.gescardcocody\.com$/,
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

const corsOptions = {
  origin: function (origin, callback) {
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    if (!origin) return callback(null, true);

    const allowed = allowedOrigins.some((pattern) => {
      if (typeof pattern === 'string') return pattern === origin;
      return pattern.test(origin);
    });

    if (allowed) {
      callback(null, true);
    } else {
      console.warn(`🚫 Origine CORS bloquée: ${origin}`);
      callback(new Error(`Origine "${origin}" non autorisée par CORS`));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'X-API-Token',
    'X-Request-ID',
  ],
  exposedHeaders: [
    'Content-Disposition',
    'X-Request-ID',
    'X-User-Role',
    'X-User-Coordination',
    'Content-Type',
    'Content-Length',
    'Filename',
  ],
  maxAge: 86400,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

// ========== 7. BODY PARSER — LIMITES STRICTES PAR ROUTE ==========
// ⚠️ CORRIGÉ : 200MB global était dangereux (attaque DoS par payload géant)
// Routes générales : 1MB suffisant
app.use((req, res, next) => {
  // Routes d'upload légitimes → 200MB
  const bigRoutes = [
    '/api/import-export',
    '/api/sync/upload',
    '/api/backup',
    '/api/updates/download',
  ];
  const isBigRoute = bigRoutes.some((r) => req.path.startsWith(r));
  const limit = isBigRoute ? '200mb' : '1mb';
  return express.json({ limit })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ========== 8. LOGGING ==========
const morganFormat = process.env.NODE_ENV === 'production' ? 'combined' : 'dev';
const accessLogStream = fs.createWriteStream(path.join(__dirname, 'logs', 'access.log'), {
  flags: 'a',
});

app.use(
  morgan(morganFormat, {
    stream: accessLogStream,
    skip: (req) => req.method === 'OPTIONS' || req.url.includes('/health'),
  })
);

app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (duration > 1000 || res.statusCode >= 400) {
      console.log(
        `📊 ${req.method} ${req.url} - ${duration}ms - ${res.statusCode} - ID: ${req.idRequete}`
      );
    }
  });
  next();
});

// ========== ROUTES PUBLIQUES ==========

app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await query('SELECT 1 as ok, current_database() as db, NOW() as time');
    const countResult = await query('SELECT COUNT(*) as total FROM cartes');
    const memory = process.memoryUsage();
    const secStats = getSecurityStats();

    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      requestId: req.idRequete,
      database: {
        connected: true,
        name: dbResult.rows[0].db,
        server_time: dbResult.rows[0].time,
      },
      data: {
        total_cartes: parseInt(countResult.rows[0].total),
      },
      memory: {
        rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        heapUsed: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        heapTotal: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
      },
      environment: process.env.NODE_ENV || 'development',
      uptime: Math.round(process.uptime()) + 's',
      // Stats sécurité visibles uniquement en production pour monitoring
      security: process.env.NODE_ENV === 'production' ? secStats : undefined,
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
      requestId: req.idRequete,
    });
  }
});

app.get('/api/test-db', async (req, res) => {
  try {
    const result = await query('SELECT version() as pg_version, NOW() as server_time');
    res.json({
      success: true,
      database: 'PostgreSQL',
      version: result.rows[0].pg_version.split(',')[0],
      server_time: result.rows[0].server_time,
      request_id: req.idRequete,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message, request_id: req.idRequete });
  }
});

app.get('/api/cors-test', (req, res) => {
  res.json({
    message: 'CORS test successful',
    your_origin: req.headers.origin || 'not specified',
    allowed_origins: allowedOrigins.filter((o) => typeof o === 'string'),
    cors_enabled: true,
    requestId: req.idRequete,
  });
});

// ========== MONTAGE DES ROUTES ==========
app.use('/api/auth', authRoutes);
app.use('/api/utilisateurs', utilisateursRoutes);
app.use('/api/cartes', cartesRoutes);
app.use('/api/inventaire', inventaireRoutes);
app.use('/api/import-export', importExportRoutes);
app.use('/api/journal', journalRoutes);
app.use('/api/log', logRoutes);
app.use('/api/profil', profilRoutes);
app.use('/api/statistiques', statistiquesRoutes);
app.use('/api/external', externalApiRoutes);
app.use('/api/backup', backupRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/updates', updatesRoutes);
app.use('/api/coordinations', coordinationsRoutes);
app.use('/api/sites', sitesRoutes);
app.use('/api/agences', agencesRoutes);
app.use('/api/init-file', initFileRoutes);
app.use('/api/rapports', rapportsRoutes);

// ========== ROUTE RACINE ==========
app.get('/', (req, res) => {
  res.json({
    message: 'API GESCARD PostgreSQL',
    version: '3.2.1',
    environment: process.env.NODE_ENV || 'development',
    health_check: `${req.protocol}://${req.get('host')}/api/health`,
    requestId: req.idRequete,
  });
});

// ========== GESTION DES ERREURS ==========
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    requested: `${req.method} ${req.url}`,
    request_id: req.idRequete,
  });
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  console.error('❌ Error:', {
    message: err.message,
    url: req.url,
    method: req.method,
    request_id: req.idRequete,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'CORS error',
      error: 'Origin not allowed',
      request_id: req.idRequete,
    });
  }
  if (err.statusCode === 429 || err.status === 429) {
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded',
      request_id: req.idRequete,
    });
  }
  if (err.message && err.message.includes('too large')) {
    return res.status(413).json({
      success: false,
      message: 'Payload trop volumineux',
      request_id: req.idRequete,
    });
  }
  if (err.name === 'JsonWebTokenError') {
    return res.status(401).json({
      success: false,
      message: 'Token invalide',
      error: 'JWT_INVALID',
      request_id: req.idRequete,
    });
  }
  if (err.name === 'TokenExpiredError') {
    return res.status(401).json({
      success: false,
      message: 'Token expiré',
      error: 'JWT_EXPIRED',
      request_id: req.idRequete,
    });
  }
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Fichier trop volumineux',
      request_id: req.idRequete,
    });
  }

  const errorResponse = {
    success: false,
    message: 'Internal server error',
    request_id: req.idRequete,
    timestamp: new Date().toISOString(),
  };
  if (process.env.NODE_ENV === 'development') errorResponse.error = err.message;

  res.status(err.status || 500).json(errorResponse);
});

// ========== LANCEMENT DU SERVEUR ==========
const server = app.listen(PORT, async () => {
  console.log('\n🚀 =====================================');
  console.log(`🚀 GESCARD API démarrée sur le port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡ PID: ${process.pid}`);
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log('🚀 =====================================\n');

  await setupBackupSystem();

  console.log('\n📋 Configuration sécurité:');
  console.log('• Body limit (général)   : 1MB');
  console.log('• Body limit (upload)    : 200MB');
  console.log('• Rate limit (auth)      : 10 req/15min');
  console.log('• Rate limit (API)       : 300 req/15min');
  console.log('• Rate limit (uploads)   : 20/15min');
  console.log('• Rate limit (exports)   : 50/heure');
  console.log('• Ban auto IPs           : ✅ ACTIVE (5 violations → 1h ban)');
  console.log('• Blocklist paths        : ✅ ACTIVE (30+ patterns)');
  console.log('• CSP                    : ✅ ACTIVE');
  console.log('• HSTS                   : ✅ ACTIVE');
  console.log('• Logs                   : /logs/access.log\n');
});

server.keepAliveTimeout = 300000;
server.headersTimeout = 310000;

process.on('SIGTERM', () => {
  console.log('🛑 SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('🛑 SIGINT received, shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  setTimeout(() => process.exit(1), 1000);
});

module.exports = app;
