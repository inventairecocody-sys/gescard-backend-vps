const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const compression = require('compression');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const morgan = require('morgan');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

dotenv.config();

const { query } = require('./db/db');

// Import des middlewares
const journalRequetes = require('./middleware/journalRequetes');
const { securityHeaders } = require('./middleware/apiAuth');

// ========== MIDDLEWARE DE SÉCURITÉ SUPPLÉMENTAIRE ==========
// Protection contre les tentatives d'accès aux fichiers sensibles
const securityMiddleware = (req, res, next) => {
  // Bloquer les tentatives d'accès aux fichiers sensibles
  const blockedPaths = ['.env', 'config', '.git', 'wp-admin', 'wp-content', 'php', 'sql'];

  if (blockedPaths.some((path) => req.url.toLowerCase().includes(path))) {
    console.warn(`🚨 Tentative d'accès bloquée: ${req.url} de ${req.ip}`);
    return res.status(403).json({
      success: false,
      message: 'Accès interdit',
      code: 'FORBIDDEN_PATH',
      request_id: req.idRequete,
    });
  }
  next();
};

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

const app = express();
const PORT = process.env.PORT || 3000;

// ========== CRÉATION DES DOSSIERS NÉCESSAIRES ==========
const dirs = ['uploads', 'logs', 'backups'];
dirs.forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`📁 Dossier ${dir} créé`);
  }
});

// ========== MIDDLEWARE DE JOURNALISATION DES REQUÊTES (PREMIER) ==========
app.use(journalRequetes);

// ========== MIDDLEWARE DE SÉCURITÉ ==========
app.use(securityMiddleware);

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

    // Vérifier si la base est vide (nouvelle installation)
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

    // Backup automatique tous les jours à 2h du matin
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

// ========== MIDDLEWARES DE SÉCURITÉ ==========
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'cross-origin' },
    hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
    hidePoweredBy: true,
    noSniff: true,
    xssFilter: true,
  })
);

// Headers de sécurité supplémentaires
app.use(securityHeaders);

// Compression GZIP
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

// Rate Limiting (assoupli pour VPS)
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5000,
  message: {
    success: false,
    error: 'Limite de requêtes atteinte',
    message: 'Trop de requêtes effectuées. Veuillez réessayer dans 15 minutes.',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Routes exemptées du rate limiting
const noLimitRoutes = ['/api/health', '/api/test-db', '/api/cors-test'];

app.use((req, res, next) => {
  const isExempt = noLimitRoutes.some((route) => req.path.startsWith(route));
  if (isExempt) return next();
  return limiter(req, res, next);
});

// ========== CONFIGURATION CORS ==========
const allowedOrigins = [
  'https://gescardcocody.netlify.app',
  'http://gescardcocody.com',
  'https://gescardcocody.com',
  'http://www.gescarcocody.com',
  'https://www.gescarcocody.com',
  /\.gescardcocody\.com$/, // Accepte tous les sous-domaines
  'http://localhost:5173',
  'http://localhost:3000',
  'http://localhost:5174',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:3000',
];

const corsOptions = {
  origin: function (origin, callback) {
    // En développement, tout accepter
    if (process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }

    // Si pas d'origine (appel serveur à serveur), accepter
    if (!origin) return callback(null, true);

    // Vérification avec regex et liste
    const allowed = allowedOrigins.some((pattern) => {
      if (typeof pattern === 'string') {
        return pattern === origin;
      }
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

// ========== CONFIGURATION BODY PARSER ==========
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));

// ========== LOGGING ==========
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

// Middleware de logging personnalisé
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

// Route de santé
app.get('/api/health', async (req, res) => {
  try {
    const dbResult = await query('SELECT 1 as ok, current_database() as db, NOW() as time');
    const countResult = await query('SELECT COUNT(*) as total FROM cartes');

    const memory = process.memoryUsage();

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
      roles: {
        administrateur: 'Accès complet',
        gestionnaire: 'Accès limité à sa coordination',
        chef_equipe: 'Accès inventaire uniquement (3 colonnes)',
        operateur: 'Lecture seule',
      },
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

// Route de test DB
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
    res.status(500).json({
      success: false,
      error: error.message,
      request_id: req.idRequete,
    });
  }
});

// Test CORS
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

// ========== ROUTE RACINE ==========
app.get('/', (req, res) => {
  res.json({
    message: 'API CartesProject PostgreSQL',
    version: '3.0.0',
    environment: process.env.NODE_ENV || 'development',
    documentation: `${req.protocol}://${req.get('host')}/api`,
    health_check: `${req.protocol}://${req.get('host')}/api/health`,
    requestId: req.idRequete,
    roles_support: {
      administrateur: '✅ Accès complet',
      gestionnaire: '✅ Stats filtrées, import/export',
      chef_equipe: '✅ Inventaire uniquement (3 colonnes)',
      operateur: '✅ Lecture seule',
    },
    features: {
      bulk_import: true,
      export: true,
      import_smart_sync: true,
      backup_system: !!process.env.GOOGLE_CLIENT_ID,
      annulation_actions: true,
      filtrage_coordination: true,
      journal_amelioré: true,
      sync_sites: true,
    },
    sync_endpoints: {
      login: 'POST /api/sync/login',
      test: 'GET /api/sync/test',
      upload: 'POST /api/sync/upload',
      download: 'GET /api/sync/download',
      confirm: 'POST /api/sync/confirm',
      status: 'GET /api/sync/status',
    },
  });
});

// ========== GESTION DES ERREURS ==========

// 404
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route not found',
    requested: `${req.method} ${req.url}`,
    request_id: req.idRequete,
  });
});

// Gestion globale des erreurs - CORRIGÉ (next supprimé)
app.use((err, req, res) => {
  console.error('❌ Error:', {
    message: err.message,
    url: req.url,
    method: req.method,
    request_id: req.idRequete,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Erreur CORS
  if (err.message && err.message.includes('CORS')) {
    return res.status(403).json({
      success: false,
      message: 'CORS error',
      error: 'Origin not allowed',
      request_id: req.idRequete,
    });
  }

  // Rate limit
  if (err.statusCode === 429) {
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded',
      request_id: req.idRequete,
    });
  }

  // Erreur de fichier trop volumineux
  if (err.message && err.message.includes('too large')) {
    return res.status(413).json({
      success: false,
      message: 'File too large',
      max_size: '200MB',
      request_id: req.idRequete,
    });
  }

  // Erreur de validation JWT
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

  // Erreur générique
  const errorResponse = {
    success: false,
    message: 'Internal server error',
    request_id: req.idRequete,
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV === 'development') {
    errorResponse.error = err.message;
  }

  res.status(err.status || 500).json(errorResponse);
});

// ========== LANCEMENT DU SERVEUR ==========
const server = app.listen(PORT, async () => {
  console.log('\n🚀 =====================================');
  console.log(`🚀 Server started on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`⚡ PID: ${process.pid}`);
  console.log(`⏰ Started at: ${new Date().toLocaleString()}`);
  console.log(`🧠 RAM disponible: 8 Go`);
  console.log('🚀 =====================================\n');

  // Démarrer le système de backup
  await setupBackupSystem();

  console.log('\n📋 Configuration VPS LWS:');
  console.log('• Upload limit: 200MB');
  console.log('• Rate limit: 5000 req/15min');
  console.log('• Journalisation: middleware/journalRequetes.js');
  console.log('• Logs: /logs/access.log');
  console.log('• Backups: /backups/ (local) + Google Drive');
  console.log('• Connexions DB max: 50');
  console.log("• Rôles supportés: Administrateur, Gestionnaire, Chef d'équipe, Opérateur");
  console.log('• Synchronisation sites: ✅ ACTIVE (12 endpoints)');
  console.log('• Protection fichiers sensibles: ✅ ACTIVE');
  console.log(
    "• Nouveautés: Annulation d'actions, Filtrage par coordination, Sync sites, Sécurité renforcée\n"
  );
});

// Configuration des timeouts (augmentés pour VPS)
server.keepAliveTimeout = 300000; // 5 minutes
server.headersTimeout = 310000; // Juste au-dessus

// Gestion du shutdown
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

// Gestion des erreurs non capturées
process.on('unhandledRejection', (reason) => {
  console.error('❌ Unhandled Rejection:', reason);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught Exception:', error);
  setTimeout(() => process.exit(1), 1000);
});

module.exports = app;
