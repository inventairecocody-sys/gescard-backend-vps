// ========================================
// BACKEND COMPLET CONSOLIDÉ
// Généré le: 05/03/2026 21:48:25
// ========================================

// ========== SERVER.JS (POINT D'ENTRÉE) ==========
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
const securityMiddleware = (req, res, next) => {
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
const updatesRoutes = require('./routes/Updatesroutes'); // ✅ Nouveau

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

app.use(securityHeaders);

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

// Rate Limiting
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

const noLimitRoutes = [
  '/api/health',
  '/api/test-db',
  '/api/cors-test',
  '/api/updates/check',
  '/api/updates/download',
];
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
        administrateur: 'Accès complet — toutes coordinations',
        gestionnaire: 'Accès limité à sa coordination',
        chef_equipe: 'Accès à sa coordination — inventaire et cartes',
        operateur: 'Accès à son site uniquement',
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
app.use('/api/updates', updatesRoutes); // ✅ Nouveau

// ========== ROUTE RACINE ==========
app.get('/', (req, res) => {
  res.json({
    message: 'API GESCARD PostgreSQL',
    version: '3.1.0',
    environment: process.env.NODE_ENV || 'development',
    documentation: `${req.protocol}://${req.get('host')}/api`,
    health_check: `${req.protocol}://${req.get('host')}/api/health`,
    requestId: req.idRequete,
    roles_support: {
      administrateur: '✅ Accès complet — toutes coordinations',
      gestionnaire: '✅ Stats et données de sa coordination',
      chef_equipe: '✅ Données de sa coordination',
      operateur: '✅ Données de son site uniquement',
    },
    features: {
      bulk_import: true,
      export: true,
      import_smart_sync: true,
      backup_system: !!process.env.GOOGLE_CLIENT_ID,
      annulation_actions: true,
      filtrage_coordination: true,
      journal_ameliore: true,
      sync_sites: true,
      sync_utilisateurs: true,
      auto_update: true, // ✅ Nouveau
    },
    sync_endpoints: {
      login: 'POST /api/sync/login',
      test: 'GET  /api/sync/test',
      upload: 'POST /api/sync/upload',
      download: 'GET  /api/sync/download',
      confirm: 'POST /api/sync/confirm',
      status: 'GET  /api/sync/status',
      users: 'GET  /api/sync/users',
    },
    statistiques_endpoints: {
      globales: 'GET  /api/statistiques/globales',
      sites: 'GET  /api/statistiques/sites',
      detail: 'GET  /api/statistiques/detail',
      quick: 'GET  /api/statistiques/quick',
      evolution: 'GET  /api/statistiques/evolution',
      imports: 'GET  /api/statistiques/imports',
      coordinations: 'GET  /api/statistiques/coordinations',
      refresh: 'POST /api/statistiques/refresh',
      diagnostic: 'GET  /api/statistiques/diagnostic',
    },
    updates_endpoints: {
      // ✅ Nouveau
      check: 'GET  /api/updates/check?version=X.X.X',
      latest: 'GET  /api/updates/latest',
      download: 'GET  /api/updates/download',
      publish: 'POST /api/updates/publish',
      history: 'GET  /api/updates/history',
      diagnostic: 'GET  /api/updates/diagnostic',
    },
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

// ✅ _next requis par Express pour reconnaître un middleware d'erreur (4 paramètres)
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
  if (err.statusCode === 429) {
    return res.status(429).json({
      success: false,
      message: 'Rate limit exceeded',
      request_id: req.idRequete,
    });
  }
  if (err.message && err.message.includes('too large')) {
    return res.status(413).json({
      success: false,
      message: 'File too large',
      max_size: '200MB',
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

  // Erreur multer — fichier trop volumineux
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: 'Fichier trop volumineux (max 500MB)',
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

  console.log('\n📋 Configuration:');
  console.log('• Upload limit        : 200MB (exe: 500MB)');
  console.log('• Rate limit          : 5000 req/15min');
  console.log('• Logs                : /logs/access.log');
  console.log('• Backups             : /backups/ + Google Drive');
  console.log('• Connexions DB max   : 50');
  console.log("• Rôles               : Administrateur, Gestionnaire, Chef d'équipe, Opérateur");
  console.log('• Sync sites          : ✅ ACTIVE (login/upload/download/confirm/status/users)');
  console.log('• Sync utilisateurs   : ✅ ACTIVE');
  console.log('• Statistiques        : ✅ ACTIVE (filtrées par rôle)');
  console.log('• Auto-update logiciel: ✅ ACTIVE (/api/updates)');
  console.log('• Sécurité            : ✅ ACTIVE\n');
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


// ========== DÉPENDANCES (package.json) ==========
/*
Dépendances: {
  "axios": "^1.13.2",
  "bcrypt": "^6.0.0",
  "bcryptjs": "^2.4.3",
  "compression": "^1.8.1",
  "cors": "^2.8.5",
  "csv-parser": "^3.2.0",
  "dotenv": "^16.6.1",
  "eventemitter3": "^5.0.1",
  "exceljs": "^4.4.0",
  "express": "^4.22.1",
  "express-rate-limit": "^7.5.1",
  "express-validator": "^7.3.1",
  "googleapis": "^170.1.0",
  "helmet": "^7.2.0",
  "json2csv": "^6.0.0-alpha.2",
  "jsonwebtoken": "^9.0.2",
  "morgan": "^1.10.1",
  "multer": "^1.4.5-lts.1",
  "node-cron": "^4.2.1",
  "pg": "^8.17.2",
  "stream-json": "^1.8.0",
  "uuid": "^8.3.2",
  "xlsx": "^0.18.5"
}
DévDépendances: {
  "@faker-js/faker": "^8.0.2",
  "eslint": "^8.57.1",
  "eslint-config-prettier": "^10.1.8",
  "eslint-plugin-import": "^2.32.0",
  "eslint-plugin-prettier": "^5.5.5",
  "jest": "^29.6.2",
  "nodemon": "^3.0.1",
  "prettier": "^3.8.1",
  "supertest": "^6.3.3"
}
*/


// ========== Controllers\StatistiquesController.js ==========
// Controllers/statistiquesController.js

const db = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION DU CACHE
// ============================================
const CACHE = {
  globales: { data: null, timestamp: null, key: null },
  sites: { data: null, timestamp: null, key: null },
  detail: { data: null, timestamp: null, key: null },
  TIMEOUT: 5 * 60 * 1000, // 5 minutes
};

// ============================================
// FONCTIONS UTILITAIRES PRIVÉES
// ============================================

/**
 * Vérifie si le cache est encore valide pour une clé donnée
 */
const isCacheValid = (cacheKey, key) => {
  const c = CACHE[cacheKey];
  if (!c || !c.timestamp) return false;
  if (c.key !== key) return false;
  return Date.now() - c.timestamp < CACHE.TIMEOUT;
};

/**
 * Génère la clé de cache selon le rôle et la coordination de l'utilisateur
 */
const getCacheKey = (user) => {
  if (user.role === 'Administrateur') return 'all';
  if (user.role === 'Gestionnaire') return `coord_${user.coordination_id}`;
  if (user.role === "Chef d'équipe") return `coord_${user.coordination_id}`;
  return `site_${user.agence}`;
};

/**
 * Construit le filtre WHERE selon le rôle de l'utilisateur
 *
 * Administrateur  → voit tout
 * Gestionnaire     → voit sa coordination uniquement
 * Chef d'équipe   → voit sa coordination uniquement
 * Opérateur       → voit son site uniquement
 */
const buildFiltreWhere = (user, params = [], baseWhere = 'WHERE 1=1') => {
  const role = user.role;

  if (role === 'Administrateur') {
    return { where: baseWhere, params };
  }

  if (role === 'Gestionnaire' || role === "Chef d'équipe") {
    if (user.coordination) {
      params = [...params, user.coordination];
      return {
        where: baseWhere + ` AND coordination = $${params.length}`,
        params,
      };
    }
  }

  if (role === 'Opérateur') {
    if (user.agence) {
      params = [...params, user.agence];
      return {
        where: baseWhere + ` AND "SITE DE RETRAIT" = $${params.length}`,
        params,
      };
    }
  }

  // Par défaut : aucune donnée si rôle non reconnu
  return { where: baseWhere + ` AND 1=0`, params };
};

/**
 * Formate une ligne de statistiques globales
 */
const formatGlobales = (row) => {
  const total = parseInt(row.total) || 0;
  const retires = parseInt(row.retires) || 0;
  return {
    total,
    retires,
    restants: total - retires,
    tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
  };
};

/**
 * Formate un tableau de lignes statistiques par site
 */
const formatSites = (rows) =>
  rows.map((row) => {
    const total = parseInt(row.total) || 0;
    const retires = parseInt(row.retires) || 0;
    return {
      site: row.site,
      total,
      retires,
      restants: total - retires,
      tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
    };
  });

/**
 * Calcule les totaux à partir d'un tableau de sites
 */
const calculerTotaux = (sites) => {
  const totals = sites.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      retires: acc.retires + s.retires,
      restants: acc.restants + s.restants,
    }),
    { total: 0, retires: 0, restants: 0 }
  );
  return {
    ...totals,
    tauxRetraitGlobal: totals.total > 0 ? Math.round((totals.retires / totals.total) * 100) : 0,
  };
};

// Condition SQL pour les cartes retirées
const CONDITION_RETIRES = `
  delivrance IS NOT NULL
  AND TRIM(COALESCE(delivrance, '')) != ''
  AND UPPER(delivrance) != 'NON'
`;

// ============================================
// CONTRÔLEUR
// ============================================
const statistiquesController = {
  /**
   * GET /api/statistiques/globales
   * Statistiques globales : total, retirés, restants, taux
   */
  async globales(req, res) {
    try {
      const { forceRefresh } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user);

      // Servir depuis le cache si valide
      if (!forceRefresh && isCacheValid('globales', cacheKey)) {
        return res.json({
          ...CACHE.globales.data,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.globales.timestamp) / 1000) + 's',
        });
      }

      const { where, params } = buildFiltreWhere(req.user, [], 'WHERE deleted_at IS NULL');

      const result = await db.query(
        `
        SELECT
          COUNT(*)                                           AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires,
          MIN(dateimport)                                    AS premiere_importation,
          MAX(dateimport)                                    AS derniere_importation,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_actifs,
          COUNT(DISTINCT nom)                                AS beneficiaires_uniques
        FROM cartes
        ${where}
      `,
        params
      );

      const stats = formatGlobales(result.rows[0]);
      const response = {
        ...stats,
        metadata: {
          premiere_importation: result.rows[0].premiere_importation,
          derniere_importation: result.rows[0].derniere_importation,
          sites_actifs: parseInt(result.rows[0].sites_actifs) || 0,
          beneficiaires_uniques: parseInt(result.rows[0].beneficiaires_uniques) || 0,
        },
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
      };

      // Mettre en cache
      CACHE.globales = { data: response, timestamp: Date.now(), key: cacheKey };

      res.json({
        ...response,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques globales:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/sites
   * Statistiques détaillées par site
   */
  async parSite(req, res) {
    try {
      const { forceRefresh, limit = 50 } = req.query;
      const startTime = Date.now();
      const actualLimit = Math.min(parseInt(limit), 200);
      const cacheKey = getCacheKey(req.user);

      // Servir depuis le cache si valide
      if (!forceRefresh && isCacheValid('sites', cacheKey)) {
        const cachedStats = CACHE.sites.data;
        return res.json({
          sites: cachedStats,
          totals: calculerTotaux(cachedStats),
          count: cachedStats.length,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.sites.timestamp) / 1000) + 's',
          filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        });
      }

      const { where, params } = buildFiltreWhere(
        req.user,
        [],
        `WHERE "SITE DE RETRAIT" IS NOT NULL
         AND TRIM(COALESCE("SITE DE RETRAIT", '')) != ''
         AND deleted_at IS NULL`
      );

      params.push(actualLimit);
      const result = await db.query(
        `
        SELECT
          "SITE DE RETRAIT"                                  AS site,
          COUNT(*)                                           AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires,
          MIN(dateimport)                                    AS premier_import,
          MAX(dateimport)                                    AS dernier_import,
          COUNT(DISTINCT nom)                                AS beneficiaires_uniques
        FROM cartes
        ${where}
        GROUP BY "SITE DE RETRAIT"
        ORDER BY total DESC
        LIMIT $${params.length}
      `,
        params
      );

      const stats = formatSites(result.rows);

      // Mettre en cache
      CACHE.sites = { data: stats, timestamp: Date.now(), key: cacheKey };

      res.json({
        sites: stats,
        totals: calculerTotaux(stats),
        count: stats.length,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques sites:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/detail
   * Statistiques complètes : globales + sites + évolution 30j
   */
  async detail(req, res) {
    try {
      const { forceRefresh } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user);

      if (!forceRefresh && isCacheValid('detail', cacheKey)) {
        return res.json({
          ...CACHE.detail.data,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.detail.timestamp) / 1000) + 's',
        });
      }

      const { where: whereGlobales, params: paramsGlobales } = buildFiltreWhere(
        req.user,
        [],
        'WHERE deleted_at IS NULL'
      );
      const { where: whereSites, params: paramsSites } = buildFiltreWhere(
        req.user,
        [],
        `WHERE "SITE DE RETRAIT" IS NOT NULL
         AND TRIM(COALESCE("SITE DE RETRAIT", '')) != ''
         AND deleted_at IS NULL`
      );
      const { where: whereEvol, params: paramsEvol } = buildFiltreWhere(
        req.user,
        [],
        `WHERE dateimport > NOW() - INTERVAL '30 days'
         AND deleted_at IS NULL`
      );

      const [globalesResult, sitesResult, evolutionResult] = await Promise.all([
        db.query(
          `
          SELECT
            COUNT(*)                                           AS total,
            COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires,
            MIN(dateimport)                                    AS premiere_importation,
            MAX(dateimport)                                    AS derniere_importation,
            COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_actifs,
            COUNT(DISTINCT nom)                                AS beneficiaires_uniques
          FROM cartes ${whereGlobales}
        `,
          paramsGlobales
        ),

        db.query(
          `
          SELECT
            "SITE DE RETRAIT"                                  AS site,
            COUNT(*)                                           AS total,
            COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires
          FROM cartes
          ${whereSites}
          GROUP BY "SITE DE RETRAIT"
          ORDER BY total DESC
        `,
          paramsSites
        ),

        db.query(
          `
          SELECT
            DATE_TRUNC('day', dateimport)      AS jour,
            COUNT(*)                           AS imports,
            COUNT(DISTINCT "SITE DE RETRAIT")  AS sites_concernes
          FROM cartes
          ${whereEvol}
          GROUP BY DATE_TRUNC('day', dateimport)
          ORDER BY jour DESC
        `,
          paramsEvol
        ),
      ]);

      const globales = formatGlobales(globalesResult.rows[0]);
      const sites = formatSites(sitesResult.rows);

      const totalImports30j = evolutionResult.rows.reduce((acc, r) => acc + parseInt(r.imports), 0);

      const response = {
        globales: {
          ...globales,
          metadata: {
            premiere_importation: globalesResult.rows[0].premiere_importation,
            derniere_importation: globalesResult.rows[0].derniere_importation,
            sites_actifs: parseInt(globalesResult.rows[0].sites_actifs) || 0,
            beneficiaires_uniques: parseInt(globalesResult.rows[0].beneficiaires_uniques) || 0,
          },
        },
        sites,
        totaux_sites: calculerTotaux(sites),
        evolution: evolutionResult.rows.map((r) => ({
          jour: r.jour,
          imports: parseInt(r.imports),
          sites_concernes: parseInt(r.sites_concernes),
        })),
        resume: {
          total_sites: sites.length,
          total_imports_30j: totalImports30j,
          moyenne_quotidienne:
            evolutionResult.rows.length > 0
              ? Math.round(totalImports30j / evolutionResult.rows.length)
              : 0,
        },
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
      };

      CACHE.detail = { data: response, timestamp: Date.now(), key: cacheKey };

      res.json({
        ...response,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques détail:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/quick
   * Stats rapides pour tableaux de bord
   */
  async quick(req, res) {
    try {
      const { where, params } = buildFiltreWhere(req.user, [], 'WHERE deleted_at IS NULL');

      const result = await db.query(
        `
        SELECT
          COUNT(*)                                            AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)   AS retires,
          COUNT(CASE WHEN dateimport > NOW() - INTERVAL '24 hours' THEN 1 END) AS imports_24h,
          COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days'   THEN 1 END) AS imports_7j,
          COUNT(CASE WHEN sync_status = 'pending'             THEN 1 END) AS en_attente_sync
        FROM cartes
        ${where}
      `,
        params
      );

      const s = result.rows[0];
      const total = parseInt(s.total) || 0;
      const retires = parseInt(s.retires) || 0;

      res.json({
        success: true,
        stats: {
          total,
          retires,
          restants: total - retires,
          tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
          imports_24h: parseInt(s.imports_24h) || 0,
          imports_7j: parseInt(s.imports_7j) || 0,
          en_attente_sync: parseInt(s.en_attente_sync) || 0,
        },
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats rapides:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/evolution
   * Évolution temporelle des imports
   */
  async evolution(req, res) {
    try {
      const { periode = 30, interval = 'day' } = req.query;
      const jours = Math.min(parseInt(periode), 365);

      const intervalSql = ['hour', 'week', 'month'].includes(interval) ? interval : 'day';

      const { where, params } = buildFiltreWhere(
        req.user,
        [intervalSql],
        `WHERE dateimport > NOW() - INTERVAL '${jours} days'
         AND deleted_at IS NULL`
      );

      const result = await db.query(
        `
        SELECT
          DATE_TRUNC($1, dateimport)         AS periode,
          COUNT(*)                           AS total_imports,
          COUNT(DISTINCT "SITE DE RETRAIT")  AS sites_actifs,
          COUNT(DISTINCT importbatchid)      AS batches
        FROM cartes
        ${where}
        GROUP BY DATE_TRUNC($1, dateimport)
        ORDER BY periode DESC
      `,
        params
      );

      res.json({
        success: true,
        evolution: result.rows.map((r) => ({
          periode: r.periode,
          imports: parseInt(r.total_imports),
          sites_actifs: parseInt(r.sites_actifs),
          batches: parseInt(r.batches),
        })),
        parametres: {
          periode_jours: jours,
          intervalle: interval,
          points: result.rows.length,
          filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur évolution:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/imports
   * Statistiques par lot d'import
   */
  async parImport(req, res) {
    try {
      const { limit = 10 } = req.query;
      const actualLimit = Math.min(parseInt(limit), 50);

      const { where, params } = buildFiltreWhere(
        req.user,
        [],
        'WHERE importbatchid IS NOT NULL AND deleted_at IS NULL'
      );

      params.push(actualLimit);
      const result = await db.query(
        `
        SELECT
          importbatchid,
          COUNT(*)                                            AS total_cartes,
          MIN(dateimport)                                     AS date_debut,
          MAX(dateimport)                                     AS date_fin,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)   AS cartes_retirees,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_concernes,
          MIN(coordination)                                   AS coordination
        FROM cartes
        ${where}
        GROUP BY importbatchid
        ORDER BY date_debut DESC
        LIMIT $${params.length}
      `,
        params
      );

      res.json({
        success: true,
        imports: result.rows.map((r) => {
          const total = parseInt(r.total_cartes);
          const retires = parseInt(r.cartes_retirees);
          return {
            batch_id: r.importbatchid,
            total_cartes: total,
            cartes_retirees: retires,
            taux_retrait: total > 0 ? Math.round((retires / total) * 100) : 0,
            date_debut: r.date_debut,
            date_fin: r.date_fin,
            sites_concernes: parseInt(r.sites_concernes),
            coordination: r.coordination,
            duree_minutes:
              r.date_debut && r.date_fin
                ? Math.round((new Date(r.date_fin) - new Date(r.date_debut)) / 60000)
                : 0,
          };
        }),
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats imports:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/coordinations
   * Statistiques par coordination (Administrateur uniquement)
   */
  async parCoordination(req, res) {
    try {
      if (req.user.role !== 'Administrateur') {
        return res.status(403).json({
          success: false,
          error: 'Accès réservé aux Administrateurs',
        });
      }

      const result = await db.query(`
        SELECT
          coordination,
          COUNT(*)                                            AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)   AS retires,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS nb_sites,
          COUNT(DISTINCT nom)                                AS beneficiaires_uniques
        FROM cartes
        WHERE deleted_at IS NULL
        AND coordination IS NOT NULL
        GROUP BY coordination
        ORDER BY total DESC
      `);

      const coordinations = result.rows.map((r) => {
        const total = parseInt(r.total) || 0;
        const retires = parseInt(r.retires) || 0;
        return {
          coordination: r.coordination,
          total,
          retires,
          restants: total - retires,
          tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
          nb_sites: parseInt(r.nb_sites) || 0,
          beneficiaires_uniques: parseInt(r.beneficiaires_uniques) || 0,
        };
      });

      res.json({
        success: true,
        coordinations,
        total_global: calculerTotaux(coordinations),
        count: coordinations.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats coordinations:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/statistiques/refresh
   * Vider le cache manuellement
   */
  async refresh(req, res) {
    try {
      CACHE.globales = { data: null, timestamp: null, key: null };
      CACHE.sites = { data: null, timestamp: null, key: null };
      CACHE.detail = { data: null, timestamp: null, key: null };

      console.log('🔄 Cache statistiques vidé par:', req.user?.nomUtilisateur);

      res.json({
        success: true,
        message: 'Cache vidé avec succès',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur refresh:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/diagnostic
   * Diagnostic complet du module (Administrateur uniquement)
   */
  async diagnostic(req, res) {
    try {
      const startTime = Date.now();

      const result = await db.query(`
        SELECT
          COUNT(*)                           AS total_cartes,
          COUNT(DISTINCT "SITE DE RETRAIT")  AS sites_distincts,
          COUNT(DISTINCT importbatchid)      AS batches_distincts,
          COUNT(DISTINCT coordination)       AS coordinations_distinctes,
          COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) AS cartes_supprimees,
          COUNT(CASE WHEN sync_status = 'pending' THEN 1 END) AS cartes_pending,
          MIN(dateimport)                    AS premiere_carte,
          MAX(dateimport)                    AS derniere_carte,
          MAX(sync_timestamp)                AS derniere_sync,
          pg_size_pretty(pg_total_relation_size('cartes')) AS table_size_pretty,
          pg_total_relation_size('cartes')   AS table_size
        FROM cartes
      `);

      const s = result.rows[0];

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'statistiques',
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination,
        },
        statistiques: {
          total_cartes: parseInt(s.total_cartes),
          cartes_supprimees: parseInt(s.cartes_supprimees),
          cartes_en_attente_sync: parseInt(s.cartes_pending),
          sites_distincts: parseInt(s.sites_distincts),
          batches_distincts: parseInt(s.batches_distincts),
          coordinations_distinctes: parseInt(s.coordinations_distinctes),
          premiere_carte: s.premiere_carte,
          derniere_carte: s.derniere_carte,
          derniere_sync: s.derniere_sync,
        },
        stockage: {
          taille_table: s.table_size_pretty,
          taille_bytes: parseInt(s.table_size),
        },
        cache: {
          globales: CACHE.globales.timestamp ? 'actif' : 'inactif',
          sites: CACHE.sites.timestamp ? 'actif' : 'inactif',
          detail: CACHE.detail.timestamp ? 'actif' : 'inactif',
          timeout: '5 minutes',
        },
        performance: { queryTime: Date.now() - startTime },
      });
    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

module.exports = statistiquesController;


// ========== Controllers\Updatescontroller.js ==========
// Controllers/updatesController.js

const fs = require('fs');
const path = require('path');

const DOWNLOADS_DIR = '/var/www/downloads';
const VERSION_FILE = path.join(DOWNLOADS_DIR, 'version.json');

// ============================================
// UTILITAIRES
// ============================================

const lireVersion = () => {
  try {
    if (!fs.existsSync(VERSION_FILE)) return null;
    return JSON.parse(fs.readFileSync(VERSION_FILE, 'utf8'));
  } catch {
    return null;
  }
};

const ecrireVersion = (data) => {
  fs.writeFileSync(VERSION_FILE, JSON.stringify(data, null, 2), 'utf8');
};

const comparerVersions = (v1, v2) => {
  // Retourne true si v1 > v2
  const p1 = v1.replace(/^v/, '').split('.').map(Number);
  const p2 = v2.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((p1[i] || 0) > (p2[i] || 0)) return true;
    if ((p1[i] || 0) < (p2[i] || 0)) return false;
  }
  return false;
};

// ============================================
// CHECK VERSION — appelé par le logiciel
// GET /api/updates/check?version=1.0.0
// ============================================
const checkVersion = async (req, res) => {
  try {
    const clientVersion = req.query.version || '0.0.0';
    const versionData = lireVersion();

    if (!versionData) {
      return res.json({
        success: true,
        update_available: false,
        message: 'Aucune version publiée',
        current_version: clientVersion,
      });
    }

    const updateAvailable = comparerVersions(versionData.version, clientVersion);

    res.json({
      success: true,
      update_available: updateAvailable,
      current_version: clientVersion,
      latest_version: versionData.version,
      download_url: updateAvailable ? versionData.download_url : null,
      release_notes: updateAvailable ? versionData.release_notes : null,
      published_at: versionData.published_at,
      published_by: versionData.published_by,
      file_size: versionData.file_size || null,
      checksum_sha256: updateAvailable ? versionData.checksum_sha256 : null,
      mandatory: versionData.mandatory || false,
    });

    // Log de la vérification
    console.log(
      `📡 [Updates] Check version: client=${clientVersion} latest=${versionData.version} update=${updateAvailable} ip=${req.ip}`
    );
  } catch (error) {
    console.error('❌ Erreur check version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET INFO VERSION — infos publiques
// GET /api/updates/latest
// ============================================
const getLatest = async (req, res) => {
  try {
    const versionData = lireVersion();

    if (!versionData) {
      return res.json({ success: true, version: null, message: 'Aucune version publiée' });
    }

    res.json({
      success: true,
      version: versionData.version,
      release_notes: versionData.release_notes,
      published_at: versionData.published_at,
      published_by: versionData.published_by,
      file_size: versionData.file_size,
      mandatory: versionData.mandatory || false,
      download_url: versionData.download_url,
    });
  } catch (error) {
    console.error('❌ Erreur get latest:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DOWNLOAD — télécharger le fichier .exe
// GET /api/updates/download
// ============================================
const downloadExe = async (req, res) => {
  try {
    const versionData = lireVersion();
    if (!versionData || !versionData.filename) {
      return res.status(404).json({ success: false, message: 'Aucun fichier disponible' });
    }

    const filePath = path.join(DOWNLOADS_DIR, versionData.filename);
    if (!fs.existsSync(filePath)) {
      return res
        .status(404)
        .json({ success: false, message: 'Fichier introuvable sur le serveur' });
    }

    const stat = fs.statSync(filePath);
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="gescard_${versionData.version}.exe"`
    );
    res.setHeader('Content-Length', stat.size);
    res.setHeader('X-Version', versionData.version);

    console.log(
      `📥 [Updates] Téléchargement: ${versionData.filename} v${versionData.version} par ip=${req.ip}`
    );

    const stream = fs.createReadStream(filePath);
    stream.pipe(res);
  } catch (error) {
    console.error('❌ Erreur download:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// UPLOAD NOUVELLE VERSION — Admin ou SCP
// POST /api/updates/publish
// Body: multipart/form-data { file, version, release_notes, mandatory }
// ============================================
const publishVersion = async (req, res) => {
  try {
    const acteur = req.user;
    if (acteur.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Fichier .exe requis' });
    }

    const { version, release_notes, mandatory = false } = req.body;

    if (!version || !version.match(/^\d+\.\d+\.\d+$/)) {
      // Supprimer le fichier uploadé si version invalide
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Version invalide. Format attendu: 1.2.3',
      });
    }

    // Vérifier que la nouvelle version est supérieure
    const versionActuelle = lireVersion();
    if (versionActuelle && !comparerVersions(version, versionActuelle.version)) {
      fs.unlinkSync(req.file.path);
      return res.status(400).json({
        success: false,
        message: `Version ${version} doit être supérieure à la version actuelle ${versionActuelle.version}`,
      });
    }

    // S'assurer que le dossier downloads existe
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      fs.mkdirSync(DOWNLOADS_DIR, { recursive: true });
    }

    // Calculer le checksum SHA256
    const crypto = require('crypto');
    const fileBuffer = fs.readFileSync(req.file.path);
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');

    // Nom du fichier versionné
    const filename = `gescard_v${version}.exe`;
    const destPath = path.join(DOWNLOADS_DIR, filename);
    const latestPath = path.join(DOWNLOADS_DIR, 'gescard_latest.exe');

    // Déplacer le fichier uploadé
    fs.renameSync(req.file.path, destPath);

    // Copier en tant que "latest"
    fs.copyFileSync(destPath, latestPath);

    // URL de téléchargement
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const downloadUrl = `${baseUrl}/api/updates/download`;

    // Écrire version.json
    const versionData = {
      version,
      filename,
      download_url: downloadUrl,
      release_notes: release_notes || `Version ${version}`,
      mandatory: mandatory === 'true' || mandatory === true,
      published_at: new Date().toISOString(),
      published_by: acteur.nomUtilisateur || acteur.nomComplet,
      file_size: fs.statSync(destPath).size,
      checksum_sha256: checksum,
    };

    ecrireVersion(versionData);

    // Journaliser
    try {
      const journalService = // require modifié - fichier consolidé;
      await journalService.logAction({
        utilisateurId: acteur.id,
        nomUtilisateur: acteur.nomUtilisateur,
        nomComplet: acteur.nomComplet,
        role: acteur.role,
        action: `Publication version logiciel: v${version}`,
        actionType: 'PUBLISH_UPDATE',
        tableName: 'Updates',
        recordId: version,
        newValue: JSON.stringify({ version, filename, mandatory }),
        details: `Nouvelle version publiée: ${version} — ${release_notes}`,
        ip: req.ip,
      });
    } catch (e) {
      console.warn('⚠️ Journal non écrit:', e.message);
    }

    console.log(`🚀 [Updates] Nouvelle version publiée: v${version} par ${acteur.nomUtilisateur}`);

    res.json({
      success: true,
      message: `Version ${version} publiée avec succès`,
      version: versionData.version,
      filename: versionData.filename,
      file_size: versionData.file_size,
      checksum: checksum,
      download_url: downloadUrl,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    // Nettoyer le fichier uploadé en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_e) {
        /* nettoyage silencieux */
      }
    }
    console.error('❌ Erreur publication version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// LISTE DES VERSIONS — historique
// GET /api/updates/history
// ============================================
const getHistory = async (req, res) => {
  try {
    if (!fs.existsSync(DOWNLOADS_DIR)) {
      return res.json({ success: true, versions: [] });
    }

    const files = fs
      .readdirSync(DOWNLOADS_DIR)
      .filter((f) => f.match(/^gescard_v[\d.]+\.exe$/))
      .map((f) => {
        const stat = fs.statSync(path.join(DOWNLOADS_DIR, f));
        const version = f.replace('gescard_v', '').replace('.exe', '');
        return { filename: f, version, size: stat.size, created_at: stat.mtime };
      })
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    const current = lireVersion();

    res.json({
      success: true,
      current_version: current?.version || null,
      versions: files,
      count: files.length,
    });
  } catch (error) {
    console.error('❌ Erreur historique versions:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DELETE VERSION — supprimer une version
// DELETE /api/updates/:version
// ============================================
const deleteVersion = async (req, res) => {
  try {
    const acteur = req.user;
    if (acteur.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const { version } = req.params;
    const filename = `gescard_v${version}.exe`;
    const filePath = path.join(DOWNLOADS_DIR, filename);

    // Ne pas supprimer la version courante
    const current = lireVersion();
    if (current && current.version === version) {
      return res.status(400).json({
        success: false,
        message: 'Impossible de supprimer la version courante publiée',
      });
    }

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Fichier introuvable' });
    }

    fs.unlinkSync(filePath);

    res.json({
      success: true,
      message: `Version ${version} supprimée`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur suppression version:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DIAGNOSTIC
// GET /api/updates/diagnostic
// ============================================
const diagnostic = async (req, res) => {
  try {
    const versionData = lireVersion();
    const dirExists = fs.existsSync(DOWNLOADS_DIR);
    const files = dirExists ? fs.readdirSync(DOWNLOADS_DIR).filter((f) => f.endsWith('.exe')) : [];

    let fileOk = false;
    if (versionData && versionData.filename) {
      fileOk = fs.existsSync(path.join(DOWNLOADS_DIR, versionData.filename));
    }

    res.json({
      success: true,
      service: 'updates',
      downloads_dir: DOWNLOADS_DIR,
      dir_exists: dirExists,
      version_file: VERSION_FILE,
      current_version: versionData?.version || null,
      file_present: fileOk,
      exe_files: files,
      exe_count: files.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  checkVersion,
  getLatest,
  downloadExe,
  publishVersion,
  getHistory,
  deleteVersion,
  diagnostic,
};


// ========== Controllers\apiController.js ==========
const db = // require modifié - fichier consolidé;
const annulationService = // require modifié - fichier consolidé;

// 🔧 CONFIGURATION API EXTERNE - OPTIMISÉE POUR LWS
const API_CONFIG = {
  // Limites augmentées pour LWS
  maxResults: 10000, // Augmenté de 1000 → 10000
  defaultLimit: 100,
  maxSyncRecords: 5000, // Augmenté de 500 → 5000
  maxBatchSize: 1000, // Nouveau : taille des lots pour traitement
  exportMaxRows: 100000, // Nouveau : max pour exports
  enableCompression: true, // Nouveau : compression GZIP

  SITES: [
    'ADJAME',
    "CHU D'ANGRE",
    'UNIVERSITE DE COCODY',
    'LYCEE HOTELIER',
    'BINGERVILLE',
    'SITE_6',
    'SITE_7',
    'SITE_8',
    'SITE_9',
    'SITE_10',
  ],
};

// ====================================================
// 🔄 FONCTIONS DE FUSION INTELLIGENTE (inchangées - excellentes)
// ====================================================

/**
 * Met à jour une carte existante avec fusion intelligente des données
 */
exports.mettreAJourCarte = async (client, carteExistante, nouvellesDonnees) => {
  let updated = false;
  const updates = [];
  const params = [];
  let paramCount = 0;

  // ✅ TOUTES LES COLONNES PRINCIPALES À FUSIONNER
  const colonnesAFusionner = {
    "LIEU D'ENROLEMENT": 'texte',
    'SITE DE RETRAIT': 'texte',
    RANGEMENT: 'texte',
    NOM: 'texte',
    PRENOMS: 'texte',
    'LIEU NAISSANCE': 'texte',
    CONTACT: 'contact',
    'CONTACT DE RETRAIT': 'contact',
    DELIVRANCE: 'delivrance',
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date',
    COORDINATION: 'texte', // ← NOUVEAU
  };

  for (const [colonne, type] of Object.entries(colonnesAFusionner)) {
    const valeurExistante = carteExistante[colonne] || '';
    const nouvelleValeur = nouvellesDonnees[colonne]?.toString().trim() || '';

    switch (type) {
      case 'delivrance': {
        const isOuiExistante = valeurExistante.toUpperCase() === 'OUI';
        const isOuiNouvelle = nouvelleValeur.toUpperCase() === 'OUI';

        if (isOuiExistante && !isOuiNouvelle && nouvelleValeur) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "OUI" → "${nouvelleValeur}" (priorité nom)`);
        } else if (!isOuiExistante && isOuiNouvelle && valeurExistante) {
          console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé vs "OUI"`);
        } else if (valeurExistante && nouvelleValeur && valeurExistante !== nouvelleValeur) {
          // Appel à resoudreConflitNom qui retourne un boolean pour updated
          const conflitResolu = await exports.resoudreConflitNom(
            client,
            updates,
            params,
            colonne,
            valeurExistante,
            nouvelleValeur,
            carteExistante,
            nouvellesDonnees
          );
          if (conflitResolu) {
            updated = true;
          }
        } else if (nouvelleValeur && !valeurExistante) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "" → "${nouvelleValeur}" (ajout)`);
        }
        break;
      }

      case 'contact': {
        if (exports.estContactPlusComplet(nouvelleValeur, valeurExistante)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;
      }

      case 'date': {
        const dateExistante = valeurExistante ? new Date(valeurExistante) : null;
        const nouvelleDate = nouvelleValeur ? new Date(nouvelleValeur) : null;

        if (nouvelleDate && exports.estDatePlusRecente(nouvelleDate, dateExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleDate);
          updated = true;
          console.log(`  🔄 ${colonne}: ${valeurExistante} → ${nouvelleValeur} (plus récente)`);
        }
        break;
      }

      case 'texte':
      default: {
        if (exports.estValeurPlusComplete(nouvelleValeur, valeurExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;
      }
    }
  }

  if (updated && updates.length > 0) {
    updates.push(`dateimport = $${++paramCount}`);
    params.push(new Date());
    params.push(carteExistante.id);

    const updateQuery = `
      UPDATE cartes 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
    `;

    await client.query(updateQuery, params);
    console.log(
      `✅ Carte ${carteExistante.nom} ${carteExistante.prenoms} mise à jour: ${updates.length - 1} champs`
    );
  }

  return { updated };
};

// ✅ Résoudre les conflits entre noms dans DELIVRANCE
exports.resoudreConflitNom = async (
  client,
  updates,
  params,
  colonne,
  valeurExistante,
  nouvelleValeur,
  carteExistante,
  nouvellesDonnees
) => {
  const dateExistante = carteExistante['DATE DE DELIVRANCE'];
  const nouvelleDate = nouvellesDonnees['DATE DE DELIVRANCE']
    ? new Date(nouvellesDonnees['DATE DE DELIVRANCE'])
    : null;

  if (nouvelleDate && (!dateExistante || nouvelleDate > new Date(dateExistante))) {
    updates.push(`"${colonne}" = $${++params.length}`);
    params.push(nouvelleValeur);
    console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (date plus récente)`);
    return true; // Retourne true si mise à jour effectuée
  } else {
    console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé (date plus récente ou égale)`);
    return false; // Retourne false si pas de mise à jour
  }
};

// ✅ Vérifier si un contact est plus complet
exports.estContactPlusComplet = (nouveauContact, ancienContact) => {
  if (!nouveauContact) return false;
  if (!ancienContact) return true;

  const hasIndicatifComplet = (contact) =>
    contact.startsWith('+225') || contact.startsWith('00225');
  const isNumerique = (contact) => /^[\d+\s\-()]+$/.test(contact);

  if (hasIndicatifComplet(nouveauContact) && !hasIndicatifComplet(ancienContact)) return true;
  if (isNumerique(nouveauContact) && !isNumerique(ancienContact)) return true;
  if (nouveauContact.length > ancienContact.length) return true;

  return false;
};

// ✅ Vérifier si une date est plus récente
exports.estDatePlusRecente = (nouvelleDate, dateExistante, colonne) => {
  if (!dateExistante) return true;

  if (colonne === 'DATE DE DELIVRANCE') {
    return nouvelleDate > dateExistante;
  }

  return false;
};

// ✅ Vérifier si une valeur texte est plus complète
exports.estValeurPlusComplete = (nouvelleValeur, valeurExistante, colonne) => {
  if (!nouvelleValeur) return false;
  if (!valeurExistante) return true;

  switch (colonne) {
    case 'NOM':
    case 'PRENOMS': {
      const hasAccents = (texte) => /[àâäéèêëîïôöùûüÿçñ]/i.test(texte);
      if (hasAccents(nouvelleValeur) && !hasAccents(valeurExistante)) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;
    }

    case 'LIEU NAISSANCE':
    case "LIEU D'ENROLEMENT": {
      const motsNouveaux = nouvelleValeur.split(/\s+/).length;
      const motsExistants = valeurExistante.split(/\s+/).length;
      if (motsNouveaux > motsExistants) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;
    }

    default:
      if (nouvelleValeur.length > valeurExistante.length) return true;
  }

  return false;
};

// ====================================================
// 🔹 ROUTES API PUBLIQUES OPTIMISÉES POUR LWS
// ====================================================

/**
 * VÉRIFICATION DE SANTÉ ENRICHIE
 * GET /api/external/health
 */
exports.healthCheck = async (req, res) => {
  try {
    const dbTest = await db.query(
      'SELECT 1 as test, version() as postgres_version, NOW() as server_time'
    );

    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques,
        COUNT(CASE WHEN dateimport > NOW() - INTERVAL '24 hours' THEN 1 END) as imports_24h,
        COUNT(DISTINCT coordination) as coordinations_distinctes
      FROM cartes
    `);

    const sitesStats = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
    `);

    // Infos système pour LWS
    const memory = process.memoryUsage();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    res.json({
      success: true,
      status: 'healthy',
      server: {
        name: 'CartesProject API',
        version: '3.0.0-lws',
        uptime: `${hours}h ${minutes}m`,
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
        },
        environment: process.env.NODE_ENV || 'production',
      },
      database: {
        status: 'connected',
        version: dbTest.rows[0].postgres_version.split(',')[0],
        server_time: dbTest.rows[0].server_time,
      },
      statistics: {
        total_cartes: parseInt(statsResult.rows[0].total_cartes),
        sites_actifs: parseInt(statsResult.rows[0].sites_actifs),
        beneficiaires_uniques: parseInt(statsResult.rows[0].beneficiaires_uniques),
        imports_24h: parseInt(statsResult.rows[0].imports_24h),
        coordinations_distinctes: parseInt(statsResult.rows[0].coordinations_distinctes),
      },
      sites_configures: API_CONFIG.SITES,
      sites_statistiques: sitesStats.rows,
      api: {
        version: '3.0.0',
        environment: process.env.NODE_ENV || 'production',
        max_results: API_CONFIG.maxResults,
        max_sync: API_CONFIG.maxSyncRecords,
        rate_limit: '1000 req/min',
        features: [
          'fusion_intelligente',
          'gestion_conflits',
          'synchronisation_multicolonne',
          'compression_gzip',
          'batch_processing',
          'coordination_support',
        ],
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API healthCheck:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * RÉCUPÉRATION DES CHANGEMENTS OPTIMISÉE
 * GET /api/external/changes?since=2024-01-01T00:00:00&limit=5000
 */
exports.getChanges = async (req, res) => {
  try {
    const { since, limit = API_CONFIG.maxResults } = req.query;

    console.log('📡 Récupération des changements depuis:', since);

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const actualLimit = Math.min(parseInt(limit), API_CONFIG.maxResults);

    const query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        coordination,
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport,
        'UPDATE' as operation
      FROM cartes 
      WHERE dateimport > $1
      ORDER BY dateimport ASC
      LIMIT $2
    `;

    const result = await db.query(query, [sinceDate, actualLimit]);

    const derniereModification =
      result.rows.length > 0
        ? result.rows[result.rows.length - 1].dateimport
        : sinceDate.toISOString();

    // Ajouter en-têtes pour pagination
    res.setHeader('X-Total-Count', result.rows.length);
    res.setHeader('X-Last-Modified', derniereModification);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: result.rows.length,
        limit: actualLimit,
        hasMore: result.rows.length === actualLimit,
      },
      derniereModification: derniereModification,
      since: sinceDate.toISOString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des changements',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * SYNCHRONISATION AVEC FUSION INTELLIGENTE ET TRAITEMENT PAR LOTS
 * POST /api/external/sync
 */
exports.syncData = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { donnees, source = 'python_app', batch_id } = req.body;

    if (!donnees || !Array.isArray(donnees)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Format invalide',
        message: 'Le champ "donnees" doit être un tableau',
      });
    }

    // Vérifier la taille pour LWS
    const totalSize = JSON.stringify(donnees).length;
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB

    if (totalSize > maxSizeBytes) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(413).json({
        success: false,
        error: 'Données trop volumineuses',
        message: `Taille maximum: 100MB, reçu: ${Math.round(totalSize / 1024 / 1024)}MB`,
      });
    }

    if (donnees.length > API_CONFIG.maxSyncRecords) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: "Trop d'enregistrements",
        message: `Maximum ${API_CONFIG.maxSyncRecords} enregistrements par requête`,
      });
    }

    console.log(
      `🔄 Synchronisation intelligente: ${donnees.length} enregistrements depuis ${source}`
    );

    // Traitement par lots pour optimiser la mémoire
    const BATCH_SIZE = API_CONFIG.maxBatchSize;
    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    let errors = 0;
    const errorDetails = [];

    for (let i = 0; i < donnees.length; i += BATCH_SIZE) {
      const batch = donnees.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(donnees.length / BATCH_SIZE);

      console.log(
        `📦 Traitement lot ${batchNum}/${totalBatches} (${batch.length} enregistrements)`
      );

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const index = i + j;

        try {
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Enregistrement ${index}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item['SITE DE RETRAIT']?.toString().trim() || '';

          const existingCarte = await client.query(
            `SELECT * FROM cartes 
             WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
            [nom, prenoms, siteRetrait]
          );

          if (existingCarte.rows.length > 0) {
            const carteExistante = existingCarte.rows[0];
            const resultUpdate = await exports.mettreAJourCarte(client, carteExistante, item);

            if (resultUpdate.updated) {
              updated++;

              // 📝 JOURNALISATION DE LA MISE À JOUR
              await annulationService.enregistrerAction(
                null, // utilisateurId (synchronisation externe)
                'SYSTEM',
                'Synchronisation externe',
                source,
                null,
                `Mise à jour via synchronisation (batch ${batch_id || 'N/A'})`,
                'UPDATE',
                'cartes',
                carteExistante.id,
                carteExistante,
                item,
                req.ip,
                batch_id,
                carteExistante.coordination || item.COORDINATION || null
              );
            } else {
              duplicates++;
            }
          } else {
            const insertData = {
              "LIEU D'ENROLEMENT": item["LIEU D'ENROLEMENT"]?.toString().trim() || '',
              'SITE DE RETRAIT': siteRetrait,
              RANGEMENT: item['RANGEMENT']?.toString().trim() || '',
              NOM: nom,
              PRENOMS: prenoms,
              'DATE DE NAISSANCE': item['DATE DE NAISSANCE']
                ? new Date(item['DATE DE NAISSANCE'])
                : null,
              'LIEU NAISSANCE': item['LIEU NAISSANCE']?.toString().trim() || '',
              CONTACT: item['CONTACT']?.toString().trim() || '',
              DELIVRANCE: item['DELIVRANCE']?.toString().trim() || '',
              'CONTACT DE RETRAIT': item['CONTACT DE RETRAIT']?.toString().trim() || '',
              'DATE DE DELIVRANCE': item['DATE DE DELIVRANCE']
                ? new Date(item['DATE DE DELIVRANCE'])
                : null,
              sourceimport: source,
              batch_id: batch_id || null,
              coordination: item.COORDINATION || null,
            };

            const insertResult = await client.query(
              `
              INSERT INTO cartes (
                "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
                "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
                "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", sourceimport, batch_id, coordination
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING id
            `,
              Object.values(insertData)
            );

            imported++;

            // 📝 JOURNALISATION DE L'INSERTION
            await annulationService.enregistrerAction(
              null, // utilisateurId (synchronisation externe)
              'SYSTEM',
              'Synchronisation externe',
              source,
              null,
              `Insertion via synchronisation (batch ${batch_id || 'N/A'})`,
              'INSERT',
              'cartes',
              insertResult.rows[0].id,
              null,
              item,
              req.ip,
              batch_id,
              insertData.coordination
            );
          }
        } catch (error) {
          errors++;
          errorDetails.push(`Enregistrement ${index}: ${error.message}`);
          console.error(`❌ Erreur enregistrement ${index}:`, error.message);
        }
      }

      // Libérer la mémoire après chaque lot
      if (global.gc) {
        global.gc();
      }
    }

    await client.query('COMMIT');
    client.release();

    const duration = Date.now() - startTime;
    const successRate =
      donnees.length > 0 ? Math.round(((imported + updated) / donnees.length) * 100) : 0;

    console.log(
      `✅ Sync UP réussie en ${duration}ms: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`
    );

    res.json({
      success: true,
      message: 'Synchronisation avec fusion intelligente réussie',
      stats: {
        imported,
        updated,
        duplicates,
        errors,
        totalProcessed: donnees.length,
        successRate,
      },
      performance: {
        duration_ms: duration,
        records_per_second: Math.round(donnees.length / (duration / 1000)),
        batch_size: BATCH_SIZE,
        total_batches: Math.ceil(donnees.length / BATCH_SIZE),
      },
      fusion: {
        strategy: 'intelligente_multicolonnes',
        colonnes_traitees: Object.keys(exports.getColonnesAFusionner()),
      },
      batch_info: {
        batch_id: batch_id || 'N/A',
        source: source,
        timestamp: new Date().toISOString(),
      },
      errorDetails: errorDetails.slice(0, 10),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la synchronisation',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * CONFIGURATION DES COLONNES À FUSIONNER
 */
exports.getColonnesAFusionner = () => {
  return {
    "LIEU D'ENROLEMENT": 'texte',
    'SITE DE RETRAIT': 'texte',
    RANGEMENT: 'texte',
    NOM: 'texte',
    PRENOMS: 'texte',
    'LIEU NAISSANCE': 'texte',
    CONTACT: 'contact',
    'CONTACT DE RETRAIT': 'contact',
    DELIVRANCE: 'delivrance',
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date',
    COORDINATION: 'texte',
  };
};

/**
 * RÉCUPÉRATION DES CARTES AVEC FILTRES OPTIMISÉE
 * GET /api/external/cartes
 */
exports.getCartes = async (req, res) => {
  try {
    const {
      nom,
      prenom,
      contact,
      siteRetrait,
      lieuNaissance,
      dateDebut,
      dateFin,
      delivrance,
      coordination,
      page = 1,
      limit = API_CONFIG.defaultLimit,
      export_all = 'false',
    } = req.query;

    // Pour LWS, on permet des exports plus grands
    const actualLimit =
      export_all === 'true'
        ? API_CONFIG.exportMaxRows
        : Math.min(parseInt(limit), API_CONFIG.maxResults);

    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        coordination,
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    // Appliquer les filtres
    if (nom) {
      paramCount++;
      query += ` AND nom ILIKE $${paramCount}`;
      params.push(`%${nom}%`);
    }

    if (prenom) {
      paramCount++;
      query += ` AND prenoms ILIKE $${paramCount}`;
      params.push(`%${prenom}%`);
    }

    if (contact) {
      paramCount++;
      query += ` AND contact ILIKE $${paramCount}`;
      params.push(`%${contact}%`);
    }

    if (siteRetrait) {
      paramCount++;
      query += ` AND "SITE DE RETRAIT" ILIKE $${paramCount}`;
      params.push(`%${siteRetrait}%`);
    }

    if (lieuNaissance) {
      paramCount++;
      query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
      params.push(`%${lieuNaissance}%`);
    }

    if (dateDebut) {
      paramCount++;
      query += ` AND dateimport >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dateimport <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }

    if (delivrance) {
      paramCount++;
      query += ` AND delivrance ILIKE $${paramCount}`;
      params.push(`%${delivrance}%`);
    }

    if (coordination) {
      paramCount++;
      query += ` AND coordination = $${paramCount}`;
      params.push(coordination);
    }

    // Pagination
    query += ` ORDER BY id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    const result = await db.query(query, params);

    // Compter le total
    let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
    const countParams = [];

    let countParamCount = 0;
    if (nom) {
      countParamCount++;
      countQuery += ` AND nom ILIKE $${countParamCount}`;
      countParams.push(`%${nom}%`);
    }
    if (prenom) {
      countParamCount++;
      countQuery += ` AND prenoms ILIKE $${countParamCount}`;
      countParams.push(`%${prenom}%`);
    }
    if (contact) {
      countParamCount++;
      countQuery += ` AND contact ILIKE $${countParamCount}`;
      countParams.push(`%${contact}%`);
    }
    if (siteRetrait) {
      countParamCount++;
      countQuery += ` AND "SITE DE RETRAIT" ILIKE $${countParamCount}`;
      countParams.push(`%${siteRetrait}%`);
    }
    if (lieuNaissance) {
      countParamCount++;
      countQuery += ` AND "LIEU NAISSANCE" ILIKE $${countParamCount}`;
      countParams.push(`%${lieuNaissance}%`);
    }
    if (dateDebut) {
      countParamCount++;
      countQuery += ` AND dateimport >= $${countParamCount}`;
      countParams.push(new Date(dateDebut));
    }
    if (dateFin) {
      countParamCount++;
      countQuery += ` AND dateimport <= $${countParamCount}`;
      countParams.push(new Date(dateFin + ' 23:59:59'));
    }
    if (delivrance) {
      countParamCount++;
      countQuery += ` AND delivrance ILIKE $${countParamCount}`;
      countParams.push(`%${delivrance}%`);
    }
    if (coordination) {
      countParamCount++;
      countQuery += ` AND coordination = $${countParamCount}`;
      countParams.push(coordination);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    // Headers pour les exports
    if (export_all === 'true') {
      res.setHeader('X-Total-Rows', total);
      res.setHeader('X-Export-Type', 'complete');
    }

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total: total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      filters: req.query,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des cartes',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * STATISTIQUES DÉTAILLÉES ENRICHIES
 * GET /api/external/stats
 */
exports.getStats = async (req, res) => {
  try {
    const globalStats = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques,
        COUNT(DISTINCT coordination) as coordinations_distinctes,
        MIN(dateimport) as premiere_importation,
        MAX(dateimport) as derniere_importation,
        COUNT(DISTINCT batch_id) as total_batches,
        COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days' THEN 1 END) as imports_7j
      FROM cartes
    `);

    const topSites = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        ROUND(COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_retrait
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
      LIMIT 10
    `);

    const statsByCoordination = await db.query(`
      SELECT 
        coordination,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees
      FROM cartes 
      WHERE coordination IS NOT NULL AND coordination != ''
      GROUP BY coordination
      ORDER BY total_cartes DESC
    `);

    const recentActivity = await db.query(`
      SELECT 
        DATE(dateimport) as jour,
        COUNT(*) as imports,
        COUNT(DISTINCT batch_id) as batches
      FROM cartes
      WHERE dateimport > NOW() - INTERVAL '7 days'
      GROUP BY DATE(dateimport)
      ORDER BY jour DESC
    `);

    const global = globalStats.rows[0];
    const totalCartes = parseInt(global.total_cartes);
    const cartesRetirees = parseInt(global.cartes_retirees);

    res.json({
      success: true,
      data: {
        global: {
          total_cartes: totalCartes,
          cartes_retirees: cartesRetirees,
          taux_retrait_global:
            totalCartes > 0 ? Math.round((cartesRetirees / totalCartes) * 100) : 0,
          sites_actifs: parseInt(global.sites_actifs),
          beneficiaires_uniques: parseInt(global.beneficiaires_uniques),
          coordinations_distinctes: parseInt(global.coordinations_distinctes),
          premiere_importation: global.premiere_importation,
          derniere_importation: global.derniere_importation,
          total_batches: parseInt(global.total_batches || 0),
          imports_7j: parseInt(global.imports_7j || 0),
        },
        top_sites: topSites.rows,
        stats_by_coordination: statsByCoordination.rows,
        recent_activity: recentActivity.rows,
        sites_configures: API_CONFIG.SITES,
        system: {
          max_results: API_CONFIG.maxResults,
          max_sync: API_CONFIG.maxSyncRecords,
          environment: process.env.NODE_ENV || 'production',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * MODIFICATIONS PAR SITE
 * GET /api/external/modifications?site=ADJAME&derniereSync=2024-01-01T00:00:00
 */
exports.getModifications = async (req, res) => {
  try {
    const { site, derniereSync, limit = 1000 } = req.query;

    if (!site || !derniereSync) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres manquants: site et derniereSync requis',
      });
    }

    if (!API_CONFIG.SITES.includes(site)) {
      return res.status(400).json({
        success: false,
        error: 'Site non reconnu',
        message: `Sites valides: ${API_CONFIG.SITES.join(', ')}`,
      });
    }

    const actualLimit = Math.min(parseInt(limit), API_CONFIG.maxResults);

    const query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport
      FROM cartes 
      WHERE "SITE DE RETRAIT" = $1 
      AND dateimport > $2
      ORDER BY dateimport ASC
      LIMIT $3
    `;

    const result = await db.query(query, [site, new Date(derniereSync), actualLimit]);

    let derniereModification = derniereSync;
    if (result.rows.length > 0) {
      derniereModification = result.rows[result.rows.length - 1].dateimport;
    }

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification: derniereModification,
      site: site,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getModifications:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des modifications',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * LISTE DES SITES CONFIGURÉS
 * GET /api/external/sites
 */
exports.getSites = async (req, res) => {
  try {
    // Récupérer aussi les sites avec données
    const sitesActifs = await db.query(`
      SELECT DISTINCT "SITE DE RETRAIT" as site
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      ORDER BY site
    `);

    res.json({
      success: true,
      sites_configures: API_CONFIG.SITES,
      sites_actifs: sitesActifs.rows.map((row) => row.site),
      total_configures: API_CONFIG.SITES.length,
      total_actifs: sitesActifs.rows.length,
      description: 'Sites avec synchronisation intelligente multi-colonnes',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getSites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      details: error.message,
    });
  }
};

/**
 * DIAGNOSTIC COMPLET DU SERVICE
 * GET /api/external/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    const memory = process.memoryUsage();
    const uptime = process.uptime();

    // Test DB rapide
    const dbTest = await db.query('SELECT 1 as test');

    // Compter les données
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites,
        COUNT(DISTINCT coordination) as coordinations,
        MAX(dateimport) as last_import
      FROM cartes
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'api-external',
      environment: process.env.NODE_ENV || 'development',
      status: 'operational',
      database: {
        connected: dbTest.rows.length > 0,
        total_cartes: parseInt(stats.rows[0].total),
        sites_actifs: parseInt(stats.rows[0].sites),
        coordinations: parseInt(stats.rows[0].coordinations),
        dernier_import: stats.rows[0].last_import,
      },
      system: {
        uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm',
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        },
        node_version: process.version,
      },
      config: {
        maxResults: API_CONFIG.maxResults,
        maxSyncRecords: API_CONFIG.maxSyncRecords,
        maxBatchSize: API_CONFIG.maxBatchSize,
        sites: API_CONFIG.SITES,
      },
      endpoints: {
        health: '/api/external/health',
        changes: '/api/external/changes?since=...',
        sync: '/api/external/sync (POST)',
        cartes: '/api/external/cartes',
        stats: '/api/external/stats',
        modifications: '/api/external/modifications?site=...&derniereSync=...',
        sites: '/api/external/sites',
        diagnostic: '/api/external/diagnostic',
      },
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};

// Export de la configuration
exports.API_CONFIG = API_CONFIG;


// ========== Controllers\authController.js ==========
// ============================================
// CONTROLLER AUTHENTIFICATION
// ============================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = // require modifié - fichier consolidé;
const journalService = // require modifié - fichier consolidé; // ✅ Service indépendant

const CONFIG = {
  saltRounds: 12,
  jwtExpiration: '8h',
  minPasswordLength: 8,
  maxLoginAttempts: 5,
  lockoutDuration: 15 * 60 * 1000, // 15 minutes en millisecondes
  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

// Map pour stocker les tentatives de connexion par IP
const loginAttempts = new Map();

/**
 * Nettoie périodiquement les anciennes entrées de loginAttempts
 * (toutes les 30 minutes)
 */
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts.entries()) {
      if (data.lockUntil < now && data.attempts === 0) {
        loginAttempts.delete(ip);
      }
    }
  },
  30 * 60 * 1000
);

// ============================================
// LOGIN USER
// ============================================
const loginUser = async (req, res) => {
  const { NomUtilisateur, MotDePasse } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  const startTime = Date.now();

  try {
    console.log('🔍 [LOGIN] Tentative de connexion:', NomUtilisateur);

    // ============================================
    // 1. VÉRIFICATION DES TENTATIVES
    // ============================================
    const now = Date.now();
    const attemptData = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };

    if (attemptData.lockUntil > now) {
      const waitTime = Math.ceil((attemptData.lockUntil - now) / 1000 / 60);
      return res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${waitTime} minute${waitTime > 1 ? 's' : ''}.`,
      });
    }

    // ============================================
    // 2. VALIDATION DES CHAMPS
    // ============================================
    if (!NomUtilisateur || !MotDePasse) {
      return res.status(400).json({
        success: false,
        message: "Nom d'utilisateur et mot de passe requis",
      });
    }

    // ============================================
    // 3. RECHERCHE DE L'UTILISATEUR
    // ============================================
    const result = await db.query('SELECT * FROM utilisateurs WHERE nomutilisateur = $1', [
      NomUtilisateur,
    ]);

    const utilisateur = result.rows[0];

    if (!utilisateur) {
      // Mauvais nom d'utilisateur
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
      }
      loginAttempts.set(clientIp, attemptData);

      return res.status(401).json({
        success: false,
        message: "Nom d'utilisateur ou mot de passe incorrect",
      });
    }

    // ============================================
    // 4. VÉRIFICATION DU COMPTE ACTIF
    // ============================================
    if (!utilisateur.actif) {
      return res.status(401).json({
        success: false,
        message: 'Ce compte est désactivé. Contactez un administrateur.',
      });
    }

    // ============================================
    // 5. VÉRIFICATION DU MOT DE PASSE
    // ============================================
    const isMatch = await bcrypt.compare(MotDePasse, utilisateur.motdepasse);

    if (!isMatch) {
      // Mauvais mot de passe
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
      }
      loginAttempts.set(clientIp, attemptData);

      return res.status(401).json({
        success: false,
        message: "Nom d'utilisateur ou mot de passe incorrect",
      });
    }

    // ============================================
    // 6. CONNEXION RÉUSSIE
    // ============================================
    // Réinitialiser les tentatives
    loginAttempts.delete(clientIp);

    // Mettre à jour la dernière connexion
    await db.query('UPDATE utilisateurs SET derniereconnexion = NOW() WHERE id = $1', [
      utilisateur.id,
    ]);

    // Générer le token JWT
    const token = jwt.sign(
      {
        id: utilisateur.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        role: utilisateur.role,
        agence: utilisateur.agence,
        coordination: utilisateur.coordination,
        coordination_id: utilisateur.coordination_id || null, // Si vous avez cette colonne
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    console.log('✅ [LOGIN] Connexion réussie pour:', utilisateur.nomutilisateur);

    // Journalisation de la connexion
    await journalService.logAction({
      utilisateurId: utilisateur.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      role: utilisateur.role,
      agence: utilisateur.agence,
      coordination: utilisateur.coordination,
      action: 'Connexion au système',
      actionType: 'LOGIN',
      tableName: 'utilisateurs',
      recordId: utilisateur.id.toString(),
      ip: clientIp,
      details: `Connexion réussie depuis ${clientIp}`,
    });

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Connexion réussie',
      token,
      utilisateur: {
        id: utilisateur.id,
        nomComplet: utilisateur.nomcomplet,
        nomUtilisateur: utilisateur.nomutilisateur,
        email: utilisateur.email,
        agence: utilisateur.agence,
        role: utilisateur.role,
        coordination: utilisateur.coordination,
        coordination_id: utilisateur.coordination_id,
      },
      performance: { durationMs: duration },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [LOGIN] Erreur de connexion :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// LOGOUT USER
// ============================================
const logoutUser = async (req, res) => {
  try {
    // Vérifier que req.user existe
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié',
      });
    }

    // Journaliser la déconnexion
    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur || req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet || req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: 'Déconnexion du système',
      actionType: 'LOGOUT',
      tableName: 'utilisateurs',
      recordId: req.user.id.toString(),
      ip: req.ip,
      details: 'Déconnexion du système',
    });

    res.json({
      success: true,
      message: 'Déconnexion réussie',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur déconnexion:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res) => {
  try {
    // Vérifier que req.user existe
    if (!req.user) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: 'Token invalide',
      });
    }

    // Optionnel : vérifier que l'utilisateur existe toujours en base
    const result = await db.query('SELECT id, actif FROM utilisateurs WHERE id = $1', [
      req.user.id,
    ]);

    if (result.rows.length === 0 || !result.rows[0].actif) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: 'Utilisateur inexistant ou désactivé',
      });
    }

    res.json({
      success: true,
      valid: true,
      user: {
        id: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination,
        coordination_id: req.user.coordination_id,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur vérification token:', error);
    res.status(500).json({
      success: false,
      valid: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// REFRESH TOKEN
// ============================================
const refreshToken = async (req, res) => {
  try {
    // Vérifier que req.user existe
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié',
      });
    }

    // Générer un nouveau token
    const newToken = jwt.sign(
      {
        id: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination,
        coordination_id: req.user.coordination_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    res.json({
      success: true,
      token: newToken,
      message: 'Token rafraîchi avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur rafraîchissement token:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// FORGOT PASSWORD
// ============================================
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email requis',
      });
    }

    // Rechercher l'utilisateur par email
    const result = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      // Pour des raisons de sécurité, on ne révèle pas si l'email existe
      return res.json({
        success: true,
        message: 'Si cet email existe, un lien de réinitialisation a été envoyé',
        timestamp: new Date().toISOString(),
      });
    }

    const utilisateur = result.rows[0];

    // Générer un token de réinitialisation (valable 1h)
    const resetToken = jwt.sign({ id: utilisateur.id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    // TODO: Envoyer un email avec le lien de réinitialisation
    // Lien: https://gescardcocody.com/reset-password?token=${resetToken}

    console.log(
      `📧 [FORGOT] Lien de réinitialisation pour ${utilisateur.nomutilisateur}:`,
      resetToken
    );

    // Journaliser la demande
    await journalService.logAction({
      utilisateurId: utilisateur.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      action: 'Demande de réinitialisation de mot de passe',
      actionType: 'FORGOT_PASSWORD',
      tableName: 'utilisateurs',
      recordId: utilisateur.id.toString(),
      ip: req.ip,
      details: `Demande de réinitialisation depuis ${req.ip}`,
    });

    res.json({
      success: true,
      message: 'Si cet email existe, un lien de réinitialisation a été envoyé',
      // En développement, on peut renvoyer le token pour test
      ...(process.env.NODE_ENV === 'development' && { resetToken }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur mot de passe oublié:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// RESET PASSWORD
// ============================================
const resetPassword = async (req, res) => {
  const client = await db.getClient();

  try {
    const { token, newPassword } = req.body;

    // ============================================
    // 1. VALIDATION DES CHAMPS
    // ============================================
    if (!token || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Token et nouveau mot de passe requis',
      });
    }

    if (newPassword.length < CONFIG.minPasswordLength) {
      return res.status(400).json({
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`,
      });
    }

    // ============================================
    // 2. VÉRIFICATION DU TOKEN
    // ============================================
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide ou expiré',
      });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide',
      });
    }

    // ============================================
    // 3. MISE À JOUR DU MOT DE PASSE
    // ============================================
    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query('BEGIN');

    // Vérifier que l'utilisateur existe toujours
    const userCheck = await client.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1',
      [decoded.id]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
      });
    }

    const utilisateur = userCheck.rows[0];

    // Mettre à jour le mot de passe
    await client.query('UPDATE utilisateurs SET motdepasse = $1 WHERE id = $2', [
      hashedPassword,
      decoded.id,
    ]);

    await client.query('COMMIT');

    // Journaliser la réinitialisation
    await journalService.logAction({
      utilisateurId: decoded.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      action: 'Réinitialisation de mot de passe',
      actionType: 'RESET_PASSWORD',
      tableName: 'utilisateurs',
      recordId: decoded.id.toString(),
      ip: req.ip,
      details: 'Réinitialisation de mot de passe réussie',
    });

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réinitialisation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    client.release();
  }
};

// ============================================
// EXPORT
// ============================================
module.exports = {
  loginUser,
  logoutUser,
  verifyToken,
  refreshToken,
  forgotPassword,
  resetPassword,
};


// ========== Controllers\cartesController.js ==========
const db = // require modifié - fichier consolidé;
const annulationService = // require modifié - fichier consolidé;

// 🔧 CONFIGURATION API EXTERNE - OPTIMISÉE POUR LWS
const API_CONFIG = {
  maxResults: 5000,
  defaultLimit: 100,
  maxSyncRecords: 2000,
  maxBatchSize: 500,
  maxFileSize: '100mb',
  enableCompression: true,
  exportMaxRows: 10000,

  SITES: [
    'ADJAME',
    "CHU D'ANGRE",
    'UNIVERSITE DE COCODY',
    'LYCEE HOTELIER',
    'BINGERVILLE',
    'SITE_6',
    'SITE_7',
    'SITE_8',
    'SITE_9',
    'SITE_10',
  ],
};

// ====================================================
// 🔄 FONCTIONS DE FUSION INTELLIGENTE
// ====================================================

const mettreAJourCarte = async (client, carteExistante, nouvellesDonnees) => {
  let updated = false;
  const updates = [];
  const params = [];
  let paramCount = 0;

  const colonnesAFusionner = {
    "LIEU D'ENROLEMENT": 'texte',
    'SITE DE RETRAIT': 'texte',
    RANGEMENT: 'texte',
    NOM: 'texte',
    PRENOMS: 'texte',
    'LIEU NAISSANCE': 'texte',
    CONTACT: 'contact',
    'CONTACT DE RETRAIT': 'contact',
    DELIVRANCE: 'delivrance',
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date',
  };

  for (const [colonne, type] of Object.entries(colonnesAFusionner)) {
    const valeurExistante = carteExistante[colonne] || '';
    const nouvelleValeur = nouvellesDonnees[colonne]?.toString().trim() || '';

    switch (type) {
      case 'delivrance': {
        const isOuiExistante = valeurExistante.toUpperCase() === 'OUI';
        const isOuiNouvelle = nouvelleValeur.toUpperCase() === 'OUI';

        if (isOuiExistante && !isOuiNouvelle && nouvelleValeur) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "OUI" → "${nouvelleValeur}" (priorité nom)`);
        } else if (!isOuiExistante && isOuiNouvelle && valeurExistante) {
          console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé vs "OUI"`);
        } else if (valeurExistante && nouvelleValeur && valeurExistante !== nouvelleValeur) {
          const dateExistante = carteExistante['DATE DE DELIVRANCE'];
          const nouvelleDate = nouvellesDonnees['DATE DE DELIVRANCE']
            ? new Date(nouvellesDonnees['DATE DE DELIVRANCE'])
            : null;

          if (nouvelleDate && (!dateExistante || nouvelleDate > new Date(dateExistante))) {
            updates.push(`"${colonne}" = $${++paramCount}`);
            params.push(nouvelleValeur);
            updated = true;
            console.log(
              `  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (date plus récente)`
            );
          } else {
            console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé (date plus récente ou égale)`);
          }
        } else if (nouvelleValeur && !valeurExistante) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "" → "${nouvelleValeur}" (ajout)`);
        }
        break;
      }

      case 'contact': {
        if (estContactPlusComplet(nouvelleValeur, valeurExistante)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;
      }

      case 'date': {
        const dateExistante = valeurExistante ? new Date(valeurExistante) : null;
        const nouvelleDate = nouvelleValeur ? new Date(nouvelleValeur) : null;

        if (nouvelleDate && estDatePlusRecente(nouvelleDate, dateExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleDate);
          updated = true;
          console.log(`  🔄 ${colonne}: ${valeurExistante} → ${nouvelleValeur} (plus récente)`);
        }
        break;
      }

      case 'texte':
      default: {
        if (estValeurPlusComplete(nouvelleValeur, valeurExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;
      }
    }
  }

  if (updated && updates.length > 0) {
    updates.push(`dateimport = $${++paramCount}`);
    params.push(new Date());
    params.push(carteExistante.id);

    const updateQuery = `
      UPDATE cartes 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
    `;

    await client.query(updateQuery, params);
    console.log(
      `✅ Carte ${carteExistante.nom} ${carteExistante.prenoms} mise à jour: ${updates.length - 1} champs`
    );
  }

  return { updated };
};

const estContactPlusComplet = (nouveauContact, ancienContact) => {
  if (!nouveauContact) return false;
  if (!ancienContact) return true;

  const hasIndicatifComplet = (contact) =>
    contact.startsWith('+225') || contact.startsWith('00225');
  const isNumerique = (contact) => /^[\d+\s\-()]+$/.test(contact);

  if (hasIndicatifComplet(nouveauContact) && !hasIndicatifComplet(ancienContact)) return true;
  if (isNumerique(nouveauContact) && !isNumerique(ancienContact)) return true;
  if (nouveauContact.length > ancienContact.length) return true;

  return false;
};

const estDatePlusRecente = (nouvelleDate, dateExistante, colonne) => {
  if (!dateExistante) return true;
  if (colonne === 'DATE DE DELIVRANCE') return nouvelleDate > dateExistante;
  return false;
};

const estValeurPlusComplete = (nouvelleValeur, valeurExistante, colonne) => {
  if (!nouvelleValeur) return false;
  if (!valeurExistante) return true;

  switch (colonne) {
    case 'NOM':
    case 'PRENOMS': {
      const hasAccents = (texte) => /[àâäéèêëîïôöùûüÿçñ]/i.test(texte);
      if (hasAccents(nouvelleValeur) && !hasAccents(valeurExistante)) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;
    }
    case 'LIEU NAISSANCE':
    case "LIEU D'ENROLEMENT": {
      const motsNouveaux = nouvelleValeur.split(/\s+/).length;
      const motsExistants = valeurExistante.split(/\s+/).length;
      if (motsNouveaux > motsExistants) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;
    }
    default:
      if (nouvelleValeur.length > valeurExistante.length) return true;
  }

  return false;
};

// ====================================================
// 🔹 CRUD CARTES (APPLICATION WEB)
// ====================================================

/**
 * Récupérer toutes les cartes avec pagination
 * GET /api/cartes
 */
const getToutesCartes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const recherche = req.query.recherche || '';

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport
      FROM cartes
    `;

    const params = [];
    let paramCount = 0;

    if (req.infosRole?.peutVoirStatistiques === 'coordination' && req.user?.coordination) {
      paramCount++;
      query += ` WHERE coordination = $${paramCount}`;
      params.push(req.user.coordination);
    }

    if (recherche) {
      paramCount++;
      const searchCondition = ` (nom ILIKE $${paramCount} OR prenoms ILIKE $${paramCount} OR contact ILIKE $${paramCount})`;
      query += query.includes('WHERE') ? ` AND${searchCondition}` : ` WHERE${searchCondition}`;
      params.push(`%${recherche}%`);
    }

    const countQuery = query
      .replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      .split(' ORDER BY')[0];

    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error('❌ Erreur getToutesCartes:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la récupération des cartes',
      details: error.message,
    });
  }
};

/**
 * Récupérer une carte par ID
 * GET /api/cartes/:id
 */
const getCarteParId = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport
       FROM cartes WHERE id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, erreur: 'Carte non trouvée' });
    }

    if (
      req.infosRole?.role === "Chef d'équipe" &&
      result.rows[0].coordination !== req.user?.coordination
    ) {
      return res.status(403).json({
        success: false,
        erreur: 'Vous ne pouvez consulter que les cartes de votre coordination',
      });
    }

    res.json({ success: true, data: result.rows[0] });
  } catch (error) {
    console.error('❌ Erreur getCarteParId:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la récupération de la carte',
      details: error.message,
    });
  }
};

/**
 * Créer une nouvelle carte
 * POST /api/cartes
 */
const createCarte = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const {
      "LIEU D'ENROLEMENT": lieuEnrolement,
      'SITE DE RETRAIT': siteRetrait,
      rangement,
      nom,
      prenoms,
      'DATE DE NAISSANCE': dateNaissance,
      'LIEU NAISSANCE': lieuNaissance,
      contact,
      delivrance,
      'CONTACT DE RETRAIT': contactRetrait,
      'DATE DE DELIVRANCE': dateDelivrance,
    } = req.body;

    if (!nom || !prenoms) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({ success: false, erreur: 'Nom et prénoms sont obligatoires' });
    }

    if (nom.length > 255 || prenoms.length > 255) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        erreur: 'Nom ou prénoms trop longs (max 255 caractères)',
      });
    }

    const coordination = req.user?.coordination || null;

    const insertQuery = `
      INSERT INTO cartes (
        "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, dateimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING id
    `;

    const result = await client.query(insertQuery, [
      lieuEnrolement || '',
      siteRetrait || '',
      rangement || '',
      nom,
      prenoms,
      dateNaissance || null,
      lieuNaissance || '',
      contact || '',
      delivrance || '',
      contactRetrait || '',
      dateDelivrance || null,
      coordination,
    ]);

    const newId = result.rows[0].id;

    await annulationService.enregistrerAction(
      req.user?.id || null,
      req.user?.nomUtilisateur || 'SYSTEM',
      req.user?.nomComplet || req.user?.nomUtilisateur || 'Système',
      req.user?.role || 'SYSTEM',
      req.user?.agence || '',
      `Création de la carte pour ${nom} ${prenoms}`,
      'INSERT',
      'cartes',
      newId,
      null,
      req.body,
      req.ip,
      null,
      coordination
    );

    await client.query('COMMIT');
    client.release();

    res.status(201).json({ success: true, message: 'Carte créée avec succès', id: newId });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur createCarte:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la création de la carte',
      details: error.message,
    });
  }
};

/**
 * Modifier une carte existante
 * PUT /api/cartes/:id
 */
const updateCarte = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const carteExistante = await client.query('SELECT * FROM cartes WHERE id = $1', [id]);

    if (carteExistante.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ success: false, erreur: 'Carte non trouvée' });
    }

    const ancienneCarte = carteExistante.rows[0];

    const CAMEL_TO_DB = {
      lieuEnrolement: "LIEU D'ENROLEMENT",
      siteRetrait: 'SITE DE RETRAIT',
      dateNaissance: 'DATE DE NAISSANCE',
      lieuNaissance: 'LIEU NAISSANCE',
      contactRetrait: 'CONTACT DE RETRAIT',
      dateDelivrance: 'DATE DE DELIVRANCE',
      rangement: 'rangement',
      nom: 'nom',
      prenoms: 'prenoms',
      contact: 'contact',
      delivrance: 'delivrance',
      coordination: 'coordination',
    };

    const CHAMPS_LECTURE_SEULE = new Set([
      'id',
      'dateCreation',
      'dateimport',
      'dateModification',
      'createurId',
      'moderateurId',
      'prenom',
    ]);

    const normaliserCles = (data) => {
      const normalise = {};
      for (const [key, value] of Object.entries(data)) {
        if (CHAMPS_LECTURE_SEULE.has(key)) continue;
        const dbKey = CAMEL_TO_DB[key] || key;
        normalise[dbKey] = value;
      }
      return normalise;
    };

    let donneesAModifier = normaliserCles({ ...req.body });

    if (Array.isArray(req.colonnesAutorisees) && req.colonnesAutorisees.length > 0) {
      const colonnesAutoriseeNormalisees = req.colonnesAutorisees.map(
        (col) => CAMEL_TO_DB[col] || col
      );
      const bodyNormalise = normaliserCles({ ...req.body });

      donneesAModifier = {};
      colonnesAutoriseeNormalisees.forEach((col) => {
        if (bodyNormalise[col] !== undefined) {
          donneesAModifier[col] = bodyNormalise[col];
        }
      });

      if (Object.keys(donneesAModifier).length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({
          success: false,
          erreur: 'Aucune modification valide',
          message: `Vous ne pouvez modifier que: ${req.colonnesAutorisees.join(', ')}`,
        });
      }
    }

    const updates = [];
    const params = [];
    let paramCount = 0;

    for (const [key, value] of Object.entries(donneesAModifier)) {
      paramCount++;
      updates.push(`"${key}" = $${paramCount}`);
      params.push(value);
    }

    paramCount++;
    updates.push(`dateimport = $${paramCount}`);
    params.push(new Date());
    params.push(id);

    const updateQuery = `
      UPDATE cartes 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount + 1}
    `;

    await client.query(updateQuery, params);

    const carteModifiee = await client.query('SELECT * FROM cartes WHERE id = $1', [id]);

    await annulationService.enregistrerAction(
      req.user?.id || null,
      req.user?.nomUtilisateur || 'SYSTEM',
      req.user?.nomComplet || req.user?.nomUtilisateur || 'Système',
      req.user?.role || 'SYSTEM',
      req.user?.agence || '',
      `Modification de la carte #${id}`,
      'UPDATE',
      'cartes',
      id,
      ancienneCarte,
      carteModifiee.rows[0],
      req.ip,
      null,
      ancienneCarte.coordination || req.user?.coordination
    );

    await client.query('COMMIT');
    client.release();

    res.json({
      success: true,
      message: 'Carte modifiée avec succès',
      modifications: Object.keys(donneesAModifier),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur updateCarte:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la modification de la carte',
      details: error.message,
    });
  }
};

/**
 * Supprimer une carte
 * DELETE /api/cartes/:id
 */
const deleteCarte = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const carteASupprimer = await client.query('SELECT * FROM cartes WHERE id = $1', [id]);

    if (carteASupprimer.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({ success: false, erreur: 'Carte non trouvée' });
    }

    if (
      req.infosRole?.role === "Chef d'équipe" &&
      carteASupprimer.rows[0].coordination !== req.user?.coordination
    ) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        erreur: 'Vous ne pouvez supprimer que les cartes de votre coordination',
      });
    }

    await client.query('DELETE FROM cartes WHERE id = $1', [id]);

    await annulationService.enregistrerAction(
      req.user?.id || null,
      req.user?.nomUtilisateur || 'SYSTEM',
      req.user?.nomComplet || req.user?.nomUtilisateur || 'Système',
      req.user?.role || 'SYSTEM',
      req.user?.agence || '',
      `Suppression de la carte #${id}`,
      'DELETE',
      'cartes',
      id,
      carteASupprimer.rows[0],
      null,
      req.ip,
      null,
      carteASupprimer.rows[0].coordination
    );

    await client.query('COMMIT');
    client.release();

    res.json({ success: true, message: 'Carte supprimée avec succès' });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur deleteCarte:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la suppression de la carte',
      details: error.message,
    });
  }
};

// ====================================================
// ✅ NOUVEAU — LISTE DES COORDINATIONS (CoordinationDropdown)
// ====================================================

/**
 * Retourne la liste distincte des coordinations présentes en base
 * GET /api/cartes/coordinations
 *
 * - Administrateur       : toutes les coordinations
 * - Gestionnaire         : sa coordination uniquement
 * - Chef d'équipe        : sa coordination uniquement
 * - Opérateur            : sa coordination uniquement
 */
const getCoordinations = async (req, res) => {
  try {
    const { role, coordination: userCoord } = req.user || {};

    const rolesLimites = ['Gestionnaire', "Chef d'équipe", 'Opérateur'];

    let result;

    if (rolesLimites.includes(role) && userCoord) {
      // Rôle limité : retourner seulement sa coordination
      result = await db.query(
        `SELECT DISTINCT coordination
         FROM cartes
         WHERE coordination IS NOT NULL
           AND coordination <> ''
           AND LOWER(coordination) = LOWER($1)
         ORDER BY coordination ASC`,
        [userCoord]
      );
    } else {
      // Administrateur : toutes les coordinations
      result = await db.query(
        `SELECT DISTINCT coordination
         FROM cartes
         WHERE coordination IS NOT NULL
           AND coordination <> ''
         ORDER BY coordination ASC`
      );
    }

    const coordinations = result.rows.map((row) => row.coordination);

    return res.json({
      success: true,
      coordinations,
      count: coordinations.length,
    });
  } catch (error) {
    console.error('❌ Erreur getCoordinations:', error);
    return res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des coordinations',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ====================================================
// 🔹 ROUTES API PUBLIQUES (SYNC EXTERNE)
// ====================================================

const healthCheck = async (req, res) => {
  try {
    const dbTest = await db.query(
      'SELECT 1 as test, version() as postgres_version, NOW() as server_time'
    );

    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques
      FROM cartes
    `);

    const sitesStats = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
    `);

    const memory = process.memoryUsage();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    res.json({
      success: true,
      status: 'healthy',
      server: {
        name: 'CartesProject API',
        version: '3.0.0-lws',
        uptime: `${hours}h ${minutes}m`,
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        },
        node_version: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development',
      },
      database: {
        status: 'connected',
        version: dbTest.rows[0].postgres_version.split(',')[0],
        server_time: dbTest.rows[0].server_time,
      },
      statistics: {
        total_cartes: parseInt(statsResult.rows[0].total_cartes),
        sites_actifs: parseInt(statsResult.rows[0].sites_actifs),
        beneficiaires_uniques: parseInt(statsResult.rows[0].beneficiaires_uniques),
      },
      sites_configures: API_CONFIG.SITES,
      sites_statistiques: sitesStats.rows,
      api: {
        max_results: API_CONFIG.maxResults,
        max_sync: API_CONFIG.maxSyncRecords,
        max_batch_size: API_CONFIG.maxBatchSize,
        max_file_size: API_CONFIG.maxFileSize,
        export_max_rows: API_CONFIG.exportMaxRows,
        rate_limit: '1000 req/min',
        features: [
          'fusion_intelligente',
          'gestion_conflits',
          'synchronisation_multicolonne',
          'compression_gzip',
          'traitement_par_lots',
          'export_complet',
        ],
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API healthCheck:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const getChanges = async (req, res) => {
  try {
    const { since } = req.query;

    console.log('📡 Récupération des changements depuis:', since);

    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000);

    const query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport,
        'UPDATE' as operation
      FROM cartes 
      WHERE dateimport > $1
      ORDER BY dateimport ASC
      LIMIT ${API_CONFIG.maxResults}
    `;

    const result = await db.query(query, [sinceDate]);

    const derniereModification =
      result.rows.length > 0
        ? result.rows[result.rows.length - 1].dateimport
        : sinceDate.toISOString();

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification,
      since: sinceDate.toISOString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des changements',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const syncData = async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { donnees, source = 'python_app', batch_id } = req.body;

    if (!donnees || !Array.isArray(donnees)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Format invalide',
        message: 'Le champ "donnees" doit être un tableau',
      });
    }

    const totalSize = JSON.stringify(donnees).length;
    const maxSizeBytes = 100 * 1024 * 1024;

    if (totalSize > maxSizeBytes) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(413).json({
        success: false,
        error: 'Données trop volumineuses',
        message: `Taille maximum: 100MB, reçu: ${Math.round(totalSize / 1024 / 1024)}MB`,
      });
    }

    if (donnees.length > API_CONFIG.maxSyncRecords) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: "Trop d'enregistrements",
        message: `Maximum ${API_CONFIG.maxSyncRecords} enregistrements par requête`,
      });
    }

    console.log(
      `🔄 Synchronisation intelligente: ${donnees.length} enregistrements depuis ${source}`
    );

    const BATCH_SIZE = API_CONFIG.maxBatchSize;
    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    let errors = 0;
    const errorDetails = [];
    const startTime = Date.now();

    for (let i = 0; i < donnees.length; i += BATCH_SIZE) {
      const batch = donnees.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(donnees.length / BATCH_SIZE);

      console.log(
        `📦 Traitement lot ${batchNum}/${totalBatches} (${batch.length} enregistrements)`
      );

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const index = i + j;

        try {
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Enregistrement ${index}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item['SITE DE RETRAIT']?.toString().trim() || '';

          const existingCarte = await client.query(
            `SELECT * FROM cartes 
             WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
            [nom, prenoms, siteRetrait]
          );

          if (existingCarte.rows.length > 0) {
            const carteExistante = existingCarte.rows[0];
            const resultUpdate = await mettreAJourCarte(client, carteExistante, item);

            if (resultUpdate.updated) {
              updated++;
              await annulationService.enregistrerAction(
                null,
                'SYSTEM',
                'Synchronisation externe',
                source,
                null,
                `Mise à jour via synchronisation (batch ${batch_id || 'N/A'})`,
                'UPDATE',
                'cartes',
                carteExistante.id,
                carteExistante,
                item,
                req.ip,
                batch_id,
                carteExistante.coordination
              );
            } else {
              duplicates++;
            }
          } else {
            const insertData = {
              "LIEU D'ENROLEMENT": item["LIEU D'ENROLEMENT"]?.toString().trim() || '',
              'SITE DE RETRAIT': siteRetrait,
              RANGEMENT: item['RANGEMENT']?.toString().trim() || '',
              NOM: nom,
              PRENOMS: prenoms,
              'DATE DE NAISSANCE': item['DATE DE NAISSANCE']
                ? new Date(item['DATE DE NAISSANCE'])
                : null,
              'LIEU NAISSANCE': item['LIEU NAISSANCE']?.toString().trim() || '',
              CONTACT: item['CONTACT']?.toString().trim() || '',
              DELIVRANCE: item['DELIVRANCE']?.toString().trim() || '',
              'CONTACT DE RETRAIT': item['CONTACT DE RETRAIT']?.toString().trim() || '',
              'DATE DE DELIVRANCE': item['DATE DE DELIVRANCE']
                ? new Date(item['DATE DE DELIVRANCE'])
                : null,
              sourceimport: source,
              batch_id: batch_id || null,
              coordination: item.coordination || null,
            };

            const insertResult = await client.query(
              `INSERT INTO cartes (
                "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
                "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
                "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", sourceimport, batch_id, coordination
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING id`,
              Object.values(insertData)
            );

            imported++;
            await annulationService.enregistrerAction(
              null,
              'SYSTEM',
              'Synchronisation externe',
              source,
              null,
              `Insertion via synchronisation (batch ${batch_id || 'N/A'})`,
              'INSERT',
              'cartes',
              insertResult.rows[0].id,
              null,
              item,
              req.ip,
              batch_id,
              insertData.coordination
            );
          }
        } catch (error) {
          errors++;
          errorDetails.push(`Enregistrement ${index}: ${error.message}`);
          console.error(`❌ Erreur enregistrement ${index}:`, error.message);
        }
      }

      if (global.gc) global.gc();
    }

    await client.query('COMMIT');
    client.release();

    const duration = Date.now() - startTime;
    const successRate =
      donnees.length > 0 ? Math.round(((imported + updated) / donnees.length) * 100) : 0;

    console.log(
      `✅ Sync UP réussie en ${duration}ms: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`
    );

    res.json({
      success: true,
      message: 'Synchronisation avec fusion intelligente réussie',
      stats: { imported, updated, duplicates, errors, totalProcessed: donnees.length, successRate },
      fusion: {
        strategy: 'intelligente_multicolonnes',
        colonnes_traitees: Object.keys(getColonnesAFusionner()),
      },
      performance: {
        duration_ms: duration,
        processing_mode: 'batch',
        batch_size: BATCH_SIZE,
        total_batches: Math.ceil(donnees.length / BATCH_SIZE),
        records_per_second: Math.round(donnees.length / (duration / 1000)),
      },
      batch_info: { batch_id: batch_id || 'N/A', source, timestamp: new Date().toISOString() },
      errorDetails: errorDetails.slice(0, 10),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la synchronisation',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const getColonnesAFusionner = () => ({
  "LIEU D'ENROLEMENT": 'texte',
  'SITE DE RETRAIT': 'texte',
  RANGEMENT: 'texte',
  NOM: 'texte',
  PRENOMS: 'texte',
  'LIEU NAISSANCE': 'texte',
  CONTACT: 'contact',
  'CONTACT DE RETRAIT': 'contact',
  DELIVRANCE: 'delivrance',
  'DATE DE NAISSANCE': 'date',
  'DATE DE DELIVRANCE': 'date',
});

const getCartes = async (req, res) => {
  try {
    const {
      nom,
      prenom,
      contact,
      siteRetrait,
      lieuNaissance,
      dateDebut,
      dateFin,
      delivrance,
      page = 1,
      limit = API_CONFIG.defaultLimit,
      export_all = 'false',
    } = req.query;

    const actualLimit =
      export_all === 'true'
        ? API_CONFIG.exportMaxRows
        : Math.min(parseInt(limit), API_CONFIG.maxResults);

    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        coordination,
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (nom) {
      paramCount++;
      query += ` AND nom ILIKE $${paramCount}`;
      params.push(`%${nom}%`);
    }
    if (prenom) {
      paramCount++;
      query += ` AND prenoms ILIKE $${paramCount}`;
      params.push(`%${prenom}%`);
    }
    if (contact) {
      paramCount++;
      query += ` AND contact ILIKE $${paramCount}`;
      params.push(`%${contact}%`);
    }
    if (siteRetrait) {
      paramCount++;
      query += ` AND "SITE DE RETRAIT" ILIKE $${paramCount}`;
      params.push(`%${siteRetrait}%`);
    }
    if (lieuNaissance) {
      paramCount++;
      query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
      params.push(`%${lieuNaissance}%`);
    }
    if (dateDebut) {
      paramCount++;
      query += ` AND dateimport >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }
    if (dateFin) {
      paramCount++;
      query += ` AND dateimport <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }
    if (delivrance) {
      paramCount++;
      query += ` AND delivrance ILIKE $${paramCount}`;
      params.push(`%${delivrance}%`);
    }

    query += ` ORDER BY id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    const result = await db.query(query, params);

    // Count séparé
    let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
    const countParams = [];
    let cp = 0;
    if (nom) {
      cp++;
      countQuery += ` AND nom ILIKE $${cp}`;
      countParams.push(`%${nom}%`);
    }
    if (prenom) {
      cp++;
      countQuery += ` AND prenoms ILIKE $${cp}`;
      countParams.push(`%${prenom}%`);
    }
    if (contact) {
      cp++;
      countQuery += ` AND contact ILIKE $${cp}`;
      countParams.push(`%${contact}%`);
    }
    if (siteRetrait) {
      cp++;
      countQuery += ` AND "SITE DE RETRAIT" ILIKE $${cp}`;
      countParams.push(`%${siteRetrait}%`);
    }
    if (lieuNaissance) {
      cp++;
      countQuery += ` AND "LIEU NAISSANCE" ILIKE $${cp}`;
      countParams.push(`%${lieuNaissance}%`);
    }
    if (dateDebut) {
      cp++;
      countQuery += ` AND dateimport >= $${cp}`;
      countParams.push(new Date(dateDebut));
    }
    if (dateFin) {
      cp++;
      countQuery += ` AND dateimport <= $${cp}`;
      countParams.push(new Date(dateFin + ' 23:59:59'));
    }
    if (delivrance) {
      cp++;
      countQuery += ` AND delivrance ILIKE $${cp}`;
      countParams.push(`%${delivrance}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    if (export_all === 'true') {
      res.setHeader('X-Total-Rows', total);
      res.setHeader('X-Export-Type', 'complete');
    }

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des cartes',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const getStats = async (req, res) => {
  try {
    const globalStats = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques,
        MIN(dateimport) as premiere_importation,
        MAX(dateimport) as derniere_importation,
        COUNT(DISTINCT batch_id) as total_batches
      FROM cartes
    `);

    const topSites = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        ROUND(COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_retrait
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
    `);

    const recentActivity = await db.query(`
      SELECT 
        DATE(dateimport) as jour,
        COUNT(*) as imports,
        COUNT(DISTINCT batch_id) as batches
      FROM cartes
      WHERE dateimport > NOW() - INTERVAL '7 days'
      GROUP BY DATE(dateimport)
      ORDER BY jour DESC
    `);

    const global = globalStats.rows[0];
    const totalCartes = parseInt(global.total_cartes);
    const cartesRetirees = parseInt(global.cartes_retirees);

    res.json({
      success: true,
      data: {
        global: {
          total_cartes: totalCartes,
          cartes_retirees: cartesRetirees,
          taux_retrait_global:
            totalCartes > 0 ? Math.round((cartesRetirees / totalCartes) * 100) : 0,
          sites_actifs: parseInt(global.sites_actifs),
          beneficiaires_uniques: parseInt(global.beneficiaires_uniques),
          premiere_importation: global.premiere_importation,
          derniere_importation: global.derniere_importation,
          total_batches: parseInt(global.total_batches || 0),
        },
        top_sites: topSites.rows,
        recent_activity: recentActivity.rows,
        sites_configures: API_CONFIG.SITES,
        system: {
          max_capacity: API_CONFIG.maxResults,
          max_sync: API_CONFIG.maxSyncRecords,
          max_batch_size: API_CONFIG.maxBatchSize,
          environment: process.env.NODE_ENV || 'production',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const getModifications = async (req, res) => {
  try {
    const { site, derniereSync, limit = 1000 } = req.query;

    if (!site || !derniereSync) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres manquants: site et derniereSync requis',
      });
    }

    if (!API_CONFIG.SITES.includes(site)) {
      return res.status(400).json({
        success: false,
        error: 'Site non reconnu',
        message: `Sites valides: ${API_CONFIG.SITES.join(', ')}`,
      });
    }

    const actualLimit = Math.min(parseInt(limit), API_CONFIG.maxResults);

    const query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport
      FROM cartes 
      WHERE "SITE DE RETRAIT" = $1 
      AND dateimport > $2
      ORDER BY dateimport ASC
      LIMIT $3
    `;

    const result = await db.query(query, [site, new Date(derniereSync), actualLimit]);

    let derniereModification = derniereSync;
    if (result.rows.length > 0) {
      derniereModification = result.rows[result.rows.length - 1].dateimport;
    }

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification,
      site,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getModifications:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des modifications',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

const getSites = async (req, res) => {
  try {
    res.json({
      success: true,
      sites: API_CONFIG.SITES,
      total_sites: API_CONFIG.SITES.length,
      description: '10 sites avec synchronisation intelligente multi-colonnes',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getSites:', error);
    res.status(500).json({ success: false, error: 'Erreur serveur', details: error.message });
  }
};

// ====================================================
// EXPORT
// ====================================================
module.exports = {
  // CRUD application web
  getToutesCartes,
  getCarteParId,
  createCarte,
  updateCarte,
  deleteCarte,

  // ✅ NOUVEAU — coordinations pour CoordinationDropdown
  getCoordinations,

  // Fonctions de fusion intelligente
  mettreAJourCarte,
  estContactPlusComplet,
  estDatePlusRecente,
  estValeurPlusComplete,

  // API publique / sync externe
  healthCheck,
  getChanges,
  syncData,
  getColonnesAFusionner,
  getCartes,
  getStats,
  getModifications,
  getSites,
  API_CONFIG,
};


// ========== Controllers\importExportController.js ==========
const db = // require modifié - fichier consolidé;
const ExcelJS = require('exceljs');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const annulationService = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION GLOBALE OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  // Formats supportés
  supportedFormats: ['.csv', '.xlsx', '.xls'],
  csvDelimiter: ';', // Point-virgule pour Excel français

  // Colonnes standard
  csvHeaders: [
    "LIEU D'ENROLEMENT",
    'SITE DE RETRAIT',
    'RANGEMENT',
    'NOM',
    'PRENOMS',
    'DATE DE NAISSANCE',
    'LIEU NAISSANCE',
    'CONTACT',
    'DELIVRANCE',
    'CONTACT DE RETRAIT',
    'DATE DE DELIVRANCE',
    'COORDINATION',
  ],

  // Contrôles
  requiredHeaders: ['NOM', 'PRENOMS'],
  isLWS: true,

  // Configuration export
  maxExportRows: 1000000,
  maxExportRowsRecommended: 500000,
  exportTimeout: 600000,
  importTimeout: 300000,
  chunkSize: 10000,
  memoryLimitMB: 512,
  batchSize: 2000,
  maxConcurrent: 3,
  compressionLevel: 6,
};

// ============================================
// CONTROLEUR PRINCIPAL OPTIMISÉ POUR LWS
// ============================================
class OptimizedImportExportController {
  constructor() {
    this.activeExports = new Map();
    this.activeImports = new Map();
    this.exportQueue = [];
    this.processingQueue = false;

    console.log('🚀 Contrôleur Import/Export optimisé pour LWS');
    console.log(`📊 Configuration LWS:`);
    console.log(`   - Max lignes export: ${CONFIG.maxExportRows.toLocaleString()}`);
    console.log(`   - Taille chunk: ${CONFIG.chunkSize.toLocaleString()}`);
    console.log(`   - Timeout export: ${CONFIG.exportTimeout / 1000}s`);
    console.log(`   - Mémoire max: ${CONFIG.memoryLimitMB}MB`);
  }

  // ============================================
  // GESTION DE LA FILE D'ATTENTE
  // ============================================

  async processExportQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;

    while (this.exportQueue.length > 0 && this.activeExports.size < CONFIG.maxConcurrent) {
      const nextExport = this.exportQueue.shift();
      try {
        await nextExport();
      } catch (error) {
        console.error("❌ Erreur dans la file d'attente:", error);
      }
    }

    this.processingQueue = false;
  }

  // ============================================
  // FONCTIONS DE VÉRIFICATION DES DROITS
  // ============================================

  verifierDroitsImportExport(req) {
    const role = req.user?.role;

    if (role === 'Administrateur' || role === 'Gestionnaire') {
      return { autorise: true };
    }

    return {
      autorise: false,
      message: 'Seuls les administrateurs et gestionnaires peuvent importer/exporter',
    };
  }

  ajouterFiltreCoordination(req, query, params, colonne = 'coordination') {
    const role = req.user?.role;
    const coordination = req.user?.coordination;
    const newParams = [...params];

    if ((role === 'Gestionnaire' || role === "Chef d'équipe") && coordination) {
      return {
        query: query + ` AND ${colonne} = $${params.length + 1}`,
        params: [...params, coordination],
      };
    }

    return { query, params: newParams };
  }

  // ============================================
  // EXPORT EXCEL LIMITÉ
  // ============================================
  async exportExcel(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `📤 Export Excel limité demandé (ID: ${exportId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export Excel limité (max ${limit}) démarré`,
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'excel_limited', limit },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 ${totalRows} cartes accessibles, export limité à ${limit}`);

      let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
      let dataParams = [];

      const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

      const finalQuery = filtreData.query + ' ORDER BY id LIMIT $' + (filtreData.params.length + 1);
      const finalParams = [...filtreData.params, limit];

      const result = await client.query(finalQuery, finalParams);

      const rows = result.rows;

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter',
        });
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GESCARD Cocody';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.lastPrinted = new Date();

      workbook.views = [
        {
          x: 0,
          y: 0,
          width: 10000,
          height: 20000,
          firstSheet: 0,
          activeTab: 0,
          visibility: 'visible',
        },
      ];

      const worksheet = workbook.addWorksheet('Cartes', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
        pageSetup: { paperSize: 9, orientation: 'landscape' },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
      });

      worksheet.columns = CONFIG.csvHeaders.map((header) => ({
        header,
        key: header.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, ''),
        width: 25,
        style: {
          font: { bold: true, size: 12 },
          alignment: { vertical: 'middle', horizontal: 'center' },
        },
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' },
          size: 12,
          name: 'Calibri',
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      rows.forEach((row, index) => {
        const excelRow = worksheet.addRow(row);

        if (index % 2 === 0) {
          excelRow.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' },
            };
          });
        }

        if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
          const delivranceCell = excelRow.getCell('delivrance');
          if (delivranceCell) {
            delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
          }
        }
      });

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: CONFIG.csvHeaders.length },
      };

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Total-Rows', rows.length);
      res.setHeader('X-Export-Type', 'limited');
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      await workbook.xlsx.write(res);

      const duration = Date.now() - startTime;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export Excel limité terminé: ${rows.length} lignes en ${duration}ms`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'excel_limited', rows: rows.length, duration },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(`✅ Export Excel limité réussi: ${rows.length} lignes en ${duration}ms`);
    } catch (error) {
      console.error(`❌ Erreur export Excel:`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export Excel",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
        });
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export Excel: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT CSV LIMITÉ
  // ============================================
  async exportCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `csv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `📤 Export CSV limité demandé (ID: ${exportId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export CSV limité (max ${limit}) démarré`,
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'csv_limited', limit },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 ${totalRows} cartes accessibles, export CSV limité à ${limit}`);

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Export-Type', 'limited');
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.write('\uFEFF');

      const headers = CONFIG.csvHeaders.map((h) => `"${h}"`).join(CONFIG.csvDelimiter) + '\n';
      res.write(headers);

      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      let iterationCount = 0;

      // Remplacer while (offset < limit) par une boucle avec break condition
      for (let page = 0; page < Math.ceil(limit / chunkSize); page++) {
        iterationCount++;
        const currentLimit = Math.min(chunkSize, limit - offset);

        if (currentLimit <= 0) break;

        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];

        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, currentLimit, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) break;

        let batchCSV = '';
        for (const row of rows) {
          const csvRow = CONFIG.csvHeaders
            .map((header) => {
              let value = row[header] || '';

              if (typeof value === 'string') {
                value = value.replace(/"/g, '""');

                if (
                  value.includes(CONFIG.csvDelimiter) ||
                  value.includes('"') ||
                  value.includes('\n') ||
                  value.includes('\r')
                ) {
                  value = `"${value}"`;
                }
              } else if (value instanceof Date) {
                value = value.toISOString().split('T')[0];
              }

              return value;
            })
            .join(CONFIG.csvDelimiter);

          batchCSV += csvRow + '\n';
          totalWritten++;
        }

        res.write(batchCSV);
        offset += rows.length;

        if (iterationCount % 5 === 0) {
          console.log(`📝 CSV limité: ${totalWritten}/${limit} lignes écrites`);
        }

        if (rows.length < currentLimit) break;
      }

      res.end();

      const duration = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (duration / 1000)) : 0;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export CSV limité terminé: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'csv_limited', rows: totalWritten, duration, speed },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(
        `✅ Export CSV limité réussi: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`
      );
    } catch (error) {
      console.error(`❌ Erreur export CSV:`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export CSV",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
        });
      } else {
        try {
          res.end();
        } catch (e) {
          // Ignorer les erreurs de fin de réponse
        }
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export CSV: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT EXCEL COMPLET
  // ============================================
  async exportCompleteExcel(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `excel_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `🚀 EXPORT EXCEL COMPLET demandé par ${req.user?.nomUtilisateur} (${req.user?.role}) (ID: ${exportId})`
    );

    if (this.activeExports.size >= CONFIG.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: "Trop d'exports en cours",
        message: `Maximum ${CONFIG.maxConcurrent} exports simultanés`,
        queueLength: this.exportQueue.length,
      });
    }

    this.activeExports.set(exportId, { startTime, type: 'excel_complete' });

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        'Export Excel COMPLET démarré',
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'excel_complete' },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 TOTAL DES DONNÉES ACCESSIBLES: ${totalRows} cartes`);

      if (totalRows === 0) {
        this.activeExports.delete(exportId);
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter',
        });
      }

      if (totalRows > CONFIG.maxExportRows) {
        console.warn(
          `⚠️ Export très volumineux: ${totalRows} lignes (max: ${CONFIG.maxExportRows})`
        );

        await annulationService.enregistrerAction(
          req.user?.id,
          req.user?.nomUtilisateur,
          req.user?.nomComplet || req.user?.nomUtilisateur,
          req.user?.role,
          req.user?.agence || '',
          `Export très volumineux: ${totalRows} lignes, peut être lent`,
          'EXPORT_WARNING',
          'Cartes',
          null,
          null,
          { rows: totalRows, warning: 'large_export' },
          req.ip,
          null,
          req.user?.coordination
        );
      }

      const sampleResult = await client.query('SELECT * FROM cartes LIMIT 1');
      const firstRow = sampleResult.rows[0] || {};

      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at', 'id'];
      const headers = Object.keys(firstRow).filter(
        (key) => !excludedColumns.includes(key.toLowerCase())
      );

      console.log(`📋 ${headers.length} colonnes détectées`);

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GESCARD Cocody';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.calcProperties.fullCalcOnLoad = false;

      const worksheet = workbook.addWorksheet('Cartes', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
        pageSetup: { paperSize: 9, orientation: 'landscape' },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
      });

      worksheet.columns = headers.map((header) => ({
        header: header.replace(/_/g, ' ').toUpperCase(),
        key: header,
        width: 25,
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' },
          size: 12,
          name: 'Calibri',
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      console.log(`⏳ Récupération et écriture des données...`);

      let offset = 0;
      const chunkSize = 2000;
      let totalWritten = 0;
      let lastProgressLog = Date.now();
      let rowOffset = 0;

      // Remplacer while (true) par une boucle avec break condition
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];

        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, chunkSize, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) {
          hasMoreData = false;
          break;
        }

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowData = {};

          headers.forEach((header) => {
            let value = row[header];

            if (value instanceof Date) {
              value = value.toLocaleDateString('fr-FR');
            }

            rowData[header] = value || '';
          });

          const excelRow = worksheet.addRow(rowData);

          if ((rowOffset + i) % 2 === 0) {
            excelRow.eachCell((cell) => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF2F2F2' },
              };
            });
          }

          if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
            const delivranceCell = excelRow.getCell('delivrance');
            if (delivranceCell) {
              delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
            }
          }
        }

        totalWritten += rows.length;
        offset += rows.length;
        rowOffset += rows.length;

        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const progress = Math.round((totalWritten / totalRows) * 100);
          const elapsed = (now - startTime) / 1000;
          const speed = Math.round(totalWritten / elapsed);

          console.log(
            `📊 Progression Excel: ${totalWritten}/${totalRows} lignes (${progress}%) - ${speed} lignes/sec`
          );
          lastProgressLog = now;
        }
      }

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 0;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(50, maxLength + 2);
      });

      console.log(`⏳ Génération finale du fichier Excel...`);

      await workbook.xlsx.write(res);

      const totalTime = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (totalTime / 1000)) : 0;
      const memoryUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export Excel COMPLET terminé: ${totalWritten} lignes en ${totalTime}ms (${speed} lignes/sec)`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'excel_complete', rows: totalWritten, duration: totalTime, speed },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(`🎉 Export Excel COMPLET réussi !`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Lignes exportées: ${totalWritten.toLocaleString()}`);
      console.log(`   - Colonnes: ${headers.length}`);
      console.log(`   - Temps total: ${(totalTime / 1000).toFixed(1)}s`);
      console.log(`   - Vitesse: ${speed} lignes/sec`);
      console.log(`   - Mémoire max: ${memoryUsed}MB`);
    } catch (error) {
      console.error(`❌ ERREUR export Excel complet (ID: ${exportId}):`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export Excel complet",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
          advice: [
            'Le fichier peut être trop volumineux pour Excel',
            "Essayez d'exporter en CSV pour les très gros fichiers",
            'Divisez vos données en plusieurs exports si nécessaire',
          ],
        });
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export Excel complet: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT CSV COMPLET
  // ============================================
  async exportCompleteCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `csv_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `🚀 EXPORT CSV COMPLET demandé par ${req.user?.nomUtilisateur} (${req.user?.role}) (ID: ${exportId})`
    );

    if (this.activeExports.size >= CONFIG.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: "Trop d'exports en cours",
        message: `Maximum ${CONFIG.maxConcurrent} exports simultanés`,
      });
    }

    this.activeExports.set(exportId, { startTime, type: 'csv_complete' });

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        'Export CSV COMPLET démarré',
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'csv_complete' },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 TOTAL DES DONNÉES ACCESSIBLES: ${totalRows} cartes`);

      if (totalRows === 0) {
        this.activeExports.delete(exportId);
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter',
        });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.write('\uFEFF');

      const sampleResult = await client.query('SELECT * FROM cartes LIMIT 1');
      const firstRow = sampleResult.rows[0] || {};

      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at'];
      const headers = Object.keys(firstRow).filter(
        (key) => !excludedColumns.includes(key.toLowerCase())
      );

      const csvHeaders = headers
        .map((header) => `"${header.replace(/"/g, '""').replace(/_/g, ' ').toUpperCase()}"`)
        .join(CONFIG.csvDelimiter);

      res.write(csvHeaders + '\n');

      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      let lastProgressLog = Date.now();

      console.log(`⏳ Début de l'export streaming CSV...`);

      // Remplacer while (true) par une boucle avec break condition
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];

        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, chunkSize, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) {
          hasMoreData = false;
          break;
        }

        let batchCSV = '';
        for (const row of rows) {
          const csvRow = headers
            .map((header) => {
              let value = row[header];

              if (value === null || value === undefined) {
                return '';
              }

              let stringValue;
              if (value instanceof Date) {
                stringValue = value.toLocaleDateString('fr-FR');
              } else {
                stringValue = String(value);
              }

              if (
                stringValue.includes(CONFIG.csvDelimiter) ||
                stringValue.includes('"') ||
                stringValue.includes('\n') ||
                stringValue.includes('\r')
              ) {
                stringValue = `"${stringValue.replace(/"/g, '""')}"`;
              }

              return stringValue;
            })
            .join(CONFIG.csvDelimiter);

          batchCSV += csvRow + '\n';
          totalWritten++;
        }

        res.write(batchCSV);
        offset += rows.length;

        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const progress = Math.round((totalWritten / totalRows) * 100);
          const elapsed = (now - startTime) / 1000;
          const speed = Math.round(totalWritten / elapsed);

          console.log(
            `📊 Progression CSV: ${totalWritten}/${totalRows} lignes (${progress}%) - ${speed} lignes/sec`
          );
          lastProgressLog = now;

          if (res.flush) res.flush();
        }

        const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memUsage > CONFIG.memoryLimitMB * 0.8) {
          console.warn(`⚠️ Mémoire élevée: ${Math.round(memUsage)}MB, pause de 100ms`);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      res.end();

      const duration = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (duration / 1000)) : 0;
      const memoryUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export CSV COMPLET terminé: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'csv_complete', rows: totalWritten, duration, speed },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(`🎉 Export CSV COMPLET réussi !`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Lignes exportées: ${totalWritten.toLocaleString()}`);
      console.log(`   - Colonnes: ${headers.length}`);
      console.log(`   - Temps total: ${(duration / 1000).toFixed(1)}s`);
      console.log(`   - Vitesse: ${speed} lignes/sec`);
      console.log(`   - Mémoire max: ${memoryUsed}MB`);
    } catch (error) {
      console.error(`❌ ERREUR export CSV complet (ID: ${exportId}):`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export CSV complet",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
        });
      } else {
        try {
          res.end();
        } catch (e) {
          // Ignorer les erreurs de fin de réponse
        }
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export CSV complet: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT TOUT EN UN CLIC
  // ============================================
  async exportAllData(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `all_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(
      `🚀 Export "TOUT EN UN" demandé par ${req.user?.nomUtilisateur} (${req.user?.role}) (ID: ${exportId})`
    );

    let client;

    try {
      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 TOTAL ACCESSIBLE: ${totalRows} cartes`);

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export "TOUT EN UN" démarré: ${totalRows} cartes`,
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'auto_select', rows: totalRows },
        req.ip,
        null,
        req.user?.coordination
      );

      let chosenFormat;

      if (totalRows > CONFIG.maxExportRowsRecommended) {
        chosenFormat = 'csv';
      } else {
        chosenFormat = 'excel';
      }

      console.log(`🤔 Format choisi: ${chosenFormat.toUpperCase()}`);

      req.exportId = exportId;

      if (chosenFormat === 'excel') {
        await this.exportCompleteExcel(req, res);
      } else {
        await this.exportCompleteCSV(req, res);
      }
    } catch (error) {
      console.error('❌ Erreur export tout en un:', error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors du choix de la méthode d'export",
          message: error.message,
          advice: [
            "Essayez d'utiliser directement /export/complete pour Excel",
            'Ou /export/complete/csv pour CSV',
            'Vérifiez que la base de données est accessible',
          ],
        });
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export tout en un: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
    }
  }

  // ============================================
  // EXPORT CSV PAR SITE
  // ============================================
  async exportCSVBySite(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { siteRetrait } = req.query;

    if (!siteRetrait) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre siteRetrait requis',
      });
    }

    const decodedSite = decodeURIComponent(siteRetrait).replace(/\+/g, ' ').trim();

    console.log(
      `📤 Export CSV pour site: ${decodedSite} par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    let client;

    try {
      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as count FROM cartes WHERE "SITE DE RETRAIT" = $1';
      let countParams = [decodedSite];

      const filtreCount = this.ajouterFiltreCoordination(
        req,
        countQuery,
        countParams,
        'coordination'
      );

      const siteCheck = await client.query(filtreCount.query, filtreCount.params);
      const count = parseInt(siteCheck.rows[0].count);

      if (count === 0) {
        return res.status(404).json({
          success: false,
          error: `Aucune donnée pour le site: ${decodedSite}`,
        });
      }

      const safeSiteName = decodedSite.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `export-${safeSiteName}-${timestamp}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Site', decodedSite);
      res.setHeader('X-Total-Rows', count);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.write('\uFEFF');

      const headers = CONFIG.csvHeaders.map((h) => `"${h}"`).join(CONFIG.csvDelimiter) + '\n';
      res.write(headers);

      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;

      // Remplacer while (true) par une boucle avec break condition
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE "SITE DE RETRAIT" = $1';
        let dataParams = [decodedSite];

        const filtreData = this.ajouterFiltreCoordination(
          req,
          dataQuery,
          dataParams,
          'coordination'
        );

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, chunkSize, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) {
          hasMoreData = false;
          break;
        }

        let batchCSV = '';
        for (const row of rows) {
          const csvRow = CONFIG.csvHeaders
            .map((header) => {
              let value = row[header] || '';

              if (typeof value === 'string') {
                value = value.replace(/"/g, '""');
                if (
                  value.includes(CONFIG.csvDelimiter) ||
                  value.includes('"') ||
                  value.includes('\n')
                ) {
                  value = `"${value}"`;
                }
              } else if (value instanceof Date) {
                value = value.toLocaleDateString('fr-FR');
              }

              return value;
            })
            .join(CONFIG.csvDelimiter);

          batchCSV += csvRow + '\n';
          totalWritten++;
        }

        res.write(batchCSV);
        offset += rows.length;

        console.log(`📝 Site ${decodedSite}: ${totalWritten}/${count} lignes`);
      }

      res.end();

      console.log(`✅ Export CSV site terminé: ${decodedSite} - ${totalWritten} lignes`);
    } catch (error) {
      console.error('❌ Erreur export CSV site:', error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur export CSV site: ' + error.message,
        });
      }
    } finally {
      if (client?.release) client.release();
    }
  }

  // ============================================
  // IMPORT CSV
  // ============================================
  async importCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignorer les erreurs de nettoyage
        }
      }
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier uploadé',
      });
    }

    const importId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();

    console.log(
      `📥 Import CSV: ${req.file.originalname} (ID: ${importId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    if (this.activeImports.size >= 2) {
      fs.unlinkSync(req.file.path);
      return res.status(429).json({
        success: false,
        error: "Trop d'imports en cours",
        message: 'Maximum 2 imports simultanés',
      });
    }

    this.activeImports.set(importId, { startTime, file: req.file.originalname });

    const client = await db.getClient();

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import CSV: ${req.file.originalname}`,
        'IMPORT_START',
        'Cartes',
        null,
        null,
        { filename: req.file.originalname },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      await client.query('BEGIN');

      const stats = fs.statSync(req.file.path);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > 100) {
        throw new Error(`Fichier trop volumineux: ${Math.round(fileSizeMB)}MB (max 100MB)`);
      }

      console.log(`📊 Taille fichier: ${Math.round(fileSizeMB)}MB`);

      const csvData = await this.parseFile(req.file.path, req.file.originalname);

      console.log(`📋 ${csvData.length} lignes à traiter`);

      if (csvData.length === 0) {
        throw new Error('Le fichier CSV est vide');
      }

      // ✅ Log des en-têtes détectés pour diagnostic
      const headersDetected = Object.keys(csvData[0]);
      console.log(`📋 En-têtes détectés: ${headersDetected.join(' | ')}`);

      // ✅ Mapping flexible des en-têtes alternatifs vers les noms standards
      // Permet d'accepter des variantes de noms de colonnes dans le fichier
      const HEADER_ALIASES = {
        NOM: ['NOM', 'NAME', 'LASTNAME', 'LAST NAME', 'FAMILLE'],
        PRENOMS: ['PRENOMS', 'PRENOM', 'FIRSTNAME', 'FIRST NAME', 'PRÉNOMS', 'PRÉNOM'],
        'SITE DE RETRAIT': ['SITE DE RETRAIT', 'SITE', 'SITERETRAIT', 'SITE_RETRAIT'],
        "LIEU D'ENROLEMENT": [
          "LIEU D'ENROLEMENT",
          'LIEU DENROLEMENT',
          'LIEU ENROLEMENT',
          'LIEU D ENROLEMENT',
          'LIEUDANROLEMENT',
          'ENROLEMENT',
        ],
        RANGEMENT: ['RANGEMENT', 'RANGE', 'CASIER'],
        'DATE DE NAISSANCE': [
          'DATE DE NAISSANCE',
          'DATENAISSANCE',
          'DATE_NAISSANCE',
          'DDN',
          'NAISSANCE',
        ],
        'LIEU NAISSANCE': [
          'LIEU NAISSANCE',
          'LIEUNAISSANCE',
          'LIEU_NAISSANCE',
          'LIEU DE NAISSANCE',
        ],
        CONTACT: ['CONTACT', 'TELEPHONE', 'TEL', 'PHONE', 'MOBILE'],
        DELIVRANCE: ['DELIVRANCE', 'DÉLIVRANCE', 'RETIRE', 'RETIRÉ', 'LIVRÉ', 'LIVRE'],
        'CONTACT DE RETRAIT': [
          'CONTACT DE RETRAIT',
          'CONTACTRETRAIT',
          'CONTACT_RETRAIT',
          'TEL RETRAIT',
        ],
        'DATE DE DELIVRANCE': [
          'DATE DE DELIVRANCE',
          'DATE DELIVRANCE',
          'DATEDELIVRANCE',
          'DATE_DELIVRANCE',
          'DATE RETRAIT',
        ],
        COORDINATION: ['COORDINATION', 'COORD', 'ZONE'],
      };

      const normaliserLigne = (row) => {
        const normalised = { ...row };
        for (const [standard, aliases] of Object.entries(HEADER_ALIASES)) {
          if (normalised[standard] !== undefined) continue; // déjà présent
          for (const alias of aliases) {
            if (row[alias] !== undefined) {
              normalised[standard] = row[alias];
              break;
            }
          }
        }
        return normalised;
      };

      const csvDataNormalisee = csvData.map(normaliserLigne);

      // ✅ Vérifier les en-têtes requis sur les données NORMALISÉES
      const firstRowNorm = csvDataNormalisee[0];
      const missingHeaders = CONFIG.requiredHeaders.filter(
        (h) => !Object.keys(firstRowNorm).some((key) => key.toUpperCase() === h)
      );

      if (missingHeaders.length > 0) {
        throw new Error(
          `En-têtes requis manquants: ${missingHeaders.join(', ')}. En-têtes détectés: ${headersDetected.join(', ')}`
        );
      }

      const batchSize = CONFIG.batchSize;
      let imported = 0;
      let updated = 0;
      let duplicates = 0;
      let errors = 0;
      const errorDetails = [];
      let processedRows = 0;

      for (let i = 0; i < csvDataNormalisee.length; i += batchSize) {
        const batch = csvDataNormalisee.slice(i, i + batchSize);
        const batchResult = await this.processCSVBatchOptimized(
          client,
          batch,
          i + 1,
          importBatchId,
          req.user?.id,
          req.user?.role,
          req.user?.coordination
        );

        imported += batchResult.imported;
        updated += batchResult.updated;
        duplicates += batchResult.duplicates || 0;
        errors += batchResult.errors;
        processedRows += batch.length;

        const progress = Math.round((processedRows / csvDataNormalisee.length) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(processedRows / elapsed);

        console.log(
          `📈 Progression: ${progress}% (${processedRows}/${csvDataNormalisee.length}) - ${speed} lignes/sec`
        );

        if (batchResult.errors > 0) {
          errorDetails.push(...batchResult.errorDetails.slice(0, 10));
        }

        if (i % (batchSize * 5) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      await client.query('COMMIT');

      const duration = Date.now() - startTime;
      const speed =
        csvDataNormalisee.length > 0 ? Math.round(csvDataNormalisee.length / (duration / 1000)) : 0;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import terminé: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} doublons bloqués, ${errors} erreurs en ${duration}ms`,
        'IMPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { imported, updated, duplicates, errors, duration, speed },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      console.log(`✅ Import terminé en ${duration}ms (${speed} lignes/sec)`);
      console.log(
        `📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} doublons bloqués, ${errors} erreurs`
      );

      res.json({
        success: true,
        message: 'Import terminé avec succès',
        stats: {
          totalRows: csvDataNormalisee.length,
          imported,
          updated,
          duplicates,
          errors,
          importBatchID: importBatchId,
        },
        performance: {
          duration_ms: duration,
          lines_per_second: speed,
          file_size_mb: Math.round(fileSizeMB * 10) / 10,
        },
        // ✅ Erreurs lisibles : max 20 renvoyées au frontend
        errors: errorDetails.slice(0, 20),
      });
    } catch (error) {
      console.error('❌ Erreur import CSV:', error);

      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.warn('⚠️ Erreur rollback:', rollbackError.message);
      }

      res.status(500).json({
        success: false,
        error: 'Erreur import CSV',
        message: error.message,
        importId,
      });
    } finally {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.warn('⚠️ Impossible supprimer fichier:', e.message);
        }
      }

      if (client?.release) client.release();
      this.activeImports.delete(importId);
    }
  }

  // ============================================
  // IMPORT SMART SYNC
  // ============================================
  async importSmartSync(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignorer les erreurs de nettoyage
        }
      }
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier uploadé',
      });
    }

    const importId = `smart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();

    console.log(
      `🧠 Import Smart Sync: ${req.file.originalname} (ID: ${importId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    const client = await db.getClient();

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import Smart Sync: ${req.file.originalname}`,
        'IMPORT_START',
        'Cartes',
        null,
        null,
        { type: 'smart', filename: req.file.originalname },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      await client.query('BEGIN');

      const csvDataRaw = await this.parseFile(req.file.path, req.file.originalname);
      const headersDetectedSmart = Object.keys(csvDataRaw[0] || {});
      console.log(`📋 En-têtes Smart Sync: ${headersDetectedSmart.join(' | ')}`);

      // Même normalisation des en-têtes que pour l'import standard
      const HEADER_ALIASES_SMART = {
        NOM: ['NOM', 'NAME', 'LASTNAME', 'LAST NAME', 'FAMILLE'],
        PRENOMS: ['PRENOMS', 'PRENOM', 'FIRSTNAME', 'FIRST NAME', 'PRÉNOMS', 'PRÉNOM'],
        'SITE DE RETRAIT': ['SITE DE RETRAIT', 'SITE', 'SITERETRAIT', 'SITE_RETRAIT'],
        "LIEU D'ENROLEMENT": [
          "LIEU D'ENROLEMENT",
          'LIEU DENROLEMENT',
          'LIEU ENROLEMENT',
          'LIEU D ENROLEMENT',
          'ENROLEMENT',
        ],
        RANGEMENT: ['RANGEMENT', 'RANGE', 'CASIER'],
        'DATE DE NAISSANCE': [
          'DATE DE NAISSANCE',
          'DATENAISSANCE',
          'DATE_NAISSANCE',
          'DDN',
          'NAISSANCE',
        ],
        'LIEU NAISSANCE': [
          'LIEU NAISSANCE',
          'LIEUNAISSANCE',
          'LIEU_NAISSANCE',
          'LIEU DE NAISSANCE',
        ],
        CONTACT: ['CONTACT', 'TELEPHONE', 'TEL', 'PHONE', 'MOBILE'],
        DELIVRANCE: ['DELIVRANCE', 'DÉLIVRANCE', 'RETIRE', 'RETIRÉ', 'LIVRÉ', 'LIVRE'],
        'CONTACT DE RETRAIT': [
          'CONTACT DE RETRAIT',
          'CONTACTRETRAIT',
          'CONTACT_RETRAIT',
          'TEL RETRAIT',
        ],
        'DATE DE DELIVRANCE': [
          'DATE DE DELIVRANCE',
          'DATE DELIVRANCE',
          'DATEDELIVRANCE',
          'DATE_DELIVRANCE',
          'DATE RETRAIT',
        ],
        COORDINATION: ['COORDINATION', 'COORD', 'ZONE'],
      };

      const csvData = csvDataRaw.map((row) => {
        const normalised = { ...row };
        for (const [standard, aliases] of Object.entries(HEADER_ALIASES_SMART)) {
          if (normalised[standard] !== undefined) continue;
          for (const alias of aliases) {
            if (row[alias] !== undefined) {
              normalised[standard] = row[alias];
              break;
            }
          }
        }
        return normalised;
      });

      console.log(`📋 ${csvData.length} lignes à traiter avec fusion intelligente`);

      let imported = 0;
      let updated = 0;
      let duplicates = 0;
      let errors = 0;
      const errorDetails = [];

      for (let i = 0; i < csvData.length; i++) {
        try {
          const item = csvData[i];

          if (!item.COORDINATION && req.user?.coordination && req.user?.role === 'Gestionnaire') {
            item.COORDINATION = req.user.coordination;
          }

          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Ligne ${i + 2}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const dateNaissanceSmartRaw = this.formatDate(item['DATE DE NAISSANCE']);
          const lieuNaissanceSmartRaw = this.sanitizeString(item['LIEU NAISSANCE']);

          // ✅ Doublon = même nom + mêmes prénoms + même date de naissance + même lieu de naissance
          const existingCarte = await client.query(
            `SELECT * FROM cartes
             WHERE LOWER(TRIM(nom)) = LOWER($1)
               AND LOWER(TRIM(prenoms)) = LOWER($2)
               AND "DATE DE NAISSANCE" = $3
               AND LOWER(TRIM("LIEU NAISSANCE")) = LOWER($4)`,
            [nom, prenoms, dateNaissanceSmartRaw, lieuNaissanceSmartRaw]
          );

          if (existingCarte.rows.length > 0) {
            const carteExistante = existingCarte.rows[0];
            const updatedRecord = await this.smartUpdateCarte(client, carteExistante, item);

            if (updatedRecord) {
              updated++;

              await annulationService.enregistrerAction(
                req.user?.id,
                req.user?.nomUtilisateur,
                req.user?.nomComplet || req.user?.nomUtilisateur,
                req.user?.role,
                req.user?.agence || '',
                `Mise à jour via import smart sync (batch ${importBatchId})`,
                'UPDATE',
                'cartes',
                carteExistante.id,
                carteExistante,
                item,
                req.ip,
                importBatchId,
                carteExistante.coordination || req.user?.coordination
              );
            } else {
              duplicates++;
            }
          } else {
            const newId = await this.smartInsertCarte(
              client,
              item,
              importBatchId,
              req.user?.id,
              req.user?.coordination
            );
            imported++;

            await annulationService.enregistrerAction(
              req.user?.id,
              req.user?.nomUtilisateur,
              req.user?.nomComplet || req.user?.nomUtilisateur,
              req.user?.role,
              req.user?.agence || '',
              `Insertion via import smart sync (batch ${importBatchId})`,
              'INSERT',
              'cartes',
              newId,
              null,
              item,
              req.ip,
              importBatchId,
              item.COORDINATION || req.user?.coordination
            );
          }
        } catch (error) {
          errors++;
          errorDetails.push(`Ligne ${i + 2}: ${error.message}`);
        }

        if ((i + 1) % 1000 === 0) {
          const progress = Math.round(((i + 1) / csvData.length) * 100);
          console.log(`📊 Progression smart: ${progress}% (${i + 1}/${csvData.length})`);
        }
      }

      await client.query('COMMIT');

      const duration = Date.now() - startTime;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import Smart Sync terminé: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`,
        'IMPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { imported, updated, duplicates, errors, duration },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      console.log(`✅ Import Smart Sync terminé en ${duration}ms`);
      console.log(
        `📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`
      );

      res.json({
        success: true,
        message: 'Import Smart Sync terminé',
        stats: {
          totalRows: csvData.length,
          imported,
          updated,
          duplicates,
          errors,
          importBatchID: importBatchId,
        },
        performance: {
          duration_ms: duration,
          lines_per_second: Math.round(csvData.length / (duration / 1000)),
        },
        errors: errorDetails.slice(0, 10),
      });
    } catch (error) {
      console.error('❌ Erreur import smart sync:', error);

      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.warn('⚠️ Erreur rollback:', rollbackError.message);
      }

      res.status(500).json({
        success: false,
        error: 'Erreur import smart sync',
        message: error.message,
      });
    } finally {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.warn('⚠️ Impossible supprimer fichier:', e.message);
        }
      }

      if (client?.release) client.release();
    }
  }

  // ============================================
  // MÉTHODES UTILITAIRES
  // ============================================

  parseCSVStream(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      let rowCount = 0;

      fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(
          csv({
            separator: CONFIG.csvDelimiter,
            mapHeaders: ({ header }) => {
              return (
                header
                  .trim()
                  .toUpperCase()
                  // ✅ Garder les apostrophes (LIEU D'ENROLEMENT) et tirets
                  .replace(/[^\w\s'-]/g, '')
                  .replace(/\s+/g, ' ')
              );
            },
            mapValues: ({ value }) => {
              if (!value) return '';
              return value.toString().trim();
            },
            skipLines: 0,
          })
        )
        .on('data', (data) => {
          results.push(data);
          rowCount++;

          if (rowCount % 10000 === 0) {
            console.log(`📖 CSV parsing: ${rowCount} lignes lues`);
          }
        })
        .on('end', () => {
          console.log(`✅ CSV parsing terminé: ${rowCount} lignes`);
          resolve(results);
        })
        .on('error', (error) => {
          reject(new Error(`Erreur parsing CSV: ${error.message}`));
        });
    });
  }

  // ✅ Parsing Excel (.xlsx / .xls) → même format de données que parseCSVStream
  async parseExcelFile(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);

    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('Le fichier Excel ne contient aucune feuille');

    // ✅ Extraire la valeur brute d'une cellule ExcelJS (gère tous les types)
    const getCellValue = (cell) => {
      if (cell === null || cell === undefined) return '';
      // ExcelJS peut retourner un objet { text, hyperlink } pour les cellules riches
      if (typeof cell === 'object') {
        if (cell.text !== undefined) return String(cell.text).trim();
        if (cell.result !== undefined) return String(cell.result).trim(); // formule
        if (cell.value !== undefined) return getCellValue(cell.value);
      }
      return String(cell).trim();
    };

    const results = [];
    let headers = [];
    let headerRowFound = false;

    worksheet.eachRow({ includeEmpty: false }, (row) => {
      // Extraire toutes les valeurs de la ligne
      const rawValues = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        rawValues[colNumber - 1] = getCellValue(cell.value);
      });

      if (!headerRowFound) {
        // Normaliser les en-têtes exactement comme parseCSVStream
        headers = rawValues.map((h) =>
          String(h || '')
            .trim()
            .toUpperCase()
            .replace(/[^\w\s'-]/g, '')
            .replace(/\s+/g, ' ')
        );
        headerRowFound = true;
        console.log(`📋 En-têtes Excel lus: ${headers.filter(Boolean).join(' | ')}`);
      } else {
        // Construire l'objet de données
        const obj = {};
        headers.forEach((header, i) => {
          if (header) obj[header] = rawValues[i] || '';
        });
        // Ignorer les lignes complètement vides
        if (Object.values(obj).some((v) => v !== '')) {
          results.push(obj);
        }
      }
    });

    console.log(`✅ Excel parsing terminé: ${results.length} lignes`);
    if (results.length > 0) {
      console.log(`📋 Exemple ligne 1: NOM=${results[0].NOM}, PRENOMS=${results[0].PRENOMS}`);
    }
    return results;
  }

  // ✅ Détecte automatiquement le format (CSV ou Excel) selon l'extension du fichier
  async parseFile(filePath, originalName) {
    const ext = (originalName || filePath).toLowerCase().split('.').pop();
    if (ext === 'xlsx' || ext === 'xls') {
      console.log(`📊 Format détecté: Excel (${ext})`);
      return this.parseExcelFile(filePath);
    }
    console.log(`📊 Format détecté: CSV`);
    return this.parseCSVStream(filePath);
  }

  async processCSVBatchOptimized(
    client,
    batch,
    startLine,
    importBatchID,
    userId,
    userRole,
    userCoordination
  ) {
    const result = {
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 0,
      errorDetails: [],
    };

    for (let i = 0; i < batch.length; i++) {
      const data = batch[i];
      const lineNum = startLine + i;
      // ✅ Déclarés avant le try pour être accessibles dans le catch
      let nom = '';
      let prenoms = '';

      try {
        if (!data.COORDINATION && userCoordination && userRole === 'Gestionnaire') {
          data.COORDINATION = userCoordination;
        }

        if (!data.NOM || !data.PRENOMS) {
          result.errors++;
          result.errorDetails.push(`Ligne ${lineNum}: NOM et PRENOMS obligatoires`);
          continue;
        }

        nom = data.NOM.toString().trim();
        prenoms = data.PRENOMS.toString().trim();
        const siteRetrait = data['SITE DE RETRAIT']?.toString().trim() || '';
        const dateNaissanceRaw = this.formatDate(data['DATE DE NAISSANCE']);
        const lieuNaissanceRaw = this.sanitizeString(data['LIEU NAISSANCE']);

        // ✅ Doublon = même nom + mêmes prénoms + même date de naissance + même lieu de naissance
        const existing = await client.query(
          `SELECT id, coordination, "SITE DE RETRAIT" as site FROM cartes
           WHERE LOWER(TRIM(nom)) = LOWER($1)
             AND LOWER(TRIM(prenoms)) = LOWER($2)
             AND "DATE DE NAISSANCE" = $3
             AND LOWER(TRIM("LIEU NAISSANCE")) = LOWER($4)`,
          [nom, prenoms, dateNaissanceRaw, lieuNaissanceRaw]
        );

        const insertData = {
          "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
          'SITE DE RETRAIT': siteRetrait,
          RANGEMENT: this.sanitizeString(data['RANGEMENT']),
          NOM: nom,
          PRENOMS: prenoms,
          'DATE DE NAISSANCE': this.formatDate(data['DATE DE NAISSANCE']),
          'LIEU NAISSANCE': this.sanitizeString(data['LIEU NAISSANCE']),
          CONTACT: this.formatPhone(data['CONTACT']),
          DELIVRANCE: this.formatDelivrance(data['DELIVRANCE']),
          'CONTACT DE RETRAIT': this.formatPhone(data['CONTACT DE RETRAIT']),
          'DATE DE DELIVRANCE': this.formatDate(data['DATE DE DELIVRANCE']),
          COORDINATION: data.COORDINATION || userCoordination,
        };

        if (existing.rows.length > 0) {
          // Doublon trouvé — bloquer si Gestionnaire et coordination différente
          if (
            userRole === 'Gestionnaire' &&
            existing.rows[0].coordination &&
            existing.rows[0].coordination !== userCoordination
          ) {
            result.duplicates++;
            result.errorDetails.push(
              `⛔ Ligne ${lineNum} [DOUBLON BLOQUÉ] "${nom} ${prenoms}" (né le ${dateNaissanceRaw || '?'} à ${lieuNaissanceRaw || '?'}) existe déjà dans la coordination "${existing.rows[0].coordination}" — modification non autorisée`
            );
            continue;
          }

          // Mise à jour de la carte existante
          await client.query(
            `
            UPDATE cartes SET
              "LIEU D'ENROLEMENT" = $1,
              rangement = $2,
              "DATE DE NAISSANCE" = $3,
              "LIEU NAISSANCE" = $4,
              contact = $5,
              delivrance = $6,
              "CONTACT DE RETRAIT" = $7,
              "DATE DE DELIVRANCE" = $8,
              coordination = $9,
              dateimport = NOW()
            WHERE id = $10
          `,
            [
              insertData["LIEU D'ENROLEMENT"],
              insertData['RANGEMENT'],
              insertData['DATE DE NAISSANCE'],
              insertData['LIEU NAISSANCE'],
              insertData['CONTACT'],
              insertData['DELIVRANCE'],
              insertData['CONTACT DE RETRAIT'],
              insertData['DATE DE DELIVRANCE'],
              insertData['COORDINATION'],
              existing.rows[0].id,
            ]
          );

          result.updated++; // mise à jour réussie — pas un doublon bloqué
        } else {
          // ✅ Nouvelle carte — colonnes en minuscules sans guillemets
          await client.query(
            `
            INSERT INTO cartes (
              "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
              "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
              "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, dateimport
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
          `,
            [
              insertData["LIEU D'ENROLEMENT"],
              insertData['SITE DE RETRAIT'],
              insertData['RANGEMENT'],
              insertData['NOM'],
              insertData['PRENOMS'],
              insertData['DATE DE NAISSANCE'],
              insertData['LIEU NAISSANCE'],
              insertData['CONTACT'],
              insertData['DELIVRANCE'],
              insertData['CONTACT DE RETRAIT'],
              insertData['DATE DE DELIVRANCE'],
              insertData['COORDINATION'],
            ]
          );

          result.imported++;
        }
      } catch (error) {
        result.errors++;
        // ✅ Message d'erreur détaillé et compréhensible
        let messageErreur = error.message;

        if (error.message.includes("n'existe pas")) {
          // Erreur colonne PostgreSQL — extraire le nom de la colonne
          const match = error.message.match(/«\s*(.+?)\s*»/);
          const colonne = match ? match[1] : '?';
          messageErreur = `Colonne inconnue en base de données: "${colonne}" — contactez l'administrateur`;
        } else if (
          error.message.includes('violates not-null') ||
          error.message.includes('null value')
        ) {
          messageErreur = `Champ obligatoire manquant (NOM ou PRENOMS vide)`;
        } else if (error.message.includes('duplicate key') || error.message.includes('unique')) {
          messageErreur = `Doublon détecté — cette carte existe déjà`;
        } else if (error.message.includes('invalid input syntax')) {
          const match = error.message.match(/type "(.+?)"/);
          const type = match ? match[1] : 'inconnu';
          messageErreur = `Format de données invalide pour le type "${type}" — vérifiez les dates et numéros`;
        }

        result.errorDetails.push(
          `❌ Ligne ${lineNum} [${nom || '?'} ${prenoms || '?'}]: ${messageErreur}`
        );

        // Logger en détail dans la console serveur
        if (result.errors <= 3) {
          console.error(`❌ Erreur import ligne ${lineNum} (${nom} ${prenoms}):`, error.message);
          console.error(`   Data:`, JSON.stringify(data).substring(0, 200));
        } else if (result.errors === 4) {
          console.error(`❌ ... (autres erreurs supprimées des logs)`);
        }
      }
    }

    return result;
  }

  async smartUpdateCarte(client, existingCarte, newData) {
    let updated = false;
    const updates = [];
    const params = [];
    let paramCount = 0;

    const columnsToCheck = [
      "LIEU D'ENROLEMENT",
      'RANGEMENT',
      'LIEU NAISSANCE',
      'CONTACT',
      'DELIVRANCE',
      'CONTACT DE RETRAIT',
      'DATE DE NAISSANCE',
      'DATE DE DELIVRANCE',
      'COORDINATION',
    ];

    for (const col of columnsToCheck) {
      const oldVal = existingCarte[col] || '';
      const newVal = newData[col] || '';

      if (newVal && newVal !== oldVal) {
        let shouldUpdate = true;

        if (col === 'CONTACT' || col === 'CONTACT DE RETRAIT') {
          if (oldVal.length > newVal.length) shouldUpdate = false;
        }

        if (
          col === 'DELIVRANCE' &&
          oldVal.toString().toUpperCase() === 'OUI' &&
          newVal.toString().toUpperCase() !== 'OUI'
        ) {
          shouldUpdate = false;
        }

        if (shouldUpdate) {
          paramCount++;
          updates.push(`"${col}" = $${paramCount}`);
          params.push(this.formatValue(col, newVal));
          updated = true;
        }
      }
    }

    if (updated) {
      paramCount++;
      updates.push(`dateimport = NOW()`);
      params.push(existingCarte.id);

      await client.query(
        `
        UPDATE cartes 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
      `,
        params
      );
    }

    return updated;
  }

  async smartInsertCarte(client, data, importBatchID, userId, userCoordination) {
    const insertData = {
      "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
      'SITE DE RETRAIT': this.sanitizeString(data['SITE DE RETRAIT']),
      RANGEMENT: this.sanitizeString(data['RANGEMENT']),
      NOM: this.sanitizeString(data['NOM']),
      PRENOMS: this.sanitizeString(data['PRENOMS']),
      'DATE DE NAISSANCE': this.formatDate(data['DATE DE NAISSANCE']),
      'LIEU NAISSANCE': this.sanitizeString(data['LIEU NAISSANCE']),
      CONTACT: this.formatPhone(data['CONTACT']),
      DELIVRANCE: this.formatDelivrance(data['DELIVRANCE']),
      'CONTACT DE RETRAIT': this.formatPhone(data['CONTACT DE RETRAIT']),
      'DATE DE DELIVRANCE': this.formatDate(data['DATE DE DELIVRANCE']),
      COORDINATION: data.COORDINATION || userCoordination,
    };

    const result = await client.query(
      `
      INSERT INTO cartes (
        "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, dateimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING id
    `,
      [
        insertData["LIEU D'ENROLEMENT"],
        insertData['SITE DE RETRAIT'],
        insertData['RANGEMENT'],
        insertData['NOM'],
        insertData['PRENOMS'],
        insertData['DATE DE NAISSANCE'],
        insertData['LIEU NAISSANCE'],
        insertData['CONTACT'],
        insertData['DELIVRANCE'],
        insertData['CONTACT DE RETRAIT'],
        insertData['DATE DE DELIVRANCE'],
        insertData['COORDINATION'],
      ]
    );

    return result.rows[0].id;
  }

  sanitizeString(value) {
    if (!value) return '';
    return value.toString().trim().replace(/\s+/g, ' ');
  }

  formatDate(value) {
    if (!value) return null;

    try {
      let date;

      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'string') {
        if (value.includes('/')) {
          const parts = value.split('/');
          if (parts.length === 3) {
            date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          }
        } else if (value.includes('-')) {
          date = new Date(value);
        } else if (!isNaN(parseInt(value))) {
          date = new Date(parseInt(value));
        } else {
          date = new Date(value);
        }
      } else {
        date = new Date(value);
      }

      if (isNaN(date.getTime())) return null;

      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  formatPhone(value) {
    if (!value) return '';

    const digits = value.toString().replace(/\D/g, '');

    if (digits.length === 10 && digits.startsWith('0')) {
      return digits;
    } else if (digits.length === 8) {
      return '0' + digits;
    } else if (digits.length === 12 && digits.startsWith('225')) {
      return '0' + digits.substring(3);
    }

    return digits.substring(0, 8);
  }

  formatDelivrance(value) {
    if (!value) return '';
    const upper = value.toString().trim().toUpperCase();
    if (upper === 'OUI' || upper === 'NON') {
      return upper;
    }
    return value.toString().trim();
  }

  formatValue(column, value) {
    if (!value) return '';

    if (column.includes('DATE')) {
      return this.formatDate(value);
    } else if (column.includes('CONTACT')) {
      return this.formatPhone(value);
    } else if (column === 'DELIVRANCE') {
      return this.formatDelivrance(value);
    } else {
      return this.sanitizeString(value);
    }
  }

  // ============================================
  // ROUTES UTILITAIRES
  // ============================================

  async getSitesList(req, res) {
    try {
      let query =
        'SELECT DISTINCT "SITE DE RETRAIT" as site FROM cartes WHERE "SITE DE RETRAIT" IS NOT NULL';
      let params = [];

      const filtre = this.ajouterFiltreCoordination(req, query, params);

      const result = await db.query(filtre.query + ' ORDER BY site', filtre.params);

      const sites = result.rows.map((row) => row.site).filter((site) => site && site.trim() !== '');

      res.json({
        success: true,
        sites,
        count: sites.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur récupération sites:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur récupération sites: ' + error.message,
      });
    }
  }

  async downloadTemplate(req, res) {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Template', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
      });

      worksheet.columns = CONFIG.csvHeaders.map((header) => ({
        header,
        key: header.replace(/\s+/g, '_'),
        width: 25,
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      const exampleData = {
        "LIEU D'ENROLEMENT": 'Abidjan Plateau',
        'SITE DE RETRAIT': 'Yopougon',
        RANGEMENT: 'A1-001',
        NOM: 'KOUAME',
        PRENOMS: 'Jean',
        'DATE DE NAISSANCE': '15/05/1990',
        'LIEU NAISSANCE': 'Abidjan',
        CONTACT: '01234567',
        DELIVRANCE: 'OUI',
        'CONTACT DE RETRAIT': '07654321',
        'DATE DE DELIVRANCE': '20/11/2024',
        COORDINATION: req.user?.coordination || 'Exemple',
      };

      const exampleRow = worksheet.addRow(exampleData);
      exampleRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      });

      worksheet.addRow([]);
      const instructions = worksheet.addRow(['INSTRUCTIONS IMPORTANTES:']);
      instructions.getCell(1).font = { bold: true };

      worksheet.addRow(['- NOM et PRENOMS sont obligatoires']);
      worksheet.addRow(['- Formats date: JJ/MM/AAAA ou AAAA-MM-JJ']);
      worksheet.addRow(['- Téléphone: 8 chiffres (sera formaté automatiquement)']);
      worksheet.addRow(['- DELIVRANCE: OUI ou NON (vide si non délivrée)']);
      worksheet.addRow(['- COORDINATION: (optionnel) sera automatiquement attribuée si vide']);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="template-import-cartes.xlsx"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-User-Role', req.user?.role || 'unknown');

      await workbook.xlsx.write(res);
    } catch (error) {
      console.error('❌ Erreur génération template:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur génération template: ' + error.message,
      });
    }
  }

  async diagnostic(req, res) {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await db.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      const sitesResult = await db.query(
        'SELECT COUNT(DISTINCT "SITE DE RETRAIT") as sites FROM cartes'
      );
      const sitesCount = parseInt(sitesResult.rows[0].sites);

      const recentResult = await db.query(`
        SELECT COUNT(*) as recent 
        FROM cartes 
        WHERE dateimport > NOW() - INTERVAL '24 hours'
      `);
      const recentImports = parseInt(recentResult.rows[0].recent);

      const coordinationStats = await db.query(`
        SELECT coordination, COUNT(*) as total 
        FROM cartes 
        WHERE coordination IS NOT NULL 
        GROUP BY coordination 
        ORDER BY total DESC
      `);

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'import-export-lws',
        environment: 'lws-optimized',
        version: '4.0.0-lws',
        user: {
          role: req.user?.role,
          coordination: req.user?.coordination,
          nom: req.user?.nomUtilisateur,
        },
        data: {
          total_cartes_accessibles: totalRows,
          sites_actifs: sitesCount,
          imports_24h: recentImports,
          exports_en_cours: this.activeExports.size,
          imports_en_cours: this.activeImports.size,
          file_d_attente: this.exportQueue.length,
        },
        coordination_stats: coordinationStats.rows,
        config: {
          maxExportRows: CONFIG.maxExportRows,
          maxExportRowsRecommended: CONFIG.maxExportRowsRecommended,
          exportTimeout: CONFIG.exportTimeout,
          importTimeout: CONFIG.importTimeout,
          chunkSize: CONFIG.chunkSize,
          batchSize: CONFIG.batchSize,
          memoryLimitMB: CONFIG.memoryLimitMB,
          maxConcurrent: CONFIG.maxConcurrent,
        },
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
          external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB',
        },
        uptime: `${hours}h ${minutes}m`,
        endpoints: {
          export_complet_excel: '/api/import-export/export/complete',
          export_complet_csv: '/api/import-export/export/complete/csv',
          export_tout_en_un: '/api/import-export/export/all',
          export_limite_excel: '/api/import-export/export',
          export_limite_csv: '/api/import-export/export/csv',
          export_par_site: '/api/import-export/export/site?siteRetrait=...',
          import_csv: '/api/import-export/import/csv',
          import_smart: '/api/import-export/import/smart-sync',
          template: '/api/import-export/template',
          sites: '/api/import-export/sites',
          diagnostic: '/api/import-export/diagnostic',
        },
        recommendations: [
          totalRows > CONFIG.maxExportRowsRecommended
            ? `⚠️ Base volumineuse (${totalRows.toLocaleString()} lignes accessibles) - Utilisez CSV pour les exports`
            : `✅ Base optimale (${totalRows.toLocaleString()} lignes accessibles) - Excel ou CSV disponibles`,
          `📊 Export recommandé: ${totalRows > CONFIG.maxExportRowsRecommended ? 'CSV' : 'Excel'}`,
          `⚡ Vitesse max théorique: ${Math.round(CONFIG.chunkSize / 10)}K lignes/sec`,
          `💾 Mémoire disponible: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB/${CONFIG.memoryLimitMB}MB`,
        ],
      });
    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur diagnostic: ' + error.message,
      });
    }
  }

  async getExportStatus(req, res) {
    res.json({
      success: true,
      activeExports: Array.from(this.activeExports.entries()).map(([id, data]) => ({
        id,
        type: data.type,
        startedAt: new Date(data.startTime).toISOString(),
        elapsed: Date.now() - data.startTime,
      })),
      activeImports: Array.from(this.activeImports.entries()).map(([id, data]) => ({
        id,
        file: data.file,
        startedAt: new Date(data.startTime).toISOString(),
        elapsed: Date.now() - data.startTime,
      })),
      queueLength: this.exportQueue.length,
    });
  }
}

// ============================================
// EXPORT
// ============================================
const controller = new OptimizedImportExportController();

module.exports = {
  importCSV: controller.importCSV.bind(controller),
  importExcel: controller.importCSV.bind(controller),
  importSmartSync: controller.importSmartSync.bind(controller),
  exportExcel: controller.exportExcel.bind(controller),
  exportCSV: controller.exportCSV.bind(controller),
  exportCompleteExcel: controller.exportCompleteExcel.bind(controller),
  exportCompleteCSV: controller.exportCompleteCSV.bind(controller),
  exportAllData: controller.exportAllData.bind(controller),
  exportCSVBySite: controller.exportCSVBySite.bind(controller),
  exportFiltered: controller.exportCSVBySite.bind(controller),
  exportResultats: controller.exportCSVBySite.bind(controller),
  exportStream: controller.exportCompleteCSV.bind(controller),
  exportOptimized: controller.exportCompleteCSV.bind(controller),
  getSitesList: controller.getSitesList.bind(controller),
  downloadTemplate: controller.downloadTemplate.bind(controller),
  diagnostic: controller.diagnostic.bind(controller),
  getExportStatus: controller.getExportStatus.bind(controller),
  CONFIG,
  _controller: controller,
};


// ========== Controllers\inventaireController.js ==========
const db = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  defaultLimit: 50,
  maxLimit: 10000, // Limite max pour les exports
  searchMinLength: 2, // Longueur min pour recherche
  cacheTimeout: 300, // Cache de 5 minutes pour les stats
  statsCache: null,
  statsCacheTime: null,
};

// ============================================
// FONCTIONS UTILITAIRES DE FILTRAGE
// ============================================

/**
 * Ajoute le filtre de coordination à une requête SQL selon le rôle
 */
const ajouterFiltreCoordination = (req, query, params, colonne = 'coordination') => {
  const role = req.user?.role;
  const coordination = req.user?.coordination;

  // Admin voit tout
  if (role === 'Administrateur') {
    return { query, params };
  }

  // Gestionnaire et Chef d'équipe: filtrés par coordination
  if ((role === 'Gestionnaire' || role === "Chef d'équipe") && coordination) {
    return {
      query: query + ` AND ${colonne} = $${params.length + 1}`,
      params: [...params, coordination],
    };
  }

  // Opérateur: voit tout mais en lecture seule (pas de filtre)
  return { query, params };
};

/**
 * Masque les informations sensibles selon le rôle
 */
const masquerInfosSensibles = (req, carte) => {
  if (!carte) return carte;

  const role = req.user?.role;

  // Admin voit tout
  if (role === 'Administrateur') {
    return carte;
  }

  // Créer une copie pour ne pas modifier l'original
  const carteMasquee = { ...carte };

  // Gestionnaire et Chef d'équipe: voient tout (pas d'infos ultra-sensibles dans l'inventaire)
  if (role === 'Gestionnaire' || role === "Chef d'équipe") {
    return carteMasquee;
  }

  // Opérateur: masquer certaines infos si nécessaire
  if (role === 'Opérateur') {
    // Par exemple, masquer les contacts partiellement
    if (carteMasquee.contact && carteMasquee.contact.length > 4) {
      carteMasquee.contact = carteMasquee.contact.slice(0, -4) + '****';
    }
    if (carteMasquee['CONTACT DE RETRAIT'] && carteMasquee['CONTACT DE RETRAIT'].length > 4) {
      carteMasquee['CONTACT DE RETRAIT'] = carteMasquee['CONTACT DE RETRAIT'].slice(0, -4) + '****';
    }
  }

  return carteMasquee;
};

/**
 * Masque les informations sensibles sur un tableau de cartes
 */
const masquerInfosSensiblesTableau = (req, cartes) => {
  if (!Array.isArray(cartes)) return cartes;
  return cartes.map((carte) => masquerInfosSensibles(req, carte));
};

// ============================================
// CONTROLEUR D'INVENTAIRE OPTIMISÉ POUR LWS
// ============================================
const inventaireController = {
  /**
   * 🔍 RECHERCHE MULTICRITÈRES AVEC PAGINATION - OPTIMISÉE POUR LWS
   * GET /api/inventaire/recherche
   */
  rechercheCartes: async (req, res) => {
    try {
      const {
        nom,
        prenom,
        contact,
        siteRetrait,
        lieuNaissance,
        dateNaissance,
        rangement,
        delivrance,
        page = 1,
        limit = CONFIG.defaultLimit,
        export_all = 'false',
      } = req.query;

      console.log(`📦 Recherche par ${req.user.nomUtilisateur} (${req.user.role}):`, req.query);

      // ✅ PAGINATION ADAPTATIVE
      const pageNum = Math.max(1, parseInt(page));
      const limitNum =
        export_all === 'true' ? CONFIG.maxLimit : Math.min(parseInt(limit), CONFIG.maxLimit);
      const offset = (pageNum - 1) * limitNum;

      // ✅ CONSTRUCTION DYNAMIQUE DE LA REQUÊTE
      let query = `SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        coordination,
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes WHERE 1=1`;

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      const params = [];
      const countParams = [];
      let paramCount = 0;

      // 🔤 NOM (recherche partielle optimisée)
      if (nom && nom.trim() !== '' && nom.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND nom ILIKE $${paramCount}`;
        countQuery += ` AND nom ILIKE $${paramCount}`;
        params.push(`%${nom.trim()}%`);
        countParams.push(`%${nom.trim()}%`);
      }

      // 🔤 PRÉNOM (recherche partielle)
      if (prenom && prenom.trim() !== '' && prenom.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND prenoms ILIKE $${paramCount}`;
        countQuery += ` AND prenoms ILIKE $${paramCount}`;
        params.push(`%${prenom.trim()}%`);
        countParams.push(`%${prenom.trim()}%`);
      }

      // 📞 CONTACT (recherche partielle - format téléphone)
      if (contact && contact.trim() !== '') {
        paramCount++;
        const contactClean = contact.trim().replace(/\D/g, '');
        query += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
        countQuery += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
        params.push(`%${contactClean}%`, `%${contact.trim()}%`);
        countParams.push(`%${contactClean}%`, `%${contact.trim()}%`);
        paramCount++;
      }

      // 🏢 SITE DE RETRAIT
      if (siteRetrait && siteRetrait.trim() !== '') {
        paramCount++;
        if (siteRetrait.includes(',')) {
          const sites = siteRetrait.split(',').map((s) => s.trim());
          const siteParams = sites.map((_, idx) => `$${paramCount + idx}`).join(', ');
          query += ` AND "SITE DE RETRAIT" IN (${siteParams})`;
          countQuery += ` AND "SITE DE RETRAIT" IN (${siteParams})`;
          sites.forEach((site) => {
            params.push(site);
            countParams.push(site);
          });
          paramCount += sites.length - 1;
        } else {
          query += ` AND "SITE DE RETRAIT" = $${paramCount}`;
          countQuery += ` AND "SITE DE RETRAIT" = $${paramCount}`;
          params.push(siteRetrait.trim());
          countParams.push(siteRetrait.trim());
        }
      }

      // 🗺️ LIEU DE NAISSANCE
      if (
        lieuNaissance &&
        lieuNaissance.trim() !== '' &&
        lieuNaissance.length >= CONFIG.searchMinLength
      ) {
        paramCount++;
        query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
        countQuery += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
        params.push(`%${lieuNaissance.trim()}%`);
        countParams.push(`%${lieuNaissance.trim()}%`);
      }

      // 🎂 DATE DE NAISSANCE
      if (dateNaissance && dateNaissance.trim() !== '') {
        paramCount++;
        if (dateNaissance.includes(',')) {
          const [debut, fin] = dateNaissance.split(',').map((d) => d.trim());
          query += ` AND "DATE DE NAISSANCE" BETWEEN $${paramCount} AND $${paramCount + 1}`;
          countQuery += ` AND "DATE DE NAISSANCE" BETWEEN $${paramCount} AND $${paramCount + 1}`;
          params.push(debut, fin);
          countParams.push(debut, fin);
          paramCount++;
        } else {
          query += ` AND "DATE DE NAISSANCE" = $${paramCount}`;
          countQuery += ` AND "DATE DE NAISSANCE" = $${paramCount}`;
          params.push(dateNaissance.trim());
          countParams.push(dateNaissance.trim());
        }
      }

      // 📦 RANGEMENT
      if (rangement && rangement.trim() !== '' && rangement.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND rangement ILIKE $${paramCount}`;
        countQuery += ` AND rangement ILIKE $${paramCount}`;
        params.push(`%${rangement.trim()}%`);
        countParams.push(`%${rangement.trim()}%`);
      }

      // ✅ FILTRE DÉLIVRANCE
      if (delivrance && delivrance.trim() !== '') {
        paramCount++;
        const delivValue = delivrance.trim().toUpperCase();
        if (delivValue === 'OUI' || delivValue === 'NON') {
          query += ` AND UPPER(delivrance) = $${paramCount}`;
          countQuery += ` AND UPPER(delivrance) = $${paramCount}`;
          params.push(delivValue);
          countParams.push(delivValue);
        }
      }

      // ✅ APPLIQUER LE FILTRE DE COORDINATION SELON LE RÔLE
      const filtreQuery = ajouterFiltreCoordination(req, query, params);
      const filtreCountQuery = ajouterFiltreCoordination(req, countQuery, countParams);

      // ✅ TRI INTELLIGENT
      filtreQuery.query += ` ORDER BY 
        CASE 
          WHEN "SITE DE RETRAIT" IS NULL THEN 1 
          ELSE 0 
        END,
        "SITE DE RETRAIT",
        nom,
        prenoms
      `;

      // ✅ PAGINATION
      if (export_all !== 'true') {
        filtreQuery.query += ` LIMIT $${filtreQuery.params.length + 1} OFFSET $${filtreQuery.params.length + 2}`;
        filtreQuery.params.push(limitNum, offset);
      }

      console.log('📋 Requête SQL:', filtreQuery.query);
      console.log('🔢 Paramètres:', filtreQuery.params);

      // 🗄️ EXÉCUTION DES REQUÊTES
      const startTime = Date.now();

      const result = await db.query(filtreQuery.query, filtreQuery.params);
      const countResult = await db.query(filtreCountQuery.query, filtreCountQuery.params);

      const duration = Date.now() - startTime;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limitNum);

      // 🔒 Masquer les informations sensibles selon le rôle
      const cartesMasquees = masquerInfosSensiblesTableau(req, result.rows);

      console.log(`✅ ${result.rows.length} cartes trouvées sur ${total} total (${duration}ms)`);

      // Headers pour export
      if (export_all === 'true') {
        res.setHeader('X-Total-Rows', total);
        res.setHeader('X-Query-Time', `${duration}ms`);
      }
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.json({
        success: true,
        cartes: cartesMasquees,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
        performance: {
          queryTime: duration,
          returnedRows: result.rows.length,
        },
        criteres: {
          nom: nom || null,
          prenom: prenom || null,
          contact: contact || null,
          siteRetrait: siteRetrait || null,
          lieuNaissance: lieuNaissance || null,
          dateNaissance: dateNaissance || null,
          rangement: rangement || null,
          delivrance: delivrance || null,
        },
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur recherche:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la recherche',
        details: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * 📊 STATISTIQUES D'INVENTAIRE AVEC CACHE ET FILTRAGE PAR COORDINATION
   * GET /api/inventaire/stats
   */
  getStatistiques: async (req, res) => {
    try {
      const { forceRefresh } = req.query;

      // Vérifier le cache (5 minutes) - seulement pour Admin
      if (
        req.user.role === 'Administrateur' &&
        !forceRefresh &&
        CONFIG.statsCache &&
        CONFIG.statsCacheTime &&
        Date.now() - CONFIG.statsCacheTime < CONFIG.cacheTimeout * 1000
      ) {
        console.log('📦 Stats servies depuis le cache');
        return res.json({
          success: true,
          ...CONFIG.statsCache,
          cached: true,
          cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime) / 1000) + 's',
        });
      }

      const startTime = Date.now();

      // Pour les gestionnaires, on filtre par coordination
      const role = req.user.role;
      const coordination = req.user.coordination;

      let totalQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let totalParams = [];

      let retiresQuery = `
        SELECT COUNT(*) as retires FROM cartes 
        WHERE delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON'
      `;
      let retiresParams = [];

      let sitesQuery = `
        SELECT 
          "SITE DE RETRAIT" as site,
          COUNT(*) as total,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as retires,
          COUNT(CASE WHEN delivrance IS NULL OR delivrance = '' OR UPPER(delivrance) = 'NON' THEN 1 END) as disponibles
        FROM cartes 
        WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      `;
      let sitesParams = [];

      let recentesQuery = `
        SELECT 
          id, 
          nom, 
          prenoms, 
          "SITE DE RETRAIT" as site,
          delivrance,
          coordination,
          TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
        FROM cartes 
        ORDER BY dateimport DESC 
        LIMIT 20
      `;
      let recentesParams = [];

      // Appliquer les filtres selon le rôle
      if (role === 'Gestionnaire' && coordination) {
        totalQuery += ` AND coordination = $1`;
        totalParams = [coordination];

        retiresQuery += ` AND coordination = $1`;
        retiresParams = [coordination];

        sitesQuery += ` AND coordination = $1`;
        sitesParams = [coordination];

        recentesQuery = `
          SELECT 
            id, 
            nom, 
            prenoms, 
            "SITE DE RETRAIT" as site,
            delivrance,
            coordination,
            TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
          FROM cartes 
          WHERE coordination = $1
          ORDER BY dateimport DESC 
          LIMIT 20
        `;
        recentesParams = [coordination];
      }

      // Exécuter les requêtes
      const totalResult = await db.query(totalQuery, totalParams);
      const retiresResult = await db.query(retiresQuery, retiresParams);
      const sitesResult = await db.query(
        sitesQuery + ' GROUP BY "SITE DE RETRAIT" ORDER BY total DESC',
        sitesParams
      );
      const recentesResult = await db.query(recentesQuery, recentesParams);

      // Statistiques temporelles (optionnellement filtrées)
      let temporelQuery = `
        SELECT 
          DATE_TRUNC('month', dateimport) as mois,
          COUNT(*) as total
        FROM cartes
        WHERE dateimport > NOW() - INTERVAL '6 months'
      `;
      let temporelParams = [];

      if (role === 'Gestionnaire' && coordination) {
        temporelQuery += ` AND coordination = $1`;
        temporelParams = [coordination];
      }

      temporelQuery += " GROUP BY DATE_TRUNC('month', dateimport) ORDER BY mois DESC";

      const temporelResult = await db.query(temporelQuery, temporelParams);

      const total = parseInt(totalResult.rows[0].total);
      const retires = parseInt(retiresResult.rows[0].retires);
      const disponibles = total - retires;
      const tauxRetrait = total > 0 ? Math.round((retires / total) * 100) : 0;

      const statsData = {
        statistiques: {
          global: {
            total,
            retires,
            disponibles,
            tauxRetrait,
          },
          parSite: sitesResult.rows.map((site) => ({
            ...site,
            tauxRetrait: site.total > 0 ? Math.round((site.retires / site.total) * 100) : 0,
          })),
          recentes: masquerInfosSensiblesTableau(req, recentesResult.rows),
          temporel: temporelResult.rows,
        },
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
        performance: {
          queryTime: Date.now() - startTime,
        },
        timestamp: new Date().toISOString(),
      };

      // Mettre en cache seulement pour Admin
      if (role === 'Administrateur') {
        CONFIG.statsCache = statsData;
        CONFIG.statsCacheTime = Date.now();
      }

      res.json({
        success: true,
        ...statsData,
        cached: false,
      });
    } catch (error) {
      console.error('❌ Erreur statistiques:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du calcul des statistiques',
        details: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * 🔍 RECHERCHE RAPIDE OPTIMISÉE AVEC FILTRE COORDINATION
   * GET /api/inventaire/recherche-rapide?q=terme
   */
  rechercheRapide: async (req, res) => {
    try {
      const { q, limit = 20 } = req.query;

      if (!q || q.trim() === '') {
        return res.json({
          success: true,
          resultats: [],
          total: 0,
        });
      }

      if (q.trim().length < CONFIG.searchMinLength) {
        return res.json({
          success: true,
          resultats: [],
          total: 0,
          message: `Minimum ${CONFIG.searchMinLength} caractères requis`,
        });
      }

      const searchTerm = `%${q.trim()}%`;
      const limitNum = Math.min(parseInt(limit), 100);

      const startTime = Date.now();

      // Construire la requête avec filtre de coordination
      let query = `
        SELECT 
          id,
          nom,
          prenoms,
          "SITE DE RETRAIT" as site,
          contact,
          delivrance,
          rangement,
          coordination,
          CASE 
            WHEN nom ILIKE $1 THEN 10
            WHEN prenoms ILIKE $1 THEN 9
            WHEN contact ILIKE $1 THEN 8
            WHEN "SITE DE RETRAIT" ILIKE $1 THEN 7
            WHEN "LIEU NAISSANCE" ILIKE $1 THEN 6
            WHEN rangement ILIKE $1 THEN 5
            ELSE 1
          END as pertinence
        FROM cartes 
        WHERE 
          (nom ILIKE $1 OR
          prenoms ILIKE $1 OR
          contact ILIKE $1 OR
          "SITE DE RETRAIT" ILIKE $1 OR
          "LIEU NAISSANCE" ILIKE $1 OR
          rangement ILIKE $1)
      `;

      const params = [searchTerm];

      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');

      filtreQuery.query +=
        ' ORDER BY pertinence DESC, nom, prenoms LIMIT $' + (filtreQuery.params.length + 1);
      filtreQuery.params.push(limitNum);

      const result = await db.query(filtreQuery.query, filtreQuery.params);

      const duration = Date.now() - startTime;

      // Masquer les infos sensibles
      const resultatsMasques = masquerInfosSensiblesTableau(req, result.rows);

      res.json({
        success: true,
        resultats: resultatsMasques,
        total: result.rows.length,
        performance: {
          queryTime: duration,
        },
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur recherche rapide:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la recherche rapide',
        details: error.message,
      });
    }
  },

  /**
   * 📋 LISTE DES SITES AVEC STATISTIQUES (FILTRÉE PAR COORDINATION)
   * GET /api/inventaire/sites
   */
  getSites: async (req, res) => {
    try {
      const startTime = Date.now();

      let query = `
        SELECT 
          "SITE DE RETRAIT" as site,
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees,
          MIN(dateimport) as premier_import,
          MAX(dateimport) as dernier_import
        FROM cartes 
        WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      `;

      let params = [];

      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');

      filtreQuery.query += ' GROUP BY "SITE DE RETRAIT" ORDER BY "SITE DE RETRAIT"';

      const result = await db.query(filtreQuery.query, filtreQuery.params);

      const sites = result.rows.map((row) => ({
        ...row,
        taux_retrait:
          row.total_cartes > 0 ? Math.round((row.cartes_retirees / row.total_cartes) * 100) : 0,
      }));

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        sites,
        total: sites.length,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
        performance: {
          queryTime: duration,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur récupération sites:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des sites',
        details: error.message,
      });
    }
  },

  /**
   * 🎯 CARTES PAR SITE AVEC PAGINATION (FILTRÉE PAR COORDINATION)
   * GET /api/inventaire/site/:site
   */
  getCartesParSite: async (req, res) => {
    try {
      const { site } = req.params;
      const { page = 1, limit = CONFIG.defaultLimit, delivrance } = req.query;

      if (!site) {
        return res.status(400).json({
          success: false,
          error: 'Le paramètre site est obligatoire',
        });
      }

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), CONFIG.maxLimit);
      const offset = (pageNum - 1) * limitNum;

      const decodedSite = decodeURIComponent(site).replace(/\+/g, ' ').trim();

      let query = `
        SELECT 
          id,
          "LIEU D'ENROLEMENT",
          rangement,
          nom,
          prenoms,
          TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
          "LIEU NAISSANCE",
          contact,
          delivrance,
          "CONTACT DE RETRAIT",
          TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
          coordination,
          TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
        FROM cartes 
        WHERE "SITE DE RETRAIT" = $1
      `;

      const params = [decodedSite];
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE "SITE DE RETRAIT" = $1';
      const countParams = [decodedSite];

      // Filtre délivrance optionnel
      if (delivrance && delivrance.trim() !== '') {
        const delivValue = delivrance.trim().toUpperCase();
        if (delivValue === 'OUI' || delivValue === 'NON') {
          query += ` AND UPPER(delivrance) = $2`;
          countQuery += ` AND UPPER(delivrance) = $2`;
          params.push(delivValue);
          countParams.push(delivValue);
        }
      }

      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');
      const filtreCountQuery = ajouterFiltreCoordination(
        req,
        countQuery,
        countParams,
        'coordination'
      );

      // Tri et pagination
      filtreQuery.query += ` ORDER BY nom, prenoms LIMIT $${filtreQuery.params.length + 1} OFFSET $${filtreQuery.params.length + 2}`;
      filtreQuery.params.push(limitNum, offset);

      const startTime = Date.now();

      const result = await db.query(filtreQuery.query, filtreQuery.params);
      const countResult = await db.query(filtreCountQuery.query, filtreCountQuery.params);

      const duration = Date.now() - startTime;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limitNum);

      // Masquer les infos sensibles
      const cartesMasquees = masquerInfosSensiblesTableau(req, result.rows);

      res.json({
        success: true,
        cartes: cartesMasquees,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1,
        },
        site: decodedSite,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
          delivrance: delivrance || null,
        },
        performance: {
          queryTime: duration,
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur cartes par site:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des cartes par site',
        details: error.message,
      });
    }
  },

  /**
   * 📊 STATISTIQUES DÉTAILLÉES PAR SITE (FILTRÉES PAR COORDINATION)
   * GET /api/inventaire/site/:site/stats
   */
  getSiteStats: async (req, res) => {
    try {
      const { site } = req.params;

      if (!site) {
        return res.status(400).json({
          success: false,
          error: 'Le paramètre site est obligatoire',
        });
      }

      const decodedSite = decodeURIComponent(site).replace(/\+/g, ' ').trim();

      let query = `
        SELECT 
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees,
          COUNT(CASE WHEN delivrance IS NULL OR delivrance = '' OR UPPER(delivrance) = 'NON' THEN 1 END) as cartes_disponibles,
          MIN(dateimport) as premier_import,
          MAX(dateimport) as dernier_import,
          COUNT(DISTINCT batch_id) as total_imports,
          COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days' THEN 1 END) as imports_7j
        FROM cartes 
        WHERE "SITE DE RETRAIT" = $1
      `;

      const params = [decodedSite];

      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');

      const result = await db.query(filtreQuery.query, filtreQuery.params);

      const stats = result.rows[0];
      stats.taux_retrait =
        stats.total_cartes > 0 ? Math.round((stats.cartes_retirees / stats.total_cartes) * 100) : 0;

      res.json({
        success: true,
        site: decodedSite,
        statistiques: stats,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats site:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des statistiques du site',
        details: error.message,
      });
    }
  },

  /**
   * 🔄 RAFRAÎCHIR LE CACHE DES STATISTIQUES (Admin uniquement)
   * POST /api/inventaire/cache/refresh
   */
  refreshCache: async (req, res) => {
    try {
      // Vérifier que l'utilisateur est admin (déjà fait par middleware)
      if (req.user.role !== 'Administrateur') {
        return res.status(403).json({
          success: false,
          error: 'Seuls les administrateurs peuvent rafraîchir le cache',
        });
      }

      // Vider le cache
      CONFIG.statsCache = null;
      CONFIG.statsCacheTime = null;

      res.json({
        success: true,
        message: 'Cache vidé avec succès',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur refresh cache:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du rafraîchissement du cache',
        details: error.message,
      });
    }
  },

  /**
   * 🔍 DIAGNOSTIC INVENTAIRE (Admin uniquement)
   * GET /api/inventaire/diagnostic
   */
  diagnostic: async (req, res) => {
    try {
      // Vérifier que l'utilisateur est admin
      if (req.user.role !== 'Administrateur') {
        return res.status(403).json({
          success: false,
          error: 'Seuls les administrateurs peuvent accéder au diagnostic',
        });
      }

      const startTime = Date.now();

      // Statistiques par coordination
      const coordinationStats = await db.query(`
        SELECT 
          coordination,
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees
        FROM cartes 
        WHERE coordination IS NOT NULL
        GROUP BY coordination
        ORDER BY total_cartes DESC
      `);

      // Compter les enregistrements
      const countResult = await db.query('SELECT COUNT(*) as total FROM cartes');
      const total = parseInt(countResult.rows[0].total);

      // Vérifier les index
      const indexResult = await db.query(`
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes
        WHERE tablename = 'cartes'
      `);

      // Derniers imports
      const lastImport = await db.query(`
        SELECT 
          MAX(dateimport) as dernier_import,
          COUNT(DISTINCT batch_id) as total_batches
        FROM cartes
      `);

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'inventaire',
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination,
        },
        database: {
          total_cartes: total,
          dernier_import: lastImport.rows[0].dernier_import,
          total_batches: parseInt(lastImport.rows[0].total_batches || 0),
        },
        coordination_stats: coordinationStats.rows,
        indexes: indexResult.rows.map((idx) => ({
          name: idx.indexname,
          definition: idx.indexdef,
        })),
        config: {
          defaultLimit: CONFIG.defaultLimit,
          maxLimit: CONFIG.maxLimit,
          searchMinLength: CONFIG.searchMinLength,
          cacheTimeout: CONFIG.cacheTimeout,
        },
        performance: {
          queryTime: Date.now() - startTime,
        },
        endpoints: [
          '/api/inventaire/recherche',
          '/api/inventaire/stats',
          '/api/inventaire/recherche-rapide',
          '/api/inventaire/sites',
          '/api/inventaire/site/:site',
          '/api/inventaire/site/:site/stats',
          '/api/inventaire/cache/refresh',
          '/api/inventaire/diagnostic',
        ],
      });
    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  },
};

module.exports = inventaireController;


// ========== Controllers\journalController.js ==========
// ============================================
// CONTROLLER JOURNAL
// ============================================

const db = // require modifié - fichier consolidé;
const journalService = // require modifié - fichier consolidé;

// ============================================
// GET JOURNAL
// ============================================
const getJournal = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 50,
      utilisateurId,
      actionType,
      tableName,
      dateDebut,
      dateFin,
      coordination,
      annulee,
    } = req.query;

    const result = await journalService.getJournal({
      page: parseInt(page),
      limit: parseInt(limit),
      utilisateurId,
      actionType,
      tableName,
      dateDebut,
      dateFin,
      coordination,
      annulee: annulee === 'true' ? true : annulee === 'false' ? false : undefined,
    });

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      data: result.data,
      pagination: {
        page: result.page,
        limit: result.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / result.limit),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getJournal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET JOURNAL BY ID
// ============================================
const getJournalById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT 
        j.*,
        u.nomutilisateur as utilisateur_nom,
        u2.nomutilisateur as annule_par_nom
      FROM journalactivite j
      LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
      LEFT JOIN utilisateurs u2 ON j.annulee_par = u2.id
      WHERE j.journalid = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Entrée non trouvée' });
    }

    res.json({
      success: true,
      data: result.rows[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getJournalById:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET IMPORTS
// ============================================
const getImports = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        importbatchid,
        COUNT(*) as total_cartes,
        MIN(dateimport) as date_debut,
        MAX(dateimport) as date_fin,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites,
        MIN(coordination) as coordination
      FROM cartes
      WHERE importbatchid IS NOT NULL
      GROUP BY importbatchid
      ORDER BY date_debut DESC
      LIMIT 100
    `);

    res.json({
      success: true,
      data: result.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getImports:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET IMPORT DETAILS
// ============================================
const getImportDetails = async (req, res) => {
  try {
    const { batchId } = req.params;

    const result = await db.query(
      `
      SELECT 
        j.*,
        u.nomutilisateur
      FROM journalactivite j
      LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
      WHERE j.importbatchid = $1
      ORDER BY j.dateaction DESC
    `,
      [batchId]
    );

    res.json({
      success: true,
      data: result.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getImportDetails:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET STATS
// ============================================
const getStats = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_actions,
        COUNT(DISTINCT utilisateurid) as utilisateurs_actifs,
        COUNT(DISTINCT actiontype) as types_actions,
        MIN(dateaction) as premiere_action,
        MAX(dateaction) as derniere_action,
        COUNT(CASE WHEN dateaction > NOW() - INTERVAL '24 hours' THEN 1 END) as actions_24h,
        COUNT(CASE WHEN dateaction > NOW() - INTERVAL '7 days' THEN 1 END) as actions_7j,
        COUNT(CASE WHEN annulee = true THEN 1 END) as actions_annulees
      FROM journalactivite
    `);

    const topUsers = await db.query(`
      SELECT 
        utilisateurid,
        u.nomutilisateur,
        COUNT(*) as total_actions
      FROM journalactivite j
      LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
      GROUP BY utilisateurid, u.nomutilisateur
      ORDER BY total_actions DESC
      LIMIT 5
    `);

    const topActions = await db.query(`
      SELECT 
        actiontype,
        COUNT(*) as count
      FROM journalactivite
      GROUP BY actiontype
      ORDER BY count DESC
      LIMIT 5
    `);

    res.json({
      success: true,
      stats: result.rows[0],
      topUsers: topUsers.rows,
      topActions: topActions.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getStats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// GET ACTIONS ANNUABLES
// ============================================
const getActionsAnnulables = async (req, res) => {
  try {
    const result = await journalService.getActionsAnnulables();

    if (!result.success) {
      return res.status(500).json({ success: false, error: result.error });
    }

    res.json({
      success: true,
      data: result.data,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getActionsAnnulables:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// ANNULER ACTION
// ============================================
const annulerAction = async (req, res) => {
  const client = await db.getClient();
  try {
    const { id } = req.params;
    const adminId = req.user.id;

    await client.query('BEGIN');

    // Récupérer l'action originale
    const action = await client.query(
      'SELECT * FROM journalactivite WHERE journalid = $1 AND annulee = false',
      [id]
    );

    if (action.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Action non trouvée ou déjà annulée',
      });
    }

    const entree = action.rows[0];

    // Récupérer les anciennes valeurs
    let anciennesValeurs;
    try {
      anciennesValeurs =
        typeof entree.oldvalue === 'string' ? JSON.parse(entree.oldvalue) : entree.oldvalue || {};
    } catch (e) {
      anciennesValeurs = {};
    }

    const table = entree.tablename;
    const recordId = entree.recordid;

    // Restaurer selon le type d'action
    switch (entree.actiontype) {
      case 'INSERT':
      case 'CREATE_USER':
      case 'CREATE':
        await client.query(`DELETE FROM ${table} WHERE id = $1`, [recordId]);
        break;

      case 'UPDATE':
      case 'UPDATE_USER':
      case 'MODIFICATION':
        if (Object.keys(anciennesValeurs).length > 0) {
          const champs = [];
          const valeurs = [];
          let index = 1;

          for (const [champ, valeur] of Object.entries(anciennesValeurs)) {
            champs.push(`"${champ}" = $${index}`);
            valeurs.push(valeur);
            index++;
          }

          valeurs.push(recordId);

          await client.query(
            `UPDATE ${table} SET ${champs.join(', ')} WHERE id = $${index}`,
            valeurs
          );
        }
        break;

      case 'DELETE':
      case 'DELETE_USER':
      case 'SUPPRESSION':
        if (Object.keys(anciennesValeurs).length > 0) {
          const colonnes = Object.keys(anciennesValeurs)
            .map((c) => `"${c}"`)
            .join(', ');
          const placeholders = Object.keys(anciennesValeurs)
            .map((_, i) => `$${i + 1}`)
            .join(', ');
          const valeursInsert = Object.values(anciennesValeurs);

          await client.query(
            `INSERT INTO ${table} (${colonnes}) VALUES (${placeholders})`,
            valeursInsert
          );
        }
        break;

      default:
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: "Ce type d'action ne peut pas être annulé",
        });
    }

    // Marquer comme annulée
    await journalService.marquerCommeAnnulee(id, adminId);

    // Journaliser l'annulation
    await journalService.logAction({
      utilisateurId: adminId,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: "Annulation d'action",
      actionType: 'ANNULATION',
      tableName: 'journalactivite',
      recordId: id.toString(),
      oldValue: null,
      newValue: JSON.stringify({ action_annulee_id: id }),
      details: `Action ${id} annulée`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Action annulée avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur annulation:', error);
    res.status(500).json({ success: false, error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// ANNULER IMPORTATION
// ============================================
const annulerImportation = async (req, res) => {
  try {
    const { importBatchId } = req.body;

    if (!importBatchId) {
      return res.status(400).json({
        success: false,
        message: 'ID du batch requis',
      });
    }

    // Supprimer les cartes de cet import
    await db.query('DELETE FROM cartes WHERE importbatchid = $1', [importBatchId]);

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: "Annulation d'importation",
      actionType: 'ANNULATION_IMPORT',
      tableName: 'imports',
      recordId: importBatchId,
      details: `Import ${importBatchId} annulé`,
      ip: req.ip,
    });

    res.json({
      success: true,
      message: 'Importation annulée avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur annulation import:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// NETTOYER JOURNAL
// ============================================
const nettoyerJournal = async (req, res) => {
  try {
    const { avantDate } = req.body;
    const dateLimite = avantDate || new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();

    await db.query('DELETE FROM journalactivite WHERE dateaction < $1', [dateLimite]);

    res.json({
      success: true,
      message: 'Journal nettoyé avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur nettoyage journal:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// DIAGNOSTIC
// ============================================
const diagnostic = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_entrees,
        COUNT(DISTINCT utilisateurid) as utilisateurs_distincts,
        MIN(dateaction) as premiere_action,
        MAX(dateaction) as derniere_action,
        COUNT(CASE WHEN annulee = true THEN 1 END) as actions_annulees,
        pg_total_relation_size('journalactivite') as table_size,
        pg_size_pretty(pg_total_relation_size('journalactivite')) as table_size_pretty
      FROM journalactivite
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'journal',
      utilisateur: {
        role: req.user.role,
        coordination: req.user.coordination,
      },
      statistiques: {
        total_entrees: parseInt(stats.total_entrees),
        utilisateurs_distincts: parseInt(stats.utilisateurs_distincts),
        premiere_action: stats.premiere_action,
        derniere_action: stats.derniere_action,
        actions_annulees: parseInt(stats.actions_annulees),
      },
      stockage: {
        taille_table: stats.table_size_pretty,
        taille_bytes: parseInt(stats.table_size),
      },
      endpoints: [
        '/api/journal',
        '/api/journal/:id',
        '/api/journal/imports',
        '/api/journal/imports/:batchId',
        '/api/journal/stats',
        '/api/journal/actions/annulables',
        '/api/journal/:id/annuler',
        '/api/journal/annuler-import',
        '/api/journal/nettoyer',
        '/api/journal/export',
        '/api/journal/diagnostic',
        '/api/journal/health',
        '/api/journal/test',
      ],
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// EXPORT
// ============================================
module.exports = {
  getJournal,
  getJournalById,
  getImports,
  getImportDetails,
  getStats,
  getActionsAnnulables,
  annulerAction,
  annulerImportation,
  nettoyerJournal,
  diagnostic,
};


// ========== Controllers\logController.js ==========
const db = // require modifié - fichier consolidé;
const journalController = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  defaultLimit: 50,
  maxLimit: 10000, // Pour les exports
  minSearchLength: 2, // Longueur min pour recherche
  maxRetentionDays: 365, // Conservation max 1 an
  defaultRetentionDays: 90, // Conservation par défaut
  cacheTimeout: 300, // Cache stats 5 minutes
  statsCache: null,
  statsCacheTime: null,

  // Types d'actions courants pour auto-complétion
  commonActions: [
    'CONNEXION',
    'DECONNEXION',
    'CREATION',
    'MODIFICATION',
    'SUPPRESSION',
    'IMPORT',
    'EXPORT',
    'RECHERCHE',
    'CONSULTATION',
    'BACKUP',
    'RESTAURATION',
    'ANNULATION',
  ],
};

// ============================================
// FONCTIONS UTILITAIRES DE FILTRAGE
// ============================================

/**
 * Vérifie si l'utilisateur peut accéder aux logs
 */
const peutAccederLogs = (req) => {
  const role = req.user?.role;

  // Admin peut tout voir
  if (role === 'Administrateur') {
    return { autorise: true };
  }

  // Gestionnaire, Chef d'équipe, Opérateur n'ont pas accès
  return {
    autorise: false,
    message: 'Seuls les administrateurs peuvent consulter les logs',
  };
};

// ============================================
// CONTROLEUR LOG OPTIMISÉ POUR LWS
// ============================================

/**
 * Récupérer tous les logs avec pagination - REDIRIGÉ VERS JOURNAL
 * GET /api/logs
 */
exports.getAllLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(
      `📋 Redirection getAllLogs vers journalController.getJournal pour ${req.user.nomUtilisateur}`
    );

    // Rediriger vers le journal principal avec les mêmes paramètres
    req.query.export_all = req.query.export_all || 'false';

    // Appeler le journalController
    return await journalController.getJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur getAllLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Créer un nouveau log - UTILISE JOURNALCONTROLLER
 * POST /api/logs
 */
exports.createLog = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { Utilisateur, Action } = req.body;

    if (!Utilisateur || !Action) {
      return res.status(400).json({
        success: false,
        error: 'Utilisateur et Action sont requis',
      });
    }

    // Utiliser journalController.logAction
    await journalController.logAction({
      utilisateurId: req.user?.id || null,
      nomUtilisateur: Utilisateur,
      nomComplet: Utilisateur,
      role: req.user?.role || 'System',
      agence: req.user?.agence || null,
      actionType: Action.toUpperCase(),
      tableName: 'log',
      details: `Action manuelle: ${Action}`,
      ip: req.ip,
      coordination: req.user?.coordination || null,
    });

    res.json({
      success: true,
      message: 'Log ajouté avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('❌ Erreur createLog:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Récupérer les logs par utilisateur - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/user/:utilisateur
 */
exports.getLogsByUser = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { utilisateur } = req.params;

    if (!utilisateur) {
      return res.status(400).json({
        success: false,
        error: "Le nom d'utilisateur est requis",
      });
    }

    console.log(
      `📋 Redirection getLogsByUser vers journalController.getJournal pour utilisateur: ${utilisateur}`
    );

    // Rediriger vers le journal avec filtre utilisateur
    req.query.utilisateur = utilisateur;
    req.query.export_all = req.query.export_all || 'false';

    return await journalController.getJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur getLogsByUser:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Récupérer les logs par plage de dates - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/date-range
 */
exports.getLogsByDateRange = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { dateDebut, dateFin } = req.query;

    if (!dateDebut || !dateFin) {
      return res.status(400).json({
        success: false,
        error: 'Les dates de début et fin sont requises',
      });
    }

    console.log(`📋 Redirection getLogsByDateRange vers journalController.getJournal`);

    // Rediriger vers le journal avec filtres de dates
    req.query.dateDebut = dateDebut;
    req.query.dateFin = dateFin;
    req.query.export_all = req.query.export_all || 'false';

    return await journalController.getJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur getLogsByDateRange:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Récupérer les logs récents - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/recent
 */
exports.getRecentLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(`📋 Redirection getRecentLogs vers journalController.getJournal`);

    // Rediriger vers le journal avec limite réduite
    req.query.limit = req.query.limit || '50';
    req.query.export_all = 'false';

    return await journalController.getJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur getRecentLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Supprimer les vieux logs - REDIRIGÉ VERS JOURNAL
 * DELETE /api/logs/old
 */
exports.deleteOldLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(`📋 Redirection deleteOldLogs vers journalController.nettoyerJournal`);

    // Rediriger vers nettoyerJournal
    req.body = { jours: req.query.days || CONFIG.defaultRetentionDays };

    return await journalController.nettoyerJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur deleteOldLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Statistiques des logs avec cache - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/stats
 */
exports.getLogStats = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(`📋 Redirection getLogStats vers journalController.getStats`);

    // Rediriger vers les stats du journal
    return await journalController.getStats(req, res);
  } catch (err) {
    console.error('❌ Erreur getLogStats:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Recherche avancée dans les logs - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/search
 */
exports.searchLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { q } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({
        success: false,
        error: 'Le terme de recherche est requis',
      });
    }

    if (q.trim().length < CONFIG.minSearchLength) {
      return res.json({
        success: true,
        logs: [],
        total: 0,
        message: `Minimum ${CONFIG.minSearchLength} caractères requis`,
      });
    }

    console.log(`📋 Redirection searchLogs vers journalController.getJournal avec recherche: ${q}`);

    // Rediriger vers le journal avec recherche
    req.query.utilisateur = q;
    req.query.actionType = q;
    req.query.export_all = req.query.export_all || 'false';

    return await journalController.getJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur searchLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Supprimer tous les logs (admin seulement) - REDIRIGÉ VERS JOURNAL
 * DELETE /api/logs/all
 */
exports.clearAllLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(`📋 Redirection clearAllLogs vers journalController.nettoyerJournal (tout)`);

    // Rediriger vers nettoyerJournal avec une période très longue
    req.body = { jours: 0 }; // Supprimer tout

    return await journalController.nettoyerJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur clearAllLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Exporter les logs - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/export
 */
exports.exportLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { format = 'json' } = req.query;

    console.log(`📋 Redirection exportLogs vers journalController.getJournal (export)`);

    // Rediriger vers le journal avec export_all
    req.query.export_all = 'true';

    // Appeler getJournal et capturer le résultat
    await journalController.getJournal(req, res);

    // Si format CSV, on pourrait convertir ici, mais pour l'instant on garde JSON
    if (format === 'csv' && !res.headersSent) {
      // Logique de conversion CSV à implémenter si nécessaire
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="logs-export-${new Date().toISOString().split('T')[0]}.csv"`
      );
      // ... conversion
    }
  } catch (err) {
    console.error('❌ Erreur exportLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Méthode utilitaire pour logger les actions - UTILISE JOURNALCONTROLLER
 */
exports.logAction = async (utilisateur, action, req = null) => {
  try {
    if (!utilisateur || !action) {
      console.warn('⚠️ Tentative de log avec paramètres manquants');
      return;
    }

    // Utiliser journalController.logAction
    await journalController.logAction({
      utilisateurId: req?.user?.id || null,
      nomUtilisateur: utilisateur,
      nomComplet: utilisateur,
      role: req?.user?.role || 'System',
      agence: req?.user?.agence || null,
      actionType: action.toUpperCase(),
      tableName: 'log',
      details: action,
      ip: req?.ip || null,
      coordination: req?.user?.coordination || null,
    });
  } catch (err) {
    console.error('❌ Erreur lors de la journalisation:', err.message);
  }
};

/**
 * Récupérer les logs avec filtres avancés - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/filtered
 */
exports.getFilteredLogs = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(`📋 Redirection getFilteredLogs vers journalController.getJournal`);

    // Transférer tous les filtres
    const { utilisateur, action, dateDebut, dateFin, sort } = req.query;

    req.query.utilisateur = utilisateur;
    req.query.actionType = action;
    req.query.dateDebut = dateDebut;
    req.query.dateFin = dateFin;
    req.query.sort = sort;
    req.query.export_all = req.query.export_all || 'false';

    return await journalController.getJournal(req, res);
  } catch (err) {
    console.error('❌ Erreur getFilteredLogs:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Obtenir les actions fréquentes pour auto-complétion
 * GET /api/logs/actions
 */
exports.getCommonActions = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { search } = req.query;

    let actions = CONFIG.commonActions;

    if (search && search.trim() !== '') {
      const searchTerm = search.toLowerCase();
      actions = actions.filter((a) => a.toLowerCase().includes(searchTerm));
    }

    // Récupérer aussi les actions réelles de la base (journalactivite)
    const dbActions = await db.query(`
      SELECT DISTINCT actiontype as action, COUNT(*) as frequency
      FROM journalactivite
      GROUP BY actiontype
      ORDER BY frequency DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      suggestions: actions,
      populaires: dbActions.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error('❌ Erreur getCommonActions:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};

/**
 * Diagnostic du système de logs - REDIRIGÉ VERS JOURNAL
 * GET /api/logs/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    // Vérifier les droits d'accès
    const droits = peutAccederLogs(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    console.log(`📋 Redirection diagnostic vers journalController.diagnostic`);

    // Rediriger vers le diagnostic du journal
    return await journalController.diagnostic(req, res);
  } catch (err) {
    console.error('❌ Erreur diagnostic:', err);
    res.status(500).json({
      success: false,
      error: err.message,
    });
  }
};


// ========== Controllers\profilController.js ==========
const bcrypt = require('bcryptjs');
const db = // require modifié - fichier consolidé;
const journalController = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  saltRounds: 12, // Niveau de hash bcrypt
  minPasswordLength: 8, // Longueur minimale mot de passe
  maxActivityLimit: 1000, // Max activités à retourner
  sessionTimeout: 3600000, // 1 heure en ms
  cacheTimeout: 300, // Cache stats 5 minutes
  statsCache: new Map(), // Cache pour les stats utilisateur
  statsCacheTime: new Map(),
};

// ============================================
// FONCTIONS UTILITAIRES DE VÉRIFICATION
// ============================================

/**
 * Vérifie si l'utilisateur peut accéder/modifier un profil
 */
const peutAccederProfil = (req, userIdCible) => {
  const role = req.user?.role;
  const userId = req.user?.id;

  // Admin peut tout voir
  if (role === 'Administrateur') {
    return { autorise: true };
  }

  // Gestionnaire, Chef d'équipe, Opérateur ne voient que leur propre profil
  if (parseInt(userId) === parseInt(userIdCible)) {
    return { autorise: true };
  }

  return {
    autorise: false,
    message: "Vous ne pouvez accéder qu'à votre propre profil",
  };
};

// ============================================
// CONTROLEUR PROFIL OPTIMISÉ POUR LWS
// ============================================

/**
 * Récupérer le profil de l'utilisateur connecté
 * GET /api/profil
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        actif,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
      FROM utilisateurs 
      WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Ne pas retourner le mot de passe
    delete user.motdepasse;

    res.json({
      success: true,
      user,
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération profil:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Récupérer le profil d'un utilisateur par ID (Admin uniquement)
 * GET /api/profil/:userId
 */
exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // Vérifier les droits
    const droits = peutAccederProfil(req, userId);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        message: droits.message,
      });
    }

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        actif,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
      FROM utilisateurs 
      WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Ne pas retourner le mot de passe
    delete user.motdepasse;

    res.json({
      success: true,
      user,
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération profil utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Changer le mot de passe
 * POST /api/profil/change-password
 */
exports.changePassword = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    // Validation
    if (!currentPassword || !newPassword) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Les mots de passe sont requis',
      });
    }

    if (newPassword.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`,
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Les mots de passe ne correspondent pas',
      });
    }

    // Vérifier la complexité (optionnel)
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumbers = /\d/.test(newPassword);

    if (!(hasUpperCase && hasLowerCase && hasNumbers)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message:
          'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre',
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Vérifier le mot de passe actuel
    const isMatch = await bcrypt.compare(currentPassword, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return res.status(401).json({
        success: false,
        message: 'Mot de passe actuel incorrect',
      });
    }

    // Vérifier que le nouveau mot de passe est différent
    const isSamePassword = await bcrypt.compare(newPassword, user.motdepasse);
    if (isSamePassword) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Le nouveau mot de passe doit être différent de l'ancien",
      });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    // Mettre à jour le mot de passe
    await client.query(
      'UPDATE utilisateurs SET motdepasse = $1, derniereconnexion = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: user.id,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: 'Changement de mot de passe',
      actionType: 'UPDATE_PASSWORD',
      tableName: 'Utilisateurs',
      recordId: user.id.toString(),
      details: 'Modification du mot de passe',
      ip: req.ip,
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Mot de passe modifié avec succès',
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur changement mot de passe:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * Mettre à jour le profil
 * PUT /api/profil
 */
exports.updateProfile = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { nomComplet, email, agence } = req.body;
    const userId = req.user.id;

    // Validation
    if (!nomComplet || nomComplet.trim() === '') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Le nom complet est requis',
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Format d'email invalide",
      });
    }

    // Récupérer l'ancien profil
    const oldProfileResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [
      userId,
    ]);

    const oldProfile = oldProfileResult.rows[0];

    if (!oldProfile) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Vérifier si l'email est déjà utilisé par un autre utilisateur
    if (email && email !== oldProfile.email) {
      const emailCheck = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà utilisé',
        });
      }
    }

    // Mettre à jour le profil
    await client.query(
      'UPDATE utilisateurs SET nomcomplet = $1, email = $2, agence = $3 WHERE id = $4',
      [nomComplet.trim(), email || null, agence || null, userId]
    );

    // Récupérer le nouveau profil
    const newProfileResult = await client.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        actif 
      FROM utilisateurs WHERE id = $1`,
      [userId]
    );

    const newProfile = newProfileResult.rows[0];

    // Journaliser si des changements ont eu lieu
    const changes = [];
    if (oldProfile.nomcomplet !== newProfile.nomcomplet) changes.push('nom complet');
    if (oldProfile.email !== newProfile.email) changes.push('email');
    if (oldProfile.agence !== newProfile.agence) changes.push('agence');

    if (changes.length > 0) {
      await journalController.logAction({
        utilisateurId: userId,
        nomUtilisateur: oldProfile.nomutilisateur,
        nomComplet: oldProfile.nomcomplet,
        role: oldProfile.role,
        agence: oldProfile.agence,
        coordination: oldProfile.coordination,
        action: 'Modification du profil',
        actionType: 'UPDATE_PROFILE',
        tableName: 'Utilisateurs',
        recordId: userId.toString(),
        oldValue: JSON.stringify({
          nomComplet: oldProfile.nomcomplet,
          email: oldProfile.email,
          agence: oldProfile.agence,
        }),
        newValue: JSON.stringify({
          nomComplet: newProfile.nomcomplet,
          email: newProfile.email,
          agence: newProfile.agence,
        }),
        details: `Modification: ${changes.join(', ')}`,
        ip: req.ip,
      });
    }

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Profil mis à jour avec succès',
      user: newProfile,
      changes: changes.length > 0 ? changes : ['aucun changement'],
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur mise à jour profil:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * Récupérer l'activité de l'utilisateur
 * GET /api/profil/activity
 */
exports.getUserActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, page = 1 } = req.query;

    const actualLimit = Math.min(parseInt(limit), CONFIG.maxActivityLimit);
    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        detailsaction,
        importbatchid,
        annulee,
        coordination
       FROM journalactivite 
       WHERE utilisateurid = $1 
       ORDER BY dateaction DESC 
       LIMIT $2 OFFSET $3`,
      [userId, actualLimit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1',
      [userId]
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      activities: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1,
      },
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération activités:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Récupérer l'activité d'un utilisateur (Admin uniquement)
 * GET /api/profil/:userId/activity
 */
exports.getUserActivityById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent consulter l'activité des autres utilisateurs",
      });
    }

    const { limit = 20, page = 1 } = req.query;

    const actualLimit = Math.min(parseInt(limit), CONFIG.maxActivityLimit);
    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        detailsaction,
        importbatchid,
        annulee,
        coordination
       FROM journalactivite 
       WHERE utilisateurid = $1 
       ORDER BY dateaction DESC 
       LIMIT $2 OFFSET $3`,
      [userId, actualLimit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1',
      [userId]
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      userId: parseInt(userId),
      activities: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1,
      },
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération activités utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Vérifier la disponibilité du nom d'utilisateur
 * GET /api/profil/check-username
 */
exports.checkUsernameAvailability = async (req, res) => {
  try {
    const { username } = req.query;
    const userId = req.user.id;

    if (!username || username.trim() === '') {
      return res.status(400).json({
        success: false,
        message: "Nom d'utilisateur requis",
      });
    }

    // Validation du format
    const usernameRegex = /^[a-zA-Z0-9._-]{3,30}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        success: false,
        message: "Le nom d'utilisateur doit contenir 3-30 caractères (lettres, chiffres, . _ -)",
      });
    }

    const startTime = Date.now();

    const result = await db.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1 AND id != $2',
      [username.trim(), userId]
    );

    const isAvailable = result.rows.length === 0;

    res.json({
      success: true,
      available: isAvailable,
      message: isAvailable ? "Nom d'utilisateur disponible" : "Nom d'utilisateur déjà utilisé",
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erreur vérification nom d'utilisateur:", error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Mettre à jour le nom d'utilisateur
 * PUT /api/profil/username
 */
exports.updateUsername = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { newUsername, password } = req.body;
    const userId = req.user.id;

    // Validation
    if (!newUsername || newUsername.trim() === '') {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Nouveau nom d'utilisateur requis",
      });
    }

    // Validation du format
    const usernameRegex = /^[a-zA-Z0-9._-]{3,30}$/;
    if (!usernameRegex.test(newUsername)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Le nom d'utilisateur doit contenir 3-30 caractères (lettres, chiffres, . _ -)",
      });
    }

    // Vérifier le mot de passe pour sécurité
    if (!password) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Mot de passe requis pour modifier le nom d'utilisateur",
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(password, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return res.status(401).json({
        success: false,
        message: 'Mot de passe incorrect',
      });
    }

    // Vérifier si le nom d'utilisateur est disponible
    const checkResult = await client.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1 AND id != $2',
      [newUsername.trim(), userId]
    );

    if (checkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Ce nom d'utilisateur est déjà utilisé",
      });
    }

    // Mettre à jour le nom d'utilisateur
    await client.query('UPDATE utilisateurs SET nomutilisateur = $1 WHERE id = $2', [
      newUsername.trim(),
      userId,
    ]);

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: userId,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: "Changement de nom d'utilisateur",
      actionType: 'UPDATE_USERNAME',
      tableName: 'Utilisateurs',
      recordId: userId.toString(),
      oldValue: JSON.stringify({ nomUtilisateur: user.nomutilisateur }),
      newValue: JSON.stringify({ nomUtilisateur: newUsername.trim() }),
      details: `Changement de nom d'utilisateur`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: "Nom d'utilisateur modifié avec succès",
      newUsername: newUsername.trim(),
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur changement nom d'utilisateur:", error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * Statistiques du profil
 * GET /api/profil/stats
 */
exports.getProfileStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { forceRefresh } = req.query;

    // Vérifier le cache
    const cacheKey = `user_stats_${userId}`;
    if (
      !forceRefresh &&
      CONFIG.statsCache.has(cacheKey) &&
      CONFIG.statsCacheTime.has(cacheKey) &&
      Date.now() - CONFIG.statsCacheTime.get(cacheKey) < CONFIG.cacheTimeout * 1000
    ) {
      return res.json({
        success: true,
        ...CONFIG.statsCache.get(cacheKey),
        cached: true,
        cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime.get(cacheKey)) / 1000) + 's',
      });
    }

    const startTime = Date.now();

    // Statistiques des actions
    const activityStats = await db.query(
      `SELECT 
        COUNT(*) as total_actions,
        COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as actions_7j,
        COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as actions_30j,
        COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as actions_24h
       FROM journalactivite 
       WHERE utilisateurid = $1`,
      [userId]
    );

    // Dernière connexion
    const lastLoginResult = await db.query(
      `SELECT dateaction 
       FROM journalactivite 
       WHERE utilisateurid = $1 AND actiontype = 'LOGIN' 
       ORDER BY dateaction DESC 
       LIMIT 1`,
      [userId]
    );

    // Première connexion
    const firstLoginResult = await db.query(
      `SELECT MIN(dateaction) as first_action
       FROM journalactivite 
       WHERE utilisateurid = $1`,
      [userId]
    );

    // Actions les plus fréquentes
    const frequentActions = await db.query(
      `SELECT 
        actiontype,
        COUNT(*) as count
       FROM journalactivite 
       WHERE utilisateurid = $1 
       GROUP BY actiontype 
       ORDER BY count DESC 
       LIMIT 5`,
      [userId]
    );

    // Répartition par jour (30 derniers jours)
    const dailyActivity = await db.query(
      `SELECT 
        DATE(dateaction) as jour,
        COUNT(*) as count
       FROM journalactivite 
       WHERE utilisateurid = $1 AND dateaction > NOW() - INTERVAL '30 days'
       GROUP BY DATE(dateaction)
       ORDER BY jour DESC`,
      [userId]
    );

    const statsData = {
      stats: {
        totalActions: parseInt(activityStats.rows[0].total_actions),
        actionsLast24h: parseInt(activityStats.rows[0].actions_24h),
        actionsLast7Days: parseInt(activityStats.rows[0].actions_7j),
        actionsLast30Days: parseInt(activityStats.rows[0].actions_30j),
        lastLogin: lastLoginResult.rows[0]?.dateaction || null,
        firstAction: firstLoginResult.rows[0]?.first_action || null,
        memberSince: firstLoginResult.rows[0]?.first_action
          ? Math.ceil(
              (Date.now() - new Date(firstLoginResult.rows[0].first_action)) / (1000 * 60 * 60 * 24)
            ) + ' jours'
          : 'N/A',
      },
      frequentActions: frequentActions.rows.map((a) => ({
        ...a,
        count: parseInt(a.count),
        pourcentage:
          activityStats.rows[0].total_actions > 0
            ? Math.round((a.count / activityStats.rows[0].total_actions) * 100)
            : 0,
      })),
      dailyActivity: dailyActivity.rows,
      performance: {
        queryTime: Date.now() - startTime,
      },
    };

    // Mettre en cache
    CONFIG.statsCache.set(cacheKey, statsData);
    CONFIG.statsCacheTime.set(cacheKey, Date.now());

    res.json({
      success: true,
      ...statsData,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur statistiques profil:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Désactiver le compte
 * POST /api/profil/deactivate
 */
exports.deactivateAccount = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { password, reason } = req.body;
    const userId = req.user.id;

    if (!password) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Mot de passe requis pour désactiver le compte',
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(password, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return res.status(401).json({
        success: false,
        message: 'Mot de passe incorrect',
      });
    }

    // Vérifier si déjà inactif
    if (!user.actif) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Le compte est déjà désactivé',
      });
    }

    // Désactiver le compte
    await client.query(
      'UPDATE utilisateurs SET actif = false, date_desactivation = NOW() WHERE id = $1',
      [userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: userId,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: 'Désactivation du compte',
      actionType: 'DEACTIVATE_ACCOUNT',
      tableName: 'Utilisateurs',
      recordId: userId.toString(),
      details: reason ? `Désactivation: ${reason}` : 'Désactivation du compte',
      ip: req.ip,
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Compte désactivé avec succès',
      note: 'Votre compte a été désactivé. Contactez un administrateur pour le réactiver.',
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur désactivation compte:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * Réactiver le compte (via admin)
 * POST /api/profil/reactivate/:userId
 */
exports.reactivateAccount = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { userId } = req.params;
    const adminId = req.user.id;

    // Vérifier les droits admin
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      return res.status(403).json({
        success: false,
        message: 'Permission refusée - Action réservée aux administrateurs',
      });
    }

    // Récupérer l'utilisateur à réactiver
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    if (user.actif) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Le compte est déjà actif',
      });
    }

    // Réactiver le compte
    await client.query(
      'UPDATE utilisateurs SET actif = true, date_reactivation = NOW() WHERE id = $1',
      [userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: adminId,
      nomUtilisateur: req.user.nomutilisateur,
      nomComplet: req.user.nomcomplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: 'Réactivation de compte',
      actionType: 'REACTIVATE_ACCOUNT',
      tableName: 'Utilisateurs',
      recordId: userId.toString(),
      details: `Compte réactivé par admin: ${user.nomutilisateur}`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Compte réactivé avec succès',
      user: {
        id: user.id,
        nomUtilisateur: user.nomutilisateur,
        actif: true,
      },
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réactivation compte:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  } finally {
    client.release();
  }
};

/**
 * Exporter les données du profil
 * GET /api/profil/export
 */
exports.exportProfileData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { format = 'json' } = req.query;

    const startTime = Date.now();

    // Données du profil
    const profileResult = await db.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        actif,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
      FROM utilisateurs 
      WHERE id = $1`,
      [userId]
    );

    // Historique des activités
    const activitiesResult = await db.query(
      `SELECT 
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        detailsaction,
        importbatchid,
        annulee,
        coordination
       FROM journalactivite 
       WHERE utilisateurid = $1 
       ORDER BY dateaction DESC`,
      [userId]
    );

    const exportData = {
      profile: profileResult.rows[0],
      activities: activitiesResult.rows,
      exportDate: new Date().toISOString(),
      totalActivities: activitiesResult.rows.length,
      generatedBy: req.user.nomutilisateur,
    };

    const filename = `profil-${req.user.nomutilisateur}-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      // Export CSV
      const csvHeaders = 'Type,Action,Date,Table,Détails,BatchID,Annulée\n';
      const csvData = activitiesResult.rows
        .map(
          (row) =>
            `"${row.actiontype || ''}","${(row.action || '').replace(/"/g, '""')}","${row.dateaction || ''}","${row.tablename || ''}","${(row.detailsaction || '').replace(/"/g, '""')}","${row.importbatchid || ''}","${row.annulee ? 'Oui' : 'Non'}"`
        )
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.write('\uFEFF'); // BOM UTF-8
      res.send(csvHeaders + csvData);
    } else {
      // Export JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        ...exportData,
        performance: {
          queryTime: Date.now() - startTime,
        },
      });
    }
  } catch (error) {
    console.error('❌ Erreur export données profil:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Sessions actives (si vous gérez les sessions)
 * GET /api/profil/sessions
 */
exports.getActiveSessions = async (req, res) => {
  try {
    const userId = req.user.id;

    // À implémenter selon votre système de sessions
    // Exemple avec des tokens JWT stockés en base
    const result = await db.query(
      `SELECT 
        id,
        token,
        created_at,
        last_activity,
        ip_address,
        user_agent
      FROM user_sessions 
      WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY last_activity DESC`,
      [userId]
    );

    res.json({
      success: true,
      sessions: result.rows,
      total: result.rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Déconnecter toutes les autres sessions
 * POST /api/profil/logout-others
 */
exports.logoutOtherSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const currentSessionId = req.sessionId; // À adapter

    await db.query('DELETE FROM user_sessions WHERE user_id = $1 AND id != $2', [
      userId,
      currentSessionId,
    ]);

    res.json({
      success: true,
      message: 'Autres sessions déconnectées avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur déconnexion autres sessions:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Nettoyer le cache des stats utilisateur
 * POST /api/profil/cache/clear
 */
exports.clearUserCache = async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user_stats_${userId}`;

    CONFIG.statsCache.delete(cacheKey);
    CONFIG.statsCacheTime.delete(cacheKey);

    res.json({
      success: true,
      message: 'Cache utilisateur nettoyé',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur nettoyage cache:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

/**
 * Diagnostic du profil (Admin uniquement)
 * GET /api/profil/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    // Vérifier les droits
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent accéder au diagnostic',
      });
    }

    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        COUNT(*) as total_utilisateurs,
        COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs,
        COUNT(CASE WHEN NOT actif THEN 1 END) as utilisateurs_inactifs,
        MIN(datecreation) as premier_utilisateur,
        MAX(datecreation) as dernier_utilisateur,
        COUNT(DISTINCT role) as roles_distincts,
        COUNT(DISTINCT agence) as agences_distinctes,
        COUNT(DISTINCT coordination) as coordinations_distinctes
      FROM utilisateurs
    `);

    // Statistiques par coordination
    const coordinationStats = await db.query(`
      SELECT 
        coordination,
        COUNT(*) as total_utilisateurs,
        COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs
      FROM utilisateurs
      WHERE coordination IS NOT NULL
      GROUP BY coordination
      ORDER BY total_utilisateurs DESC
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'profil',
      utilisateur: {
        role: req.user.role,
        coordination: req.user.coordination,
      },
      statistiques: {
        total_utilisateurs: parseInt(stats.total_utilisateurs),
        utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
        utilisateurs_inactifs: parseInt(stats.utilisateurs_inactifs),
        taux_activation:
          stats.total_utilisateurs > 0
            ? Math.round((stats.utilisateurs_actifs / stats.total_utilisateurs) * 100)
            : 0,
        premier_utilisateur: stats.premier_utilisateur,
        dernier_utilisateur: stats.dernier_utilisateur,
        roles_distincts: parseInt(stats.roles_distincts),
        agences_distinctes: parseInt(stats.agences_distinctes),
        coordinations_distinctes: parseInt(stats.coordinations_distinctes),
      },
      coordination_stats: coordinationStats.rows,
      config: {
        saltRounds: CONFIG.saltRounds,
        minPasswordLength: CONFIG.minPasswordLength,
        maxActivityLimit: CONFIG.maxActivityLimit,
        cacheTimeout: CONFIG.cacheTimeout,
      },
      performance: {
        queryTime: Date.now() - startTime,
      },
      endpoints: [
        '/api/profil',
        '/api/profil/:userId',
        '/api/profil/change-password',
        '/api/profil/activity',
        '/api/profil/:userId/activity',
        '/api/profil/check-username',
        '/api/profil/username',
        '/api/profil/stats',
        '/api/profil/deactivate',
        '/api/profil/reactivate/:userId',
        '/api/profil/export',
        '/api/profil/sessions',
        '/api/profil/logout-others',
        '/api/profil/cache/clear',
        '/api/profil/diagnostic',
      ],
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
};


// ========== Controllers\syncController.js ==========
// Controllers/syncController.js
const syncService = // require modifié - fichier consolidé;
const journalService = // require modifié - fichier consolidé;

/**
 * Contrôleur de synchronisation pour les sites locaux
 * Gère l'authentification, l'upload et le download des données
 */
const syncController = {
  /**
   * Authentification d'un site
   * POST /api/sync/login
   */
  async login(req, res) {
    try {
      const { site_id, api_key } = req.body;

      if (!site_id || !api_key) {
        return res.status(400).json({
          success: false,
          error: 'site_id et api_key requis',
        });
      }

      const site = await syncService.authenticateSite(site_id, api_key);

      if (!site) {
        return res.status(401).json({
          success: false,
          error: 'Identifiants invalides ou site inactif',
        });
      }

      const token = syncService.generateSiteToken(site);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site.id,
        nomComplet: site.nom,
        role: 'SITE',
        agence: null,
        coordination: site.coordination_code,
        action: 'Connexion du site',
        actionType: 'SITE_LOGIN',
        tableName: 'sites',
        recordId: site.id,
        details: `Connexion du site ${site.nom}`,
        ip: req.ip,
      });

      res.json({
        success: true,
        token,
        site: {
          id: site.id,
          nom: site.nom,
          coordination: site.coordination_code,
          coordination_id: site.coordination_id,
        },
      });
    } catch (error) {
      console.error('❌ Erreur login site:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        message: error.message,
      });
    }
  },

  /**
   * Réception des modifications d'un site
   * POST /api/sync/upload
   */
  async upload(req, res) {
    const { modifications, last_sync } = req.body;
    const site = req.site;

    try {
      const result = await syncService.processUpload(site, modifications, last_sync);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site.id,
        nomComplet: site.nom,
        role: 'SITE',
        agence: null,
        coordination: site.coordination_code,
        action: 'Upload de synchronisation',
        actionType: 'SYNC_UPLOAD',
        tableName: 'sync_history',
        recordId: result.historyId.toString(),
        details: `Site ${site.id} a envoyé ${modifications?.length || 0} modifications`,
        ip: req.ip,
      });

      res.json({
        success: true,
        history_id: result.historyId,
        uploaded: result.uploaded,
        download: result.download,
        processed: result.processed,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur upload:', error);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site?.id || 'inconnu',
        nomComplet: site?.nom || 'Inconnu',
        role: 'SITE',
        agence: null,
        coordination: site?.coordination_code || null,
        action: 'Erreur upload synchronisation',
        actionType: 'SYNC_UPLOAD_ERROR',
        tableName: 'sync_history',
        details: `Erreur pour site ${site?.id}: ${error.message}`,
        ip: req.ip,
      });

      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Envoi des mises à jour aux sites
   * GET /api/sync/download
   */
  async download(req, res) {
    const { since, limit = 1000 } = req.query;
    const site = req.site;

    try {
      const records = await syncService.prepareDownload(site, since, parseInt(limit));

      res.json({
        success: true,
        count: records.length,
        since: since || '2000-01-01',
        until: new Date().toISOString(),
        records,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur download:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Confirmation de réception
   * POST /api/sync/confirm
   */
  async confirm(req, res) {
    const { history_id, applied_ids, errors } = req.body;
    const site = req.site;

    try {
      await syncService.confirmDownload(site.id, history_id, applied_ids, errors);

      res.json({
        success: true,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur confirmation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Statut de la synchronisation
   * GET /api/sync/status
   */
  async status(req, res) {
    const site = req.site;

    try {
      const status = await syncService.getSiteStatus(site.id);

      res.json({
        success: true,
        site: {
          id: site.id,
          nom: site.nom,
          coordination: site.coordination_code,
        },
        status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur status:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Récupération des utilisateurs pour un site
   * GET /api/sync/users
   */
  async getUsers(req, res) {
    const site = req.site;
    try {
      const users = await syncService.getUsersForSite(site.id);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site.id,
        nomComplet: site.nom,
        role: 'SITE',
        agence: null,
        coordination: site.coordination_code,
        action: 'Sync utilisateurs',
        actionType: 'SYNC_USERS',
        tableName: 'utilisateurs',
        recordId: site.id,
        details: `Site ${site.id} a téléchargé ${users.length} utilisateur(s)`,
        ip: req.ip,
      });

      res.json({
        success: true,
        count: users.length,
        users,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur getUsers:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },
};

module.exports = syncController;


// ========== Controllers\utilisateursController.js ==========
// Controllers/utilisateursController.js

const bcrypt = require('bcryptjs');
const db = // require modifié - fichier consolidé;
const journalService = // require modifié - fichier consolidé;

const CONFIG = {
  saltRounds: 12,
  minPasswordLength: 8,
  cacheTimeout: 300,
  statsCache: null,
  statsCacheTime: null,
  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

// ============================================
// UTILITAIRES
// ============================================

/**
 * Vérifie si l'utilisateur connecté peut gérer la cible
 * Administrateur  → peut tout gérer
 * Gestionnaire    → peut gérer uniquement sa coordination
 * Chef d'équipe   → peut gérer uniquement son site (agence)
 */
const peutGererUtilisateur = (acteur, cible = null) => {
  if (acteur.role === 'Administrateur') return true;

  if (acteur.role === 'Gestionnaire') {
    if (!cible) return true; // Création : on vérifiera la coordination dans le body
    return cible.coordination === acteur.coordination;
  }

  if (acteur.role === "Chef d'équipe") {
    if (!cible) return true; // Création : on vérifiera l'agence dans le body
    return cible.agence === acteur.agence;
  }

  return false;
};

/**
 * Retourne le filtre WHERE selon le rôle de l'acteur
 */
const buildUserFilter = (acteur, params = [], baseWhere = 'WHERE 1=1') => {
  if (acteur.role === 'Administrateur') {
    return { where: baseWhere, params };
  }
  if (acteur.role === 'Gestionnaire' && acteur.coordination) {
    params = [...params, acteur.coordination];
    return { where: baseWhere + ` AND coordination = $${params.length}`, params };
  }
  if (acteur.role === "Chef d'équipe" && acteur.agence) {
    params = [...params, acteur.agence];
    return { where: baseWhere + ` AND agence = $${params.length}`, params };
  }
  return { where: baseWhere + ' AND 1=0', params };
};

// ============================================
// GET ALL USERS
// ============================================
const getAllUsers = async (req, res) => {
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    const {
      page = 1,
      limit = 20,
      role,
      actif,
      coordination,
      search,
      sort = 'nomcomplet',
      order = 'asc',
    } = req.query;

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), 100);
    const offset = (actualPage - 1) * actualLimit;

    const { where, params: baseParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    let params = [...baseParams];
    let query = `
      SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination,
             TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
             TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion,
             actif
      FROM utilisateurs ${where}
    `;

    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      query += ` AND (nomutilisateur ILIKE $${params.length} OR nomcomplet ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }
    if (coordination && acteur.role === 'Administrateur') {
      params.push(coordination);
      query += ` AND coordination = $${params.length}`;
    }
    if (actif !== undefined) {
      params.push(actif === 'true');
      query += ` AND actif = $${params.length}`;
    }

    const allowedSort = [
      'nomcomplet',
      'nomutilisateur',
      'role',
      'coordination',
      'datecreation',
      'derniereconnexion',
    ];
    const sortField = allowedSort.includes(sort) ? sort : 'nomcomplet';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    query += ` ORDER BY ${sortField} ${sortOrder}`;

    params.push(actualLimit, offset);
    query += ` LIMIT $${params.length - 1} OFFSET $${params.length}`;

    // Requête count
    const { where: whereC, params: countParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    let countQuery = `SELECT COUNT(*) as total FROM utilisateurs ${whereC}`;

    const startTime = Date.now();
    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, countParams),
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      utilisateurs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1,
      },
      filtres: {
        search: search || null,
        role: role || null,
        coordination: coordination || null,
        actif: actif || null,
        sort: sortField,
        order: sortOrder,
      },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération utilisateurs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// GET USER BY ID
// ============================================
const getUserById = async (req, res) => {
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    const { id } = req.params;
    const startTime = Date.now();

    const result = await db.query(
      `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination,
              TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
              TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion,
              actif
       FROM utilisateurs WHERE id = $1`,
      [id]
    );

    const user = result.rows[0];
    if (!user) return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });

    if (!peutGererUtilisateur(acteur, user)) {
      return res
        .status(403)
        .json({ success: false, message: 'Accès non autorisé à cet utilisateur' });
    }

    // Récupérer les sites liés
    const sitesResult = await db.query(
      `SELECT s.id, s.nom, us.est_site_principal
       FROM utilisateur_sites us
       JOIN sites s ON us.site_id = s.id
       WHERE us.utilisateur_id = $1
       ORDER BY us.est_site_principal DESC, s.nom`,
      [id]
    );

    res.json({
      success: true,
      utilisateur: { ...user, sites: sitesResult.rows },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération utilisateur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// CREATE USER
// ============================================
const createUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    await client.query('BEGIN');

    const {
      NomUtilisateur,
      NomComplet,
      Email,
      Agence,
      Role,
      Coordination,
      CoordinationId,
      MotDePasse,
      SiteIds = [],
    } = req.body;

    // Validations obligatoires
    if (!NomUtilisateur || !NomComplet || !MotDePasse || !Role) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Champs obligatoires manquants' });
    }

    if (!CONFIG.validRoles.includes(Role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Rôle invalide. Rôles valides: ${CONFIG.validRoles.join(', ')}`,
      });
    }

    if (MotDePasse.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`,
      });
    }

    // Vérification des droits selon le rôle de l'acteur
    if (acteur.role === 'Gestionnaire') {
      // Ne peut créer que dans sa coordination
      if (Coordination && Coordination !== acteur.coordination) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez créer des utilisateurs que dans votre coordination',
        });
      }
      // Ne peut pas créer un Administrateur ou un autre Gestionnaire
      if (['Administrateur', 'Gestionnaire'].includes(Role)) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez pas créer un compte Administrateur ou Gestionnaire',
        });
      }
    }

    if (acteur.role === "Chef d'équipe") {
      // Ne peut créer que dans son site
      if (Agence && Agence !== acteur.agence) {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: 'Vous ne pouvez créer des utilisateurs que dans votre site',
        });
      }
      // Ne peut créer que des Opérateurs
      if (Role !== 'Opérateur') {
        await client.query('ROLLBACK');
        return res.status(403).json({
          success: false,
          message: "Un Chef d'équipe ne peut créer que des Opérateurs",
        });
      }
    }

    // Vérifier unicité nom utilisateur
    const existingUser = await client.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1',
      [NomUtilisateur]
    );
    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: "Ce nom d'utilisateur existe déjà" });
    }

    // Vérifier unicité email
    if (Email) {
      const existingEmail = await client.query('SELECT id FROM utilisateurs WHERE email = $1', [
        Email,
      ]);
      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Cet email est déjà utilisé' });
      }
    }

    // Résoudre coordination_id si non fourni
    let resolvedCoordinationId = CoordinationId || null;
    if (!resolvedCoordinationId && Coordination) {
      const coordResult = await client.query(
        'SELECT id FROM coordinations WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))',
        [Coordination]
      );
      if (coordResult.rows.length > 0) {
        resolvedCoordinationId = coordResult.rows[0].id;
      }
    }

    const hashedPassword = await bcrypt.hash(MotDePasse, CONFIG.saltRounds);

    // Insérer l'utilisateur avec coordination_id
    const result = await client.query(
      `INSERT INTO utilisateurs
       (nomutilisateur, nomcomplet, email, agence, role, coordination, coordination_id,
        motdepasse, datecreation, actif, sync_timestamp, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, NOW(), NOW())
       RETURNING id`,
      [
        NomUtilisateur,
        NomComplet,
        Email || null,
        Agence || null,
        Role,
        Coordination || null,
        resolvedCoordinationId,
        hashedPassword,
        new Date(),
        true,
      ]
    );

    const newUserId = result.rows[0].id;

    // Lier les sites dans utilisateur_sites
    if (SiteIds && SiteIds.length > 0) {
      for (let i = 0; i < SiteIds.length; i++) {
        await client.query(
          `INSERT INTO utilisateur_sites (utilisateur_id, site_id, est_site_principal)
           VALUES ($1, $2, $3)
           ON CONFLICT (utilisateur_id, site_id) DO NOTHING`,
          [newUserId, SiteIds[i], i === 0] // Premier site = principal
        );
      }
    } else if (Agence) {
      // Lier automatiquement l'agence si aucun site explicite
      const siteResult = await client.query(
        'SELECT id FROM sites WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))',
        [Agence]
      );
      if (siteResult.rows.length > 0) {
        await client.query(
          `INSERT INTO utilisateur_sites (utilisateur_id, site_id, est_site_principal)
           VALUES ($1, $2, true)
           ON CONFLICT (utilisateur_id, site_id) DO NOTHING`,
          [newUserId, siteResult.rows[0].id]
        );
      }
    }

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Création utilisateur: ${NomUtilisateur}`,
      actionType: 'CREATE_USER',
      tableName: 'Utilisateurs',
      recordId: newUserId.toString(),
      oldValue: null,
      newValue: JSON.stringify({ NomUtilisateur, NomComplet, Email, Agence, Role, Coordination }),
      details: `Nouvel utilisateur créé: ${NomComplet} (${Role})`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      userId: newUserId,
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur création utilisateur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// UPDATE USER
// ============================================
const updateUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    await client.query('BEGIN');

    const { id } = req.params;
    const { NomComplet, Email, Agence, Role, Coordination, CoordinationId, Actif, SiteIds } =
      req.body;

    if (Role && !CONFIG.validRoles.includes(Role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Rôle invalide. Rôles valides: ${CONFIG.validRoles.join(', ')}`,
      });
    }

    const oldUserResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);
    const oldUser = oldUserResult.rows[0];

    if (!oldUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    if (!peutGererUtilisateur(acteur, oldUser)) {
      await client.query('ROLLBACK');
      return res
        .status(403)
        .json({ success: false, message: 'Accès non autorisé à cet utilisateur' });
    }

    if (Email && Email !== oldUser.email) {
      const existingEmail = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [Email, id]
      );
      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Email déjà utilisé' });
      }
    }

    if (parseInt(id) === parseInt(req.user.id) && Actif === false) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ success: false, message: 'Vous ne pouvez pas désactiver votre propre compte' });
    }

    // Résoudre coordination_id
    let resolvedCoordinationId = CoordinationId || oldUser.coordination_id;
    const newCoordination = Coordination !== undefined ? Coordination : oldUser.coordination;
    if (!resolvedCoordinationId && newCoordination) {
      const coordResult = await client.query(
        'SELECT id FROM coordinations WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))',
        [newCoordination]
      );
      if (coordResult.rows.length > 0) resolvedCoordinationId = coordResult.rows[0].id;
    }

    await client.query(
      `UPDATE utilisateurs
       SET nomcomplet = $1, email = $2, agence = $3, role = $4,
           coordination = $5, coordination_id = $6, actif = $7,
           updated_at = NOW(), sync_timestamp = NOW()
       WHERE id = $8`,
      [
        NomComplet || oldUser.nomcomplet,
        Email || oldUser.email,
        Agence || oldUser.agence,
        Role || oldUser.role,
        newCoordination,
        resolvedCoordinationId,
        Actif !== undefined ? Actif : oldUser.actif,
        id,
      ]
    );

    // Mettre à jour les sites liés si fournis
    if (SiteIds && SiteIds.length > 0) {
      await client.query('DELETE FROM utilisateur_sites WHERE utilisateur_id = $1', [id]);
      for (let i = 0; i < SiteIds.length; i++) {
        await client.query(
          `INSERT INTO utilisateur_sites (utilisateur_id, site_id, est_site_principal)
           VALUES ($1, $2, $3)
           ON CONFLICT (utilisateur_id, site_id) DO NOTHING`,
          [id, SiteIds[i], i === 0]
        );
      }
    }

    const newUser = (await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id])).rows[0];

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Modification utilisateur: ${oldUser.nomutilisateur}`,
      actionType: 'UPDATE_USER',
      tableName: 'Utilisateurs',
      recordId: id,
      oldValue: JSON.stringify({
        nomComplet: oldUser.nomcomplet,
        email: oldUser.email,
        agence: oldUser.agence,
        role: oldUser.role,
        coordination: oldUser.coordination,
        actif: oldUser.actif,
      }),
      newValue: JSON.stringify({
        nomComplet: newUser.nomcomplet,
        email: newUser.email,
        agence: newUser.agence,
        role: newUser.role,
        coordination: newUser.coordination,
        actif: newUser.actif,
      }),
      details: `Utilisateur modifié: ${NomComplet || oldUser.nomcomplet}`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Utilisateur modifié avec succès',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur modification utilisateur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// DELETE USER (DESACTIVATE)
// ============================================
const deleteUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    await client.query('BEGIN');

    const { id } = req.params;
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);
    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    if (!peutGererUtilisateur(acteur, user)) {
      await client.query('ROLLBACK');
      return res
        .status(403)
        .json({ success: false, message: 'Accès non autorisé à cet utilisateur' });
    }

    if (parseInt(id) === parseInt(req.user.id)) {
      await client.query('ROLLBACK');
      return res
        .status(400)
        .json({ success: false, message: 'Vous ne pouvez pas désactiver votre propre compte' });
    }

    await client.query('UPDATE utilisateurs SET actif = false, updated_at = NOW() WHERE id = $1', [
      id,
    ]);

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Désactivation utilisateur: ${user.nomutilisateur}`,
      actionType: 'DELETE_USER',
      tableName: 'Utilisateurs',
      recordId: id,
      oldValue: JSON.stringify({ actif: user.actif }),
      newValue: JSON.stringify({ actif: false }),
      details: `Utilisateur désactivé: ${user.nomcomplet} (${user.role})`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Utilisateur désactivé avec succès',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur désactivation utilisateur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// ACTIVATE USER
// ============================================
const activateUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    await client.query('BEGIN');

    const { id } = req.params;
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);
    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    if (!peutGererUtilisateur(acteur, user)) {
      await client.query('ROLLBACK');
      return res
        .status(403)
        .json({ success: false, message: 'Accès non autorisé à cet utilisateur' });
    }

    await client.query('UPDATE utilisateurs SET actif = true, updated_at = NOW() WHERE id = $1', [
      id,
    ]);

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Réactivation utilisateur: ${user.nomutilisateur}`,
      actionType: 'ACTIVATE_USER',
      tableName: 'Utilisateurs',
      recordId: id,
      oldValue: JSON.stringify({ actif: user.actif }),
      newValue: JSON.stringify({ actif: true }),
      details: 'Utilisateur réactivé',
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Utilisateur réactivé avec succès',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réactivation utilisateur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// RESET PASSWORD
// ============================================
const resetPassword = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    await client.query('BEGIN');

    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`,
      });
    }

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);
    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    if (!peutGererUtilisateur(acteur, user)) {
      await client.query('ROLLBACK');
      return res
        .status(403)
        .json({ success: false, message: 'Accès non autorisé à cet utilisateur' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);
    await client.query(
      'UPDATE utilisateurs SET motdepasse = $1, updated_at = NOW() WHERE id = $2',
      [hashedPassword, id]
    );

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Réinitialisation mot de passe: ${user.nomutilisateur}`,
      actionType: 'RESET_PASSWORD',
      tableName: 'Utilisateurs',
      recordId: id,
      details: 'Mot de passe réinitialisé',
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réinitialisation mot de passe:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// GET USER STATS
// ============================================
const getUserStats = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const { forceRefresh } = req.query;

    if (
      !forceRefresh &&
      CONFIG.statsCache &&
      CONFIG.statsCacheTime &&
      Date.now() - CONFIG.statsCacheTime < CONFIG.cacheTimeout * 1000
    ) {
      return res.json({
        success: true,
        ...CONFIG.statsCache,
        cached: true,
        cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime) / 1000) + 's',
      });
    }

    const startTime = Date.now();

    const [stats, rolesStats, coordinationStats, recentActivity] = await Promise.all([
      db.query(`
        SELECT COUNT(*) as total_utilisateurs,
          COUNT(CASE WHEN actif = true THEN 1 END) as utilisateurs_actifs,
          COUNT(CASE WHEN actif = false THEN 1 END) as utilisateurs_inactifs,
          COUNT(DISTINCT role) as roles_distincts,
          COUNT(DISTINCT agence) as agences_distinctes,
          COUNT(DISTINCT coordination) as coordinations_distinctes,
          MIN(datecreation) as premier_utilisateur,
          MAX(datecreation) as dernier_utilisateur,
          COUNT(CASE WHEN datecreation > NOW() - INTERVAL '30 days' THEN 1 END) as nouveaux_30j
        FROM utilisateurs`),
      db.query(`
        SELECT role, COUNT(*) as count,
          COUNT(CASE WHEN actif = true THEN 1 END) as actifs,
          ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM utilisateurs), 2) as pourcentage
        FROM utilisateurs GROUP BY role ORDER BY count DESC`),
      db.query(`
        SELECT coordination, COUNT(*) as count,
          COUNT(CASE WHEN actif = true THEN 1 END) as actifs
        FROM utilisateurs WHERE coordination IS NOT NULL
        GROUP BY coordination ORDER BY count DESC`),
      db.query(`
        SELECT u.nomutilisateur, u.nomcomplet, u.role, u.coordination,
          COUNT(j.journalid) as total_actions, MAX(j.dateaction) as derniere_action,
          COUNT(CASE WHEN j.dateaction > NOW() - INTERVAL '24 hours' THEN 1 END) as actions_24h
        FROM utilisateurs u
        LEFT JOIN journalactivite j ON u.id = j.utilisateurid
        WHERE j.dateaction >= CURRENT_DATE - INTERVAL '7 days'
        GROUP BY u.id, u.nomutilisateur, u.nomcomplet, u.role, u.coordination
        ORDER BY total_actions DESC LIMIT 10`),
    ]);

    const statsData = {
      stats: {
        total_utilisateurs: parseInt(stats.rows[0].total_utilisateurs),
        utilisateurs_actifs: parseInt(stats.rows[0].utilisateurs_actifs),
        utilisateurs_inactifs: parseInt(stats.rows[0].utilisateurs_inactifs),
        taux_activation:
          stats.rows[0].total_utilisateurs > 0
            ? Math.round(
                (stats.rows[0].utilisateurs_actifs / stats.rows[0].total_utilisateurs) * 100
              )
            : 0,
        roles_distincts: parseInt(stats.rows[0].roles_distincts),
        agences_distinctes: parseInt(stats.rows[0].agences_distinctes),
        coordinations_distinctes: parseInt(stats.rows[0].coordinations_distinctes),
        nouveaux_30j: parseInt(stats.rows[0].nouveaux_30j),
        premier_utilisateur: stats.rows[0].premier_utilisateur,
        dernier_utilisateur: stats.rows[0].dernier_utilisateur,
      },
      parRole: rolesStats.rows.map((r) => ({
        ...r,
        count: parseInt(r.count),
        actifs: parseInt(r.actifs),
        pourcentage: parseFloat(r.pourcentage),
      })),
      parCoordination: coordinationStats.rows.map((r) => ({
        ...r,
        count: parseInt(r.count),
        actifs: parseInt(r.actifs),
      })),
      activiteRecente: recentActivity.rows.map((r) => ({
        ...r,
        total_actions: parseInt(r.total_actions),
        actions_24h: parseInt(r.actions_24h),
      })),
      performance: { queryTime: Date.now() - startTime },
    };

    CONFIG.statsCache = statsData;
    CONFIG.statsCacheTime = Date.now();

    res.json({ success: true, ...statsData, cached: false, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Erreur statistiques utilisateurs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// SEARCH USERS
// ============================================
const searchUsers = async (req, res) => {
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé' });
    }

    const { q, role, coordination, actif, page = 1, limit = 20 } = req.query;
    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), 100);
    const offset = (actualPage - 1) * actualLimit;

    const { where, params: baseParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    let params = [...baseParams];
    let query = `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, actif
                 FROM utilisateurs ${where}`;

    if (q && q.trim() !== '') {
      params.push(`%${q.trim()}%`);
      query += ` AND (nomutilisateur ILIKE $${params.length} OR nomcomplet ILIKE $${params.length} OR email ILIKE $${params.length})`;
    }
    if (role) {
      params.push(role);
      query += ` AND role = $${params.length}`;
    }
    if (coordination && acteur.role === 'Administrateur') {
      params.push(coordination);
      query += ` AND coordination = $${params.length}`;
    }
    if (actif !== undefined) {
      params.push(actif === 'true');
      query += ` AND actif = $${params.length}`;
    }

    params.push(actualLimit, offset);
    query += ` ORDER BY nomcomplet LIMIT $${params.length - 1} OFFSET $${params.length}`;

    const { where: whereC, params: countParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    const startTime = Date.now();
    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(`SELECT COUNT(*) as total FROM utilisateurs ${whereC}`, countParams),
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      utilisateurs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1,
      },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur recherche utilisateurs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// GET USER HISTORY
// ============================================
const getUserHistory = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const { id } = req.params;
    const { limit = 50, page = 1 } = req.query;
    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), 200);
    const offset = (actualPage - 1) * actualLimit;

    const userResult = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1',
      [id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Utilisateur non trouvé' });
    }

    const startTime = Date.now();
    const [history, countResult] = await Promise.all([
      db.query(
        `SELECT journalid, actiontype, action,
          TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
          tablename, recordid, detailsaction, iputilisateur, annulee
        FROM journalactivite WHERE utilisateurid = $1
        ORDER BY dateaction DESC LIMIT $2 OFFSET $3`,
        [id, actualLimit, offset]
      ),
      db.query('SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1', [id]),
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      utilisateur: userResult.rows[0],
      historique: history.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1,
      },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur historique utilisateur:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// EXPORT USERS
// ============================================
const exportUsers = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const { format = 'json' } = req.query;
    const users = await db.query(`
      SELECT nomutilisateur, nomcomplet, email, agence, role, coordination,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion,
        CASE WHEN actif = true THEN 'Actif' ELSE 'Inactif' END as statut
      FROM utilisateurs ORDER BY nomcomplet`);

    const filename = `utilisateurs-export-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csvHeaders =
        'NomUtilisateur,NomComplet,Email,Agence,Role,Coordination,DateCreation,DerniereConnexion,Statut\n';
      const csvData = users.rows
        .map(
          (r) =>
            `"${r.nomutilisateur}","${r.nomcomplet}","${r.email || ''}","${r.agence || ''}","${r.role}","${r.coordination || ''}","${r.datecreation}","${r.derniereconnexion || ''}","${r.statut}"`
        )
        .join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.write('\uFEFF');
      res.send(csvHeaders + csvData);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        data: users.rows,
        exportDate: new Date().toISOString(),
        total: users.rows.length,
      });
    }
  } catch (error) {
    console.error('❌ Erreur export utilisateurs:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// CHECK USERNAME AVAILABILITY
// ============================================
const checkUsernameAvailability = async (req, res) => {
  try {
    const { username, excludeId } = req.query;
    if (!username)
      return res.status(400).json({ success: false, message: "Nom d'utilisateur requis" });

    let query = 'SELECT id FROM utilisateurs WHERE nomutilisateur = $1';
    const params = [username];
    if (excludeId) {
      query += ' AND id != $2';
      params.push(excludeId);
    }

    const result = await db.query(query, params);
    const isAvailable = result.rows.length === 0;

    res.json({
      success: true,
      available: isAvailable,
      message: isAvailable ? "Nom d'utilisateur disponible" : "Nom d'utilisateur déjà utilisé",
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error("❌ Erreur vérification nom d'utilisateur:", error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// GET ROLES
// ============================================
const getRoles = async (req, res) => {
  try {
    res.json({ success: true, roles: CONFIG.validRoles, timestamp: new Date().toISOString() });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// GET COORDINATIONS
// ============================================
const getCoordinations = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }
    const result = await db.query(`
      SELECT DISTINCT coordination FROM utilisateurs
      WHERE coordination IS NOT NULL AND coordination != ''
      ORDER BY coordination`);
    res.json({
      success: true,
      coordinations: result.rows.map((r) => r.coordination),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// CLEAR STATS CACHE
// ============================================
const clearStatsCache = async (req, res) => {
  try {
    CONFIG.statsCache = null;
    CONFIG.statsCacheTime = null;
    res.json({
      success: true,
      message: 'Cache des statistiques nettoyé',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// DIAGNOSTIC
// ============================================
const diagnostic = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    }

    const startTime = Date.now();
    const result = await db.query(`
      SELECT COUNT(*) as total_utilisateurs,
        COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs,
        COUNT(DISTINCT role) as roles_distincts,
        COUNT(DISTINCT coordination) as coordinations_distinctes,
        MIN(datecreation) as premier_utilisateur,
        MAX(datecreation) as dernier_utilisateur,
        pg_total_relation_size('utilisateurs') as table_size,
        pg_size_pretty(pg_total_relation_size('utilisateurs')) as table_size_pretty
      FROM utilisateurs`);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'utilisateurs',
      utilisateur: { role: req.user.role, coordination: req.user.coordination },
      statistiques: {
        total_utilisateurs: parseInt(stats.total_utilisateurs),
        utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
        taux_activation:
          stats.total_utilisateurs > 0
            ? Math.round((stats.utilisateurs_actifs / stats.total_utilisateurs) * 100)
            : 0,
        roles_distincts: parseInt(stats.roles_distincts),
        coordinations_distinctes: parseInt(stats.coordinations_distinctes),
        premier_utilisateur: stats.premier_utilisateur,
        dernier_utilisateur: stats.dernier_utilisateur,
      },
      stockage: { taille_table: stats.table_size_pretty, taille_bytes: parseInt(stats.table_size) },
      config: {
        saltRounds: CONFIG.saltRounds,
        minPasswordLength: CONFIG.minPasswordLength,
        cacheTimeout: CONFIG.cacheTimeout,
        validRoles: CONFIG.validRoles,
      },
      performance: { queryTime: Date.now() - startTime },
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ============================================
// EXPORT
// ============================================
module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  activateUser,
  resetPassword,
  getUserStats,
  searchUsers,
  getUserHistory,
  exportUsers,
  checkUsernameAvailability,
  getRoles,
  getCoordinations,
  clearStatsCache,
  diagnostic,
};


// ========== Services\BulkImportService.js ==========
const EventEmitter = require('events');
const db = // require modifié - fichier consolidé;
const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const readline = require('readline');

class BulkImportServiceCSV extends EventEmitter {
  constructor(options = {}) {
    super();

    // ============================================
    // CONFIGURATION OPTIMISÉE POUR VPS
    // ============================================

    // Configuration optimisée pour VPS 8 Go RAM
    const defaultOptions = {
      // 🚀 OPTIMISATIONS VPS
      batchSize: 5000, // Lots plus gros (vs 2000)
      maxConcurrentBatches: 4, // Plus de parallélisme (vs 2)
      memoryLimitMB: 1024, // 1 Go pour les imports (vs 256MB)
      timeoutPerBatch: 60000, // 60 secondes (vs 30s)
      pauseBetweenBatches: 25, // Pause plus courte (vs 50ms)
      streamBufferSize: 512 * 1024, // 512KB buffer (vs 128KB)

      // 📊 CONFIGURATION STANDARD
      validateEachRow: true,
      skipDuplicates: true,
      cleanupTempFiles: true,
      enableProgressTracking: true,
      maxRowsPerImport: 1000000, // 1M lignes max (vs 500k)
      enableBatchRollback: true,
      useTransactionPerBatch: true,
      logBatchFrequency: 20,
      forceGarbageCollection: false,

      // 📄 CONFIGURATION CSV
      csvDelimiter: ';', // Point-virgule pour Excel français
      csvEncoding: 'utf8',
    };

    this.options = { ...defaultOptions, ...options };

    // Définition des colonnes CSV
    this.csvHeaders = [
      "LIEU D'ENROLEMENT",
      'SITE DE RETRAIT',
      'RANGEMENT',
      'NOM',
      'PRENOMS',
      'DATE DE NAISSANCE',
      'LIEU NAISSANCE',
      'CONTACT',
      'DELIVRANCE',
      'CONTACT DE RETRAIT',
      'DATE DE DELIVRANCE',
    ];

    this.requiredHeaders = ['NOM', 'PRENOMS'];

    // Statistiques de l'import
    this.stats = {
      totalRows: 0,
      processed: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      skipped: 0,
      errors: 0,
      startTime: null,
      endTime: null,
      batches: 0,
      memoryPeakMB: 0,
      lastProgressUpdate: 0,
      rowsPerSecond: 0,
    };

    // État de l'import
    this.isRunning = false;
    this.isCancelled = false;
    this.currentBatch = 0;
    this.lastBatchTime = null;

    console.log('🚀 Service BulkImport CSV initialisé pour VPS:', {
      batchSize: this.options.batchSize,
      maxConcurrent: this.options.maxConcurrentBatches,
      maxRows: this.options.maxRowsPerImport,
      memoryLimit: `${this.options.memoryLimitMB}MB`,
      format: 'CSV optimisé',
      performance: 'Mode VPS (performances maximales)',
    });
  }

  // ==================== MÉTHODE PRINCIPALE CSV ====================

  /**
   * Importe un fichier CSV volumineux avec traitement par lots OPTIMISÉ POUR VPS
   */
  async importLargeCSVFile(filePath, userId = null, importBatchId = null) {
    if (this.isRunning) {
      throw new Error('Un import est déjà en cours');
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.stats.startTime = new Date();
    this.currentBatch = 0;

    const finalImportBatchId =
      importBatchId || `csv_bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    this.emit('start', {
      filePath: path.basename(filePath),
      startTime: this.stats.startTime,
      importBatchId: finalImportBatchId,
      userId,
      environment: 'VPS',
      format: 'CSV',
    });

    try {
      // 1. ANALYSE RAPIDE DU FICHIER
      console.log('📊 Analyse rapide du fichier CSV...');
      await this.analyzeCSVFile(filePath);

      // 2. VALIDATION
      await this.validateCSVFile(filePath);

      if (this.stats.totalRows > this.options.maxRowsPerImport) {
        throw new Error(
          `Fichier trop volumineux: ${this.stats.totalRows} lignes (max: ${this.options.maxRowsPerImport})`
        );
      }

      this.emit('analysis', {
        totalRows: this.stats.totalRows,
        estimatedBatches: Math.ceil(this.stats.totalRows / this.options.batchSize),
        estimatedTime: this.estimateCSVTotalTime(this.stats.totalRows),
        fileSizeMB: (await fs.stat(filePath)).size / 1024 / 1024,
        recommendations: [
          '✅ VPS: performances maximales',
          `📦 Lots de ${this.options.batchSize} lignes`,
          `⚡ Vitesse estimée: ${Math.round(this.stats.totalRows / 45)} lignes/sec`,
        ],
      });

      // 3. TRAITEMENT PAR LOTS AVEC STREAMING
      console.log(`🎯 Début du traitement CSV: ${this.stats.totalRows} lignes...`);
      await this.processCSVWithOptimizedStreaming(filePath, finalImportBatchId, userId);

      // 4. FINALISATION
      this.stats.endTime = new Date();
      const duration = this.stats.endTime - this.stats.startTime;

      // Calculer les performances
      const performance = this.calculateCSVPerformance(duration);
      this.stats.rowsPerSecond = performance.rowsPerSecond;

      this.emit('complete', {
        stats: { ...this.stats },
        duration,
        performance,
        importBatchId: finalImportBatchId,
        successRate:
          this.stats.totalRows > 0
            ? Math.round(((this.stats.imported + this.stats.updated) / this.stats.totalRows) * 100)
            : 0,
        environment: 'VPS',
        format: 'CSV',
      });

      console.log(`✅ Import CSV terminé en ${Math.round(duration / 1000)}s:`, {
        importés: this.stats.imported,
        misÀJour: this.stats.updated,
        doublons: this.stats.duplicates,
        erreurs: this.stats.errors,
        vitesse: `${performance.rowsPerSecond} lignes/sec`,
        mémoirePic: `${this.stats.memoryPeakMB}MB`,
        efficacité: performance.efficiency,
      });

      return {
        success: true,
        importBatchId: finalImportBatchId,
        stats: { ...this.stats },
        duration,
        performance,
        environment: 'VPS',
        format: 'CSV',
      };
    } catch (error) {
      this.stats.endTime = new Date();

      this.emit('error', {
        error: error.message,
        stats: { ...this.stats },
        importBatchId: finalImportBatchId,
        duration: this.stats.endTime - this.stats.startTime,
        format: 'CSV',
      });

      console.error('❌ Erreur import CSV massif:', error.message);
      throw error;
    } finally {
      this.isRunning = false;

      // NETTOYAGE
      await this.optimizedCleanup(filePath);
    }
  }

  // ==================== ANALYSE CSV OPTIMISÉE ====================

  /**
   * Analyser le fichier CSV en mode streaming
   */
  async analyzeCSVFile(filePath) {
    try {
      let lineCount = 0;
      let detectedHeaders = [];
      let isFirstRow = true;

      // Lire les premières lignes pour détecter les en-têtes
      const fileStream = fs.createReadStream(filePath, {
        encoding: this.options.csvEncoding,
        highWaterMark: this.options.streamBufferSize,
      });

      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity,
      });

      for await (const line of rl) {
        if (isFirstRow) {
          // Détecter les en-têtes
          detectedHeaders = line
            .split(this.options.csvDelimiter)
            .map((h) => h.trim().replace(/"/g, '').toUpperCase());
          isFirstRow = false;

          // Valider les en-têtes
          this.validateCSVHeaders(detectedHeaders);

          // Créer le mapping
          this.createHeaderMapping(detectedHeaders);
        } else {
          lineCount++;

          // Estimation pour les très gros fichiers
          if (lineCount > 5000) {
            // Estimer basé sur la taille du fichier
            const stats = await fs.stat(filePath);
            const bytesPerLine = stats.size / (lineCount + 1);
            lineCount = Math.floor(stats.size / bytesPerLine) - 1;
            break;
          }
        }
      }

      rl.close();

      this.stats.totalRows = lineCount;

      console.log(
        `📊 Fichier CSV analysé: ${this.stats.totalRows} lignes, ${detectedHeaders.length} colonnes`
      );
    } catch (error) {
      console.error('❌ Erreur analyse CSV:', error);
      throw new Error(`Impossible d'analyser le fichier CSV: ${error.message}`);
    }
  }

  /**
   * Créer le mapping des en-têtes
   */
  createHeaderMapping(detectedHeaders) {
    const mapping = {};

    this.csvHeaders.forEach((standardHeader) => {
      const normalizedStandard = standardHeader.replace(/\s+/g, '').toUpperCase();

      const foundIndex = detectedHeaders.findIndex(
        (h) => h.replace(/\s+/g, '').toUpperCase() === normalizedStandard
      );

      if (foundIndex !== -1) {
        mapping[standardHeader] = foundIndex;
      }
    });

    this.headerMapping = mapping;
  }

  /**
   * Valider les en-têtes CSV
   */
  validateCSVHeaders(headers) {
    const upperHeaders = headers.map((h) => h.toUpperCase());
    const missingHeaders = this.requiredHeaders.filter(
      (h) => !upperHeaders.some((uh) => uh.includes(h.toUpperCase()))
    );

    if (missingHeaders.length > 0) {
      throw new Error(`En-têtes requis manquants: ${missingHeaders.join(', ')}`);
    }

    console.log('✅ En-têtes CSV validés');
  }

  /**
   * Valider le fichier CSV pour VPS
   */
  async validateCSVFile(filePath) {
    const stats = await fs.stat(filePath);
    const fileSizeMB = stats.size / 1024 / 1024;

    console.log(`📁 Taille du fichier: ${fileSizeMB.toFixed(2)}MB`);

    if (fileSizeMB > 500) {
      console.warn(`⚠️ Fichier très volumineux: ${fileSizeMB.toFixed(2)}MB`);
      this.emit('warning', {
        type: 'large_file',
        sizeMB: fileSizeMB,
        advice: 'Le traitement peut prendre plusieurs minutes',
      });
    }
  }

  // ==================== TRAITEMENT STREAMING CSV ====================

  /**
   * Traitement CSV avec streaming optimisé
   */
  async processCSVWithOptimizedStreaming(filePath, importBatchId, userId) {
    return new Promise((resolve, reject) => {
      let currentBatch = [];
      let rowNumber = 0;
      let batchIndex = 0;
      let processing = false;

      const stream = fs.createReadStream(filePath, {
        encoding: this.options.csvEncoding,
        highWaterMark: this.options.streamBufferSize,
      });

      const parser = csv({
        separator: this.options.csvDelimiter,
        mapHeaders: ({ header }) => header.trim().toUpperCase(),
        mapValues: ({ value }) => (value ? value.toString().trim() : ''),
        skipLines: 0,
      });

      stream
        .pipe(parser)
        .on('data', async (data) => {
          if (this.isCancelled) {
            stream.destroy();
            reject(new Error('Import CSV annulé'));
            return;
          }

          rowNumber++;

          // Ignorer la ligne d'en-tête
          if (rowNumber === 1) return;

          // Ajouter au lot courant
          currentBatch.push({
            rowNumber,
            data: this.mapCSVData(data),
          });

          // Si le lot est complet, le traiter
          if (currentBatch.length >= this.options.batchSize && !processing) {
            processing = true;

            // Pause le stream
            stream.pause();

            try {
              await this.processCSVBatchWithTimeout(
                [...currentBatch],
                batchIndex,
                importBatchId,
                userId
              );

              currentBatch = [];
              batchIndex++;
              this.currentBatch = batchIndex;

              // Mise à jour de la progression
              this.updateProgress(rowNumber - 1);
            } catch (error) {
              stream.destroy();
              reject(error);
              return;
            } finally {
              processing = false;
              stream.resume();
            }
          }
        })
        .on('end', async () => {
          try {
            // Traiter le dernier lot
            if (currentBatch.length > 0 && !this.isCancelled) {
              await this.processCSVBatchWithTimeout(
                currentBatch,
                batchIndex,
                importBatchId,
                userId
              );
              this.currentBatch = batchIndex + 1;
            }

            resolve({ batches: this.currentBatch });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          console.error('❌ Erreur streaming CSV:', error);
          reject(new Error(`Erreur lecture CSV: ${error.message}`));
        });
    });
  }

  /**
   * Mapper les données CSV vers notre structure
   */
  mapCSVData(csvRow) {
    const mappedData = {};

    Object.keys(this.headerMapping).forEach((standardHeader) => {
      const index = this.headerMapping[standardHeader];

      if (index !== undefined) {
        // Accès direct par index dans l'objet csvRow
        const values = Object.values(csvRow);
        mappedData[standardHeader] = values[index] || '';
      } else {
        mappedData[standardHeader] = '';
      }
    });

    return mappedData;
  }

  // ==================== TRAITEMENT DES LOTS ====================

  /**
   * Traiter un batch CSV avec timeout
   */
  async processCSVBatchWithTimeout(batch, batchIndex, importBatchId, userId) {
    if (this.isCancelled || batch.length === 0) return;

    const batchStartTime = Date.now();
    this.lastBatchTime = batchStartTime;

    this.stats.batches++;

    this.emit('batchStart', {
      batchIndex,
      size: batch.length,
      startTime: new Date(),
      memoryBefore: this.getMemoryUsage(),
    });

    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout batch ${batchIndex} après ${this.options.timeoutPerBatch}ms`));
      }, this.options.timeoutPerBatch);
    });

    try {
      const batchResults = await Promise.race([
        this.processCSVBatch(batch, batchIndex, importBatchId, userId),
        timeoutPromise,
      ]);

      const batchDuration = Date.now() - batchStartTime;
      const batchRowsPerSecond =
        batch.length > 0 ? Math.round(batch.length / (batchDuration / 1000)) : 0;

      this.emit('batchComplete', {
        batchIndex,
        results: batchResults,
        duration: batchDuration,
        memory: this.getMemoryUsage(),
        rowsPerSecond: batchRowsPerSecond,
      });

      // Pause entre les lots
      if (this.options.pauseBetweenBatches > 0) {
        await this.sleep(this.options.pauseBetweenBatches);
      }

      return batchResults;
    } catch (error) {
      this.emit('batchError', {
        batchIndex,
        error: error.message,
        size: batch.length,
        duration: Date.now() - batchStartTime,
      });

      if (this.options.enableBatchRollback) {
        console.warn(`⚠️ Rollback batch ${batchIndex} après erreur: ${error.message}`);
      }

      throw error;
    }
  }

  /**
   * Traitement optimisé d'un batch CSV
   */
  async processCSVBatch(batch, batchIndex, importBatchId, userId) {
    const client = await db.getClient();
    const batchResults = {
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 0,
      skipped: 0,
    };

    try {
      if (this.options.useTransactionPerBatch) {
        await client.query('BEGIN');
      }

      // Préparer les requêtes batch
      const insertValues = [];
      const insertParams = [];
      let paramIndex = 1;

      for (const item of batch) {
        try {
          const { data } = item;

          // Validation des champs requis
          if (!this.validateCSVRequiredFields(data)) {
            batchResults.errors++;
            this.stats.errors++;
            continue;
          }

          // Nettoyer et parser les données
          const cleanedData = this.cleanCSVRowData(data);

          // Vérification doublon
          if (this.options.skipDuplicates) {
            const isDuplicate = await this.checkCSVDuplicateOptimized(client, cleanedData);
            if (isDuplicate) {
              batchResults.duplicates++;
              this.stats.duplicates++;
              continue;
            }
          }

          // Préparer l'insertion
          insertValues.push(`(
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}
          )`);

          insertParams.push(
            cleanedData["LIEU D'ENROLEMENT"] || '',
            cleanedData['SITE DE RETRAIT'] || '',
            cleanedData['RANGEMENT'] || '',
            cleanedData['NOM'] || '',
            cleanedData['PRENOMS'] || '',
            this.parseCSVDateForDB(cleanedData['DATE DE NAISSANCE']),
            cleanedData['LIEU NAISSANCE'] || '',
            this.formatPhoneNumber(cleanedData['CONTACT'] || ''),
            cleanedData['DELIVRANCE'] || '',
            this.formatPhoneNumber(cleanedData['CONTACT DE RETRAIT'] || ''),
            this.parseCSVDateForDB(cleanedData['DATE DE DELIVRANCE']),
            new Date(),
            importBatchId
          );

          batchResults.imported++;
          this.stats.imported++;
          this.stats.processed++;
        } catch (error) {
          batchResults.errors++;
          this.stats.errors++;
          console.warn(`⚠️ Erreur ligne ${item.rowNumber}:`, error.message);
        }
      }

      // Insertion batch
      if (insertValues.length > 0) {
        const query = `
          INSERT INTO cartes (
            "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
            "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
            "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", dateimport, importbatchid
          ) VALUES ${insertValues.join(', ')}
          ON CONFLICT (nom, prenoms, "DATE DE NAISSANCE") 
          DO UPDATE SET 
            delivrance = EXCLUDED.delivrance,
            "CONTACT DE RETRAIT" = EXCLUDED."CONTACT DE RETRAIT",
            "DATE DE DELIVRANCE" = EXCLUDED."DATE DE DELIVRANCE",
            dateimport = NOW()
          RETURNING id
        `;

        const result = await client.query(query, insertParams);
        batchResults.updated = result.rowCount - insertValues.length;
        this.stats.updated += batchResults.updated;
      }

      // Journalisation
      await this.logCSVBatchOptimized(client, userId, importBatchId, batchIndex, batchResults);

      if (this.options.useTransactionPerBatch) {
        await client.query('COMMIT');
      }

      return batchResults;
    } catch (error) {
      if (this.options.useTransactionPerBatch) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // ==================== UTILITAIRES ====================

  /**
   * Validation des champs requis
   */
  validateCSVRequiredFields(data) {
    return data.NOM && data.NOM.trim() !== '' && data.PRENOMS && data.PRENOMS.trim() !== '';
  }

  /**
   * Nettoyer les données d'une ligne
   */
  cleanCSVRowData(data) {
    const cleaned = {};

    for (const key of this.csvHeaders) {
      let value = data[key] || '';

      if (typeof value === 'string') {
        value = value.trim();

        if (key.includes('DATE')) {
          value = this.parseCSVDate(value);
        } else if (key.includes('CONTACT')) {
          value = this.formatPhoneNumber(value);
        }
      }

      cleaned[key] = value;
    }

    return cleaned;
  }

  /**
   * Parser de date CSV robuste
   */
  parseCSVDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return '';

    const str = dateStr.trim();

    // Format Excel (nombre)
    const num = parseFloat(str);
    if (!isNaN(num) && num > 1000) {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + (num - 1) * 86400000);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }

    // Formats de date standards
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
      /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
      /^(\d{2})-(\d{2})-(\d{4})$/, // DD-MM-YYYY
      /^(\d{4})\/(\d{2})\/(\d{2})$/, // YYYY/MM/DD
    ];

    for (const regex of formats) {
      const match = str.match(regex);
      if (match) {
        let year, month, day;

        if (regex.source.includes('^\\d{4}')) {
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else {
          day = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          year = parseInt(match[3], 10);
          if (year < 100) year += 2000;
        }

        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
    }

    // Dernier essai avec Date.parse
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
      const date = new Date(parsed);
      return date.toISOString().split('T')[0];
    }

    return '';
  }

  /**
   * Formater une date pour la base de données
   */
  parseCSVDateForDB(dateStr) {
    const parsed = this.parseCSVDate(dateStr);
    return parsed || null;
  }

  /**
   * Vérification doublon optimisée
   */
  async checkCSVDuplicateOptimized(client, data) {
    try {
      const result = await client.query(
        `SELECT 1 FROM cartes 
         WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1)) 
         AND LOWER(TRIM(prenoms)) = LOWER(TRIM($2))
         AND "DATE DE NAISSANCE" = $3
         LIMIT 1`,
        [data.NOM || '', data.PRENOMS || '', this.parseCSVDateForDB(data['DATE DE NAISSANCE'])]
      );

      return result.rows.length > 0;
    } catch (error) {
      console.warn('⚠️ Erreur vérification doublon:', error.message);
      return false;
    }
  }

  /**
   * Formater un numéro de téléphone
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';

    let cleaned = phone.toString().replace(/\D/g, '');

    if (cleaned.startsWith('225')) {
      cleaned = cleaned.substring(3);
    } else if (cleaned.startsWith('00225')) {
      cleaned = cleaned.substring(5);
    }

    if (cleaned.length > 0 && cleaned.length < 8) {
      cleaned = cleaned.padStart(8, '0');
    }

    return cleaned.substring(0, 8);
  }

  /**
   * Journalisation batch optimisée
   */
  async logCSVBatchOptimized(client, userId, importBatchId, batchIndex, results) {
    if (batchIndex % this.options.logBatchFrequency !== 0) {
      return;
    }

    try {
      await client.query(
        `
        INSERT INTO journalactivite (
          utilisateurid, nomutilisateur, dateaction, action, 
          actiontype, tablename, importbatchid, detailsaction
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `,
        [
          userId || null,
          userId ? 'import_csv' : 'system',
          new Date(),
          `Batch CSV ${batchIndex}`,
          'BULK_IMPORT_CSV_BATCH',
          'cartes',
          importBatchId,
          `Importés: ${results.imported}, Doublons: ${results.duplicates}`,
        ]
      );
    } catch (error) {
      // Logger en mode debug seulement
      if (process.env.NODE_ENV === 'development') {
        console.debug('⚠️ Erreur journalisation batch (non critique):', error.message);
      }
    }
  }

  // ==================== PERFORMANCE ET MÉMOIRE ====================

  /**
   * Mettre à jour la progression
   */
  updateProgress(currentRow) {
    const now = Date.now();

    if (now - this.stats.lastProgressUpdate < 1000 && currentRow < this.stats.totalRows) {
      return;
    }

    const progress = Math.round((currentRow / this.stats.totalRows) * 100);
    const memory = this.getMemoryUsage();

    this.emit('progress', {
      processed: currentRow,
      total: this.stats.totalRows,
      percentage: progress,
      currentBatch: this.currentBatch,
      memory,
      rowsPerSecond: this.calculateCurrentSpeed(currentRow),
    });

    this.stats.lastProgressUpdate = now;
  }

  /**
   * Calculer la vitesse actuelle
   */
  calculateCurrentSpeed(currentRow) {
    const duration = Date.now() - this.stats.startTime.getTime();
    return duration > 0 ? Math.round(currentRow / (duration / 1000)) : 0;
  }

  /**
   * Calculer les performances
   */
  calculateCSVPerformance(duration) {
    const rowsPerSecond =
      this.stats.processed > 0 ? Math.round(this.stats.processed / (duration / 1000)) : 0;

    const avgBatchTime = this.stats.batches > 0 ? Math.round(duration / this.stats.batches) : 0;

    let efficiency = 'moyenne';
    if (rowsPerSecond > 800) efficiency = 'excellente';
    else if (rowsPerSecond > 500) efficiency = 'bonne';
    else if (rowsPerSecond > 200) efficiency = 'satisfaisante';

    return {
      rowsPerSecond,
      avgBatchTime,
      efficiency,
      memoryPeak: `${this.stats.memoryPeakMB}MB`,
    };
  }

  /**
   * Estimer le temps total
   */
  estimateCSVTotalTime(totalRows) {
    const rowsPerSecond = 800; // Estimation VPS
    const seconds = Math.ceil(totalRows / rowsPerSecond);

    if (seconds < 60) return `${seconds} secondes`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
    return `${Math.ceil(seconds / 3600)} heures`;
  }

  /**
   * Obtenir l'utilisation mémoire
   */
  getMemoryUsage() {
    const memory = process.memoryUsage();
    const usedMB = Math.round(memory.heapUsed / 1024 / 1024);

    if (usedMB > this.stats.memoryPeakMB) {
      this.stats.memoryPeakMB = usedMB;
    }

    return {
      usedMB,
      totalMB: Math.round(memory.heapTotal / 1024 / 1024),
      isCritical: usedMB > this.options.memoryLimitMB * 0.9,
    };
  }

  /**
   * Nettoyage optimisé
   */
  async optimizedCleanup(filePath) {
    try {
      if (this.options.cleanupTempFiles && filePath) {
        await this.cleanupFile(filePath);
      }

      this.headers = null;
      this.headerMapping = null;
      this.currentBatch = 0;

      console.log('🧹 Nettoyage CSV terminé');
    } catch (error) {
      console.warn('⚠️ Erreur nettoyage:', error.message);
    }
  }

  /**
   * Nettoyer un fichier
   */
  async cleanupFile(filePath) {
    try {
      if (
        filePath &&
        (await fs
          .access(filePath)
          .then(() => true)
          .catch(() => false))
      ) {
        await fs.unlink(filePath);
        console.log(`🗑️ Fichier supprimé: ${path.basename(filePath)}`);
      }
    } catch (error) {
      // Ignorer les erreurs
    }
  }

  /**
   * Pause
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Annuler l'import
   */
  cancel() {
    this.isCancelled = true;
    this.emit('cancelled', {
      stats: { ...this.stats },
      timestamp: new Date(),
      currentBatch: this.currentBatch,
      format: 'CSV',
    });

    console.log('🛑 Import CSV annulé');
  }

  /**
   * Obtenir le statut
   */
  getStatus() {
    const duration = this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0;
    const memory = this.getMemoryUsage();

    return {
      isRunning: this.isRunning,
      isCancelled: this.isCancelled,
      stats: { ...this.stats },
      memory,
      progress:
        this.stats.totalRows > 0
          ? Math.round((this.stats.processed / this.stats.totalRows) * 100)
          : 0,
      currentBatch: this.currentBatch,
      environment: 'VPS',
      format: 'CSV',
      currentSpeed: duration > 0 ? Math.round(this.stats.processed / (duration / 1000)) : 0,
      estimatedRemaining: this.estimateRemainingTime(),
    };
  }

  /**
   * Estimer le temps restant
   */
  estimateRemainingTime() {
    if (!this.stats.startTime || this.stats.processed === 0) return null;

    const elapsed = Date.now() - this.stats.startTime.getTime();
    const remainingRows = this.stats.totalRows - this.stats.processed;
    const rowsPerSecond = this.stats.processed / (elapsed / 1000);

    if (rowsPerSecond <= 0) return null;

    const secondsRemaining = Math.ceil(remainingRows / rowsPerSecond);

    if (secondsRemaining < 60) return `${secondsRemaining}s`;
    if (secondsRemaining < 3600) return `${Math.ceil(secondsRemaining / 60)}min`;
    return `${Math.ceil(secondsRemaining / 3600)}h`;
  }
}

module.exports = BulkImportServiceCSV;


// ========== Services\annulationService.js ==========
// ============================================
// services/annulationService.js
// ============================================
// Service d'annulation des actions avec traçabilité complète
// Gère l'enregistrement des actions et leur annulation par les administrateurs
// ============================================

const db = // require modifié - fichier consolidé;

class ServiceAnnulation {
  /**
   * Enregistrer une action dans le journal avec les valeurs JSON pour annulation
   * @param {number} utilisateurId - ID de l'utilisateur
   * @param {string} nomUtilisateur - Nom d'utilisateur
   * @param {string} nomComplet - Nom complet
   * @param {string} role - Rôle de l'utilisateur
   * @param {string} agence - Agence de l'utilisateur
   * @param {string} action - Action effectuée (texte lisible)
   * @param {string} actionType - Type d'action (INSERT, UPDATE, DELETE, etc.)
   * @param {string} table - Table concernée
   * @param {number|string} recordId - ID de l'enregistrement
   * @param {Object} anciennesValeurs - Valeurs avant modification
   * @param {Object} nouvellesValeurs - Valeurs après modification
   * @param {string} ip - Adresse IP
   * @param {string|null} importBatchId - ID de lot d'import (optionnel)
   * @param {string} coordination - Coordination de l'utilisateur
   * @returns {Promise<number>} - ID du journal créé
   */
  async enregistrerAction(
    utilisateurId,
    nomUtilisateur,
    nomComplet,
    role,
    agence,
    action,
    actionType,
    table,
    recordId,
    anciennesValeurs,
    nouvellesValeurs,
    ip,
    importBatchId = null,
    coordination = null
  ) {
    // Validation des paramètres requis
    if (!utilisateurId || !nomUtilisateur || !actionType || !table) {
      throw new Error('Paramètres manquants pour enregistrerAction');
    }

    // Sérialisation sécurisée des JSON
    const anciennesValeursJSON = anciennesValeurs
      ? typeof anciennesValeurs === 'string'
        ? anciennesValeurs
        : JSON.stringify(anciennesValeurs)
      : null;

    const nouvellesValeursJSON = nouvellesValeurs
      ? typeof nouvellesValeurs === 'string'
        ? nouvellesValeurs
        : JSON.stringify(nouvellesValeurs)
      : null;

    // Construire le message d'action par défaut si non fourni
    const actionMessage = action || `Action ${actionType} sur ${table} #${recordId || '?'}`;

    const requete = `
      INSERT INTO journalactivite (
        utilisateurid, 
        nomutilisateur, 
        nomcomplet, 
        role, 
        agence,
        dateaction, 
        action, 
        actiontype, 
        tableaffectee, 
        tablename,
        ligneaffectee, 
        recordid, 
        oldvalue, 
        newvalue,
        iputilisateur, 
        adresseip, 
        importbatchid, 
        detailsaction,
        anciennes_valeurs, 
        nouvelles_valeurs, 
        annulee,
        coordination
      ) VALUES (
        $1, $2, $3, $4, $5, 
        NOW(), $6, $7, $8, $9, 
        $10, $11, $12, $13, 
        $14, $15, $16, $17, 
        $18::jsonb, $19::jsonb, false,
        $20
      )
      RETURNING journalid
    `;

    const resultat = await db.query(requete, [
      utilisateurId,
      nomUtilisateur,
      nomComplet || nomUtilisateur,
      role,
      agence || '',
      actionMessage,
      actionType.toUpperCase(),
      table,
      table, // tableaffectee = tablename
      recordId, // ligneaffectee
      recordId, // recordid
      anciennesValeursJSON, // oldvalue (JSON text)
      nouvellesValeursJSON, // newvalue (JSON text)
      ip,
      ip,
      importBatchId,
      actionMessage, // detailsaction
      anciennesValeursJSON, // anciennes_valeurs (JSONB)
      nouvellesValeursJSON, // nouvelles_valeurs (JSONB)
      coordination, // Nouvelle colonne coordination
    ]);

    if (!resultat.rows || resultat.rows.length === 0) {
      throw new Error("Échec de l'enregistrement dans le journal");
    }

    return resultat.rows[0].journalid;
  }

  /**
   * Annuler une action (Admin uniquement)
   * @param {number} idJournal - ID de l'entrée journal à annuler
   * @param {number} adminId - ID de l'administrateur
   * @param {string} adminNom - Nom de l'administrateur
   * @param {string} ip - Adresse IP de l'admin (pour traçabilité)
   * @returns {Promise<boolean>} - Succès de l'annulation
   */
  async annulerAction(idJournal, adminId, adminNom, ip) {
    // Validation
    if (!idJournal || !adminId) {
      throw new Error('Paramètres manquants pour annulerAction');
    }

    // Récupérer l'action originale avec verrouillage pour éviter les doubles annulations
    const action = await db.query(
      `SELECT * FROM journalactivite 
       WHERE journalid = $1 AND annulee = false 
       FOR UPDATE`, // Verrouillage ligne
      [idJournal]
    );

    if (action.rows.length === 0) {
      throw new Error('Action non trouvée ou déjà annulée');
    }

    const entree = action.rows[0];

    // Récupérer les anciennes valeurs depuis le JSON
    let anciennesValeurs = {};
    try {
      if (entree.anciennes_valeurs) {
        anciennesValeurs =
          typeof entree.anciennes_valeurs === 'string'
            ? JSON.parse(entree.anciennes_valeurs)
            : entree.anciennes_valeurs;
      } else if (entree.oldvalue) {
        anciennesValeurs =
          typeof entree.oldvalue === 'string' ? JSON.parse(entree.oldvalue) : entree.oldvalue;
      }
    } catch (e) {
      console.warn(`⚠️ Erreur parsing anciennes valeurs pour journal ${idJournal}:`, e.message);
      anciennesValeurs = {};
    }

    const table = entree.tableaffectee || entree.tablename;
    const idEnregistrement = entree.recordid || entree.ligneaffectee;

    if (!table || !idEnregistrement) {
      throw new Error('Informations de restauration incomplètes');
    }

    // Exécuter la restauration dans une transaction
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Restaurer les anciennes valeurs selon le type d'action
      const actionType = (entree.actiontype || entree.action || '').toUpperCase();

      switch (actionType) {
        case 'AJOUT':
        case 'INSERT':
        case 'CREATE':
          // Pour un ajout, on supprime l'enregistrement
          await client.query(`DELETE FROM ${table} WHERE id = $1`, [idEnregistrement]);
          break;

        case 'MODIFICATION':
        case 'UPDATE':
        case 'EDIT':
          // Pour une modification, on remet les anciennes valeurs
          if (Object.keys(anciennesValeurs).length > 0) {
            const champs = [];
            const valeurs = [];
            let index = 1;

            for (const [champ, valeur] of Object.entries(anciennesValeurs)) {
              champs.push(`"${champ}" = $${index}`);
              valeurs.push(valeur);
              index++;
            }

            valeurs.push(idEnregistrement);

            await client.query(
              `UPDATE ${table} SET ${champs.join(', ')} WHERE id = $${index}`,
              valeurs
            );
          }
          break;

        case 'SUPPRESSION':
        case 'DELETE':
        case 'REMOVE':
          // Pour une suppression, on réinsère les anciennes valeurs
          if (Object.keys(anciennesValeurs).length > 0) {
            const colonnes = Object.keys(anciennesValeurs)
              .map((c) => `"${c}"`)
              .join(', ');
            const placeholders = Object.keys(anciennesValeurs)
              .map((_, i) => `$${i + 1}`)
              .join(', ');
            const valeursInsert = Object.values(anciennesValeurs);

            await client.query(
              `INSERT INTO ${table} (${colonnes}) VALUES (${placeholders})`,
              valeursInsert
            );
          }
          break;

        default:
          throw new Error(`Type d'action non supporté pour l'annulation: ${actionType}`);
      }

      // Marquer l'action comme annulée
      await client.query(
        `UPDATE journalactivite 
         SET annulee = true, annulee_par = $1, date_annulation = NOW() 
         WHERE journalid = $2`,
        [adminId, idJournal]
      );

      // Enregistrer l'annulation comme nouvelle entrée (sans récursion)
      const actionAnnulation = `Annulation de l'action #${idJournal} (${entree.action})`;

      await client.query(
        `INSERT INTO journalactivite (
          utilisateurid, nomutilisateur, nomcomplet, role, agence,
          dateaction, action, actiontype, tableaffectee, tablename,
          ligneaffectee, recordid, oldvalue, newvalue,
          iputilisateur, adresseip, detailsaction,
          anciennes_valeurs, nouvelles_valeurs, annulee,
          coordination, annulee_par, date_annulation
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, 'ANNULATION', $7, $8,
                  $9, $10, $11, $12, $13, $14, $15,
                  $16::jsonb, $17::jsonb, false,
                  $18, NULL, NULL)`,
        [
          adminId,
          adminNom,
          adminNom,
          'Administrateur',
          entree.agence || '',
          actionAnnulation,
          'journalactivite',
          'journalactivite',
          idJournal,
          idJournal,
          JSON.stringify({ action_annulee_id: idJournal }),
          JSON.stringify({ action_annulee: entree.action, restauration: 'succès' }),
          ip,
          ip,
          actionAnnulation,
          JSON.stringify({ action_originale_id: idJournal }),
          JSON.stringify({ statut: 'annulation_réussie' }),
          entree.coordination,
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("❌ Erreur lors de l'annulation:", error);
      throw new Error(`Échec de l'annulation: ${error.message}`);
    } finally {
      client.release();
    }

    return true;
  }

  /**
   * Lister les actions annulables (Admin)
   * @param {Object} filtres - Filtres optionnels
   * @param {number} limite - Nombre maximum de résultats
   * @returns {Promise<Array>} - Liste des actions annulables
   */
  async listerActionsAnnulables(filtres = {}, limite = 500) {
    let requete = `
      SELECT 
        j.journalid,
        j.utilisateurid,
        j.nomutilisateur,
        j.nomcomplet,
        j.role,
        j.agence,
        j.coordination,
        j.dateaction,
        j.action,
        j.actiontype,
        j.tableaffectee,
        j.tablename,
        j.ligneaffectee,
        j.recordid,
        j.oldvalue,
        j.newvalue,
        j.detailsaction,
        j.anciennes_valeurs,
        j.nouvelles_valeurs,
        u.nomutilisateur as annule_par_nom,
        j.date_annulation
      FROM journalactivite j
      LEFT JOIN utilisateurs u ON j.annulee_par = u.id
      WHERE j.annulee = false
        AND j.actiontype IN ('UPDATE', 'MODIFICATION', 'INSERT', 'AJOUT', 'DELETE', 'SUPPRESSION')
    `;

    const valeurs = [];
    let index = 1;

    // Ajouter les filtres
    if (filtres.table) {
      requete += ` AND (j.tableaffectee = $${index} OR j.tablename = $${index})`;
      valeurs.push(filtres.table);
      index++;
    }

    if (filtres.utilisateurId) {
      requete += ` AND j.utilisateurid = $${index}`;
      valeurs.push(filtres.utilisateurId);
      index++;
    }

    if (filtres.dateDebut) {
      requete += ` AND j.dateaction >= $${index}`;
      valeurs.push(filtres.dateDebut);
      index++;
    }

    if (filtres.dateFin) {
      requete += ` AND j.dateaction <= $${index}`;
      valeurs.push(filtres.dateFin);
      index++;
    }

    if (filtres.coordination) {
      requete += ` AND j.coordination = $${index}`;
      valeurs.push(filtres.coordination);
      index++;
    }

    requete += ` ORDER BY j.dateaction DESC LIMIT $${index}`;
    valeurs.push(limite);

    const resultat = await db.query(requete, valeurs);

    return resultat.rows;
  }

  /**
   * Vérifier si une action peut être annulée
   * @param {number} idJournal - ID de l'action
   * @returns {Promise<Object>} - Statut de l'action
   */
  async peutEtreAnnulee(idJournal) {
    const resultat = await db.query(
      `SELECT 
        annulee,
        dateaction,
        EXTRACT(EPOCH FROM (NOW() - dateaction))/3600 as heures_ecoulees,
        actiontype
       FROM journalactivite 
       WHERE journalid = $1`,
      [idJournal]
    );

    if (resultat.rows.length === 0) {
      return { peutAnnuler: false, raison: 'Action non trouvée' };
    }

    const action = resultat.rows[0];

    if (action.annulee) {
      return { peutAnnuler: false, raison: 'Action déjà annulée' };
    }

    // Vérifier le type d'action
    const typesAnnulables = ['UPDATE', 'MODIFICATION', 'INSERT', 'AJOUT', 'DELETE', 'SUPPRESSION'];
    if (!typesAnnulables.includes(action.actiontype)) {
      return { peutAnnuler: false, raison: "Ce type d'action ne peut pas être annulé" };
    }

    // Optionnel: limite de temps pour l'annulation (ex: 30 jours)
    const limiteHeures = 30 * 24; // 30 jours
    if (action.heures_ecoulees > limiteHeures) {
      return {
        peutAnnuler: false,
        raison: `Délai d'annulation dépassé (plus de 30 jours)`,
        heures_ecoulees: Math.round(action.heures_ecoulees),
      };
    }

    return {
      peutAnnuler: true,
      heures_ecoulees: Math.round(action.heures_ecoulees),
    };
  }
}

module.exports = new ServiceAnnulation();


// ========== Services\journalService.js ==========
// ============================================
// SERVICE JOURNAL - INDÉPENDANT (PAS DE DÉPENDANCE CIRCULAIRE)
// ============================================

const db = // require modifié - fichier consolidé;

class JournalService {
  /**
   * Journaliser une action
   */
  async logAction(data) {
    try {
      const {
        utilisateurId,
        nomUtilisateur,
        nomComplet,
        role,
        agence,
        coordination,
        action,
        actionType,
        tableName,
        recordId,
        oldValue,
        newValue,
        details,
        ip,
        importBatchId = null,
      } = data;

      console.log(`📝 [Journal] ${actionType} - ${action} par ${nomUtilisateur}`);

      // Vérifier si la table existe et a les bonnes colonnes
      const checkQuery = `
        INSERT INTO journalactivite (
          utilisateurid, nomutilisateur, nomcomplet, role, agence,
          coordination, dateaction, action, actiontype,
          tablename, recordid, oldvalue, newvalue,
          detailsaction, iputilisateur, importbatchid
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `;

      const params = [
        utilisateurId || null,
        nomUtilisateur || 'systeme',
        nomComplet || 'Système',
        role || 'Systeme',
        agence || null,
        coordination || null,
        action || 'Action',
        actionType || 'SYSTEM',
        tableName || 'systeme',
        recordId ? recordId.toString() : null,
        oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : null,
        newValue ? (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)) : null,
        details || null,
        ip || null,
        importBatchId,
      ];

      await db.query(checkQuery, params);
      return { success: true, id: null };
    } catch (error) {
      console.error('❌ Erreur journalService.logAction:', error);
      // Ne pas bloquer l'application si la journalisation échoue
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les entrées du journal avec filtres
   */
  async getJournal(filtres = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        utilisateurId,
        actionType,
        tableName,
        dateDebut,
        dateFin,
        coordination,
        annulee,
      } = filtres;

      const offset = (page - 1) * limit;
      const conditions = [];
      const params = [];
      let paramIndex = 1;

      let query = `
        SELECT 
          j.*,
          u.nomutilisateur as utilisateur_nom,
          u2.nomutilisateur as annule_par_nom
        FROM journalactivite j
        LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
        LEFT JOIN utilisateurs u2 ON j.annulee_par = u2.id
        WHERE 1=1
      `;

      if (utilisateurId) {
        conditions.push(`j.utilisateurid = $${paramIndex++}`);
        params.push(utilisateurId);
      }

      if (actionType) {
        conditions.push(`j.actiontype = $${paramIndex++}`);
        params.push(actionType);
      }

      if (tableName) {
        conditions.push(`j.tablename = $${paramIndex++}`);
        params.push(tableName);
      }

      if (dateDebut) {
        conditions.push(`j.dateaction >= $${paramIndex++}`);
        params.push(dateDebut);
      }

      if (dateFin) {
        conditions.push(`j.dateaction <= $${paramIndex++}`);
        params.push(dateFin);
      }

      if (coordination) {
        conditions.push(`j.coordination = $${paramIndex++}`);
        params.push(coordination);
      }

      if (annulee !== undefined) {
        conditions.push(`j.annulee = $${paramIndex++}`);
        params.push(annulee);
      }

      if (conditions.length > 0) {
        query += ' AND ' + conditions.join(' AND ');
      }

      query += ` ORDER BY j.dateaction DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      // Compter le total
      let countQuery = 'SELECT COUNT(*) as total FROM journalactivite j WHERE 1=1';
      if (conditions.length > 0) {
        countQuery += ' AND ' + conditions.join(' AND ');
      }
      const countResult = await db.query(countQuery, params.slice(0, -2));

      return {
        success: true,
        data: result.rows,
        total: parseInt(countResult.rows[0].total),
        page,
        limit,
      };
    } catch (error) {
      console.error('❌ Erreur journalService.getJournal:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les actions annulables
   */
  async getActionsAnnulables() {
    try {
      const result = await db.query(`
        SELECT 
          j.*,
          u.nomutilisateur as utilisateur_nom
        FROM journalactivite j
        LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
        WHERE j.annulee = false
          AND j.actiontype IN ('UPDATE', 'MODIFICATION', 'INSERT', 'AJOUT', 'DELETE', 'SUPPRESSION')
        ORDER BY j.dateaction DESC
        LIMIT 500
      `);

      return { success: true, data: result.rows };
    } catch (error) {
      console.error('❌ Erreur journalService.getActionsAnnulables:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Marquer une action comme annulée
   */
  async marquerCommeAnnulee(journalId, adminId) {
    try {
      await db.query(
        `UPDATE journalactivite 
         SET annulee = true, annulee_par = $1, date_annulation = NOW() 
         WHERE journalid = $2`,
        [adminId, journalId]
      );
      return { success: true };
    } catch (error) {
      console.error('❌ Erreur journalService.marquerCommeAnnulee:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new JournalService();


// ========== Services\syncService.js ==========
// Services/syncService.js
const db = // require modifié - fichier consolidé;
const jwt = require('jsonwebtoken');

const syncService = {
  // ----------------------------------------------------------
  // Authentifier un site avec sa clé API
  // ----------------------------------------------------------
  async authenticateSite(siteId, apiKey) {
    try {
      const result = await db.query(
        `SELECT
          s.id,
          s.nom,
          s.coordination_id,
          c.code  AS coordination_code,
          c.nom   AS coordination_nom,
          s.is_active
        FROM sites s
        JOIN coordinations c ON s.coordination_id = c.id
        WHERE s.id       = $1
          AND s.api_key  = $2
          AND s.is_active = true`,
        [siteId, apiKey]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Erreur authenticateSite:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Générer un token JWT 24h pour le site
  // ----------------------------------------------------------
  generateSiteToken(site) {
    return jwt.sign(
      {
        site_id: site.id,
        site_nom: site.nom,
        coordination_id: site.coordination_id,
        coordination_code: site.coordination_code,
        type: 'site',
      },
      process.env.JWT_SECRET || 'votre-secret-jwt-site',
      { expiresIn: '24h' }
    );
  },

  // ----------------------------------------------------------
  // Traiter les modifications reçues d'un site (UPLOAD)
  // ----------------------------------------------------------
  async processUpload(site, modifications, lastSync) {
    let historyId;

    const histClient = await db.pool.connect();
    try {
      await histClient.query('BEGIN');
      const histResult = await histClient.query(
        `INSERT INTO sync_history (site_id, sync_start, status)
         VALUES ($1, NOW(), 'in_progress')
         RETURNING id`,
        [site.id]
      );
      historyId = histResult.rows[0].id;
      await histClient.query('COMMIT');
    } catch (err) {
      await histClient.query('ROLLBACK');
      throw err;
    } finally {
      histClient.release();
    }

    const stats = { inserts: 0, updates: 0, deletes: 0, conflicts: 0, errors: 0 };
    const processed = [];

    for (const mod of modifications || []) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        if (mod.coordination_id !== site.coordination_id) {
          throw new Error(
            `Coordination invalide: attendu ${site.coordination_id}, reçu ${mod.coordination_id}`
          );
        }

        let result;

        if (mod.operation === 'INSERT') {
          result = await this._handleInsert(client, mod, site);
          stats.inserts++;
        } else if (mod.operation === 'UPDATE') {
          result = await this._handleUpdate(client, mod, site, historyId);
          result.conflict ? stats.conflicts++ : stats.updates++;
        } else if (mod.operation === 'DELETE') {
          result = await this._handleDelete(client, mod, site);
          stats.deletes++;
        } else {
          throw new Error(`Opération inconnue: ${mod.operation}`);
        }

        await client.query('COMMIT');

        processed.push({
          local_id: mod.local_id,
          pg_id: result?.pg_id || mod.pg_id,
          status: result?.conflict ? 'conflict' : 'success',
        });
      } catch (err) {
        await client.query('ROLLBACK');
        stats.errors++;
        processed.push({ local_id: mod.local_id, error: err.message, status: 'error' });
      } finally {
        client.release();
      }
    }

    if (processed.length > 0) {
      const successIds = processed
        .filter((p) => p.status === 'success' && p.pg_id)
        .map((p) => p.pg_id);

      if (successIds.length > 0) {
        await db.query(
          `UPDATE cartes
           SET sync_status = 'synced', last_sync_attempt = NOW()
           WHERE id = ANY($1)`,
          [successIds]
        );
      }
    }

    const updClient = await db.pool.connect();
    try {
      await updClient.query('BEGIN');
      await updClient.query(
        `UPDATE sync_history
         SET sync_end           = NOW(),
             uploaded_inserts   = $1,
             uploaded_updates   = $2,
             uploaded_deletes   = $3,
             uploaded_conflicts = $4,
             status             = $5
         WHERE id = $6`,
        [
          stats.inserts,
          stats.updates,
          stats.deletes,
          stats.conflicts,
          stats.errors > 0 ? 'partial' : 'success',
          historyId,
        ]
      );

      await updClient.query(
        `UPDATE sites
         SET last_sync_at    = NOW(),
             last_sync_error = $2
         WHERE id = $1`,
        [site.id, stats.errors > 0 ? `${stats.errors} erreur(s)` : null]
      );

      await updClient.query('COMMIT');
    } catch (err) {
      await updClient.query('ROLLBACK');
      throw err;
    } finally {
      updClient.release();
    }

    await db.query(`SELECT refresh_site_sync_stats($1)`, [site.id]);

    const download = await this.prepareDownload(site, lastSync, 1000);

    return { historyId, uploaded: stats, download, processed };
  },

  // ----------------------------------------------------------
  // Gérer une insertion
  // ----------------------------------------------------------
  async _handleInsert(client, mod, site) {
    if (mod.local_id) {
      const existing = await client.query(
        `SELECT id FROM cartes WHERE local_id = $1 AND site_proprietaire_id = $2`,
        [mod.local_id, site.id]
      );
      if (existing.rows.length > 0) {
        return { pg_id: existing.rows[0].id };
      }
    }

    const result = await client.query(
      `INSERT INTO cartes (
        coordination_id, site_proprietaire_id, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE",
        version, sync_timestamp, sync_status, local_id
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, 1, NOW(), 'synced', $11)
      RETURNING id`,
      [
        mod.coordination_id,
        site.id,
        mod.nom,
        mod.prenoms,
        mod.date_naissance || null,
        mod.lieu_naissance || null,
        mod.contact || null,
        mod.delivrance || null,
        mod.contact_retrait || null,
        mod.date_delivrance || null,
        mod.local_id || null,
      ]
    );

    return { pg_id: result.rows[0].id };
  },

  // ----------------------------------------------------------
  // Last-Write-Wins via sync_timestamp
  // ----------------------------------------------------------
  async _handleUpdate(client, mod, site, historyId) {
    const serverRow = await client.query(
      `SELECT id, version, sync_timestamp, delivrance,
              "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", contact
       FROM cartes WHERE id = $1`,
      [mod.pg_id]
    );

    if (serverRow.rows.length === 0) {
      throw new Error(`Carte ${mod.pg_id} introuvable`);
    }

    const server = serverRow.rows[0];
    const serverTime = new Date(server.sync_timestamp);
    const clientTime = mod.sync_timestamp ? new Date(mod.sync_timestamp) : new Date(0);

    if (clientTime <= serverTime) {
      await client.query(
        `INSERT INTO sync_conflicts (
          site_id, sync_history_id, carte_id, coordination_id,
          conflict_type, conflict_field,
          client_value, server_value,
          resolution_status, resolution_method
        ) VALUES ($1, $2, $3, $4, 'timestamp_conflict', 'sync_timestamp',
                  $5, $6, 'resolved', 'last_write_wins')`,
        [
          site.id,
          historyId,
          mod.pg_id,
          site.coordination_id,
          JSON.stringify(mod),
          JSON.stringify(server),
        ]
      );
      return { conflict: true, pg_id: mod.pg_id, winner: 'server' };
    }

    const updates = [];
    const params = [];
    let paramIdx = 0;

    const fieldsMap = {
      delivrance: '"delivrance"',
      contact_retrait: '"CONTACT DE RETRAIT"',
      date_delivrance: '"DATE DE DELIVRANCE"',
      contact: '"contact"',
      nom: '"nom"',
      prenoms: '"prenoms"',
      lieu_naissance: '"LIEU NAISSANCE"',
    };

    for (const [modKey, sqlCol] of Object.entries(fieldsMap)) {
      if (mod[modKey] !== undefined) {
        paramIdx++;
        updates.push(`${sqlCol} = $${paramIdx}`);
        params.push(mod[modKey]);
      }
    }

    if (updates.length === 0) {
      return { pg_id: mod.pg_id };
    }

    params.push(mod.pg_id);

    await client.query(
      `UPDATE cartes SET ${updates.join(', ')} WHERE id = $${paramIdx + 1}`,
      params
    );

    return { pg_id: mod.pg_id };
  },

  // ----------------------------------------------------------
  // Soft delete
  // ----------------------------------------------------------
  async _handleDelete(client, mod, site) {
    await client.query(
      `UPDATE cartes
       SET deleted_at  = NOW(),
           sync_status = 'synced'
       WHERE id                   = $1
         AND site_proprietaire_id = $2
         AND deleted_at IS NULL`,
      [mod.pg_id, site.id]
    );
    return { pg_id: mod.pg_id };
  },

  // ----------------------------------------------------------
  // Download différentiel
  // ----------------------------------------------------------
  async prepareDownload(site, since, limit = 1000) {
    try {
      const sinceDate = since
        ? new Date(since).toISOString()
        : new Date('2000-01-01').toISOString();

      const result = await db.query(`SELECT * FROM get_changes_since($1, $2::TIMESTAMP, $3)`, [
        site.id,
        sinceDate,
        limit,
      ]);

      console.log(
        `📥 Download pour ${site.id}: ${result.rows.length} enregistrements depuis ${sinceDate}`
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Erreur prepareDownload:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Confirmer la réception du download
  // ----------------------------------------------------------
  async confirmDownload(siteId, historyId, appliedIds, errors) {
    try {
      if (appliedIds && appliedIds.length > 0) {
        const numericIds = appliedIds.map((id) => parseInt(id)).filter((id) => !isNaN(id));
        if (numericIds.length > 0) {
          await db.query(`SELECT mark_as_synced($1, $2)`, [siteId, numericIds]);
        }
      }

      await db.query(
        `UPDATE sync_history
         SET downloaded_count   = $1,
             downloaded_inserts = $2,
             downloaded_updates = $3,
             error_message      = $4
         WHERE id = $5 AND site_id = $6`,
        [
          appliedIds?.length || 0,
          appliedIds?.filter((id) => String(id).includes('new')).length || 0,
          appliedIds?.filter((id) => !String(id).includes('new')).length || 0,
          errors ? JSON.stringify(errors) : null,
          historyId,
          siteId,
        ]
      );
    } catch (error) {
      console.error('❌ Erreur confirmDownload:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Statut détaillé d'un site
  // ----------------------------------------------------------
  async getSiteStatus(siteId) {
    try {
      const result = await db.query(`SELECT * FROM v_sync_status WHERE site_id = $1`, [siteId]);

      if (result.rows.length === 0) return null;

      const s = result.rows[0];
      return {
        total_cards: s.total_cards,
        pending_cards: s.pending_cards,
        synced_cards: s.synced_cards,
        conflict_cards: s.conflict_cards,
        taux_sync_pct: s.taux_sync_pct,
        last_sync_at: s.last_sync_at,
        last_successful_sync: s.last_successful_sync,
        conflicts_pending: s.conflicts_pending,
        sync_health: s.sync_health,
        last_error: s.last_sync_error,
      };
    } catch (error) {
      console.error('❌ Erreur getSiteStatus:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Tableau de bord global (admin)
  // ----------------------------------------------------------
  async getGlobalDashboard() {
    try {
      const [dashboard, sites, conflicts] = await Promise.all([
        db.query(`SELECT * FROM v_sync_dashboard`),
        db.query(`SELECT * FROM v_sync_status`),
        db.query(`SELECT * FROM v_conflicts_pending LIMIT 50`),
      ]);

      return {
        global: dashboard.rows[0],
        sites: sites.rows,
        conflicts: conflicts.rows,
      };
    } catch (error) {
      console.error('❌ Erreur getGlobalDashboard:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Récupérer les utilisateurs autorisés pour un site
  // ----------------------------------------------------------
  async getUsersForSite(siteId) {
    try {
      const result = await db.query(`SELECT * FROM get_users_for_site($1)`, [siteId]);
      console.log(`👥 Utilisateurs pour ${siteId}: ${result.rows.length}`);
      return result.rows;
    } catch (error) {
      console.error('❌ Erreur getUsersForSite:', error);
      throw error;
    }
  },
};

module.exports = syncService;


// ========== backup-postgres.js ==========
const { google } = require('googleapis');
const { Client } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const zlib = require('zlib');
const { pipeline } = require('stream');
const pump = util.promisify(pipeline);

class PostgreSQLBackup {
  constructor() {
    this.auth = null;
    this.drive = null;
    this.backupFolderId = null;
    this.stats = {
      totalBackups: 0,
      lastBackup: null,
      totalSize: 0,
    };

    console.log('🚀 Service Backup PostgreSQL initialisé pour VPS');
  }

  // ============================================
  // 1. AUTHENTIFICATION GOOGLE DRIVE
  // ============================================

  async authenticate() {
    console.log('🔐 Authentification Google Drive...');

    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.GOOGLE_REFRESH_TOKEN
    ) {
      throw new Error('Configuration Google Drive incomplète');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        console.log('🔄 Nouveau refresh token reçu');
      }
    });

    this.auth = oauth2Client;
    this.drive = google.drive({ version: 'v3', auth: oauth2Client });

    console.log('✅ Authentification Google Drive réussie');
  }

  // ============================================
  // 2. GESTION DU DOSSIER BACKUP
  // ============================================

  async getOrCreateBackupFolder() {
    console.log('📁 Recherche du dossier backup...');

    try {
      // D'abord, chercher avec l'ID fixe si fourni
      if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
        try {
          const folder = await this.drive.files.get({
            fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
            fields: 'id, name',
          });

          this.backupFolderId = folder.data.id;
          console.log(`✅ Dossier trouvé par ID: ${this.backupFolderId} (${folder.data.name})`);
          return this.backupFolderId;
        } catch (error) {
          console.log('⚠️  Dossier ID non trouvé, recherche par nom...');
        }
      }

      // Chercher par nom
      const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups';
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime desc',
      });

      if (response.data.files.length > 0) {
        this.backupFolderId = response.data.files[0].id;
        console.log(`✅ Dossier trouvé: ${this.backupFolderId} (${folderName})`);
        return this.backupFolderId;
      }

      // Créer le dossier
      console.log(`📁 Création du dossier ${folderName}...`);
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Backups automatiques Gescard',
      };

      const folder = await this.drive.files.create({
        resource: folderMetadata,
        fields: 'id, name',
      });

      this.backupFolderId = folder.data.id;
      console.log(`✅ Dossier créé: ${this.backupFolderId}`);
      return this.backupFolderId;
    } catch (error) {
      console.error('❌ Erreur dossier:', error.message);
      throw error;
    }
  }

  // ============================================
  // 3. EXPORT AVEC PG_DUMP (optimisé VPS)
  // ============================================

  async exportWithPgDump() {
    console.log('💾 Export PostgreSQL avec pg_dump...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `backup-gescard-${timestamp}.sql.gz`;
    const filePath = path.join('/tmp', fileName);

    try {
      // Vérifier que pg_dump est disponible
      await execPromise('which pg_dump');

      // Extraire les infos de connexion (soit DATABASE_URL soit variables individuelles)
      let dbHost, dbPort, dbName, dbUser, dbPass;

      if (process.env.DATABASE_URL) {
        const dbUrl = new URL(process.env.DATABASE_URL);
        dbHost = dbUrl.hostname;
        dbPort = dbUrl.port || 5432;
        dbName = dbUrl.pathname.slice(1);
        dbUser = dbUrl.username;
        dbPass = dbUrl.password;
      } else {
        dbHost = process.env.DB_HOST || 'localhost';
        dbPort = process.env.DB_PORT || 5432;
        dbName = process.env.DB_NAME;
        dbUser = process.env.DB_USER;
        dbPass = process.env.DB_PASSWORD;
      }

      // Options optimisées pour pg_dump
      const command = `pg_dump \
        --host=${dbHost} \
        --port=${dbPort} \
        --username=${dbUser} \
        --dbname=${dbName} \
        --format=plain \
        --no-owner \
        --no-privileges \
        --compress=9 \
        --file=${filePath}`;

      const env = { ...process.env, PGPASSWORD: dbPass };

      console.log(`📁 Création backup compressé: ${fileName}`);
      const startTime = Date.now();

      await execPromise(command, { env, timeout: 600000 }); // 10 minutes max (VPS)

      const stats = await fs.stat(filePath);
      const duration = Date.now() - startTime;

      console.log(
        `✅ Backup créé: ${(stats.size / 1024 / 1024).toFixed(2)} MB en ${Math.round(duration / 1000)}s`
      );

      return { filePath, fileName, size: stats.size, duration, method: 'pg_dump' };
    } catch (error) {
      console.error('❌ Erreur pg_dump:', error.message);

      if (error.message.includes('timeout')) {
        throw new Error('Timeout pg_dump - fichier trop volumineux');
      }

      console.log('⚠️  Fallback vers export JSON...');
      const result = await this.exportManualBackup();
      result.method = 'manual_json';
      return result;
    }
  }

  // ============================================
  // 4. EXPORT MANUEL JSON COMPRESSÉ
  // ============================================

  async exportManualBackup() {
    console.log('🔄 Export manuel JSON...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `backup-gescard-${timestamp}.json.gz`;
    const filePath = path.join('/tmp', fileName);
    const tempJsonPath = path.join('/tmp', `temp-${Date.now()}.json`);

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      statement_timeout: 300000, // 5 minutes par requête (VPS)
    });

    try {
      await client.connect();
      console.log('✅ Connecté à PostgreSQL');

      // Récupérer toutes les tables
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('spatial_ref_sys')
        ORDER BY table_name;
      `;

      const tablesResult = await client.query(tablesQuery);
      const tables = tablesResult.rows.map((row) => row.table_name);

      console.log(`📋 ${tables.length} tables à exporter`);

      const backupData = {
        metadata: {
          database: 'Gescard PostgreSQL',
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          tableCount: tables.length,
          tables: [],
        },
        data: {},
      };

      // Exporter chaque table
      for (const [index, tableName] of tables.entries()) {
        console.log(`📤 [${index + 1}/${tables.length}] Export table: ${tableName}`);

        const countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
        const countResult = await client.query(countQuery);
        const rowCount = parseInt(countResult.rows[0].count);

        if (rowCount === 0) {
          console.log(`   ⏭️  Table vide ignorée`);
          continue;
        }

        // Export par lots pour les grandes tables
        if (rowCount > 20000) {
          console.log(`   📦 Grande table (${rowCount} lignes) - export par lots...`);
          backupData.data[tableName] = await this.exportLargeTable(client, tableName, rowCount);
        } else {
          const dataQuery = `SELECT * FROM "${tableName}"`;
          const dataResult = await client.query(dataQuery);
          backupData.data[tableName] = dataResult.rows;
        }

        backupData.metadata.tables.push({
          name: tableName,
          rows: rowCount,
        });

        console.log(`   ✅ ${rowCount} lignes exportées`);
      }

      // Sauvegarder temporairement
      await fs.writeFile(tempJsonPath, JSON.stringify(backupData, null, 0));
      const jsonStats = await fs.stat(tempJsonPath);
      console.log(`📄 JSON temporaire: ${(jsonStats.size / 1024 / 1024).toFixed(2)} MB`);

      // Compresser avec gzip
      console.log('🗜️  Compression du fichier...');
      const startTime = Date.now();

      await this.compressFile(tempJsonPath, filePath);

      const stats = await fs.stat(filePath);
      const duration = Date.now() - startTime;

      console.log(
        `✅ Backup compressé: ${(stats.size / 1024 / 1024).toFixed(2)} MB (ratio: ${Math.round((stats.size / jsonStats.size) * 100)}%)`
      );

      // Nettoyer
      await fs.unlink(tempJsonPath).catch(() => {});

      return { filePath, fileName, size: stats.size, duration, method: 'manual_json' };
    } catch (error) {
      console.error('❌ Erreur export manuel:', error);
      throw error;
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Export d'une grande table par lots
  async exportLargeTable(client, tableName, totalRows) {
    const rows = [];
    const batchSize = 10000; // Plus gros sur VPS
    let offset = 0;

    while (offset < totalRows) {
      const query = `SELECT * FROM "${tableName}" ORDER BY id LIMIT ${batchSize} OFFSET ${offset}`;
      const result = await client.query(query);
      rows.push(...result.rows);

      offset += batchSize;
      if (offset % 100000 === 0) {
        console.log(`   ⏳ ${Math.round((offset / totalRows) * 100)}% exporté...`);
      }
    }

    return rows;
  }

  // Compression gzip
  async compressFile(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const gzip = zlib.createGzip({ level: 9 });
      const source = fsSync.createReadStream(inputPath);
      const destination = fsSync.createWriteStream(outputPath);

      pump(source, gzip, destination).then(resolve).catch(reject);
    });
  }

  // ============================================
  // 5. UPLOAD VERS GOOGLE DRIVE
  // ============================================

  async uploadToDrive(filePath, fileName) {
    console.log(`☁️  Upload vers Google Drive: ${fileName}`);

    const fileMetadata = {
      name: fileName,
      parents: [this.backupFolderId],
      description: `Backup Gescard - ${new Date().toLocaleString('fr-FR')}`,
      properties: {
        type: 'postgresql_backup',
        created: new Date().toISOString(),
        size: (await fs.stat(filePath)).size.toString(),
      },
    };

    const media = {
      mimeType: 'application/gzip',
      body: fsSync.createReadStream(filePath),
    };

    try {
      const startTime = Date.now();

      const file = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, size, createdTime',
      });

      const duration = Date.now() - startTime;
      const sizeMB = parseInt(file.data.size) / 1024 / 1024;

      console.log(
        `✅ Upload réussi: ${file.data.name} (${sizeMB.toFixed(2)} MB en ${Math.round(duration / 1000)}s)`
      );
      console.log(`🔗 Lien: ${file.data.webViewLink}`);

      return file.data;
    } catch (error) {
      console.error('❌ Erreur upload:', error.message);
      throw error;
    }
  }

  // ============================================
  // 6. BACKUP COMPLET
  // ============================================

  async executeBackup() {
    console.log('🚀 Démarrage backup Gescard...');
    const startTime = Date.now();

    try {
      await this.authenticate();
      await this.getOrCreateBackupFolder();

      // Essayer pg_dump d'abord
      let backupFile;
      try {
        backupFile = await this.exportWithPgDump();
      } catch (error) {
        console.log('⚠️  pg_dump échoué, fallback JSON');
        backupFile = await this.exportManualBackup();
      }

      // Upload
      const uploadedFile = await this.uploadToDrive(backupFile.filePath, backupFile.fileName);

      // Nettoyage
      await fs.unlink(backupFile.filePath).catch(() => {});

      const totalDuration = Date.now() - startTime;

      console.log(`🎉 BACKUP RÉUSSI en ${Math.round(totalDuration / 1000)}s`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Fichier: ${uploadedFile.name}`);
      console.log(`   - Taille: ${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - ID: ${uploadedFile.id}`);
      console.log(`   - Méthode: ${backupFile.method || 'pg_dump'}`);

      return {
        ...uploadedFile,
        duration: totalDuration,
        method: backupFile.method || 'pg_dump',
      };
    } catch (error) {
      console.error('💥 BACKUP ÉCHOUÉ:', error.message);
      throw error;
    }
  }

  // ============================================
  // 7. LISTER LES BACKUPS
  // ============================================

  async listBackups(options = {}) {
    const { limit = 50 } = options; // includeSizes supprimé car non utilisé

    await this.authenticate();
    await this.getOrCreateBackupFolder();

    const response = await this.drive.files.list({
      q: `'${this.backupFolderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: limit,
      fields: 'files(id, name, createdTime, size, mimeType, webViewLink, description, properties)',
    });

    const files = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      created: new Date(file.createdTime).toLocaleString('fr-FR'),
      createdISO: file.createdTime,
      size: file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'N/A',
      sizeBytes: parseInt(file.size) || 0,
      type: file.mimeType === 'application/gzip' ? 'SQL' : 'JSON',
      link: file.webViewLink,
      downloadLink: `https://drive.google.com/uc?export=download&id=${file.id}`,
    }));

    // Mettre à jour les stats
    this.stats.totalBackups = files.length;
    this.stats.totalSize = files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
    this.stats.lastBackup = files.length > 0 ? files[0].createdISO : null;

    return files;
  }

  // ============================================
  // 8. SUPPRIMER UN BACKUP
  // ============================================

  async deleteBackup(backupId) {
    console.log(`🗑️  Suppression backup: ${backupId}`);

    await this.authenticate();

    try {
      await this.drive.files.delete({
        fileId: backupId,
      });

      console.log('✅ Backup supprimé');
      return true;
    } catch (error) {
      console.error('❌ Erreur suppression:', error.message);
      throw error;
    }
  }

  // ============================================
  // 9. NETTOYER LES VIEUX BACKUPS
  // ============================================

  async cleanupOldBackups(olderThanDays = 90) {
    console.log(`🧹 Nettoyage backups > ${olderThanDays} jours`);

    const backups = await this.listBackups({ limit: 1000 });
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const oldBackups = backups.filter((b) => new Date(b.createdISO) < cutoffDate);

    if (oldBackups.length === 0) {
      console.log('✅ Aucun backup à nettoyer');
      return 0;
    }

    console.log(`🗑️  ${oldBackups.length} backups à supprimer`);

    for (const backup of oldBackups) {
      await this.deleteBackup(backup.id);
    }

    console.log(`✅ Nettoyage terminé: ${oldBackups.length} backups supprimés`);
    return oldBackups.length;
  }

  // ============================================
  // 10. STATISTIQUES
  // ============================================

  async getStats() {
    await this.listBackups({ limit: 1000 });

    return {
      totalBackups: this.stats.totalBackups,
      totalSizeMB: Math.round(this.stats.totalSize / 1024 / 1024),
      lastBackup: this.stats.lastBackup,
      averageSizeMB:
        this.stats.totalBackups > 0
          ? Math.round(this.stats.totalSize / this.stats.totalBackups / 1024 / 1024)
          : 0,
      googleDrive: {
        folderId: this.backupFolderId,
        folderName: process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups',
      },
    };
  }

  // ============================================
  // 11. VÉRIFIER L'ÉTAT
  // ============================================

  async healthCheck() {
    try {
      const startTime = Date.now();

      await this.authenticate();
      await this.getOrCreateBackupFolder();

      // Tester l'upload en créant un petit fichier test
      const testFile = path.join('/tmp', 'health-test.txt');
      await fs.writeFile(testFile, 'OK');

      const testUpload = await this.drive.files.create({
        resource: {
          name: 'health-check.txt',
          parents: [this.backupFolderId],
        },
        media: {
          mimeType: 'text/plain',
          body: fsSync.createReadStream(testFile),
        },
        fields: 'id',
      });

      // Nettoyer
      await this.drive.files.delete({ fileId: testUpload.data.id });
      await fs.unlink(testFile);

      const duration = Date.now() - startTime;

      return {
        status: 'healthy',
        duration: `${duration}ms`,
        authenticated: true,
        folderId: this.backupFolderId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        authenticated: false,
      };
    }
  }

  // ============================================
  // 12. VÉRIFIER S'IL Y A DES BACKUPS
  // ============================================

  async hasBackups() {
    try {
      const backups = await this.listBackups({ limit: 1 });
      return backups.length > 0;
    } catch (error) {
      console.warn('⚠️ Erreur vérification backups:', error.message);
      return false;
    }
  }
}

module.exports = PostgreSQLBackup;


// ========== consolider.js ==========
// consolider.js - Version corrigée
const fs = require('fs');
const path = require('path');

// Configuration
const outputFile = 'backend-complet.js';
const excludeDirs = ['node_modules', '.git', 'backups', 'uploads', 'logs'];
const excludeFiles = ['.env', '.env.local', 'package-lock.json', 'nodemon.json'];

// Fonction pour lire tous les fichiers JS récursivement
function getAllJsFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);

  files.forEach((file) => {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      if (!excludeDirs.includes(file)) {
        getAllJsFiles(filePath, fileList);
      }
    } else if (file.endsWith('.js') && !excludeFiles.includes(file)) {
      fileList.push(filePath);
    }
  });

  return fileList;
}

// Fonction principale pour consolider
async function consolider() {
  console.log('📦 Consolidation du backend en cours...');

  let output = `// ========================================
// BACKEND COMPLET CONSOLIDÉ
// Généré le: ${new Date().toLocaleString()}
// ========================================\n\n`;

  // 1. D'abord server.js (point d'entrée)
  const serverPath = path.join(process.cwd(), 'server.js');
  if (fs.existsSync(serverPath)) {
    console.log('📄 Lecture de server.js');
    const content = fs.readFileSync(serverPath, 'utf8');
    output += `// ========== SERVER.JS (POINT D'ENTRÉE) ==========\n`;
    output += content;
    output += '\n\n';
  }

  // 2. Ensuite package.json (pour les dépendances)
  const packagePath = path.join(process.cwd(), 'package.json');
  if (fs.existsSync(packagePath)) {
    console.log('📄 Lecture de package.json');
    const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    output += `// ========== DÉPENDANCES (package.json) ==========\n`;
    output += `/*\n`;
    output += `Dépendances: ${JSON.stringify(packageJson.dependencies, null, 2)}\n`;
    output += `DévDépendances: ${JSON.stringify(packageJson.devDependencies, null, 2)}\n`;
    output += `*/\n\n`;
  }

  // 3. Tous les fichiers organisés par dossier
  const jsFiles = getAllJsFiles(process.cwd());

  // Trier les fichiers par dossier
  jsFiles.sort();

  for (const file of jsFiles) {
    if (file === serverPath || file.includes('node_modules')) continue;

    console.log(`📄 Lecture de ${path.relative(process.cwd(), file)}`);
    const content = fs.readFileSync(file, 'utf8');
    const relativePath = path.relative(process.cwd(), file);

    output += `\n// ========== ${relativePath} ==========\n`;

    // CORRECTION ICI : Version sans paramètre inutilisé
    const modifiedContent = content.replace(/require\(['"](\.\.?\/[^'"]+)['"]\)/g, () => {
      return `// require modifié - fichier consolidé`;
    });

    output += modifiedContent;
    output += '\n';
  }

  // Écrire le fichier consolidé
  fs.writeFileSync(outputFile, output, 'utf8');

  console.log(`\n✅ Consolidation terminée! Fichier créé: ${outputFile}`);
  console.log(`📁 Taille: ${(fs.statSync(outputFile).size / 1024).toFixed(2)} KB`);
}

// Exécuter
consolider().catch(console.error);


// ========== db\db.js ==========
// db/db.js
const { Pool } = require('pg');
require('dotenv').config();

// Détecter l'environnement
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Configuration optimisée pour VPS 8 Go RAM
const getPoolConfig = () => {
  const baseConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,

    // Configuration optimisée pour performances
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };

  if (isProduction) {
    // Configuration PRODUCTION (VPS 8 Go RAM)
    console.log('⚙️ Configuration DB optimisée pour VPS 8 Go RAM');
    return {
      ...baseConfig,
      max: 50, // Pool de connexions confortable
      min: 5, // Garder des connexions chaudes
      allowExitOnIdle: false, // Ne pas fermer les connexions inactives trop vite
    };
  } else if (isDevelopment) {
    // Développement local
    return {
      ...baseConfig,
      max: 10,
      min: 0,
    };
  } else {
    // Default
    return {
      ...baseConfig,
      max: 20,
      min: 2,
    };
  }
};

// Créer le pool avec la configuration adaptée
const pool = new Pool(getPoolConfig());

// Gestion des exports streams
let activeExportStreams = new Set();

const registerExportStream = (streamId) => {
  activeExportStreams.add(streamId);
  console.log(`📤 Export stream actif: ${streamId} (total: ${activeExportStreams.size})`);
};

const unregisterExportStream = (streamId) => {
  activeExportStreams.delete(streamId);
  console.log(`📥 Export stream terminé: ${streamId} (reste: ${activeExportStreams.size})`);

  // Forcer le garbage collection si beaucoup de streams terminés
  if (activeExportStreams.size === 0 && global.gc) {
    console.log('🧹 Nettoyage mémoire forcé');
    global.gc();
  }
};

// Événements du pool
pool.on('connect', () => {
  console.log('✅ Nouvelle connexion PostgreSQL établie');
});

pool.on('acquire', () => {
  const stats = getPoolStats();
  console.log(`🔗 Client acquis (actifs: ${stats.total - stats.idle}/${stats.total})`);
});

pool.on('remove', () => {
  console.log('🗑️ Client retiré du pool');
});

pool.on('error', (err) => {
  console.error('❌ Erreur PostgreSQL pool:', err.message);
});

// Requêtes standard avec timing
const query = async (text, params) => {
  const start = Date.now();
  const isExportQuery =
    text.includes('cartes') && (text.includes('SELECT') || text.includes('select'));

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log pour les requêtes lentes
    if (duration > 500 || isExportQuery) {
      console.log(`📊 ${isExportQuery ? '📤 EXPORT' : 'Query'} (${duration}ms):`, {
        query: text.substring(0, 150).replace(/\s+/g, ' ') + '...',
        rows: result.rowCount,
        params: params ? `[${params.length} params]` : 'none',
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`❌ Erreur query (${duration}ms):`, {
      query: text.substring(0, 100),
      error: error.message,
      code: error.code,
    });

    throw error;
  }
};

// Version streaming pour les gros exports
const queryStream = async (text, params, batchSize = 2000) => {
  const client = await pool.connect();
  console.log('🌊 Début query streaming avec batch:', batchSize);

  let offset = 0;
  let hasMore = true;
  const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  registerExportStream(streamId);

  const streamIterator = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (!hasMore) {
            unregisterExportStream(streamId);
            client.release();
            return { done: true };
          }

          try {
            const batchQuery = `${text} LIMIT ${batchSize} OFFSET ${offset}`;
            const result = await client.query(batchQuery, params);

            if (result.rows.length === 0) {
              hasMore = false;
              unregisterExportStream(streamId);
              client.release();
              return { done: true };
            }

            offset += batchSize;

            return {
              done: false,
              value: result.rows,
            };
          } catch (error) {
            unregisterExportStream(streamId);
            client.release();
            throw error;
          }
        },
      };
    },
  };

  return streamIterator;
};

// Version streaming optimisée pour gros volumes
const queryStreamOptimized = async (text, params, batchSize = 1000) => {
  console.log('🚀 Début queryStreamOptimized');

  const client = await pool.connect();
  const optimizedBatchSize = batchSize;

  let offset = 0;
  let hasMore = true;
  let batchCount = 0;
  const streamId = `stream_opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  registerExportStream(streamId);

  const streamIterator = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (!hasMore) {
            unregisterExportStream(streamId);
            client.release();

            return { done: true };
          }

          try {
            batchCount++;

            // Construction de la requête
            let batchQuery = text;
            if (!text.includes('LIMIT') && !text.includes('limit')) {
              batchQuery += ` LIMIT ${optimizedBatchSize} OFFSET ${offset}`;
            } else {
              batchQuery = batchQuery.replace(/LIMIT \d+/i, `LIMIT ${optimizedBatchSize}`);
              if (!batchQuery.includes('OFFSET')) {
                batchQuery += ` OFFSET ${offset}`;
              } else {
                batchQuery = batchQuery.replace(/OFFSET \d+/i, `OFFSET ${offset}`);
              }
            }

            const result = await client.query(batchQuery, params);

            if (result.rows.length === 0) {
              hasMore = false;
              unregisterExportStream(streamId);
              client.release();
              return { done: true };
            }

            offset += optimizedBatchSize;

            // Log de progression
            if (batchCount % 5 === 0) {
              const memory = process.memoryUsage();
              console.log(
                `📦 Stream batch ${batchCount}: ${result.rows.length} lignes, offset: ${offset}, mémoire: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`
              );
            }

            return {
              done: false,
              value: result.rows,
            };
          } catch (error) {
            unregisterExportStream(streamId);
            client.release();

            console.error(`❌ Erreur queryStreamOptimized batch ${batchCount}:`, error.message);
            throw error;
          }
        },
      };
    },
  };

  return streamIterator;
};

// Obtenir un client avec timeout de sécurité
const getClient = async () => {
  try {
    const client = await pool.connect();
    const timeout = 60000; // 60 secondes

    const originalRelease = client.release;
    let released = false;

    client.release = () => {
      if (!released) {
        released = true;
        originalRelease.apply(client);
      }
    };

    setTimeout(() => {
      if (!released) {
        console.error(`⏰ Timeout sécurité: client bloqué depuis ${timeout / 1000}s`);
        try {
          client.release();
        } catch (e) {
          // Ignorer
        }
      }
    }, timeout);

    return client;
  } catch (error) {
    console.error('❌ Erreur getClient:', error.message);
    throw error;
  }
};

// Statistiques du pool
const getPoolStats = () => {
  return {
    total: pool.totalCount || 0,
    idle: pool.idleCount || 0,
    waiting: pool.waitingCount || 0,
    environment: isProduction ? 'Production (VPS)' : isDevelopment ? 'Développement' : 'Inconnu',
  };
};

// Nettoyage périodique
setInterval(() => {
  const stats = getPoolStats();

  if (stats.idle > 10) {
    console.log('📊 Stats pool:', JSON.stringify(stats));
  }
}, 120000); // Toutes les 2 minutes

// ========== NOUVELLE FONCTION D'ATTENTE ROBUSTE ==========

/**
 * Attend que PostgreSQL soit prêt avec plus de tentatives
 * et sans marquer d'échec définitif
 */
const waitForPostgres = async (maxAttempts = 15, delay = 2000) => {
  console.log('⏳ Attente de PostgreSQL...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Requête simple pour tester la connexion
      await pool.query('SELECT 1 as connection_test');
      console.log(`✅ PostgreSQL connecté (tentative ${attempt}/${maxAttempts})`);

      // Récupérer quelques infos utiles
      try {
        const versionResult = await pool.query('SELECT version()');
        const countResult = await pool.query('SELECT COUNT(*) FROM cartes');
        console.log(`📊 Version: ${versionResult.rows[0].version.split(' ')[0]}`);
        console.log(`📊 Cartes dans la base: ${countResult.rows[0].count}`);
      } catch (e) {
        // Ignorer les erreurs de ces requêtes supplémentaires
      }

      return true;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn(
          `⚠️ PostgreSQL inaccessible après ${maxAttempts} tentatives, mais le serveur continue`
        );
        console.warn('⚠️ Les routes qui nécessitent la BDD retourneront des erreurs 503');
        return false;
      }
      console.log(
        `⏳ Tentative ${attempt}/${maxAttempts} échouée (${error.message}), nouvelle tentative dans ${delay / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return false;
};

// ========== REMPLACEMENT DE L'ANCIEN TEST ==========

// Remplacer l'ancien appel par celui-ci
setTimeout(async () => {
  const connected = await waitForPostgres(15, 2000);
  if (connected) {
    console.log('✅ Base de données prête - Toutes les routes fonctionneront normalement');
  } else {
    console.log('⚠️ Le serveur a démarré sans PostgreSQL - Mode dégradé');
  }
}, 1000);

module.exports = {
  query,
  queryStream,
  queryStreamOptimized,
  getClient,
  getPoolStats,
  registerExportStream,
  unregisterExportStream,
  pool,
};


// ========== ecosystem.config.js ==========
module.exports = {
  apps: [
    {
      name: 'backend',
      script: 'server.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        DB_HOST: 'localhost',
        DB_PORT: 5432,
        DB_NAME: 'gescard_db',
        DB_USER: 'jeanluc_ahoua',
        DB_PASSWORD: 'Djono@@100',
        JWT_SECRET: 'Cocody@@100!',
      },
    },
  ],
};


// ========== generate-hash.js ==========
const bcrypt = require('bcrypt');

const passwords = [
  'Univ!Admin1',
  'Univ!Super1',
  'Univ!Chef1',
  'Univ!Oper1',
  'CHU!Chef2',
  'CHU!Oper2',
  'Lycée!Chef3',
  'Lycée!Oper3',
  'Binge!Chef4',
  'Binge!Oper4',
  'Adj!Chef5',
  'Adj!Oper5',
];

async function run() {
  for (const pw of passwords) {
    const hash = await bcrypt.hash(pw, 10);
    console.log(`${pw} -> ${hash}`);
  }
}

run();


// ========== middleware\apiAuth.js ==========
/**
 * Middleware d'authentification pour l'API externe
 * Optimisé pour LWS avec sécurité renforcée
 * Version adaptée avec les nouveaux rôles et coordination
 */

const crypto = require('crypto');
const journalController = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const API_CONFIG = {
  // Tokens autorisés (à charger depuis les variables d'environnement)
  allowedTokens: (process.env.API_TOKENS || 'CARTES_API_2025_SECRET_TOKEN_NOV')
    .split(',')
    .map((t) => t.trim()),

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
  publicRoutes: ['health', 'sites', 'changes', 'cors-test', 'diagnostic'],

  // Routes protégées (nécessitent authentification)
  protectedRoutes: ['sync', 'cartouches', 'stats', 'modifications', 'cartes'],

  // Niveaux d'accès par token (pour future extension)
  tokenLevels: {
    read: ['cartes', 'sites', 'changes', 'stats'],
    write: ['sync', 'modifications'],
    admin: ['*'],
  },
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
    records.minute = records.minute.filter((time) => time > minuteAgo);

    // Nettoyer les requêtes de plus d'une heure
    records.hour = records.hour.filter((time) => time > hourAgo);

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
      hour: [],
    });
  }

  const records = rateLimitStore.get(clientIP);

  // Vérifier limite minute
  if (records.minute.length >= API_CONFIG.maxRequestsPerMinute) {
    return {
      allowed: false,
      reason: 'minute',
      limit: API_CONFIG.maxRequestsPerMinute,
      resetTime: records.minute[0] + API_CONFIG.rateLimitWindow,
    };
  }

  // Vérifier limite heure
  if (records.hour.length >= API_CONFIG.maxRequestsPerHour) {
    return {
      allowed: false,
      reason: 'hour',
      limit: API_CONFIG.maxRequestsPerHour,
      resetTime: records.hour[0] + API_CONFIG.hourWindow,
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
        ...details,
      }),
      ip: req.ip || req.connection.remoteAddress,
      details: `Accès API: ${status}`,
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
  console.log("🔐 Tentative d'accès API externe:", {
    ip: clientIP,
    method: req.method,
    url: req.url,
    path: req.path,
    tokenPresent: !!token,
    userAgent: req.headers['user-agent'],
    origin: req.headers.origin || 'undefined',
    timestamp: new Date().toISOString(),
  });

  // ✅ ROUTES PUBLIQUES - Identification par pattern
  const pathParts = req.path.split('/').filter((part) => part.length > 0);
  const lastSegment = pathParts[pathParts.length - 1] || '';
  const isPublicRoute =
    API_CONFIG.publicRoutes.includes(lastSegment) ||
    req.path.includes('/health') ||
    req.path.includes('/cors-test') ||
    req.path.includes('/sites');

  // Nettoyage périodique du rate limiting (toutes les 100 requêtes environ)
  if (Math.random() < 0.01) {
    // 1% de chance
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
        period: rateCheck.reason,
      });
    }

    // Ajouter des informations de contexte
    req.apiClient = {
      authenticated: false,
      clientType: 'public',
      ip: clientIP,
      timestamp: new Date().toISOString(),
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
      code: 'MISSING_TOKEN',
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
      code: 'INVALID_TOKEN_FORMAT',
    });
  }

  // Vérifier la validité du token (avec cache)
  if (!validTokens.has(token)) {
    console.log('❌ Accès API refusé: token invalide');

    // Journaliser la tentative avec token invalide
    console.warn('⚠️ Tentative avec token invalide:', {
      ip: clientIP,
      token: token.substring(0, 10) + '...',
      path: req.path,
    });

    logAPIAccess(req, 'INVALID_TOKEN', { tokenPrefix: token.substring(0, 10) });

    return res.status(403).json({
      success: false,
      error: 'Token API invalide',
      message: "Le token fourni n'est pas reconnu",
      code: 'INVALID_TOKEN',
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
      code: 'RATE_LIMIT_EXCEEDED',
    });
  }

  const duration = Date.now() - startTime;

  console.log('✅ Accès API autorisé - Stats:', {
    ip: clientIP,
    requestsThisMinute: rateLimitStore.get(clientIP)?.minute.length || 0,
    requestsThisHour: rateLimitStore.get(clientIP)?.hour.length || 0,
    duration: `${duration}ms`,
  });

  // Ajouter des informations de contexte à la requête
  req.apiClient = {
    authenticated: true,
    clientType: 'external_api',
    ip: clientIP,
    token: token.substring(0, 8) + '...', // Pour logging uniquement
    timestamp: new Date().toISOString(),
    level: tokenAccessLevel.get(token) || 'read', // Niveau d'accès par défaut
  };

  // Vérifier le niveau d'accès pour cette route
  const routeLevel = API_CONFIG.protectedRoutes.includes(lastSegment) ? 'write' : 'read';
  if (routeLevel === 'write' && req.apiClient.level === 'read') {
    console.log("❌ Niveau d'accès insuffisant");

    logAPIAccess(req, 'INSUFFICIENT_ACCESS', { required: 'write', actual: 'read' });

    return res.status(403).json({
      success: false,
      error: "Niveau d'accès insuffisant",
      message: "Ce token n'a pas les droits d'écriture",
      code: 'INSUFFICIENT_ACCESS',
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

  res.json = function (data) {
    const duration = Date.now() - startTime;
    const statusCode = res.statusCode;

    // Ne logger que si le logging est activé
    if (API_CONFIG.enableLogging) {
      const logMessage = statusCode >= 400 ? '⚠️' : '📊';

      console.log(`${logMessage} Accès API externe:`, {
        method: req.method,
        url: req.url,
        statusCode,
        duration: `${duration}ms`,
        clientIP,
        authenticated: req.apiClient?.authenticated || false,
        userAgent: req.headers['user-agent']?.substring(0, 50),
        timestamp: new Date().toISOString(),
      });

      // Logs plus détaillés pour les erreurs
      if (statusCode >= 500) {
        console.error('❌ Erreur serveur API:', {
          error: data?.error || 'Unknown error',
          path: req.path,
          clientIP,
        });
      }
    }

    // Ajouter des headers de rate limiting
    if (req.apiClient) {
      const records = rateLimitStore.get(clientIP);
      if (records) {
        res.setHeader('X-RateLimit-Limit-Minute', API_CONFIG.maxRequestsPerMinute);
        res.setHeader(
          'X-RateLimit-Remaining-Minute',
          Math.max(0, API_CONFIG.maxRequestsPerMinute - records.minute.length)
        );
        res.setHeader('X-RateLimit-Limit-Hour', API_CONFIG.maxRequestsPerHour);
        res.setHeader(
          'X-RateLimit-Remaining-Hour',
          Math.max(0, API_CONFIG.maxRequestsPerHour - records.hour.length)
        );
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
        code: 'INVALID_LIMIT',
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
        code: 'INVALID_PAGE',
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
        code: 'INVALID_DATE',
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

exports.errorHandler = (err, req, res) => {
  console.error('❌ Erreur API:', err);

  // Journaliser l'erreur
  logAPIAccess(req, 'ERROR', { error: err.message });

  res.status(500).json({
    success: false,
    error: 'Erreur interne du serveur',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Une erreur est survenue',
    code: 'INTERNAL_ERROR',
    requestId: req.id,
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
    topIPs: [],
  };

  // Calculer les requêtes totales
  rateLimitStore.forEach((records, ip) => {
    stats.requestsLastMinute += records.minute.length;
    stats.requestsLastHour += records.hour.length;

    stats.topIPs.push({
      ip,
      requestsMinute: records.minute.length,
      requestsHour: records.hour.length,
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


// ========== middleware\auth.js ==========
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
    superviseur: 'Gestionnaire', // Superviseur mappé vers Gestionnaire
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
// VERIFY TOKEN (VERSION UNIQUE ET STABLE)
// ============================================

/**
 * Vérifie la validité du token JWT
 *
 * ✅ CORRECTION : req.user expose désormais les propriétés
 * en DEUX formats (majuscule ET minuscule) pour assurer
 * la compatibilité avec tous les controllers et services.
 *
 * Avant : NomUtilisateur seulement → les controllers qui
 * lisaient req.user?.nomUtilisateur obtenaient undefined,
 * ce qui causait l'erreur "Paramètres manquants" dans
 * annulationService et un 500 sur tous les exports/imports.
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

    // ✅ Pré-calculer les valeurs pour éviter la répétition
    const nomUtilisateur =
      decoded.NomUtilisateur ||
      decoded.nomUtilisateur ||
      decoded.username ||
      decoded.nom_utilisateur ||
      '';

    const nomComplet =
      decoded.NomComplet || decoded.nomComplet || decoded.nom_complet || nomUtilisateur;

    const agence = decoded.Agence || decoded.agence || '';

    // Construire l'objet utilisateur avec les DEUX conventions de nommage
    req.user = {
      id: decoded.id,

      // ─── Format MAJUSCULE (ancienne convention, conservée pour compatibilité) ───
      NomUtilisateur: nomUtilisateur,
      NomComplet: nomComplet,
      Role: role,
      Agence: agence,
      Email: decoded.Email || decoded.email || '',

      // ─── Format minuscule (convention utilisée dans les controllers/services) ───
      // ✅ Ces propriétés étaient MANQUANTES et causaient le 500 sur export/import
      nomUtilisateur: nomUtilisateur,
      nomComplet: nomComplet,
      agence: agence,
      email: decoded.Email || decoded.email || '',

      // ─── Commun aux deux conventions ───
      role: role, // minuscule (utilisé partout dans les controllers)
      coordination: decoded.coordination || decoded.Coordination || null,
      level: AUTH_CONFIG.roles[role]?.level || 0,
      permissions: AUTH_CONFIG.roles[role]?.permissions || [],
    };

    console.log(`✅ Utilisateur authentifié :`, {
      id: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      role: req.user.role,
      coordination: req.user.coordination,
    });

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

    if (!normalizedRoles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Rôle non autorisé',
        yourRole: req.user.role,
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
      nomUtilisateur: decoded.NomUtilisateur || decoded.nomUtilisateur || decoded.username,
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


// ========== middleware\filtreColonnes.js ==========
// ============================================
// middleware/filtreColonnes.js
// ============================================
// Filtre les colonnes modifiables selon le rôle de l'utilisateur
// ============================================

const { normaliserRole, CONFIG_ROLES } = // require modifié - fichier consolidé;

/**
 * Middleware pour filtrer les colonnes modifiables dans les requêtes
 * - Pour Admin/Gestionnaire : toutes les colonnes sont autorisées
 * - Pour Chef d'équipe : seulement les 3 colonnes spécifiques
 * - Pour Opérateur : aucune modification (déjà bloqué en amont)
 */
const filtrerColonnes = (req, res, next) => {
  try {
    // Ignorer pour les requêtes GET et OPTIONS
    if (req.method === 'GET' || req.method === 'OPTIONS' || !req.body) {
      return next();
    }

    // Vérifier que l'utilisateur est authentifié
    if (!req.user) {
      return res.status(401).json({
        erreur: 'Non authentifié',
        message: 'Vous devez être connecté pour effectuer cette action',
      });
    }

    const role = normaliserRole(req.user?.role);

    if (!role) {
      return res.status(403).json({
        erreur: 'Rôle non reconnu',
        message: "Votre rôle utilisateur n'est pas valide",
      });
    }

    // Déterminer les colonnes autorisées
    // Priorité à req.colonnesAutorisees (défini par peutModifierCarte)
    let colonnesAutorisees = req.colonnesAutorisees;

    // Si non défini, utiliser la configuration du rôle
    if (!colonnesAutorisees) {
      const configRole = CONFIG_ROLES[role];
      colonnesAutorisees = configRole?.colonnesModifiables || [];
    }

    // Admin/Gestionnaire : toutes les colonnes sont autorisées
    if (colonnesAutorisees === 'toutes') {
      // Pour la traçabilité, on peut logger les modifications massives
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEBUG] Modification complète par ${role}:`, Object.keys(req.body).join(', '));
      }
      return next();
    }

    // Chef d'équipe ou autre rôle avec restrictions
    if (Array.isArray(colonnesAutorisees)) {
      // Cas spécial: aucune colonne autorisée (Opérateur)
      if (colonnesAutorisees.length === 0) {
        return res.status(403).json({
          erreur: 'Action non autorisée',
          message: 'Votre rôle ne permet pas de modifier des données',
        });
      }

      const corpsFiltre = {};
      const colonnesRejetees = [];

      // Normaliser les noms de colonnes pour la comparaison
      const colonnesAutoriseesNormalisees = colonnesAutorisees.map((col) =>
        col.toLowerCase().trim()
      );

      // Filtrer les colonnes
      Object.keys(req.body).forEach((key) => {
        const keyNormalisee = key.toLowerCase().trim();

        if (colonnesAutoriseesNormalisees.includes(keyNormalisee)) {
          // Garder la clé originale pour préserver la casse si nécessaire
          corpsFiltre[key] = req.body[key];
        } else {
          colonnesRejetees.push(key);
        }
      });

      // Log des colonnes rejetées en développement
      if (process.env.NODE_ENV === 'development' && colonnesRejetees.length > 0) {
        console.log(`[DEBUG] Colonnes rejetées pour ${role}:`, colonnesRejetees.join(', '));
      }

      // Remplacer le corps de la requête par la version filtrée
      req.body = corpsFiltre;
      req.colonnesRejetees = colonnesRejetees; // Optionnel: pour information

      // Vérifications spécifiques selon la méthode HTTP
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (Object.keys(corpsFiltre).length === 0) {
          return res.status(400).json({
            erreur: 'Aucune modification autorisée',
            message: "Vous n'avez pas le droit de modifier ces champs",
            champsAutorises: colonnesAutorisees,
            champsTentatives: colonnesRejetees,
          });
        }
      }

      // Pour POST (création), on vérifie qu'au moins les champs requis sont présents
      if (req.method === 'POST') {
        // On pourrait ajouter une validation des champs requis ici
        // selon le contexte métier
      }
    }

    next();
  } catch (error) {
    console.error('Erreur dans filtrerColonnes:', error);
    return res.status(500).json({
      erreur: 'Erreur serveur',
      message: 'Une erreur est survenue lors du filtrage des données',
    });
  }
};

/**
 * Middleware spécifique pour l'import/export
 * Vérifie que les colonnes importées sont autorisées
 */
const filtrerColonnesImport = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);
    const configRole = CONFIG_ROLES[role];

    // Si l'utilisateur peut tout modifier, pas de filtrage
    if (configRole?.colonnesModifiables === 'toutes') {
      return next();
    }

    // Pour les imports, on pourrait avoir une logique spécifique
    // Par exemple, vérifier que les colonnes du fichier correspondent
    // aux droits de l'utilisateur

    next();
  } catch (error) {
    console.error('Erreur dans filtrerColonnesImport:', error);
    next();
  }
};

module.exports = {
  filtrerColonnes,
  filtrerColonnesImport,
};


// ========== middleware\importExportAccess.js ==========
// middleware/importExportAccess.js

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const ACCESS_CONFIG = {
  // Tokens API externes (multiples possibles)
  externalApiTokens: (process.env.EXTERNAL_API_TOKENS || '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean),

  // Limites par défaut
  defaultLimits: {
    maxFileSize: '10MB',
    maxRowsPerImport: 10000,
    maxRowsPerExport: 50000,
  },

  // Configuration rate limiting avancée
  rateLimits: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    admin: { bulk: 20, stream: 50, other: 200 },
    superviseur: { bulk: 10, stream: 30, other: 100 },
    chef: { bulk: 5, stream: 15, other: 50 },
    operateur: { bulk: 0, stream: 10, other: 30 },
    consultant: { bulk: 0, stream: 5, other: 20 },
  },

  // Routes exemptées de rate limiting
  exemptRoutes: [
    '/health',
    '/test-db',
    '/cors-test',
    '/diagnostic',
    '/template',
    '/status',
    '/sites-list',
  ],

  // Mapping des types de routes
  routeTypes: {
    'bulk-import': ['bulk-import', 'bulk', 'mass-import'],
    import: ['import', 'upload', 'csv', 'excel'],
    'smart-sync': ['smart-sync', 'smart', 'sync'],
    stream: ['stream', 'chunk', 'partial'],
    optimized: ['optimized', 'fast', 'quick'],
    export: ['export', 'download', 'extract'],
    filtered: ['filtered', 'search', 'query'],
    admin: ['admin', 'manage', 'config'],
    monitoring: ['monitoring', 'stats', 'status', 'progress'],
    diagnostic: ['diagnostic', 'test', 'check'],
  },
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
    data.timestamps = data.timestamps.filter((t) => t > now - windowMs);
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
  const pathParts = urlPath.split('/').filter((p) => p.length > 0);
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
    import: { roles: ['Administrateur', 'Superviseur'], message: 'imports de données' },
    'smart-sync': {
      roles: ['Administrateur', 'Superviseur'],
      message: 'synchronisation intelligente',
    },
    stream: {
      roles: ['Administrateur', 'Superviseur', "Chef d'équipe"],
      message: 'exports streaming',
    },
    optimized: {
      roles: ['Administrateur', 'Superviseur', "Chef d'équipe"],
      message: 'exports optimisés',
    },
    admin: { roles: ['Administrateur'], message: "fonctions d'administration" },
    filtered: { roles: ['Administrateur', 'Superviseur'], message: 'exports filtrés avancés' },
    management: { roles: ['Administrateur', 'Superviseur'], message: 'gestion des imports' },
    monitoring: {
      roles: ['Administrateur', 'Superviseur', "Chef d'équipe"],
      message: 'monitoring',
    },
    diagnostic: { roles: ['Administrateur', 'Superviseur'], message: 'diagnostic' },
    export: {
      roles: ['Administrateur', 'Superviseur', "Chef d'équipe", 'Opérateur', 'Consultant'],
      message: 'exports',
    },
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
  if (roleLower.includes('chef') || roleLower.includes('equipe') || roleLower.includes('équipe'))
    return "Chef d'équipe";
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
    hasAuth: !!authHeader,
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
          maxRowsPerImport: 100000,
        },
      };

      // Appliquer un rate limiting spécifique pour l'API externe
      const rateKey = `ext:${clientIP}`;
      const now = Date.now();
      const windowMs = 60000; // 1 minute

      if (!requestTracker.has(rateKey)) {
        requestTracker.set(rateKey, { timestamps: [now] });
      } else {
        const data = requestTracker.get(rateKey);
        data.timestamps = data.timestamps.filter((t) => t > now - windowMs);
        data.timestamps.push(now);

        if (data.timestamps.length > 60) {
          // Max 60 req/min pour API externe
          return res.status(429).json({
            success: false,
            error: 'Rate limit API externe',
            message: 'Trop de requêtes (max 60/minute)',
            retryAfter: 60,
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
      requestId,
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
      requestId,
    });
  }

  // 4. DÉFINIR LES PERMISSIONS PAR RÔLE (version enrichie)
  const rolePermissions = {
    Administrateur: {
      allowed: [
        'bulk-import',
        'import',
        'smart-sync',
        'filtered',
        'admin',
        'stream',
        'optimized',
        'export',
        'monitoring',
        'diagnostic',
        'management',
      ],
      description: 'Accès complet à toutes les fonctionnalités',
      limits: { maxFileSize: '100MB', maxRowsPerImport: 500000, maxRowsPerExport: 1000000 },
    },
    Superviseur: {
      allowed: [
        'bulk-import',
        'import',
        'smart-sync',
        'filtered',
        'stream',
        'optimized',
        'export',
        'monitoring',
        'management',
      ],
      description: 'Import/export avancé et gestion',
      limits: { maxFileSize: '50MB', maxRowsPerImport: 200000, maxRowsPerExport: 500000 },
    },
    "Chef d'équipe": {
      allowed: ['export', 'stream', 'optimized', 'filtered', 'monitoring'],
      description: 'Export seulement avec options avancées',
      limits: { maxFileSize: '25MB', maxRowsPerImport: 0, maxRowsPerExport: 100000 },
    },
    Opérateur: {
      allowed: ['export', 'stream'],
      description: 'Export limité',
      limits: { maxFileSize: '10MB', maxRowsPerImport: 0, maxRowsPerExport: 50000 },
    },
    Consultant: {
      allowed: ['export'],
      description: 'Export simple',
      limits: { maxFileSize: '5MB', maxRowsPerImport: 0, maxRowsPerExport: 10000 },
    },
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
      import: 'Les imports sont réservés aux administrateurs et superviseurs.',
      'smart-sync':
        'La synchronisation intelligente est réservée aux administrateurs et superviseurs.',
      stream: "L'export streaming est réservé aux administrateurs, superviseurs et chefs d'équipe.",
      optimized:
        "L'export optimisé est réservé aux administrateurs, superviseurs et chefs d'équipe.",
      filtered: 'Les exports filtrés avancés sont réservés aux administrateurs et superviseurs.',
      admin: "Les fonctionnalités d'administration sont réservées aux administrateurs.",
      management: 'La gestion des imports est réservée aux administrateurs et superviseurs.',
      monitoring: "Le monitoring est réservé aux administrateurs, superviseurs et chefs d'équipe.",
      diagnostic: 'Le diagnostic est réservé aux administrateurs et superviseurs.',
    };

    return res.status(403).json({
      success: false,
      error: 'Permission refusée',
      message:
        errorMessages[routeType] ||
        `Votre rôle (${userRole}) ne vous permet pas d'effectuer cette action.`,
      yourRole: userRole,
      requiredRoles: requirement.roles,
      yourPermissions: userPerms.allowed,
      actionType: routeType,
      code: 'FORBIDDEN_ACTION',
      requestId,
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
      maxRowsPerExport: userPerms.limits.maxRowsPerExport,
    },
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
  const isExempt = ACCESS_CONFIG.exemptRoutes.some((route) => req.url.includes(route));
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
      Administrateur: ACCESS_CONFIG.rateLimits.admin,
      Superviseur: ACCESS_CONFIG.rateLimits.superviseur,
      "Chef d'équipe": ACCESS_CONFIG.rateLimits.chef,
      Opérateur: ACCESS_CONFIG.rateLimits.operateur,
      Consultant: ACCESS_CONFIG.rateLimits.consultant,
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
    data.timestamps = data.timestamps.filter((t) => t > now - windowMs);

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
        code: 'RATE_LIMIT_EXCEEDED',
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
      code: 'NO_FILE',
    });
  }

  // Vérifier le type de fichier
  const allowedTypes = [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
  ];

  if (!allowedTypes.includes(req.file.mimetype)) {
    return res.status(400).json({
      success: false,
      error: 'Type de fichier non supporté',
      message: 'Seuls les fichiers Excel (.xlsx, .xls) et CSV sont acceptés',
      fileType: req.file.mimetype,
      code: 'INVALID_FILE_TYPE',
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
      user: req.user?.nomUtilisateur || 'external',
    });

    return res.status(400).json({
      success: false,
      error: 'Fichier trop volumineux',
      message: `La taille maximale autorisée est de ${maxSizeMB}MB`,
      fileSize: `${fileSizeMB.toFixed(2)}MB`,
      maxAllowed: `${maxSizeMB}MB`,
      advice:
        fileSizeMB > 100
          ? 'Contactez un administrateur pour les très gros fichiers'
          : 'Divisez votre fichier en plusieurs parties',
      code: 'FILE_TOO_LARGE',
    });
  }

  // Ajouter des métadonnées
  req.fileMetadata = {
    sizeMB: fileSizeMB,
    originalName: req.file.originalname,
    mimeType: req.file.mimetype,
    uploadTime: new Date().toISOString(),
  };

  next();
};

// ============================================
// MIDDLEWARE DE JOURNALISATION
// ============================================

const logImportExportAccess = (req, res, next) => {
  const startTime = Date.now();
  const requestId =
    req.requestId || Date.now().toString(36) + Math.random().toString(36).substr(2, 5);

  req.requestId = requestId;

  // Journalisation initiale
  console.log(`📨 [${requestId}] Requête import/export:`, {
    method: req.method,
    url: req.url,
    user:
      req.user?.nomUtilisateur ||
      req.user?.NomUtilisateur ||
      req.apiClient?.clientType ||
      'anonymous',
    role: req.userPermissions?.role || 'unknown',
    ip: req.ip,
    file: req.file?.originalname || null,
    timestamp: new Date().toISOString(),
  });

  // Capturer la réponse
  const originalJson = res.json;
  res.json = function (data) {
    const duration = Date.now() - startTime;

    // Journaliser les requêtes importantes
    const isImportant =
      duration > 2000 ||
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
        user: req.user?.nomUtilisateur || 'anonymous',
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
      code: 'INVALID_SOURCE',
    });
  }

  // Valider smartSync
  if (smartSync !== undefined && typeof smartSync !== 'boolean') {
    return res.status(400).json({
      success: false,
      error: 'Paramètre smartSync invalide',
      message: 'smartSync doit être true ou false',
      code: 'INVALID_SMART_SYNC',
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
  ACCESS_CONFIG,
};


// ========== middleware\journalRequetes.js ==========
// ============================================
// middleware/journalRequetes.js
// ============================================
// Journalisation détaillée de toutes les requêtes HTTP
// Ajouté en premier middleware dans server.js
// ============================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const LOGS_DIR = path.join(__dirname, '../../logs');
const REQUETES_LOG_FILE = path.join(LOGS_DIR, 'requetes.log');
const ERREURS_LOG_FILE = path.join(LOGS_DIR, 'erreurs.log');
const PERFORMANCES_LOG_FILE = path.join(LOGS_DIR, 'performances-lentes.log');

// Créer le dossier logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  console.log(`📁 Dossier de logs créé: ${LOGS_DIR}`);
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Génère un ID unique pour chaque requête
 */
const genererIdUnique = () => {
  return crypto.randomBytes(8).toString('hex');
};

/**
 * Formate la date au format ISO
 */
const formaterDate = (date = new Date()) => {
  return date.toISOString();
};

/**
 * Écrit un message dans un fichier de log (asynchrone)
 */
const ecrireLog = (fichier, message) => {
  const ligne = `[${formaterDate()}] ${message}\n`;
  fs.appendFile(fichier, ligne, (err) => {
    if (err) console.error('❌ Erreur écriture log:', err.message);
  });
};

/**
 * Nettoie les objets sensibles (mots de passe)
 */
const nettoyerObjetsSensibles = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  const nettoye = { ...obj };
  const champsSensibles = [
    'motDePasse',
    'confirmationMotDePasse',
    'password',
    'currentPassword',
    'newPassword',
  ];

  champsSensibles.forEach((champ) => {
    if (nettoye[champ]) nettoye[champ] = '[MASQUÉ]';
  });

  return nettoye;
};

// ============================================
// MIDDLEWARE PRINCIPAL
// ============================================

/**
 * Middleware de journalisation des requêtes
 */
const journalRequetes = (req, res, next) => {
  const debut = Date.now();
  const idRequete = genererIdUnique();

  // Ajouter l'ID à la requête pour traçabilité
  req.idRequete = idRequete;

  // Ajouter l'ID dans les en-têtes de réponse
  res.setHeader('X-Request-ID', idRequete);

  // Capturer l'IP réelle (derrière proxy)
  const ipReelle =
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.ip ||
    '0.0.0.0';

  // Informations de base sur la requête
  const infosRequete = {
    id: idRequete,
    timestamp: formaterDate(),
    methode: req.method,
    url: req.originalUrl || req.url,
    ip: ipReelle,
    userAgent: req.headers['user-agent'] || 'inconnu',
    referer: req.headers['referer'] || req.headers['referrer'] || null,
    utilisateur: req.user
      ? {
          id: req.user.id,
          nom: req.user.nomUtilisateur || req.user.NomUtilisateur,
          role: req.user.role || req.user.Role,
          coordination: req.user.coordination,
        }
      : 'non authentifié',
  };

  // Log entrant dans la console
  console.log(`\n📥 [${idRequete}] ${req.method} ${req.url}`);
  console.log(
    `   👤 Utilisateur: ${typeof infosRequete.utilisateur === 'object' ? infosRequete.utilisateur.nom || 'anonyme' : 'anonyme'} (${typeof infosRequete.utilisateur === 'object' ? infosRequete.utilisateur.role || 'aucun' : 'aucun'})`
  );
  console.log(`   🌐 IP: ${ipReelle}`);

  // Log entrant dans le fichier
  ecrireLog(REQUETES_LOG_FILE, `IN  ${JSON.stringify(infosRequete)}`);

  // Capturer le corps de la requête pour les logs (sans mots de passe)
  if (req.body && Object.keys(req.body).length > 0) {
    const corpsLog = nettoyerObjetsSensibles(req.body);
    console.log(`   📦 Corps:`, corpsLog);
    req.corpsLog = corpsLog; // Stocker pour la réponse
  }

  // Intercepter la méthode res.json pour logger la réponse
  const jsonOriginal = res.json;
  res.json = function (donnees) {
    const duree = Date.now() - debut;
    const statusCode = res.statusCode;

    // Déterminer le niveau de log
    const niveau = statusCode >= 500 ? '❌ ERREUR' : statusCode >= 400 ? '⚠️ ALERTE' : '✅ SUCCÈS';

    // Préparer les infos de réponse
    const infosReponse = {
      id: idRequete,
      duree: `${duree}ms`,
      statusCode,
      niveau: niveau.trim(),
      taille: JSON.stringify(donnees).length,
    };

    // Log dans la console
    console.log(`${niveau} [${idRequete}] ${req.method} ${req.url}`);
    console.log(`   ⏱️  Temps: ${duree}ms | Code: ${statusCode}`);

    // Log détaillé pour les erreurs
    if (statusCode >= 400) {
      console.log(`   📋 Détails erreur:`, {
        message: donnees.erreur || donnees.message || 'Erreur inconnue',
        code: donnees.code,
      });

      // Log d'erreur dans fichier séparé
      ecrireLog(
        ERREURS_LOG_FILE,
        JSON.stringify({
          requete: infosRequete,
          reponse: infosReponse,
          erreur: donnees,
          corpsRequete: req.corpsLog || null,
        })
      );
    }

    // Log de la réponse dans le fichier principal
    ecrireLog(
      REQUETES_LOG_FILE,
      `OUT ${JSON.stringify({
        ...infosReponse,
        utilisateur: infosRequete.utilisateur,
      })}`
    );

    // Restaurer et appeler la méthode originale
    return jsonOriginal.call(this, donnees);
  };

  // Marquer que nous avons intercepté
  res._jsonIntercepte = true;

  // Gérer les erreurs de la requête
  res.on('finish', () => {
    // Si la réponse n'a pas utilisé res.json (ex: res.send, res.end)
    if (!res._jsonIntercepte) {
      const duree = Date.now() - debut;
      console.log(`⚪ [${idRequete}] ${req.method} ${req.url} - ${res.statusCode} - ${duree}ms`);

      ecrireLog(
        REQUETES_LOG_FILE,
        `OUT ${JSON.stringify({
          id: idRequete,
          duree: `${duree}ms`,
          statusCode: res.statusCode,
          utilisateur: infosRequete.utilisateur,
        })}`
      );
    }
  });

  next();
};

// ============================================
// MIDDLEWARE SPÉCIFIQUES
// ============================================

/**
 * Middleware pour logger les performances (à utiliser sur des routes spécifiques)
 * @param {number} seuil - Durée en ms au-delà de laquelle la requête est considérée lente
 */
const loggerPerformance = (seuil = 1000) => {
  return (req, res, next) => {
    const debut = Date.now();

    res.on('finish', () => {
      const duree = Date.now() - debut;
      if (duree > seuil) {
        console.log(`🐢 Requête lente [${duree}ms] ${req.method} ${req.url}`);

        // Log des requêtes lentes dans un fichier spécifique
        ecrireLog(
          PERFORMANCES_LOG_FILE,
          JSON.stringify({
            timestamp: formaterDate(),
            duree,
            methode: req.method,
            url: req.url,
            utilisateur: req.user?.nomUtilisateur || 'anonyme',
            ip: req.headers['x-forwarded-for'] || req.ip,
          })
        );
      }
    });

    next();
  };
};

// ============================================
// FONCTIONS DE MAINTENANCE
// ============================================

/**
 * Nettoie les vieux logs (archive)
 * @param {number} jours - Nombre de jours de conservation
 */
const nettoyerVieuxLogs = (jours = 30) => {
  try {
    const maintenant = Date.now();
    const limite = maintenant - jours * 24 * 60 * 60 * 1000;
    let fichiersTraites = 0;

    [REQUETES_LOG_FILE, ERREURS_LOG_FILE, PERFORMANCES_LOG_FILE].forEach((fichier) => {
      if (fs.existsSync(fichier)) {
        const stats = fs.statSync(fichier);
        if (stats.mtimeMs < limite) {
          // Archiver
          const dateStr = formaterDate().split('T')[0];
          const archive = `${fichier}.${dateStr}.old`;

          // Si l'archive existe déjà, ajouter un timestamp
          if (fs.existsSync(archive)) {
            const timestamp = Date.now();
            fs.renameSync(fichier, `${fichier}.${timestamp}.old`);
          } else {
            fs.renameSync(fichier, archive);
          }

          console.log(`📦 Log archivé: ${path.basename(archive)}`);
          fichiersTraites++;
        }
      }
    });

    if (fichiersTraites > 0) {
      console.log(`✅ ${fichiersTraites} fichier(s) de log archivé(s)`);
    }
  } catch (error) {
    console.error('❌ Erreur nettoyage logs:', error.message);
  }
};

// Exécuter le nettoyage une fois au démarrage
nettoyerVieuxLogs(30);

// Nettoyage périodique (tous les jours)
setInterval(() => nettoyerVieuxLogs(30), 24 * 60 * 60 * 1000);

// ============================================
// EXPORTS
// ============================================

module.exports = journalRequetes;
module.exports.loggerPerformance = loggerPerformance;
module.exports.nettoyerVieuxLogs = nettoyerVieuxLogs;


// ========== middleware\permission.js ==========
// ============================================
// middleware/permission.js
// ============================================
// Permissions spéciales pour les fonctionnalités avancées
// - Gestion des statistiques avec filtrage par coordination
// - Masquage des informations sensibles selon le rôle
// ============================================

const { normaliserRole, CONFIG_ROLES } = // require modifié - fichier consolidé;

/**
 * Middleware pour gérer l'accès aux statistiques
 * Ajoute req.filtreStats avec la valeur appropriée:
 * - 'tout' pour Admin
 * - 'coordination' pour Gestionnaire
 * - false pour les autres (refusé)
 */
const peutVoirStatistiques = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);

    if (!role) {
      return res.status(401).json({
        erreur: 'Non authentifié',
        message: 'Vous devez être connecté pour voir les statistiques',
      });
    }

    const configRole = CONFIG_ROLES[role];

    if (!configRole) {
      return res.status(403).json({
        erreur: 'Rôle inconnu',
        message: "Votre rôle n'est pas reconnu dans le système",
      });
    }

    const modeVue = configRole.peutVoirStatistiques;

    // Vérifier si l'utilisateur a le droit de voir les stats
    if (!modeVue) {
      return res.status(403).json({
        erreur: 'Accès refusé',
        message: "Vous n'avez pas les droits pour voir les statistiques",
        role: role,
      });
    }

    // Ajouter le filtre à la requête
    req.filtreStats = {
      mode: modeVue, // 'tout' ou 'coordination'
      coordination: req.user?.coordination || null, // Pour le filtrage
    };

    // Log en développement
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Accès statistiques - Rôle: ${role}, Mode: ${modeVue}`);
    }

    next();
  } catch (error) {
    console.error('❌ Erreur dans peutVoirStatistiques:', error);
    return res.status(500).json({
      erreur: 'Erreur serveur',
      message: 'Une erreur est survenue lors de la vérification des droits',
    });
  }
};

/**
 * Middleware pour gérer la visibilité des informations sensibles
 * Ajoute req.optionsMasquage avec la configuration appropriée
 *
 * Informations sensibles gérées:
 * - Adresses IP
 * - Anciennes valeurs (dans le journal)
 * - Nouvelles valeurs (dans le journal)
 * - Informations personnelles
 */
const peutVoirInfosSensibles = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);

    if (!role) {
      // Utilisateur non connecté: tout masquer par défaut
      req.optionsMasquage = {
        ip: true,
        anciennesValeurs: true,
        nouvellesValeurs: true,
        informationsPersonnelles: true,
        detailsConnexion: true,
      };
      return next();
    }

    // Configuration du masquage selon le rôle
    switch (role) {
      case 'Administrateur':
        // Admin voit tout
        req.optionsMasquage = {
          ip: false, // Voit les IPs
          anciennesValeurs: false, // Voit les anciennes valeurs
          nouvellesValeurs: false, // Voit les nouvelles valeurs
          informationsPersonnelles: false, // Voit toutes les infos
          detailsConnexion: false, // Voit les détails de connexion
        };
        break;

      case 'Gestionnaire':
        // Gestionnaire: voit presque tout sauf IP
        req.optionsMasquage = {
          ip: true, // Masque les IPs
          anciennesValeurs: false, // Voit les anciennes valeurs
          nouvellesValeurs: false, // Voit les nouvelles valeurs
          informationsPersonnelles: false, // Voit les infos personnelles
          detailsConnexion: true, // Masque les détails de connexion
        };
        break;

      case "Chef d'équipe":
        // Chef d'équipe: voit le minimum
        req.optionsMasquage = {
          ip: true, // Masque les IPs
          anciennesValeurs: true, // Masque les anciennes valeurs
          nouvellesValeurs: true, // Masque les nouvelles valeurs
          informationsPersonnelles: true, // Masque les infos personnelles
          detailsConnexion: true, // Masque les détails de connexion
        };
        break;

      case 'Opérateur':
        // Opérateur: tout masquer
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: true,
          nouvellesValeurs: true,
          informationsPersonnelles: true,
          detailsConnexion: true,
        };
        break;

      default:
        // Par défaut: tout masquer
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: true,
          nouvellesValeurs: true,
          informationsPersonnelles: true,
          detailsConnexion: true,
        };
    }

    // Ajouter le rôle pour référence
    req.optionsMasquage.role = role;

    // Log en développement
    if (process.env.NODE_ENV === 'development') {
      console.log(`🔒 Masquage configuré pour ${role}:`, req.optionsMasquage);
    }

    next();
  } catch (error) {
    console.error('❌ Erreur dans peutVoirInfosSensibles:', error);
    // En cas d'erreur, on masque tout par sécurité
    req.optionsMasquage = {
      ip: true,
      anciennesValeurs: true,
      nouvellesValeurs: true,
      informationsPersonnelles: true,
      detailsConnexion: true,
      toutes: true,
    };
    next();
  }
};

/**
 * Middleware pour filtrer les données sensibles dans les réponses
 * À utiliser dans les contrôleurs après avoir récupéré les données
 */
const filtrerDonneesSensibles = (donnees, optionsMasquage) => {
  if (!donnees || !optionsMasquage) return donnees;

  // Si c'est un tableau, filtrer chaque élément
  if (Array.isArray(donnees)) {
    return donnees.map((item) => filtrerDonneesSensibles(item, optionsMasquage));
  }

  // Si c'est un objet, créer une copie filtrée
  if (typeof donnees === 'object') {
    const donneesFiltrees = { ...donnees };

    // Masquer les IPs
    if (optionsMasquage.ip && donneesFiltrees.ip) {
      donneesFiltrees.ip = '***.***.***.***';
    }
    if (optionsMasquage.ip && donneesFiltrees.ipUtilisateur) {
      donneesFiltrees.ipUtilisateur = '***.***.***.***';
    }
    if (optionsMasquage.ip && donneesFiltrees.iputilisateur) {
      donneesFiltrees.iputilisateur = '***.***.***.***';
    }

    // Masquer les anciennes valeurs
    if (optionsMasquage.anciennesValeurs && donneesFiltrees.anciennes_valeurs) {
      donneesFiltrees.anciennes_valeurs = '[MASQUÉ]';
    }
    if (optionsMasquage.anciennesValeurs && donneesFiltrees.oldvalue) {
      donneesFiltrees.oldvalue = '[MASQUÉ]';
    }
    if (optionsMasquage.anciennesValeurs && donneesFiltrees.oldValue) {
      donneesFiltrees.oldValue = '[MASQUÉ]';
    }

    // Masquer les nouvelles valeurs
    if (optionsMasquage.nouvellesValeurs && donneesFiltrees.nouvelles_valeurs) {
      donneesFiltrees.nouvelles_valeurs = '[MASQUÉ]';
    }
    if (optionsMasquage.nouvellesValeurs && donneesFiltrees.newvalue) {
      donneesFiltrees.newvalue = '[MASQUÉ]';
    }
    if (optionsMasquage.nouvellesValeurs && donneesFiltrees.newValue) {
      donneesFiltrees.newValue = '[MASQUÉ]';
    }

    // Masquer les informations personnelles
    if (optionsMasquage.informationsPersonnelles) {
      const champsPersonnels = [
        'email',
        'Email',
        'telephone',
        'contact',
        'CONTACT',
        'adresse',
        'dateNaissance',
        'DATE_DE_NAISSANCE',
        'nom',
        'prenom',
      ];
      champsPersonnels.forEach((champ) => {
        if (donneesFiltrees[champ]) {
          donneesFiltrees[champ] = '[MASQUÉ]';
        }
      });
    }

    return donneesFiltrees;
  }

  return donnees;
};

/**
 * Middleware utilitaire pour vérifier si l'utilisateur a un rôle spécifique
 */
const aRole = (rolesAutorises) => {
  return (req, res, next) => {
    const role = normaliserRole(req.user?.role);

    if (!role) {
      return res.status(401).json({
        erreur: 'Non authentifié',
        message: 'Vous devez être connecté',
      });
    }

    const rolesList = Array.isArray(rolesAutorises) ? rolesAutorises : [rolesAutorises];
    const rolesNormalises = rolesList.map((r) => normaliserRole(r));

    if (rolesNormalises.includes(role)) {
      return next();
    }

    return res.status(403).json({
      erreur: 'Accès refusé',
      message: "Vous n'avez pas le rôle requis pour cette action",
      rolesRequis: rolesList,
      votreRole: role,
    });
  };
};

/**
 * Middleware pour vérifier si l'utilisateur est dans la bonne coordination
 */
const estDansCoordination = (paramCoordination) => {
  return (req, res, next) => {
    const coordinationUtilisateur = req.user?.coordination;
    const coordinationCible = req.params[paramCoordination] || req.body.coordination;

    if (!coordinationUtilisateur) {
      return res.status(403).json({
        erreur: 'Accès refusé',
        message: "Vous n'êtes pas associé à une coordination",
      });
    }

    // Admin peut tout voir
    if (normaliserRole(req.user?.role) === 'Administrateur') {
      return next();
    }

    if (coordinationUtilisateur === coordinationCible) {
      return next();
    }

    return res.status(403).json({
      erreur: 'Accès refusé',
      message: "Vous ne pouvez accéder qu'aux données de votre coordination",
      votreCoordination: coordinationUtilisateur,
      coordinationRequise: coordinationCible,
    });
  };
};

module.exports = {
  peutVoirStatistiques,
  peutVoirInfosSensibles,
  filtrerDonneesSensibles,
  aRole,
  estDansCoordination,
};


// ========== middleware\verificationRole.js ==========
// ============================================
// middleware/verificationRole.js
// ============================================

// ============================================
// CONFIGURATION DES RÔLES
// ============================================
const CONFIG_ROLES = {
  Administrateur: {
    niveau: 100,
    pages: ['*'], // Toutes les pages
    peutImporterExporter: true,
    peutVoirStatistiques: 'tout',
    colonnesModifiables: 'toutes',
    peutAnnulerAction: true,
    peutVoirJournal: true,
    peutGererComptes: true,
    peutVoirInfosSensibles: true, // Voir IP, anciennes valeurs, etc.
  },
  Gestionnaire: {
    niveau: 80,
    pages: ['accueil', 'inventaire', 'profil', 'deconnexion', 'import-export', 'statistiques'],
    peutImporterExporter: true,
    peutVoirStatistiques: 'coordination', // Seulement sa coordination
    colonnesModifiables: 'toutes',
    peutAnnulerAction: false,
    peutVoirJournal: false, // ❌ Gestionnaire ne voit pas le journal
    peutGererComptes: false, // ❌ Gestionnaire ne gère pas les comptes
    peutVoirInfosSensibles: false,
  },
  "Chef d'équipe": {
    niveau: 60,
    pages: ['accueil', 'inventaire', 'profil', 'deconnexion'],
    peutImporterExporter: false,
    peutVoirStatistiques: false,
    colonnesModifiables: ['delivrance', 'CONTACT DE RETRAIT', 'DATE DE DELIVRANCE'],
    peutAnnulerAction: false,
    peutVoirJournal: false,
    peutGererComptes: false,
    peutVoirInfosSensibles: false,
  },
  Opérateur: {
    niveau: 40,
    pages: ['accueil', 'inventaire', 'profil', 'deconnexion'],
    peutImporterExporter: false,
    peutVoirStatistiques: false,
    colonnesModifiables: [], // Aucune modification
    peutAnnulerAction: false,
    peutVoirJournal: false,
    peutGererComptes: false,
    peutVoirInfosSensibles: false,
  },
};

// ============================================
// FONCTIONS DE NORMALISATION
// ============================================
const normaliserRole = (role) => {
  if (!role) return null;

  const correspondances = {
    administrateur: 'Administrateur',
    admin: 'Administrateur',
    gestionnaire: 'Gestionnaire',
    superviseur: 'Gestionnaire', // Ancien rôle mappé vers Gestionnaire
    "chef d'équipe": "Chef d'équipe",
    "chef d'equipe": "Chef d'équipe",
    chef: "Chef d'équipe",
    operateur: 'Opérateur',
    opérateur: 'Opérateur',
    operator: 'Opérateur',
  };

  const roleMin = role.toString().toLowerCase().trim();
  return correspondances[roleMin] || role;
};

// ============================================
// MIDDLEWARES
// ============================================

/**
 * Vérifier l'accès à une page
 * @param {string} nomPage - Nom de la page demandée
 */
const peutAccederPage = (nomPage) => {
  return (req, res, next) => {
    const role = normaliserRole(req.user?.role);

    if (!role) {
      return res.status(401).json({
        erreur: 'Non authentifié',
        message: 'Utilisateur non authentifié ou rôle manquant',
      });
    }

    const configRole = CONFIG_ROLES[role];

    if (!configRole) {
      return res.status(403).json({
        erreur: 'Rôle inconnu',
        votreRole: role,
      });
    }

    if (configRole.pages.includes('*') || configRole.pages.includes(nomPage)) {
      return next();
    }

    return res.status(403).json({
      erreur: 'Accès refusé',
      page: nomPage,
      votreRole: role,
      message: "Vous n'avez pas les droits pour accéder à cette page",
    });
  };
};

/**
 * Vérifier les droits d'import/export
 */
const peutImporterExporter = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];

  if (configRole?.peutImporterExporter) {
    return next();
  }

  return res.status(403).json({
    erreur: 'Action non autorisée',
    message: 'Seuls les administrateurs et gestionnaires peuvent importer/exporter',
  });
};

/**
 * Vérifier les droits de modification d'une carte
 * Middleware complexe qui vérifie:
 * 1. Si l'utilisateur a le droit de modifier des cartes
 * 2. Pour les chefs d'équipe, vérifie la coordination
 * 3. Ajoute req.colonnesAutorisees pour le filtrage ultérieur
 */
const peutModifierCarte = async (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);
    const carteId = req.params.id;
    const configRole = CONFIG_ROLES[role];

    if (!configRole) {
      return res.status(403).json({ erreur: 'Rôle non reconnu' });
    }

    // Opérateur : non
    if (role === 'Opérateur') {
      return res.status(403).json({
        erreur: 'Action non autorisée',
        message: 'Les opérateurs ne peuvent pas modifier les cartes',
      });
    }

    // Chef d'équipe : vérifications supplémentaires
    if (role === "Chef d'équipe") {
      // Vérifier que l'ID de carte est présent
      if (!carteId) {
        return res.status(400).json({ erreur: 'ID de carte manquant' });
      }

      const db = // require modifié - fichier consolidé;

      try {
        const carte = await db.query('SELECT coordination FROM cartes WHERE id = $1', [carteId]);

        if (carte.rows.length === 0) {
          return res.status(404).json({
            erreur: 'Carte non trouvée',
            message: 'Aucune carte trouvée avec cet ID',
          });
        }

        // Vérifier la coordination
        if (carte.rows[0].coordination === req.user.coordination) {
          // Ajouter les colonnes autorisées à la requête
          req.colonnesAutorisees = configRole.colonnesModifiables;
          return next();
        }

        return res.status(403).json({
          erreur: 'Accès refusé',
          message: 'Vous ne pouvez modifier que les cartes de votre coordination',
        });
      } catch (dbError) {
        console.error('❌ Erreur base de données dans peutModifierCarte:', dbError);
        return res.status(500).json({
          erreur: 'Erreur serveur',
          message: 'Impossible de vérifier les droits sur cette carte',
        });
      }
    }

    // Admin et Gestionnaire : tout permis
    req.colonnesAutorisees = configRole.colonnesModifiables;
    next();
  } catch (error) {
    console.error('❌ Erreur dans peutModifierCarte:', error);
    return res.status(500).json({
      erreur: 'Erreur serveur',
      message: 'Une erreur est survenue lors de la vérification des droits',
    });
  }
};

/**
 * Vérifier les droits d'annulation (Admin uniquement)
 */
const peutAnnulerAction = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];

  if (configRole?.peutAnnulerAction) {
    return next();
  }

  return res.status(403).json({
    erreur: 'Action non autorisée',
    message: 'Seuls les administrateurs peuvent annuler des actions',
  });
};

/**
 * Vérifier l'accès au journal (Admin uniquement)
 */
const peutVoirJournal = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];

  if (configRole?.peutVoirJournal) {
    return next();
  }

  return res.status(403).json({
    erreur: 'Accès refusé',
    message: 'Seuls les administrateurs peuvent consulter le journal',
  });
};

/**
 * Vérifier l'accès à la gestion des comptes (Admin uniquement)
 */
const peutGererComptes = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];

  if (configRole?.peutGererComptes) {
    return next();
  }

  return res.status(403).json({
    erreur: 'Accès refusé',
    message: 'Seuls les administrateurs peuvent gérer les comptes utilisateurs',
  });
};

/**
 * Middleware pour ajouter les infos de rôle à req
 * Utile pour les contrôleurs qui ont besoin des permissions
 */
const ajouterInfosRole = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];

  if (configRole) {
    req.infosRole = {
      role: role,
      niveau: configRole.niveau,
      peutVoirStatistiques: configRole.peutVoirStatistiques,
      colonnesModifiables: configRole.colonnesModifiables,
      peutVoirInfosSensibles: configRole.peutVoirInfosSensibles,
    };
  }

  next();
};

module.exports = {
  // Middlewares principaux
  peutAccederPage,
  peutImporterExporter,
  peutModifierCarte,
  peutAnnulerAction,
  peutVoirJournal,
  peutGererComptes,
  ajouterInfosRole,

  // Utilitaires
  normaliserRole,
  CONFIG_ROLES,
};


// ========== middleware\verifySiteToken.js ==========
// middleware/verifySiteToken.js
const jwt = require('jsonwebtoken');
const db = // require modifié - fichier consolidé;

/**
 * Middleware pour vérifier le token JWT d'un site
 * À utiliser sur toutes les routes de synchronisation
 */
module.exports = async (req, res, next) => {
  try {
    // Récupérer le token du header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token manquant ou format invalide',
      });
    }

    const token = authHeader.split(' ')[1];

    // Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'votre-secret-jwt');

    // Vérifier que le site existe toujours et est actif
    const site = await db.query(
      `
      SELECT 
        s.id,
        s.nom,
        s.coordination_id,
        c.code as coordination_code,
        s.is_active
      FROM sites s
      JOIN coordinations c ON s.coordination_id = c.id
      WHERE s.id = $1 AND s.is_active = true
      `,
      [decoded.site_id]
    );

    if (site.rows.length === 0) {
      return res.status(401).json({
        error: 'Site inactif ou inexistant',
      });
    }

    // Ajouter les infos du site à la requête
    req.site = {
      id: site.rows[0].id,
      nom: site.rows[0].nom,
      coordination_id: site.rows[0].coordination_id,
      coordination_code: site.rows[0].coordination_code,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expiré',
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token invalide',
      });
    }

    console.error('❌ Erreur auth site:', error);
    return res.status(500).json({
      error: 'Erreur serveur',
    });
  }
};


// ========== restore-postgres.js ==========
const { google } = require('googleapis');
const { Client } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const zlib = require('zlib');
const { pipeline } = require('stream');
const pump = util.promisify(pipeline);

class PostgreSQLRestorer {
  constructor() {
    this.drive = null;
    this.auth = null;
    this.backupFolderId = null;

    console.log('🔄 Service Restauration PostgreSQL initialisé pour VPS');
  }

  // ============================================
  // 1. AUTHENTIFICATION GOOGLE DRIVE
  // ============================================

  async authenticate() {
    console.log('🔐 Authentification Google Drive...');

    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.GOOGLE_REFRESH_TOKEN
    ) {
      throw new Error('Configuration Google Drive incomplète');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    this.auth = oauth2Client;
    this.drive = google.drive({ version: 'v3', auth: oauth2Client });

    console.log('✅ Authentification Google Drive réussie');
  }

  // ============================================
  // 2. TROUVER LE DOSSIER DE BACKUP
  // ============================================

  async findBackupFolder() {
    console.log('📁 Recherche du dossier backup...');

    try {
      // Si ID fixe fourni
      if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
        try {
          const folder = await this.drive.files.get({
            fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
            fields: 'id, name',
          });

          this.backupFolderId = folder.data.id;
          console.log(`✅ Dossier trouvé par ID: ${this.backupFolderId}`);
          return this.backupFolderId;
        } catch (error) {
          console.log('⚠️  Dossier ID non trouvé, recherche par nom...');
        }
      }

      // Recherche par nom
      const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups';
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        orderBy: 'createdTime desc',
      });

      if (response.data.files.length === 0) {
        throw new Error(`❌ Dossier '${folderName}' non trouvé dans Google Drive`);
      }

      this.backupFolderId = response.data.files[0].id;
      console.log(`✅ Dossier trouvé: ${this.backupFolderId}`);
      return this.backupFolderId;
    } catch (error) {
      console.error('❌ Erreur recherche dossier:', error.message);
      throw error;
    }
  }

  // ============================================
  // 3. TROUVER LE DERNIER BACKUP
  // ============================================

  async findLatestBackup() {
    console.log('🔍 Recherche du dernier backup...');

    await this.findBackupFolder();

    const response = await this.drive.files.list({
      q: `'${this.backupFolderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: 1,
      fields: 'files(id, name, createdTime, size, mimeType)',
    });

    if (response.data.files.length === 0) {
      throw new Error('❌ Aucun backup trouvé');
    }

    const latestBackup = response.data.files[0];
    const fileSizeMB = (parseInt(latestBackup.size) / 1024 / 1024).toFixed(2);

    console.log(`✅ Dernier backup trouvé: ${latestBackup.name}`);
    console.log(`📦 Taille: ${fileSizeMB} MB`);
    console.log(`📅 Créé le: ${new Date(latestBackup.createdTime).toLocaleString('fr-FR')}`);

    return latestBackup;
  }

  // ============================================
  // 4. TROUVER UN BACKUP PAR ID
  // ============================================

  async findBackupById(backupId) {
    console.log(`🔍 Recherche backup: ${backupId}`);

    try {
      const file = await this.drive.files.get({
        fileId: backupId,
        fields: 'id, name, createdTime, size, mimeType',
      });

      const fileSizeMB = (parseInt(file.data.size) / 1024 / 1024).toFixed(2);

      console.log(`✅ Backup trouvé: ${file.data.name}`);
      console.log(`📦 Taille: ${fileSizeMB} MB`);

      return file.data;
    } catch (error) {
      console.error('❌ Backup non trouvé:', error.message);
      throw new Error(`Backup avec ID ${backupId} non trouvé`);
    }
  }

  // ============================================
  // 5. LISTER TOUS LES BACKUPS
  // ============================================

  async listAllBackups() {
    console.log('📋 Liste des backups disponibles...');

    await this.findBackupFolder();

    const response = await this.drive.files.list({
      q: `'${this.backupFolderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: 100,
      fields: 'files(id, name, createdTime, size, mimeType)',
    });

    const backups = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      created: new Date(file.createdTime).toLocaleString('fr-FR'),
      sizeMB: (parseInt(file.size) / 1024 / 1024).toFixed(2),
      type: file.name.endsWith('.gz')
        ? 'SQL compressé'
        : file.name.endsWith('.sql')
          ? 'SQL'
          : file.name.endsWith('.json')
            ? 'JSON'
            : 'Inconnu',
    }));

    console.log(`✅ ${backups.length} backup(s) trouvé(s)`);
    return backups;
  }

  // ============================================
  // 6. TÉLÉCHARGER UN BACKUP
  // ============================================

  async downloadBackup(fileId, fileName) {
    console.log(`⬇️  Téléchargement du backup: ${fileName}`);

    const tempPath = path.join('/tmp', `restore-${Date.now()}-${fileName}`);
    const startTime = Date.now();

    const dest = fsSync.createWriteStream(tempPath);
    const response = await this.drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    return new Promise((resolve, reject) => {
      let downloadedBytes = 0;

      response.data
        .on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = (
            (downloadedBytes / response.data.headers['content-length']) *
            100
          ).toFixed(1);
          process.stdout.write(`\r⏳ Téléchargement: ${percent}%`);
        })
        .pipe(dest)
        .on('finish', () => {
          const duration = Date.now() - startTime;
          const fileSizeMB = downloadedBytes / 1024 / 1024;
          console.log(
            `\n✅ Téléchargement terminé: ${fileSizeMB.toFixed(2)} MB en ${Math.round(duration / 1000)}s`
          );
          resolve(tempPath);
        })
        .on('error', (error) => {
          console.error('\n❌ Erreur téléchargement:', error.message);
          reject(error);
        });
    });
  }

  // ============================================
  // 7. DÉCOMPRESSER SI NÉCESSAIRE
  // ============================================

  async decompressIfNeeded(filePath) {
    if (filePath.endsWith('.gz')) {
      console.log('🗜️  Décompression du fichier...');
      const decompressedPath = filePath.replace('.gz', '');

      return new Promise((resolve, reject) => {
        const gunzip = zlib.createGunzip();
        const source = fsSync.createReadStream(filePath);
        const destination = fsSync.createWriteStream(decompressedPath);

        pump(source, gunzip, destination)
          .then(() => {
            // Supprimer le fichier compressé
            fs.unlink(filePath).catch(() => {});
            console.log(`✅ Fichier décompressé: ${path.basename(decompressedPath)}`);
            resolve(decompressedPath);
          })
          .catch(reject);
      });
    }

    return filePath;
  }

  // ============================================
  // 8. RESTAURER FICHIER SQL (OPTIMISÉ VPS)
  // ============================================

  async restoreSqlFile(filePath) {
    console.log('🔄 Restauration SQL...');

    // Obtenir les infos de connexion
    let dbHost, dbPort, dbName, dbUser, dbPass;

    if (process.env.DATABASE_URL) {
      const dbUrl = new URL(process.env.DATABASE_URL);
      dbHost = dbUrl.hostname;
      dbPort = dbUrl.port || 5432;
      dbName = dbUrl.pathname.slice(1);
      dbUser = dbUrl.username;
      dbPass = dbUrl.password;
    } else {
      dbHost = process.env.DB_HOST || 'localhost';
      dbPort = process.env.DB_PORT || 5432;
      dbName = process.env.DB_NAME;
      dbUser = process.env.DB_USER;
      dbPass = process.env.DB_PASSWORD;
    }

    // Commande psql optimisée pour VPS
    const command = `psql \
      --host=${dbHost} \
      --port=${dbPort} \
      --username=${dbUser} \
      --dbname=${dbName} \
      --file=${filePath} \
      --set ON_ERROR_STOP=on`;

    const env = { ...process.env, PGPASSWORD: dbPass };

    try {
      console.log('⚡ Exécution de la restauration SQL (cela peut prendre quelques minutes)...');
      const startTime = Date.now();

      const { stdout, stderr } = await execPromise(command, {
        env,
        timeout: 600000, // 10 minutes pour VPS
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      });

      const duration = Date.now() - startTime;

      if (stderr && !stderr.includes('WARNING:')) {
        console.warn('⚠️  Avertissements:', stderr);
      }

      console.log(`✅ Restauration SQL terminée en ${Math.round(duration / 1000)}s`);
      return true;
    } catch (error) {
      console.error('❌ Erreur restauration SQL:', error.message);

      if (error.message.includes('timeout')) {
        throw new Error('Timeout restauration - fichier trop volumineux');
      }

      console.log('⚠️  Fallback vers restauration JSON...');
      return false;
    }
  }

  // ============================================
  // 9. RESTAURER FICHIER JSON (OPTIMISÉ VPS)
  // ============================================

  async restoreJsonFile(filePath) {
    console.log('🔄 Restauration JSON...');

    // Lire et parser le fichier
    console.log('📖 Lecture du fichier JSON...');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const backupData = JSON.parse(fileContent);

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      statement_timeout: 300000, // 5 minutes par requête
    });

    try {
      await client.connect();
      console.log('✅ Connecté à PostgreSQL');

      // Désactiver les triggers temporairement pour accélérer
      await client.query('SET session_replication_role = replica;');

      // Restaurer les données
      const tables = backupData.data || {};
      const tableNames = Object.keys(tables);

      console.log(`📋 ${tableNames.length} tables à restaurer`);

      let totalRows = 0;
      let successTables = 0;

      for (const [index, tableName] of tableNames.entries()) {
        const rows = tables[tableName];

        if (!Array.isArray(rows) || rows.length === 0) {
          console.log(`⏭️  Table ${tableName} vide, ignorée`);
          continue;
        }

        console.log(
          `📤 [${index + 1}/${tableNames.length}] Restauration ${tableName} (${rows.length} lignes)...`
        );

        try {
          // Vider la table (plus rapide que DELETE)
          await client.query(`TRUNCATE TABLE "${tableName}" CASCADE;`);

          // Restaurer les données
          const restoredCount = await this.restoreTableOptimized(client, tableName, rows);

          totalRows += restoredCount;
          successTables++;
          console.log(`   ✅ ${restoredCount} lignes restaurées dans ${tableName}`);
        } catch (error) {
          console.error(`   ❌ Erreur table ${tableName}:`, error.message);
        }
      }

      // Réactiver les triggers
      await client.query('SET session_replication_role = DEFAULT;');

      console.log(
        `✅ Restauration JSON terminée: ${successTables}/${tableNames.length} tables, ${totalRows} lignes totales`
      );
      return true;
    } catch (error) {
      console.error('❌ Erreur restauration JSON:', error);
      throw error;
    } finally {
      await client.end();
    }
  }

  // ============================================
  // 10. RESTAURATION OPTIMISÉE D'UNE TABLE
  // ============================================

  async restoreTableOptimized(client, tableName, rows) {
    if (rows.length === 0) return 0;

    // Prendre les colonnes du premier objet
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnNames = columns.map((col) => `"${col}"`).join(', ');

    const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

    let restoredCount = 0;
    const batchSize = 1000; // Lots de 1000 pour VPS

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      // Utiliser une transaction par batch
      await client.query('BEGIN');

      try {
        for (const row of batch) {
          const values = columns.map((col) => row[col]);
          await client.query(insertSQL, values);
          restoredCount++;
        }
        await client.query('COMMIT');

        if ((i + batchSize) % 10000 === 0) {
          console.log(`   ⏳ ${Math.min(i + batchSize, rows.length)}/${rows.length} lignes...`);
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return restoredCount;
  }

  // ============================================
  // 11. RESTAURATION COMPLÈTE
  // ============================================

  async executeRestoration() {
    console.log('🚀 DÉMARRAGE RESTAURATION COMPLÈTE');
    console.log('==================================');
    const startTime = Date.now();

    try {
      await this.authenticate();

      // 1. Trouver le dernier backup
      const latestBackup = await this.findLatestBackup();

      // 2. Télécharger
      const downloadedPath = await this.downloadBackup(latestBackup.id, latestBackup.name);

      // 3. Décompresser si nécessaire
      const restorePath = await this.decompressIfNeeded(downloadedPath);

      // 4. Restaurer selon le type
      let restored = false;

      if (restorePath.endsWith('.sql')) {
        restored = await this.restoreSqlFile(restorePath);
      }

      if (!restored && restorePath.endsWith('.json')) {
        await this.restoreJsonFile(restorePath);
        restored = true;
      }

      // 5. Nettoyage
      await fs.unlink(restorePath).catch(() => {});

      const totalDuration = Date.now() - startTime;

      console.log('==================================');
      console.log(`🎉 RESTAURATION RÉUSSIE en ${Math.round(totalDuration / 1000)}s`);
      console.log(`📦 Backup: ${latestBackup.name}`);
      console.log(`📅 Date: ${new Date(latestBackup.createdTime).toLocaleString('fr-FR')}`);

      return {
        success: true,
        backupName: latestBackup.name,
        backupDate: latestBackup.createdTime,
        duration: totalDuration,
      };
    } catch (error) {
      console.error('💥 RESTAURATION ÉCHOUÉE:', error.message);
      throw error;
    }
  }

  // ============================================
  // 12. RESTAURATION À PARTIR D'UN ID
  // ============================================

  async restoreFromId(backupId) {
    console.log(`🚀 RESTAURATION BACKUP SPÉCIFIQUE: ${backupId}`);
    console.log('========================================');
    const startTime = Date.now();

    try {
      await this.authenticate();

      // 1. Trouver le backup par ID
      const backup = await this.findBackupById(backupId);

      // 2. Télécharger
      const downloadedPath = await this.downloadBackup(backup.id, backup.name);

      // 3. Décompresser si nécessaire
      const restorePath = await this.decompressIfNeeded(downloadedPath);

      // 4. Restaurer selon le type
      let restored = false;

      if (restorePath.endsWith('.sql')) {
        restored = await this.restoreSqlFile(restorePath);
      }

      if (!restored && restorePath.endsWith('.json')) {
        await this.restoreJsonFile(restorePath);
        restored = true;
      }

      // 5. Nettoyage
      await fs.unlink(restorePath).catch(() => {});

      const totalDuration = Date.now() - startTime;

      console.log('========================================');
      console.log(`🎉 RESTAURATION RÉUSSIE en ${Math.round(totalDuration / 1000)}s`);
      console.log(`📦 Backup: ${backup.name}`);
      console.log(`📅 Date: ${new Date(backup.createdTime).toLocaleString('fr-FR')}`);

      return {
        success: true,
        backupName: backup.name,
        backupDate: backup.createdTime,
        duration: totalDuration,
      };
    } catch (error) {
      console.error('💥 RESTAURATION ÉCHOUÉE:', error.message);
      throw error;
    }
  }

  // ============================================
  // 13. VÉRIFICATION DE L'INTÉGRITÉ
  // ============================================

  async verifyBackupIntegrity(backupId) {
    console.log(`🔍 Vérification intégrité backup: ${backupId}`);

    try {
      await this.authenticate();
      const backup = await this.findBackupById(backupId);

      // Télécharger temporairement
      const downloadedPath = await this.downloadBackup(backup.id, backup.name);
      const restorePath = await this.decompressIfNeeded(downloadedPath);

      let isValid = true;
      let error = null;

      if (restorePath.endsWith('.sql')) {
        // Vérifier que le fichier SQL n'est pas corrompu
        try {
          const content = await fs.readFile(restorePath, 'utf8');
          isValid = content.includes('CREATE TABLE') || content.includes('INSERT INTO');
        } catch (e) {
          isValid = false;
          error = e.message;
        }
      } else if (restorePath.endsWith('.json')) {
        // Vérifier que le JSON est valide
        try {
          const content = await fs.readFile(restorePath, 'utf8');
          JSON.parse(content);
        } catch (e) {
          isValid = false;
          error = e.message;
        }
      }

      // Nettoyer
      await fs.unlink(downloadedPath).catch(() => {});
      if (restorePath !== downloadedPath) {
        await fs.unlink(restorePath).catch(() => {});
      }

      return {
        backupId,
        backupName: backup.name,
        isValid,
        error,
      };
    } catch (error) {
      return {
        backupId,
        isValid: false,
        error: error.message,
      };
    }
  }
}

module.exports = PostgreSQLRestorer;


// ========== routes\Cartes.js ==========
// routes/Cartes.js
const express = require('express');
const router = express.Router();
const db = // require modifié - fichier consolidé;
const { verifyToken: verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const colonnes = // require modifié - fichier consolidé;
const permission = // require modifié - fichier consolidé;
const cartesController = // require modifié - fichier consolidé;

// ============================================
// MIDDLEWARE D'AUTHENTIFICATION
// ============================================

const authMiddleware = (req, res, next) => {
  if (typeof verifierToken === 'function') {
    return verifierToken(req, res, next);
  }

  console.error("❌ ERREUR CRITIQUE: verifierToken n'est pas une fonction!");
  console.error('Type reçu:', typeof verifierToken);
  console.error('Valeur:', verifierToken);
  console.error('Vérifiez que le fichier middleware/auth.js exporte bien verifyToken');

  if (process.env.NODE_ENV !== 'production') {
    console.warn('⚠️ MODE DÉVELOPPEMENT: Authentification désactivée');
    req.user = {
      id: 1,
      NomUtilisateur: 'dev_user',
      NomComplet: 'Développeur',
      Role: 'Administrateur',
      role: 'Administrateur',
      Agence: 'DEV',
      permissions: ['*'],
      level: 100,
    };
    return next();
  }

  return res.status(500).json({
    success: false,
    message: 'Erreur de configuration du serveur',
    error: "Middleware d'authentification manquant",
    timestamp: new Date().toISOString(),
  });
};

router.use(authMiddleware);

// ============================================
// ROUTES LÉGÈRES (sans paramètre :id) — DOIVENT être avant /:id
// ============================================

/**
 * Vérification de santé de l'API
 * GET /api/cartes/health
 */
router.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'API Cartes opérationnelle',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
  });
});

/**
 * ✅ NOUVEAU — Liste des coordinations distinctes (pour CoordinationDropdown)
 * GET /api/cartes/coordinations
 * - Administrateur : toutes les coordinations
 * - Gestionnaire / Chef d'équipe / Opérateur : leur coordination uniquement
 */
router.get('/coordinations', cartesController.getCoordinations);

/**
 * Récupérer les changements depuis une date
 * GET /api/cartes/changes?since=2024-01-01T00:00:00
 */
router.get('/changes', async (req, res) => {
  try {
    const { since } = req.query;

    if (!since) {
      return res.status(400).json({ success: false, message: 'Paramètre "since" requis' });
    }

    const result = await db.query(
      `SELECT * FROM cartes 
       WHERE dateimport > $1 
       ORDER BY dateimport DESC`,
      [since]
    );

    res.json({
      success: true,
      count: result.rows.length,
      data: result.rows,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Synchronisation des données
 * POST /api/cartes/sync
 */
router.post('/sync', async (req, res) => {
  try {
    const { data, lastSync } = req.body;

    if (!data || !Array.isArray(data)) {
      return res.status(400).json({
        success: false,
        message: 'Données de synchronisation invalides',
      });
    }

    let itemsToSync = data;

    if (lastSync) {
      itemsToSync = data.filter((item) => {
        return !item.dateimport || new Date(item.dateimport) > new Date(lastSync);
      });
      console.log(
        `📅 Synchronisation depuis ${lastSync}: ${itemsToSync.length} éléments à traiter`
      );
    }

    const results = { inserted: 0, updated: 0, errors: 0, lastSync: new Date().toISOString() };

    for (const item of itemsToSync) {
      try {
        const existing = await db.query('SELECT id FROM cartes WHERE id = $1', [item.id]);

        if (existing.rows.length > 0) {
          await db.query(
            `UPDATE cartes SET 
             "LIEU D'ENROLEMENT" = $1,
             "SITE DE RETRAIT" = $2,
             rangement = $3,
             nom = $4,
             prenoms = $5,
             "DATE DE NAISSANCE" = $6,
             "LIEU NAISSANCE" = $7,
             contact = $8,
             delivrance = $9,
             "CONTACT DE RETRAIT" = $10,
             "DATE DE DELIVRANCE" = $11,
             coordination = $12,
             dateimport = NOW()
             WHERE id = $13`,
            [
              item["LIEU D'ENROLEMENT"],
              item['SITE DE RETRAIT'],
              item.rangement,
              item.nom,
              item.prenoms,
              item['DATE DE NAISSANCE'],
              item['LIEU NAISSANCE'],
              item.contact,
              item.delivrance,
              item['CONTACT DE RETRAIT'],
              item['DATE DE DELIVRANCE'],
              item.coordination,
              item.id,
            ]
          );
          results.updated++;
        } else {
          await db.query(
            `INSERT INTO cartes (
              id, "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement,
              nom, prenoms, "DATE DE NAISSANCE", "LIEU NAISSANCE",
              contact, delivrance, "CONTACT DE RETRAIT", "DATE DE DELIVRANCE",
              coordination, dateimport
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())`,
            [
              item.id,
              item["LIEU D'ENROLEMENT"],
              item['SITE DE RETRAIT'],
              item.rangement,
              item.nom,
              item.prenoms,
              item['DATE DE NAISSANCE'],
              item['LIEU NAISSANCE'],
              item.contact,
              item.delivrance,
              item['CONTACT DE RETRAIT'],
              item['DATE DE DELIVRANCE'],
              item.coordination,
            ]
          );
          results.inserted++;
        }
      } catch (err) {
        console.error('❌ Erreur synchronisation item:', err);
        results.errors++;
      }
    }

    res.json({
      success: true,
      message: 'Synchronisation terminée',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur sync:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Récupérer les sites configurés
 * GET /api/cartes/sites
 */
router.get('/sites', (req, res) => {
  const sites = ['ADJAME', "CHU D'ANGRE", 'UNIVERSITE DE COCODY', 'LYCEE HOTELIER', 'BINGERVILLE'];

  res.json({
    success: true,
    data: sites,
    count: sites.length,
    timestamp: new Date().toISOString(),
  });
});

/**
 * Statistiques détaillées
 * GET /api/cartes/stats
 */
router.get('/stats', async (req, res) => {
  try {
    const total = await db.query('SELECT COUNT(*) as count FROM cartes');

    const parSite = await db.query(`
      SELECT 
        COALESCE("SITE DE RETRAIT", 'Non défini') as site,
        COUNT(*) as nombre
      FROM cartes
      GROUP BY "SITE DE RETRAIT"
      ORDER BY nombre DESC
    `);

    const parMois = await db.query(`
      SELECT 
        TO_CHAR(dateimport, 'YYYY-MM') as mois,
        COUNT(*) as nombre
      FROM cartes
      WHERE dateimport IS NOT NULL
      GROUP BY TO_CHAR(dateimport, 'YYYY-MM')
      ORDER BY mois DESC
      LIMIT 12
    `);

    res.json({
      success: true,
      data: {
        total: parseInt(total.rows[0].count),
        parSite: parSite.rows,
        parMois: parMois.rows,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur stats:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Modifications par site
 * GET /api/cartes/modifications
 */
router.get('/modifications', async (req, res) => {
  try {
    const { site, dateDebut, dateFin } = req.query;

    let query = `
      SELECT 
        "SITE DE RETRAIT",
        COUNT(*) as total,
        MIN(dateimport) as premiere_modification,
        MAX(dateimport) as derniere_modification
      FROM cartes
      WHERE 1=1
    `;

    const params = [];

    if (site) {
      params.push(site);
      query += ` AND "SITE DE RETRAIT" = $${params.length}`;
    }
    if (dateDebut) {
      params.push(dateDebut);
      query += ` AND dateimport >= $${params.length}`;
    }
    if (dateFin) {
      params.push(dateFin);
      query += ` AND dateimport <= $${params.length}`;
    }

    query += ` GROUP BY "SITE DE RETRAIT" ORDER BY total DESC`;

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur modifications:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Récupérer les cartes avec filtres
 * GET /api/cartes
 */
router.get('/', async (req, res) => {
  try {
    const {
      nom,
      prenoms,
      siteRetrait,
      lieuEnrolement,
      rangement,
      dateNaissance,
      lieuNaissance,
      contact,
      contactRetrait,
      delivrance,
      dateDelivrance,
      coordination,
      site,
      page = 1,
      limit = 50,
    } = req.query;

    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(parseInt(limit) || 50, 500);
    const offset = (pageNum - 1) * limitNum;

    let dataQuery = `
      SELECT
        id,
        coordination,
        "LIEU D'ENROLEMENT"     AS "lieuEnrolement",
        "SITE DE RETRAIT"       AS "siteRetrait",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') AS "dateNaissance",
        "LIEU NAISSANCE"        AS "lieuNaissance",
        contact,
        delivrance,
        "CONTACT DE RETRAIT"    AS "contactRetrait",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') AS "dateDelivrance",
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') AS "dateCreation"
      FROM cartes
      WHERE 1=1
    `;

    const params = [];

    if (nom) {
      params.push(`%${nom}%`);
      dataQuery += ` AND nom ILIKE $${params.length}`;
    }
    if (prenoms) {
      params.push(`%${prenoms}%`);
      dataQuery += ` AND prenoms ILIKE $${params.length}`;
    }
    if (siteRetrait || site) {
      params.push(`%${siteRetrait || site}%`);
      dataQuery += ` AND "SITE DE RETRAIT" ILIKE $${params.length}`;
    }
    if (lieuEnrolement) {
      params.push(`%${lieuEnrolement}%`);
      dataQuery += ` AND "LIEU D'ENROLEMENT" ILIKE $${params.length}`;
    }
    if (rangement) {
      params.push(`%${rangement}%`);
      dataQuery += ` AND rangement ILIKE $${params.length}`;
    }
    if (dateNaissance) {
      params.push(dateNaissance);
      dataQuery += ` AND "DATE DE NAISSANCE" = $${params.length}`;
    }
    if (lieuNaissance) {
      params.push(`%${lieuNaissance}%`);
      dataQuery += ` AND "LIEU NAISSANCE" ILIKE $${params.length}`;
    }
    if (contact) {
      params.push(`%${contact}%`);
      dataQuery += ` AND contact ILIKE $${params.length}`;
    }
    if (contactRetrait) {
      params.push(`%${contactRetrait}%`);
      dataQuery += ` AND "CONTACT DE RETRAIT" ILIKE $${params.length}`;
    }
    if (delivrance !== undefined && delivrance !== '') {
      if (delivrance === true || delivrance === 'true' || delivrance === 'oui') {
        dataQuery += ` AND delivrance IS NOT NULL AND TRIM(COALESCE(delivrance,'')) != '' AND UPPER(delivrance) != 'NON'`;
      } else if (delivrance === false || delivrance === 'false' || delivrance === 'non') {
        dataQuery += ` AND (delivrance IS NULL OR TRIM(COALESCE(delivrance,'')) = '' OR UPPER(delivrance) = 'NON')`;
      }
    }
    if (dateDelivrance) {
      params.push(dateDelivrance);
      dataQuery += ` AND "DATE DE DELIVRANCE" = $${params.length}`;
    }
    if (coordination) {
      params.push(coordination);
      dataQuery += ` AND coordination = $${params.length}`;
    }

    // Filtre automatique par coordination selon le rôle
    if (req.user?.role === 'Gestionnaire' && req.user?.coordination && !coordination) {
      params.push(req.user.coordination);
      dataQuery += ` AND coordination = $${params.length}`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM cartes WHERE 1=1${dataQuery.split('WHERE 1=1')[1]}`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    dataQuery += ` ORDER BY nom, prenoms LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await db.query(dataQuery, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
        hasNext: pageNum < Math.ceil(total / limitNum),
        hasPrev: pageNum > 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getCartes:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================
// ROUTES CRUD POUR L'APPLICATION WEB
// ============================================

/**
 * Récupérer toutes les cartes (pagination avancée) - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/list
 */
router.get('/list', role.peutAccederPage('inventaire'), async (req, res) => {
  try {
    const { page = 1, limit = 50, recherche = '' } = req.query;

    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const offset = (pageNum - 1) * limitNum;

    let query = 'SELECT * FROM cartes WHERE 1=1';
    const params = [];

    if (recherche) {
      params.push(`%${recherche}%`);
      query += ` AND (nom ILIKE $1 OR prenoms ILIKE $1)`;
    }

    if (req.user?.role === 'Gestionnaire' && req.user?.coordination) {
      params.push(req.user.coordination);
      const paramIndex = recherche ? params.length : 1;
      query += ` AND coordination = $${paramIndex}`;
    }

    const countQuery = `SELECT COUNT(*) as total FROM cartes WHERE 1=1${query.split('WHERE')[1]}`;
    const countResult = await db.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    query += ` ORDER BY nom, prenoms LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limitNum, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        totalPages: Math.ceil(total / limitNum),
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getCartesList:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Statistiques globales - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/statistiques
 */
router.get('/statistiques', permission.peutVoirStatistiques, async (req, res) => {
  try {
    const userRole = req.user?.role;
    const coordination = req.user?.coordination;

    let query = `
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs
      FROM cartes
      WHERE 1=1
    `;

    const params = [];

    if (userRole === 'Gestionnaire' && coordination) {
      params.push(coordination);
      query += ` AND coordination = $1`;
    }

    const result = await db.query(query, params);
    const stats = result.rows[0];
    stats.taux_retrait =
      stats.total_cartes > 0 ? Math.round((stats.cartes_retirees / stats.total_cartes) * 100) : 0;

    res.json({ success: true, data: stats, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('❌ Erreur statistiques:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Mise à jour batch de cartes - PROTÉGÉ PAR RÔLE
 * PUT /api/cartes/batch
 */
router.put('/batch', role.peutImporterExporter, async (req, res) => {
  try {
    const { cartes } = req.body;

    if (!cartes || !Array.isArray(cartes)) {
      return res.status(400).json({ success: false, message: 'Liste de cartes invalide' });
    }

    const results = { success: 0, errors: 0 };

    for (const carte of cartes) {
      try {
        await db.query(
          `UPDATE cartes SET
              "LIEU D'ENROLEMENT" = COALESCE($1, "LIEU D'ENROLEMENT"),
              "SITE DE RETRAIT" = COALESCE($2, "SITE DE RETRAIT"),
              rangement = COALESCE($3, rangement),
              nom = COALESCE($4, nom),
              prenoms = COALESCE($5, prenoms),
              "DATE DE NAISSANCE" = COALESCE($6, "DATE DE NAISSANCE"),
              "LIEU NAISSANCE" = COALESCE($7, "LIEU NAISSANCE"),
              contact = COALESCE($8, contact),
              delivrance = COALESCE($9, delivrance),
              "CONTACT DE RETRAIT" = COALESCE($10, "CONTACT DE RETRAIT"),
              "DATE DE DELIVRANCE" = COALESCE($11, "DATE DE DELIVRANCE"),
              coordination = COALESCE($12, coordination),
              dateimport = NOW()
            WHERE id = $13`,
          [
            carte["LIEU D'ENROLEMENT"],
            carte['SITE DE RETRAIT'],
            carte.rangement,
            carte.nom,
            carte.prenoms,
            carte['DATE DE NAISSANCE'],
            carte['LIEU NAISSANCE'],
            carte.contact,
            carte.delivrance,
            carte['CONTACT DE RETRAIT'],
            carte['DATE DE DELIVRANCE'],
            carte.coordination,
            carte.id,
          ]
        );
        results.success++;
      } catch (err) {
        console.error('❌ Erreur mise à jour batch:', err);
        results.errors++;
      }
    }

    res.json({
      success: true,
      message: 'Mise à jour batch terminée',
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur batch update:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * Test de connexion
 * GET /api/cartes/test/connection
 */
router.get('/test/connection', async (req, res) => {
  try {
    const result = await db.query('SELECT version() as version, NOW() as time');

    res.json({
      success: true,
      message: 'Connexion à la base de données réussie',
      database: { version: result.rows[0].version, server_time: result.rows[0].time },
      server: {
        time: new Date().toISOString(),
        node_version: process.version,
        environment: process.env.NODE_ENV || 'development',
      },
    });
  } catch (error) {
    console.error('❌ Erreur test connexion:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur de connexion à la base de données',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// ============================================
// ROUTES AVEC PARAMÈTRE :id — DOIVENT être après les routes nommées
// ============================================

/**
 * Récupérer une carte par ID - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/:id
 */
router.get('/:id', role.peutAccederPage('inventaire'), cartesController.getCarteParId);

/**
 * Créer une nouvelle carte - PROTÉGÉ PAR RÔLE
 * POST /api/cartes
 */
router.post('/', role.peutModifierCarte, colonnes.filtrerColonnes, cartesController.createCarte);

/**
 * Mettre à jour une carte - PROTÉGÉ PAR RÔLE AVEC FILTRAGE
 * PUT /api/cartes/:id
 */
router.put('/:id', role.peutModifierCarte, colonnes.filtrerColonnes, cartesController.updateCarte);

/**
 * Supprimer une carte - PROTÉGÉ PAR RÔLE
 * DELETE /api/cartes/:id
 */
router.delete('/:id', role.peutModifierCarte, cartesController.deleteCarte);

module.exports = router;


// ========== routes\ImportExport.js ==========
const express = require('express');
const router = express.Router();
const importExportController = // require modifié - fichier consolidé;
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const UPLOAD_CONFIG = {
  maxFileSize: 100 * 1024 * 1024, // 100MB pour LWS
  maxFiles: 1,
  uploadDir: 'uploads/',
  allowedExtensions: ['.xlsx', '.xls', '.csv'],
  allowedMimeTypes: [
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
    'application/csv',
    'application/vnd.oasis.opendocument.spreadsheet',
  ],
};

// Assurer que le dossier uploads existe
if (!fs.existsSync(UPLOAD_CONFIG.uploadDir)) {
  fs.mkdirSync(UPLOAD_CONFIG.uploadDir, { recursive: true });
  console.log(`📁 Dossier ${UPLOAD_CONFIG.uploadDir} créé`);
}

// ============================================
// CONFIGURATION MULTER OPTIMISÉE
// ============================================

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_CONFIG.uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const random = Math.round(Math.random() * 1e9);
    const safeFileName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_').replace(/\s+/g, '_');

    // Ajouter l'ID utilisateur et sa coordination pour traçabilité
    const userId = req.user?.id || 'anonymous';
    const coordination = req.user?.coordination || 'no-coordination';
    cb(null, `import-${userId}-${coordination}-${timestamp}-${random}-${safeFileName}`);
  },
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isValidExt = UPLOAD_CONFIG.allowedExtensions.includes(ext);
  const isValidMime = UPLOAD_CONFIG.allowedMimeTypes.includes(file.mimetype);

  if (isValidExt || isValidMime) {
    cb(null, true);
  } else {
    cb(
      new Error(
        `Format non supporté. Formats acceptés: ${UPLOAD_CONFIG.allowedExtensions.join(', ')}`
      ),
      false
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_CONFIG.maxFileSize,
    files: UPLOAD_CONFIG.maxFiles,
  },
});

// ============================================
// MIDDLEWARE DE VALIDATION D'UPLOAD
// ============================================

const validateFileUpload = (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({
      success: false,
      error: 'Aucun fichier uploadé',
      code: 'NO_FILE',
    });
  }

  // Vérifier la taille
  if (req.file.size > UPLOAD_CONFIG.maxFileSize) {
    // Supprimer le fichier
    fs.unlinkSync(req.file.path);
    return res.status(400).json({
      success: false,
      error: `Fichier trop volumineux. Maximum: ${UPLOAD_CONFIG.maxFileSize / (1024 * 1024)}MB`,
      code: 'FILE_TOO_LARGE',
    });
  }

  next();
};

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifierToken);

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(
    `📦 [ImportExport] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur} (${req.user?.role})`
  );
  next();
});

// ============================================
// ROUTES PRINCIPALES
// ============================================

/**
 * 📥 IMPORT CSV STANDARD
 * POST /api/import-export/import/csv
 */
router.post(
  '/import/csv',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  upload.single('file'),
  validateFileUpload,
  importExportController.importCSV
);

/**
 * 📤 EXPORT EXCEL LIMITÉ
 * GET /api/import-export/export
 */
router.get(
  '/export',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.exportExcel
);

/**
 * 📤 EXPORT CSV LIMITÉ
 * GET /api/import-export/export/csv
 */
router.get(
  '/export/csv',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.exportCSV
);

/**
 * 🔍 EXPORT CSV PAR SITE
 * GET /api/import-export/export/site
 */
router.get(
  '/export/site',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.exportCSVBySite
);

/**
 * 📋 TÉLÉCHARGER TEMPLATE
 * GET /api/import-export/template
 */
router.get(
  '/template',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.downloadTemplate
);

/**
 * 🏢 LISTE DES SITES
 * GET /api/import-export/sites
 */
router.get(
  '/sites',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.getSitesList
);

/**
 * 🩺 DIAGNOSTIC COMPLET
 * GET /api/import-export/diagnostic
 */
router.get(
  '/diagnostic',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.diagnostic
);

// ============================================
// ROUTES D'EXPORT COMPLET
// ============================================

/**
 * 🚀 EXPORT EXCEL COMPLET (toutes les données)
 * GET /api/import-export/export/complete
 */
router.get(
  '/export/complete',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.exportCompleteExcel
);

/**
 * 🚀 EXPORT CSV COMPLET (toutes les données)
 * GET /api/import-export/export/complete/csv
 */
router.get(
  '/export/complete/csv',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.exportCompleteCSV
);

/**
 * 🚀 EXPORT "TOUT EN UN" (choix automatique du format)
 * GET /api/import-export/export/all
 */
router.get(
  '/export/all',
  role.peutImporterExporter, // Admin et Gestionnaire uniquement
  importExportController.exportAllData
);

// ============================================
// ROUTES DE COMPATIBILITÉ (avec redirection)
// ============================================

/**
 * 📥 IMPORT EXCEL (alias)
 * POST /api/import-export/import
 */
router.post(
  '/import',
  role.peutImporterExporter,
  upload.single('file'),
  validateFileUpload,
  importExportController.importCSV
);

/**
 * 🔄 IMPORT SMART SYNC
 * POST /api/import-export/import/smart-sync
 */
router.post(
  '/import/smart-sync',
  role.peutImporterExporter,
  upload.single('file'),
  validateFileUpload,
  importExportController.importSmartSync
);

/**
 * 📤 EXPORT STREAMING (redirige vers complet)
 * GET /api/import-export/export/stream
 */
router.get('/export/stream', role.peutImporterExporter, importExportController.exportCompleteCSV);

/**
 * 🎛️ EXPORT FILTRÉ (par site)
 * GET /api/import-export/export/filtered
 */
router.get('/export/filtered', role.peutImporterExporter, importExportController.exportCSVBySite);

/**
 * 🔍 EXPORT RÉSULTATS (alias)
 * GET /api/import-export/export-resultats
 */
router.get('/export-resultats', role.peutImporterExporter, importExportController.exportCSVBySite);

/**
 * 📤 EXPORT OPTIMISÉ (redirige vers complet)
 * GET /api/import-export/export/optimized
 */
router.get(
  '/export/optimized',
  role.peutImporterExporter,
  importExportController.exportCompleteCSV
);

// ============================================
// ROUTES DE STATISTIQUES ET MONITORING
// ============================================

/**
 * 📊 STATUT DES EXPORTS EN COURS
 * GET /api/import-export/status
 */
router.get('/status', role.peutImporterExporter, importExportController.getExportStatus);

// ============================================
// ROUTES DE TEST (sans authentification en dev)
// ============================================

if (process.env.NODE_ENV !== 'production') {
  /**
   * 🧪 TEST EXPORT
   * GET /api/import-export/test/export
   */
  router.get('/test/export', async (req, res) => {
    try {
      const db = // require modifié - fichier consolidé;
      const result = await db.query('SELECT COUNT(*) as total FROM cartes');
      const totalRows = parseInt(result.rows[0].total);

      res.json({
        success: true,
        message: "Service d'export opérationnel",
        timestamp: new Date().toISOString(),
        data: {
          total_cartes: totalRows,
          environnement: process.env.NODE_ENV || 'development',
          roles_autorises: ['Administrateur', 'Gestionnaire'],
          endpoints_disponibles: {
            export_limite: [
              {
                method: 'GET',
                path: '/api/import-export/export',
                description: 'Excel limité (5000 lignes)',
              },
              {
                method: 'GET',
                path: '/api/import-export/export/csv',
                description: 'CSV limité (5000 lignes)',
              },
              {
                method: 'GET',
                path: '/api/import-export/export/site',
                description: 'CSV par site',
              },
            ],
            export_complet: [
              {
                method: 'GET',
                path: '/api/import-export/export/complete',
                description: 'Excel complet (toutes les données)',
              },
              {
                method: 'GET',
                path: '/api/import-export/export/complete/csv',
                description: 'CSV complet (toutes les données)',
              },
              {
                method: 'GET',
                path: '/api/import-export/export/all',
                description: 'Choix automatique du format',
              },
            ],
            import: [
              { method: 'POST', path: '/api/import-export/import/csv', description: 'Import CSV' },
              {
                method: 'POST',
                path: '/api/import-export/import/smart-sync',
                description: 'Import avec fusion intelligente',
              },
            ],
          },
          recommandations: [
            totalRows > 50000
              ? `📊 ${totalRows.toLocaleString()} cartes: utilisez /export/all`
              : `✅ ${totalRows.toLocaleString()} cartes: toutes les routes fonctionnent`,
            totalRows > 20000
              ? '⚡ CSV recommandé pour les gros volumes'
              : '📈 Excel parfait pour les volumes modérés',
          ],
        },
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: error.message,
      });
    }
  });

  /**
   * 🧪 TEST COMPLET
   * GET /api/import-export/test
   */
  router.get('/test', (req, res) => {
    res.json({
      success: true,
      message: 'API Import/Export COMPLETE fonctionnelle',
      timestamp: new Date().toISOString(),
      version: '4.0.0-lws',
      environnement: process.env.NODE_ENV || 'development',
      roles_autorises: ['Administrateur', 'Gestionnaire'],
      features: [
        '✅ Export CSV optimisé (streaming par lots)',
        '✅ Export Excel avec style professionnel',
        '✅ Export COMPLET (toutes les données)',
        '✅ Import CSV avec validation',
        '✅ Import Smart Sync (fusion intelligente)',
        '✅ Export par site',
        "✅ Template d'import Excel",
        "✅ File d'attente et gestion mémoire",
        '✅ Monitoring des exports en cours',
        '✅ Filtrage par coordination pour les gestionnaires',
      ],
      config: {
        max_file_size: '100MB',
        max_export_rows: '1,000,000',
        max_batch_size: 10000,
        concurrent_exports: 3,
        formats_supportes: ['.csv', '.xlsx', '.xls'],
      },
      quick_start: [
        '1️⃣ Pour exporter TOUT: GET /api/import-export/export/all',
        '2️⃣ Pour exporter en Excel: GET /api/import-export/export/complete',
        '3️⃣ Pour exporter en CSV: GET /api/import-export/export/complete/csv',
        '4️⃣ Pour importer: POST /api/import-export/import/csv (multipart/form-data)',
        '5️⃣ Pour le template: GET /api/import-export/template',
        '6️⃣ Pour le diagnostic: GET /api/import-export/diagnostic',
        '7️⃣ Pour les stats: GET /api/import-export/status',
      ],
    });
  });

  /**
   * 🩺 SANTÉ DU SERVICE (publique en dev)
   * GET /api/import-export/health
   */
  router.get('/health', (req, res) => {
    const controller = importExportController._controller;

    res.json({
      status: 'healthy',
      service: 'import-export-complet',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      version: '4.0.0-lws',
      roles_autorises: ['Administrateur', 'Gestionnaire'],
      stats: {
        exports_actifs: controller?.activeExports?.size || 0,
        imports_actifs: controller?.activeImports?.size || 0,
        file_attente: controller?.exportQueue?.length || 0,
      },
      endpoints: {
        import: {
          csv: 'POST /import/csv',
          smart: 'POST /import/smart-sync',
        },
        export_limite: {
          excel: 'GET /export (max 5000)',
          csv: 'GET /export/csv (max 5000)',
          site: 'GET /export/site',
        },
        export_complet: {
          excel: 'GET /export/complete',
          csv: 'GET /export/complete/csv',
          auto: 'GET /export/all',
        },
        utilitaires: {
          template: 'GET /template',
          sites: 'GET /sites',
          diagnostic: 'GET /diagnostic',
          status: 'GET /status',
          test: 'GET /test',
        },
      },
      recommandations: [
        '🚀 Utilisez /export/all pour exporter TOUTES vos données',
        '📊 /export/complete pour Excel, /export/complete/csv pour CSV',
        '⚡ CSV recommandé pour plus de 20,000 lignes',
        '💡 /export et /export/csv sont limités à 5000 lignes',
        '📈 Vérifiez /diagnostic pour voir le volume total',
      ],
    });
  });
}

// ============================================
// ROUTE D'ACCUEIL (publique)
// ============================================

router.get('/', (req, res) => {
  const roleInfo = req.user
    ? `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role})`
    : 'Non authentifié';

  res.json({
    title: 'API Import/Export COMPLETE pour LWS',
    description: 'Exportez toutes vos données avec des performances optimisées',
    version: '4.0.0-lws',
    documentation: 'https://github.com/votre-projet/docs',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    roles_autorises: ['Administrateur', 'Gestionnaire'],
    endpoints: {
      export_complet: {
        description: '🔵 Exporter TOUTES les données (recommandé)',
        routes: {
          tout_en_un: {
            path: '/api/import-export/export/all',
            method: 'GET',
            description: 'Choix intelligent entre Excel et CSV selon le volume',
            exemple: 'curl -H "Authorization: Bearer <token>" https://api/import-export/export/all',
          },
          excel_complet: {
            path: '/api/import-export/export/complete',
            method: 'GET',
            description: 'Export COMPLET en Excel avec formatage professionnel',
          },
          csv_complet: {
            path: '/api/import-export/export/complete/csv',
            method: 'GET',
            description: 'Export COMPLET en CSV avec streaming optimisé',
          },
        },
      },
      export_limite: {
        description: '🟢 Export limité à 5000 lignes (compatibilité)',
        routes: {
          excel: '/api/import-export/export',
          csv: '/api/import-export/export/csv',
          site: '/api/import-export/export/site?site=ADJAME',
        },
      },
      import: {
        description: '🟡 Importer des données',
        routes: {
          csv: {
            path: '/api/import-export/import/csv',
            method: 'POST',
            description: 'Import CSV avec validation',
            format: 'multipart/form-data',
          },
          smart: {
            path: '/api/import-export/import/smart-sync',
            method: 'POST',
            description: 'Import avec fusion intelligente (évite les doublons)',
          },
        },
      },
      utilitaires: {
        description: '⚪ Outils complémentaires',
        routes: {
          sites: '/api/import-export/sites',
          template: '/api/import-export/template',
          diagnostic: '/api/import-export/diagnostic',
          status: '/api/import-export/status',
          health: '/api/import-export/health',
          test: '/api/import-export/test',
        },
      },
    },
    conseils_pratiques: [
      {
        situation: 'Moins de 5,000 cartes',
        conseil: 'Utilisez /export ou /export/csv',
      },
      {
        situation: 'Entre 5,000 et 50,000 cartes',
        conseil: 'Utilisez /export/all ou /export/complete/csv',
      },
      {
        situation: 'Plus de 50,000 cartes',
        conseil: 'Utilisez /export/complete/csv (streaming optimisé)',
      },
      {
        situation: 'Import avec doublons',
        conseil: 'Utilisez /import/smart-sync pour la fusion intelligente',
      },
    ],
    performance: {
      max_export_rows: '1,000,000',
      max_file_size: '100MB',
      concurrent_exports: 3,
      traitement_par_lots: '10,000 lignes par lot',
      streaming: 'Oui (CSV)',
    },
  });
});

module.exports = router;


// ========== routes\Inventaire.js ==========
const express = require('express');
const router = express.Router();
const inventaireController = // require modifié - fichier consolidé;
const { verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const INVENTAIRE_CONFIG = {
  // Rate limiting spécifique à l'inventaire
  rateLimits: {
    search: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 recherches par minute
      message: {
        success: false,
        error: 'Trop de recherches',
        message: 'Veuillez ralentir vos recherches',
        code: 'SEARCH_RATE_LIMIT',
      },
    }),

    stats: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 requêtes de stats par minute
      message: {
        success: false,
        error: 'Trop de requêtes de statistiques',
        code: 'STATS_RATE_LIMIT',
      },
    }),

    export: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 exports par 15 minutes
      message: {
        success: false,
        error: "Trop d'exports",
        message: "Limite d'exports atteinte, réessayez dans 15 minutes",
        code: 'EXPORT_RATE_LIMIT',
      },
    }),

    admin: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 10, // 10 requêtes admin par minute
      message: {
        success: false,
        error: 'Trop de requêtes admin',
        code: 'ADMIN_RATE_LIMIT',
      },
    }),
  },

  // Cache control
  cacheControl: {
    search: 'private, max-age=10', // 10 secondes
    stats: 'private, max-age=300', // 5 minutes
    sites: 'public, max-age=3600', // 1 heure
    export: 'private, no-cache',
    diagnostic: 'private, no-cache',
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifierToken);

// Ajouter les infos de rôle à la requête
router.use(role.ajouterInfosRole);

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = INVENTAIRE_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique à l'inventaire
router.use((req, res, next) => {
  console.log(
    `📦 [Inventaire] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur} (${req.user?.role}) - Coordination: ${req.user?.coordination || 'Aucune'}`
  );
  next();
});

/**
 * Middleware pour vérifier que l'utilisateur est administrateur
 */
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'Administrateur') {
    return res.status(403).json({
      success: false,
      error: 'Accès réservé aux administrateurs',
      code: 'ADMIN_ONLY',
    });
  }
  next();
};

// ============================================
// ROUTES DE RECHERCHE
// ============================================

/**
 * 🔍 Recherche multicritères avancée
 * GET /api/inventaire/recherche
 * Accessible à tous les rôles (Admin, Gestionnaire, Chef d'équipe, Opérateur)
 */
router.get(
  '/recherche',
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search,
  inventaireController.rechercheCartes
);

/**
 * 🔍 Recherche rapide (barre de recherche globale)
 * GET /api/inventaire/recherche-rapide
 * Accessible à tous les rôles
 */
router.get(
  '/recherche-rapide',
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search,
  inventaireController.rechercheRapide
);

// ============================================
// ROUTES DE STATISTIQUES
// ============================================

/**
 * 📊 Statistiques globales de l'inventaire
 * GET /api/inventaire/stats
 * Accessible selon le rôle (Admin: tout, Gestionnaire: sa coordination)
 */
router.get(
  '/stats',
  role.peutAccederPage('inventaire'), // Le contrôleur applique le filtre
  INVENTAIRE_CONFIG.rateLimits.stats,
  inventaireController.getStatistiques
);

/**
 * 📊 Rafraîchir le cache des statistiques
 * POST /api/inventaire/cache/refresh
 * Accessible uniquement aux administrateurs
 */
router.post(
  '/cache/refresh',
  requireAdmin,
  INVENTAIRE_CONFIG.rateLimits.admin,
  inventaireController.refreshCache
);

// ============================================
// ROUTES DE GESTION DES SITES
// ============================================

/**
 * 📋 Liste de tous les sites
 * GET /api/inventaire/sites
 * Accessible à tous les rôles (filtré par coordination pour Gestionnaires/Chefs)
 */
router.get(
  '/sites',
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search,
  inventaireController.getSites
);

/**
 * 🎯 Cartes par site avec pagination
 * GET /api/inventaire/site/:site
 * Accessible à tous les rôles (filtré par coordination)
 */
router.get(
  '/site/:site',
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search,
  inventaireController.getCartesParSite
);

/**
 * 📊 Statistiques détaillées par site
 * GET /api/inventaire/site/:site/stats
 * Accessible selon le rôle (filtré par coordination)
 */
router.get(
  '/site/:site/stats',
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.stats,
  inventaireController.getSiteStats
);

// ============================================
// ROUTES D'EXPORT
// ============================================

/**
 * 📤 Exporter les résultats de recherche
 * GET /api/inventaire/export
 * Accessible uniquement aux Admins et Gestionnaires (via importExportController)
 */
router.get(
  '/export',
  role.peutImporterExporter,
  INVENTAIRE_CONFIG.rateLimits.export,
  async (req, res) => {
    try {
      // Rediriger vers le contrôleur d'export avec les mêmes filtres
      req.query.export_all = 'true';
      await inventaireController.rechercheCartes(req, res);
    } catch (error) {
      console.error('❌ Erreur export inventaire:', error);
      res.status(500).json({
        success: false,
        error: "Erreur lors de l'export",
        details: error.message,
      });
    }
  }
);

// ============================================
// ROUTES DE DIAGNOSTIC
// ============================================

/**
 * 🔧 Diagnostic du module inventaire
 * GET /api/inventaire/diagnostic
 * Accessible uniquement aux administrateurs
 */
router.get(
  '/diagnostic',
  requireAdmin,
  INVENTAIRE_CONFIG.rateLimits.admin,
  inventaireController.diagnostic
);

/**
 * 📊 Obtenir les types de filtres disponibles
 * GET /api/inventaire/filtres
 * Accessible à tous les rôles
 */
router.get(
  '/filtres',
  role.peutAccederPage('inventaire'),
  INVENTAIRE_CONFIG.rateLimits.search,
  (req, res) => {
    res.json({
      success: true,
      filtres_disponibles: [
        { nom: 'nom', type: 'string', description: 'Nom du bénéficiaire' },
        { nom: 'prenom', type: 'string', description: 'Prénom du bénéficiaire' },
        { nom: 'contact', type: 'string', description: 'Numéro de téléphone' },
        { nom: 'siteRetrait', type: 'string', description: 'Site de retrait' },
        { nom: 'lieuNaissance', type: 'string', description: 'Lieu de naissance' },
        { nom: 'dateNaissance', type: 'date', description: 'Date de naissance (YYYY-MM-DD)' },
        { nom: 'rangement', type: 'string', description: 'Code de rangement' },
        { nom: 'delivrance', type: 'string', description: 'Statut de délivrance (OUI/NON)' },
        { nom: 'dateDebut', type: 'date', description: 'Date début pour filtre temporel' },
        { nom: 'dateFin', type: 'date', description: 'Date fin pour filtre temporel' },
      ],
      pagination: {
        page: 'Numéro de page (défaut: 1)',
        limit: 'Nombre de résultats par page (défaut: 50, max: 10000)',
        export_all: 'true pour exporter toutes les données sans pagination',
      },
      roles_autorises: {
        administrateur: 'Accès complet à toutes les données',
        gestionnaire: 'Accès limité à sa coordination',
        chef_equipe: 'Accès limité à sa coordination (lecture seule)',
        operateur: 'Accès limité à sa coordination (lecture seule)',
      },
      exemples: {
        recherche_simple: '/api/inventaire/recherche?nom=KOUAME&prenom=Jean',
        recherche_avancee: '/api/inventaire/recherche?siteRetrait=ADJAME&delivrance=OUI&limit=100',
        export: '/api/inventaire/export?nom=KOUAME&export_all=true',
      },
      timestamp: new Date().toISOString(),
    });
  }
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  const roleInfo = req.user
    ? `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - Coordination: ${req.user.coordination || 'Aucune'}`
    : 'Non authentifié';

  res.json({
    name: 'API Inventaire GESCARD',
    description: "Module de gestion et recherche d'inventaire",
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    roles_autorises: {
      administrateur: 'Accès complet à toutes les données',
      gestionnaire: 'Accès limité à sa coordination',
      chef_equipe: 'Accès limité à sa coordination (lecture seule)',
      operateur: 'Accès limité à sa coordination (lecture seule)',
    },
    endpoints: {
      recherche: {
        'GET /recherche': 'Recherche multicritères avec pagination',
        'GET /recherche-rapide': 'Recherche rapide (barre de recherche)',
        'GET /export': 'Exporter les résultats de recherche',
      },
      statistiques: {
        'GET /stats': 'Statistiques globales (filtrées par rôle)',
        'POST /cache/refresh': 'Rafraîchir le cache des stats (Admin)',
      },
      sites: {
        'GET /sites': 'Liste des sites (filtrée par rôle)',
        'GET /site/:site': 'Cartes par site avec pagination (filtrée par rôle)',
        'GET /site/:site/stats': 'Statistiques détaillées par site',
      },
      utilitaires: {
        'GET /diagnostic': 'Diagnostic du module (Admin)',
        'GET /filtres': 'Liste des filtres disponibles',
      },
    },
    filtres_disponibles: [
      'nom',
      'prenom',
      'contact',
      'siteRetrait',
      'lieuNaissance',
      'dateNaissance',
      'rangement',
      'delivrance',
      'dateDebut',
      'dateFin',
    ],
    pagination: {
      page: 'Numéro de page',
      limit: 'Nombre de résultats (max 10000)',
      export_all: 'Mode export (ignore la pagination)',
    },
    rate_limits: {
      recherche: '30 requêtes par minute',
      stats: '20 requêtes par minute',
      export: '10 exports par 15 minutes',
      admin: '10 requêtes admin par minute',
    },
    exemples: {
      curl_recherche:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/inventaire/recherche?nom=KOUAME&page=1&limit=50"',
      curl_site:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/inventaire/site/ADJAME"',
      curl_stats:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/inventaire/stats"',
    },
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API inventaire`,
    available_routes: [
      'GET /api/inventaire/',
      'GET /api/inventaire/recherche',
      'GET /api/inventaire/recherche-rapide',
      'GET /api/inventaire/stats',
      'GET /api/inventaire/sites',
      'GET /api/inventaire/site/:site',
      'GET /api/inventaire/site/:site/stats',
      'GET /api/inventaire/export',
      'GET /api/inventaire/diagnostic',
      'GET /api/inventaire/filtres',
      'POST /api/inventaire/cache/refresh',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;


// ========== routes\Updatesroutes.js ==========
// routes/updatesRoutes.js

const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { verifierToken } = // require modifié - fichier consolidé;
const ctrl = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION MULTER (upload .exe)
// ============================================
const UPLOAD_TMP = '/tmp/gescard_uploads';
if (!fs.existsSync(UPLOAD_TMP)) fs.mkdirSync(UPLOAD_TMP, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_TMP),
  filename: (req, file, cb) => {
    const ts = Date.now();
    cb(null, `upload_${ts}_${file.originalname}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB max
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() !== '.exe') {
      return cb(new Error('Seuls les fichiers .exe sont acceptés'));
    }
    cb(null, true);
  },
});

// ============================================
// LOGGING
// ============================================
router.use((req, res, next) => {
  console.log(`🔄 [Updates] ${req.method} ${req.path} - ip=${req.ip}`);
  next();
});

// ============================================
// ROUTES PUBLIQUES (appelées par le logiciel)
// ============================================

/**
 * Vérifier si une mise à jour est disponible
 * GET /api/updates/check?version=1.0.0
 * Utilisé par le logiciel au démarrage
 */
router.get('/check', ctrl.checkVersion);

/**
 * Infos sur la dernière version publiée
 * GET /api/updates/latest
 */
router.get('/latest', ctrl.getLatest);

/**
 * Télécharger le fichier .exe (pas de token requis — URL directe)
 * GET /api/updates/download
 */
router.get('/download', ctrl.downloadExe);

// ============================================
// ROUTES AUTHENTIFIÉES (Admin)
// ============================================
router.use(verifierToken);

/**
 * Publier une nouvelle version
 * POST /api/updates/publish
 * Body: multipart/form-data { file(.exe), version, release_notes, mandatory }
 * Accès: Administrateur uniquement
 */
router.post('/publish', upload.single('file'), ctrl.publishVersion);

/**
 * Historique des versions disponibles
 * GET /api/updates/history
 * Accès: Administrateur uniquement
 */
router.get('/history', ctrl.getHistory);

/**
 * Supprimer une ancienne version
 * DELETE /api/updates/:version
 * Accès: Administrateur uniquement
 */
router.delete('/:version', ctrl.deleteVersion);

/**
 * Diagnostic du système de mises à jour
 * GET /api/updates/diagnostic
 */
router.get('/diagnostic', ctrl.diagnostic);

/**
 * Documentation
 * GET /api/updates
 */
router.get('/', (req, res) => {
  res.json({
    name: 'API Updates GESCARD',
    version: '1.0.0',
    endpoints: {
      publics: {
        'GET /api/updates/check?version=X.X.X': 'Vérifier si mise à jour disponible',
        'GET /api/updates/latest': 'Infos dernière version',
        'GET /api/updates/download': 'Télécharger le .exe',
      },
      admin: {
        'POST /api/updates/publish': 'Publier nouvelle version (.exe + version + notes)',
        'GET /api/updates/history': 'Historique des versions',
        'DELETE /api/updates/:version': 'Supprimer une version',
        'GET /api/updates/diagnostic': 'Diagnostic',
      },
    },
    exemple_check: 'GET /api/updates/check?version=1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// Gestion erreur multer
router.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res
      .status(413)
      .json({ success: false, message: 'Fichier trop volumineux (max 500 MB)' });
  }
  if (err.message && err.message.includes('.exe')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;


// ========== routes\authRoutes.js ==========
// routes/authRoutes.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');
const rateLimit = require('express-rate-limit');

// IMPORT DU CONTROLLER
const authController = // require modifié - fichier consolidé;

// IMPORT DU MIDDLEWARE
const { verifyToken } = // require modifié - fichier consolidé;

// Vérification du middleware
if (typeof verifyToken !== 'function') {
  console.error("❌ ERREUR: verifyToken n'est pas une fonction!");
  console.error('Vérifiez que le middleware/auth.js exporte bien verifyToken');
  process.exit(1);
} else {
  console.log('✅ Middleware verifyToken chargé avec succès');
}

// Vérification du contrôleur
if (!authController) {
  console.error('❌ ERREUR: authController est undefined');
  process.exit(1);
}

console.log('📦 Contrôleur chargé, fonctions disponibles:', Object.keys(authController));

// Destructuration du contrôleur
const {
  loginUser,
  logoutUser,
  verifyToken: verifyTokenController,
  refreshToken,
  forgotPassword,
  resetPassword,
} = authController;

// Vérification des fonctions du contrôleur
const controllerFunctions = {
  loginUser,
  logoutUser,
  verifyTokenController,
  refreshToken,
  forgotPassword,
  resetPassword,
};

Object.entries(controllerFunctions).forEach(([name, func]) => {
  if (typeof func !== 'function') {
    console.error(`❌ ERREUR: ${name} n'est pas une fonction!`);
    process.exit(1);
  } else {
    console.log(`✅ ${name} est bien une fonction`);
  }
});

// Configuration
const AUTH_CONFIG = {
  loginLimiter: rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // 10 tentatives max
    skipSuccessfulRequests: true,
    message: {
      success: false,
      error: 'Trop de tentatives de connexion',
      message: 'Veuillez réessayer dans 15 minutes',
      code: 'RATE_LIMIT_EXCEEDED',
    },
  }),

  validations: {
    login: [
      body('NomUtilisateur')
        .trim()
        .notEmpty()
        .withMessage("Nom d'utilisateur requis")
        .isLength({ min: 3, max: 50 })
        .withMessage("Le nom d'utilisateur doit contenir 3-50 caractères")
        .matches(/^[a-zA-Z0-9._-]+$/)
        .withMessage('Caractères autorisés: lettres, chiffres, . _ -'),

      body('MotDePasse')
        .notEmpty()
        .withMessage('Mot de passe requis')
        .isLength({ min: 6 })
        .withMessage('Le mot de passe doit contenir au moins 6 caractères'),
    ],
  },
};

// Middleware de validation
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Erreur de validation',
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
      code: 'VALIDATION_ERROR',
    });
  }
  next();
};

console.log('🚀 Définition des routes...');

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * Connexion utilisateur
 * POST /api/auth/login
 */
console.log('   → Définition POST /login');
router.post(
  '/login',
  AUTH_CONFIG.loginLimiter,
  AUTH_CONFIG.validations.login,
  validate,
  async (req, res) => {
    try {
      req.loginAttempt = {
        timestamp: new Date().toISOString(),
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      };
      await loginUser(req, res);
    } catch (error) {
      console.error('❌ Erreur route login:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        message: 'Une erreur est survenue lors de la connexion',
        code: 'SERVER_ERROR',
      });
    }
  }
);

/**
 * Mot de passe oublié
 * POST /api/auth/forgot-password
 */
console.log('   → Définition POST /forgot-password');
router.post('/forgot-password', async (req, res) => {
  try {
    await forgotPassword(req, res);
  } catch (error) {
    console.error('❌ Erreur route forgot-password:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * Réinitialisation mot de passe
 * POST /api/auth/reset-password
 */
console.log('   → Définition POST /reset-password');
router.post('/reset-password', async (req, res) => {
  try {
    await resetPassword(req, res);
  } catch (error) {
    console.error('❌ Erreur route reset-password:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

// ============================================
// ROUTES PROTÉGÉES (NÉCESSITENT UN TOKEN)
// ============================================

/**
 * Déconnexion
 * POST /api/auth/logout
 */
console.log('   → Définition POST /logout');
router.post('/logout', verifyToken, async (req, res) => {
  try {
    await logoutUser(req, res);
  } catch (error) {
    console.error('❌ Erreur route logout:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * Vérification du token
 * GET /api/auth/verify
 */
console.log('   → Définition GET /verify');
router.get('/verify', verifyToken, async (req, res) => {
  try {
    await verifyTokenController(req, res);
  } catch (error) {
    console.error('❌ Erreur route verify:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

/**
 * Rafraîchissement du token
 * POST /api/auth/refresh
 */
console.log('   → Définition POST /refresh');
router.post('/refresh', verifyToken, async (req, res) => {
  try {
    await refreshToken(req, res);
  } catch (error) {
    console.error('❌ Erreur route refresh:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'SERVER_ERROR',
    });
  }
});

// ============================================
// ROUTES DE DIAGNOSTIC (mode développement uniquement)
// ============================================
if (process.env.NODE_ENV !== 'production') {
  console.log('   → Définition GET /test (mode dev)');
  router.get('/test', (req, res) => {
    res.json({
      success: true,
      message: "Routes d'authentification fonctionnelles",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      roles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
      availableEndpoints: [
        'POST /login',
        'POST /logout',
        'GET /verify',
        'POST /refresh',
        'POST /forgot-password',
        'POST /reset-password',
      ],
    });
  });
}

// ============================================
// GESTION 404
// ============================================
console.log('   → Définition middleware 404');
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas`,
    availableRoutes: [
      'POST /api/auth/login',
      'POST /api/auth/logout',
      'GET /api/auth/verify',
      'POST /api/auth/refresh',
      'POST /api/auth/forgot-password',
      'POST /api/auth/reset-password',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

console.log('✅ Toutes les routes ont été définies avec succès!');
console.log('📊 Nombre total de routes:', router.stack.length);

module.exports = router;


// ========== routes\backupRoutes.js ==========
const express = require('express');
const router = express.Router();
const { Client } = require('pg');
const PostgreSQLBackup = // require modifié - fichier consolidé;
const PostgreSQLRestorer = // require modifié - fichier consolidé;

// ============================================
// CONFIGURATION OPTIMISÉE POUR VPS
// ============================================
const BACKUP_CONFIG = {
  // Authentification
  adminRoles: ['Administrateur', 'admin', 'superadmin'],
  allowedRoles: ['Administrateur', 'Superviseur', 'admin', 'superadmin', 'superviseur'],

  // Google Drive
  folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || '1EDj5fNR27ZcJ6txXcUYFOhmnn8WdzbWP',
  folderName: process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups',

  // Backups
  maxBackupAge: 90 * 24 * 60 * 60 * 1000, // 90 jours
  autoBackupHour: 2, // 2h du matin
  compressionLevel: 9, // Niveau max

  // Rate limiting
  maxBackupsPerDay: 20, // Augmenté pour VPS
  backupCooldown: 2 * 60 * 1000, // 2 minutes entre backups (VPS)
  lastBackupTime: null,
  backupCountToday: 0,
  lastBackupDate: null,
};

// ============================================
// INITIALISATION DES SERVICES
// ============================================
let backupService = null;
let restoreService = null;

try {
  backupService = new PostgreSQLBackup();
  restoreService = new PostgreSQLRestorer();
  console.log('✅ Services de backup initialisés pour VPS');
} catch (error) {
  console.error('❌ Erreur initialisation services backup:', error);
}

// ============================================
// MIDDLEWARES D'AUTHENTIFICATION
// ============================================

/**
 * Authentification simple (pour compatibilité)
 */
const authenticate = (req, res, next) => {
  // Si l'utilisateur est déjà dans req.user (via JWT)
  if (req.user) {
    return next();
  }

  // Vérifier le token API
  const apiToken = req.headers['x-api-token'] || req.query.api_token;
  const validTokens = (process.env.API_TOKENS || '').split(',').map((t) => t.trim());

  if (apiToken && validTokens.includes(apiToken)) {
    req.user = {
      id: 'api-user',
      nomUtilisateur: 'api-backup',
      profil: 'admin',
      role: 'Administrateur',
    };
    return next();
  }

  // Pour les tests en développement
  if (process.env.NODE_ENV !== 'production' && req.query.test === 'true') {
    req.user = {
      id: 'test-user',
      nomUtilisateur: 'test-backup',
      profil: 'admin',
      role: 'Administrateur',
    };
    return next();
  }

  return res.status(401).json({
    success: false,
    message: 'Authentification requise',
    code: 'UNAUTHENTICATED',
  });
};

/**
 * Vérification des droits admin
 */
const requireAdmin = (req, res, next) => {
  const userRole = (req.user?.role || req.user?.profil || '').toLowerCase();
  const isAdmin = BACKUP_CONFIG.adminRoles.some((role) => userRole.includes(role.toLowerCase()));

  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Action réservée aux administrateurs',
      requiredRoles: BACKUP_CONFIG.adminRoles,
      yourRole: req.user?.role || req.user?.profil,
      code: 'FORBIDDEN_ADMIN_ONLY',
    });
  }

  next();
};

/**
 * Rate limiting pour les backups (adapté VPS)
 */
const backupRateLimit = (req, res, next) => {
  const now = new Date();
  const today = now.toDateString();

  // Réinitialiser le compteur si changement de jour
  if (BACKUP_CONFIG.lastBackupDate !== today) {
    BACKUP_CONFIG.backupCountToday = 0;
    BACKUP_CONFIG.lastBackupDate = today;
  }

  // Vérifier le cooldown (plus court sur VPS)
  if (
    BACKUP_CONFIG.lastBackupTime &&
    now - BACKUP_CONFIG.lastBackupTime < BACKUP_CONFIG.backupCooldown
  ) {
    const waitTime = Math.ceil(
      (BACKUP_CONFIG.backupCooldown - (now - BACKUP_CONFIG.lastBackupTime)) / 1000
    );
    return res.status(429).json({
      success: false,
      message: 'Trop de backups rapprochés',
      retryAfter: waitTime,
      code: 'BACKUP_COOLDOWN',
    });
  }

  // Vérifier la limite quotidienne (augmentée pour VPS)
  if (BACKUP_CONFIG.backupCountToday >= BACKUP_CONFIG.maxBackupsPerDay) {
    return res.status(429).json({
      success: false,
      message: `Limite quotidienne atteinte (${BACKUP_CONFIG.maxBackupsPerDay})`,
      code: 'BACKUP_DAILY_LIMIT',
    });
  }

  next();
};

// ============================================
// MIDDLEWARE DE VALIDATION
// ============================================

/**
 * Vérifie que les services sont initialisés
 */
const checkServices = (req, res, next) => {
  if (!backupService || !restoreService) {
    return res.status(500).json({
      success: false,
      message: 'Services de backup non disponibles',
      error: 'Vérifiez la configuration Google Drive',
      code: 'BACKUP_SERVICE_UNAVAILABLE',
    });
  }
  next();
};

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * 1. Créer un backup manuel
 * POST /api/backup/create
 */
router.post('/create', authenticate, backupRateLimit, checkServices, async (req, res) => {
  try {
    console.log('📤 Backup manuel demandé par:', req.user.nomUtilisateur);

    const backupResult = await backupService.executeBackup();

    // Mettre à jour les statistiques
    BACKUP_CONFIG.lastBackupTime = new Date();
    BACKUP_CONFIG.backupCountToday++;

    res.json({
      success: true,
      message: 'Backup créé avec succès',
      backup: {
        id: backupResult.id,
        name: backupResult.name,
        link: backupResult.webViewLink,
        size: backupResult.size ? `${Math.round(backupResult.size / 1024 / 1024)} MB` : 'N/A',
        created: new Date().toISOString(),
      },
      stats: {
        backupsToday: BACKUP_CONFIG.backupCountToday,
        remainingToday: BACKUP_CONFIG.maxBackupsPerDay - BACKUP_CONFIG.backupCountToday,
      },
      location: {
        folder: BACKUP_CONFIG.folderName,
        folderId: BACKUP_CONFIG.folderId,
        service: 'Google Drive',
      },
      schedule: {
        nextAutoBackup: `Today at ${BACKUP_CONFIG.autoBackupHour}:00 UTC`,
        autoRestore: process.env.AUTO_RESTORE === 'true',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur backup:', error);

    const errorResponse = {
      success: false,
      message: 'Erreur lors de la création du backup',
      error: error.message,
      code: 'BACKUP_CREATION_FAILED',
    };

    if (error.message.includes('Google')) {
      errorResponse.advice = 'Vérifiez la configuration Google Drive (tokens, permissions)';
      errorResponse.documentation = '/api/backup/test';
    }

    res.status(500).json(errorResponse);
  }
});

/**
 * 2. Restaurer la base de données
 * POST /api/backup/restore
 */
router.post('/restore', authenticate, requireAdmin, checkServices, async (req, res) => {
  try {
    const { backupId } = req.body;

    console.log('🔄 Restauration demandée par:', req.user.nomUtilisateur);

    if (backupId) {
      await restoreService.restoreFromId(backupId);
    } else {
      await restoreService.executeRestoration();
    }

    res.json({
      success: true,
      message: 'Base de données restaurée avec succès',
      restoredFrom: backupId ? 'backup spécifique' : 'dernier backup disponible',
      timestamp: new Date().toISOString(),
      warning: "La restauration a été effectuée. Veuillez vérifier l'intégrité des données.",
    });
  } catch (error) {
    console.error('❌ Erreur restauration:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'RESTORE_FAILED',
    });
  }
});

/**
 * 3. Lister les backups disponibles
 * GET /api/backup/list
 */
router.get('/list', authenticate, checkServices, async (req, res) => {
  try {
    const { limit = 50, sort = 'desc' } = req.query;

    const backups = await backupService.listBackups();

    // Trier
    const sortedBackups = [...backups].sort((a, b) => {
      const dateA = new Date(a.createdISO);
      const dateB = new Date(b.createdISO);
      return sort === 'desc' ? dateB - dateA : dateA - dateB;
    });

    // Limiter
    const limitedBackups = sortedBackups.slice(0, parseInt(limit));

    // Statistiques
    const totalSize = backups.reduce((acc, b) => acc + (b.sizeBytes || 0), 0);
    const oldestBackup =
      backups.length > 0 ? new Date(Math.min(...backups.map((b) => new Date(b.createdISO)))) : null;

    res.json({
      success: true,
      count: backups.length,
      displayed: limitedBackups.length,
      message:
        backups.length > 0 ? `${backups.length} backup(s) disponible(s)` : 'Aucun backup trouvé',
      statistics: {
        totalSize: totalSize ? `${Math.round(totalSize / 1024 / 1024)} MB` : 'N/A',
        oldestBackup: oldestBackup?.toLocaleString('fr-FR'),
        newestBackup:
          backups.length > 0 ? new Date(backups[0].createdISO).toLocaleString('fr-FR') : null,
        averageSize:
          backups.length > 0 ? `${Math.round(totalSize / backups.length / 1024 / 1024)} MB` : 'N/A',
      },
      backups: limitedBackups.map((backup) => ({
        id: backup.id,
        name: backup.name,
        created: backup.created,
        createdISO: backup.createdISO,
        size: backup.size,
        sizeBytes: backup.sizeBytes,
        type: backup.type,
        mimeType: backup.mimeType,
        viewLink: backup.link,
        downloadLink: backup.downloadLink,
        directLink: `https://drive.google.com/uc?export=download&id=${backup.id}`,
      })),
      storage: {
        folderName: BACKUP_CONFIG.folderName,
        folderId: BACKUP_CONFIG.folderId,
        service: 'Google Drive',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur liste backups:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des backups',
      error: error.message,
      code: 'BACKUP_LIST_FAILED',
    });
  }
});

/**
 * 4. Vérifier l'état du backup
 * GET /api/backup/status
 */
router.get('/status', authenticate, async (req, res) => {
  try {
    const hasBackups = backupService ? await backupService.hasBackups() : false;

    // Connexion DB pour statistiques
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    await client.connect();
    const countResult = await client.query('SELECT COUNT(*) as total FROM cartes');
    const totalCartes = parseInt(countResult.rows[0].total);

    // Récupérer la taille de la DB
    const sizeResult = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    const dbSize = sizeResult.rows[0].size;

    await client.end();

    const googleDriveConfigured = !!(
      process.env.GOOGLE_CLIENT_ID &&
      process.env.GOOGLE_CLIENT_SECRET &&
      process.env.GOOGLE_REFRESH_TOKEN
    );

    const now = new Date();
    const nextBackup = new Date(now);
    nextBackup.setUTCHours(BACKUP_CONFIG.autoBackupHour, 0, 0, 0);
    if (now > nextBackup) {
      nextBackup.setDate(nextBackup.getDate() + 1);
    }

    res.json({
      success: true,
      status: hasBackups ? 'operational' : 'no_backups',
      healthy: hasBackups && googleDriveConfigured,
      message: hasBackups
        ? '✅ Système de backup opérationnel'
        : '⚠️ Aucun backup trouvé - Créez-en un',

      database: {
        total_cartes: totalCartes,
        size: dbSize,
        connection: 'OK',
      },

      backup_system: {
        configured: googleDriveConfigured,
        available: hasBackups,
        auto_backup: `daily at ${BACKUP_CONFIG.autoBackupHour}:00 UTC`,
        auto_restore: process.env.AUTO_RESTORE === 'true',
        last_backup: BACKUP_CONFIG.lastBackupTime?.toLocaleString('fr-FR') || null,
        backups_today: BACKUP_CONFIG.backupCountToday,
        remaining_today: BACKUP_CONFIG.maxBackupsPerDay - BACKUP_CONFIG.backupCountToday,
        next_scheduled: nextBackup.toISOString(),
      },

      google_drive: {
        configured: googleDriveConfigured,
        folder: BACKUP_CONFIG.folderName,
        folder_id: BACKUP_CONFIG.folderId,
        test_endpoint: '/api/backup/test',
      },

      endpoints: {
        create: 'POST /api/backup/create',
        list: 'GET /api/backup/list',
        restore: 'POST /api/backup/restore (admin)',
        download: '/api/backup/download/:id',
        status: 'GET /api/backup/status',
        info: 'GET /api/backup/info',
        test: 'GET /api/backup/test',
      },

      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur status:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Erreur lors de la vérification',
      error: error.message,
      code: 'STATUS_CHECK_FAILED',
    });
  }
});

/**
 * 5. Télécharger un backup (lien)
 * POST /api/backup/download
 */
router.post('/download', authenticate, async (req, res) => {
  try {
    const { backupId } = req.body;

    if (!backupId) {
      return res.status(400).json({
        success: false,
        message: 'ID du backup requis',
        code: 'MISSING_BACKUP_ID',
      });
    }

    res.json({
      success: true,
      message: 'Liens de téléchargement générés',
      backupId,
      links: {
        direct: `/api/backup/download/${backupId}`,
        google_drive: `https://drive.google.com/uc?export=download&id=${backupId}`,
        view: `https://drive.google.com/file/d/${backupId}/view`,
      },
      instructions: [
        'Pour télécharger directement, utilisez: GET /api/backup/download/:id',
        'Le lien Google Drive est également accessible',
        'Les backups sont conservés indéfiniment',
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur génération liens:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération des liens',
      error: error.message,
    });
  }
});

/**
 * 6. Télécharger un backup par ID (redirection directe)
 * GET /api/backup/download/:backupId
 */
router.get('/download/:backupId', async (req, res) => {
  try {
    const { backupId } = req.params;

    if (!backupId) {
      return res.status(400).json({
        success: false,
        message: 'ID du backup requis',
      });
    }

    console.log(`📥 Téléchargement backup: ${backupId}`);
    res.redirect(`https://drive.google.com/uc?export=download&id=${backupId}`);
  } catch (error) {
    console.error('❌ Erreur redirection:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur de redirection',
      error: error.message,
    });
  }
});

/**
 * 7. Synchronisation pour application desktop
 * POST /api/backup/sync/local-export
 */
router.post('/sync/local-export', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, client_version, platform } = req.body;

    console.log(
      `📨 Sync depuis application desktop v${client_version || 'unknown'} (${platform || 'unknown'})`
    );

    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Données de synchronisation invalides',
        code: 'INVALID_SYNC_DATA',
      });
    }

    // Statistiques
    const stats = {};
    for (const [table, rows] of Object.entries(data)) {
      stats[table] = Array.isArray(rows) ? rows.length : 0;
    }

    // Créer un backup après réception des données
    let backupResult = null;
    if (backupService) {
      backupResult = await backupService.executeBackup();
    }

    res.json({
      success: true,
      message: 'Données synchronisées avec succès',
      received: stats,
      total_tables: Object.keys(data).length,
      total_rows: Object.values(stats).reduce((a, b) => a + b, 0),
      last_sync: new Date().toISOString(),
      backup_created: !!backupResult,
      backup_id: backupResult?.id,
      server_version: '1.0.0',
      next_sync_recommendation: '24h',
    });
  } catch (error) {
    console.error('❌ Erreur sync:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 8. Récupérer les données pour application desktop
 * GET /api/backup/sync/get-data
 */
router.get('/sync/get-data', authenticate, requireAdmin, async (req, res) => {
  try {
    const { tables, format = 'json' } = req.query;
    const requestedTables = tables ? tables.split(',') : ['cartes', 'utilisateurs', 'journal'];

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    await client.connect();

    // Exporter les tables demandées
    const exportData = {};
    const rowCounts = {};

    for (const table of requestedTables) {
      try {
        const result = await client.query(`SELECT * FROM "${table}"`);
        exportData[table] = result.rows;
        rowCounts[table] = result.rows.length;
      } catch (err) {
        console.warn(`⚠️ Table ${table} non accessible:`, err.message);
        exportData[table] = [];
        rowCounts[table] = 0;
      }
    }

    await client.end();

    const totalRows = Object.values(rowCounts).reduce((a, b) => a + b, 0);

    // Format de réponse
    const response = {
      success: true,
      data: exportData,
      metadata: {
        generated: new Date().toISOString(),
        server_version: '1.0.0',
        tables_exported: requestedTables,
        row_counts: rowCounts,
        total_rows: totalRows,
        database_url: process.env.DATABASE_URL ? 'configured' : 'missing',
      },
    };

    if (format === 'pretty') {
      res.json(response);
    } else {
      // Format compact pour performance
      res.json({
        success: true,
        data: exportData,
        _meta: {
          ts: Date.now(),
          rows: totalRows,
        },
      });
    }
  } catch (error) {
    console.error('❌ Erreur récupération données:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

/**
 * 9. Test de connexion Google Drive
 * GET /api/backup/test
 */
router.get('/test', async (req, res) => {
  try {
    console.log('🧪 Test Google Drive demandé');

    // Vérifier la configuration
    const config = {
      GOOGLE_CLIENT_ID: !!process.env.GOOGLE_CLIENT_ID,
      GOOGLE_CLIENT_SECRET: !!process.env.GOOGLE_CLIENT_SECRET,
      GOOGLE_REFRESH_TOKEN: !!process.env.GOOGLE_REFRESH_TOKEN,
      GOOGLE_REDIRECT_URI: !!process.env.GOOGLE_REDIRECT_URI,
      AUTO_RESTORE: process.env.AUTO_RESTORE,
    };

    const fullyConfigured = Object.values(config).every((v) => v === true || v === 'true');

    if (!fullyConfigured) {
      return res.json({
        success: false,
        message: 'Configuration Google Drive incomplète',
        config: {
          ...config,
          missing: Object.entries(config)
            .filter((entry) => !entry[1] || entry[1] === 'false')
            .map((entry) => entry[0]),
        },
        instructions: [
          '1. Obtenez des credentials Google Drive API',
          "2. Ajoutez les variables d'environnement",
          '3. Utilisez https://developers.google.com/oauthplayground pour obtenir refresh_token',
        ],
      });
    }

    if (!backupService) {
      return res.json({
        success: false,
        message: 'Service de backup non initialisé',
        error: 'Vérifiez les dépendances',
      });
    }

    // Tester l'authentification
    await backupService.authenticate();
    const folderId = await backupService.getOrCreateBackupFolder();

    // Lister les backups existants
    const backups = await backupService.listBackups();

    res.json({
      success: true,
      message: '✅ Google Drive fonctionnel !',
      google_drive: {
        authenticated: true,
        folder_id: folderId,
        folder_name: BACKUP_CONFIG.folderName,
        configured: true,
        backups_count: backups.length,
        last_backup: backups.length > 0 ? backups[0].createdISO : null,
      },
      config,
      environment: {
        node_env: process.env.NODE_ENV,
        auto_restore: process.env.AUTO_RESTORE === 'true',
      },
      endpoints: {
        create: 'POST /api/backup/create',
        list: 'GET /api/backup/list',
        status: 'GET /api/backup/status',
        info: 'GET /api/backup/info',
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Test Google Drive échoué:', error);

    const errorDetails = {
      success: false,
      message: '❌ Google Drive non fonctionnel',
      error: error.message,
      code: 'GOOGLE_DRIVE_TEST_FAILED',
      common_issues: [
        'Les tokens Google peuvent être expirés - régénérez-les',
        "L'API Google Drive doit être activée dans la console Google",
        'Vérifiez que le refresh_token a le scope drive.file',
        'Assurez-vous que le dossier existe ou est accessible',
      ],
    };

    if (error.message.includes('invalid_grant')) {
      errorDetails.advice =
        'Refresh_token invalide ou expiré. Régénérez-le sur https://developers.google.com/oauthplayground';
    } else if (error.message.includes('permission')) {
      errorDetails.advice = 'Permissions insuffisantes. Vérifiez les scopes OAuth.';
    }

    res.status(500).json(errorDetails);
  }
});

/**
 * 10. Information sur le système de backup
 * GET /api/backup/info
 */
router.get('/info', async (req, res) => {
  try {
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    await client.connect();

    // Statistiques DB
    const dbStats = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM cartes) as cartes,
        (SELECT COUNT(*) FROM utilisateurs) as utilisateurs,
        (SELECT COUNT(*) FROM journal) as journal,
        pg_database_size(current_database()) as db_size_bytes,
        pg_size_pretty(pg_database_size(current_database())) as db_size
    `);

    // Dernier import
    const lastImport = await client.query(`
      SELECT MAX(dateimport) as last_import FROM cartes
    `);

    await client.end();

    const stats = dbStats.rows[0];
    const googleDriveConfigured = !!(
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN
    );

    // Récupérer les infos des backups si disponibles
    let backupCount = 0;
    let backupStats = null;

    if (backupService) {
      try {
        const backups = await backupService.listBackups();
        backupCount = backups.length;

        if (backups.length > 0) {
          const sizes = backups.map((b) => b.sizeBytes || 0);
          backupStats = {
            total_backups: backups.length,
            total_size: `${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024)} MB`,
            newest: backups[0].created,
            oldest: backups[backups.length - 1].created,
          };
        }
      } catch (e) {
        console.warn('⚠️ Impossible de lister les backups:', e.message);
      }
    }

    res.json({
      success: true,
      system: 'GesCard Backup System',
      version: '2.0.0',
      status: googleDriveConfigured ? 'operational' : 'configuration_required',

      database: {
        total_cartes: parseInt(stats.cartes),
        total_utilisateurs: parseInt(stats.utilisateurs),
        total_journal: parseInt(stats.journal),
        size: stats.db_size,
        last_import: lastImport.rows[0]?.last_import || null,
        type: 'PostgreSQL',
      },

      backup_system: {
        google_drive: googleDriveConfigured ? '✅ Configured' : '❌ Not configured',
        auto_backup: 'daily at 02:00 UTC',
        auto_restore: process.env.AUTO_RESTORE === 'true' ? 'enabled' : 'disabled',
        storage: 'Google Drive',
        folder: BACKUP_CONFIG.folderName,
        backups_available: backupCount,
        ...backupStats,
      },

      configuration: {
        google_drive: {
          client_id: process.env.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Missing',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Missing',
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN ? '✅ Set' : '❌ Missing',
          redirect_uri: process.env.GOOGLE_REDIRECT_URI ? '✅ Set' : '❌ Missing',
          folder_id: BACKUP_CONFIG.folderId,
        },
        database: {
          url: process.env.DATABASE_URL ? '✅ Set' : '❌ Missing',
        },
        auto_restore: process.env.AUTO_RESTORE === 'true',
      },

      endpoints: {
        public: {
          create_backup: { method: 'POST', path: '/api/backup/create', auth: 'required' },
          list_backups: { method: 'GET', path: '/api/backup/list', auth: 'required' },
          backup_status: { method: 'GET', path: '/api/backup/status', auth: 'required' },
          backup_info: { method: 'GET', path: '/api/backup/info', auth: 'optional' },
          test_drive: { method: 'GET', path: '/api/backup/test', auth: 'none' },
          download_backup: { method: 'GET', path: '/api/backup/download/:id', auth: 'none' },
        },
        protected: {
          restore_backup: { method: 'POST', path: '/api/backup/restore', auth: 'admin_only' },
          sync_export: {
            method: 'POST',
            path: '/api/backup/sync/local-export',
            auth: 'admin_only',
          },
          sync_get_data: { method: 'GET', path: '/api/backup/sync/get-data', auth: 'admin_only' },
        },
      },

      quick_start: [
        '1. Testez la connexion: GET /api/backup/test',
        '2. Créez un backup: POST /api/backup/create',
        '3. Listez les backups: GET /api/backup/list',
        '4. Téléchargez: GET /api/backup/download/:id',
      ],

      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur info:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des informations',
      error: error.message,
    });
  }
});

/**
 * 11. Nettoyer les vieux backups (admin)
 * DELETE /api/backup/cleanup
 */
router.delete('/cleanup', authenticate, requireAdmin, async (req, res) => {
  try {
    const { olderThan = 90 } = req.query; // jours

    if (!backupService) {
      return res.status(500).json({
        success: false,
        message: 'Service de backup non disponible',
      });
    }

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThan);

    const deleted = await backupService.cleanupOldBackups(olderThan);

    res.json({
      success: true,
      message: `Nettoyage des backups terminé`,
      deleted_count: deleted,
      older_than: `${olderThan} jours`,
      cutoff_date: cutoffDate.toISOString(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur nettoyage:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
  }
});

module.exports = router;


// ========== routes\externalApi.js ==========
const express = require('express');
const router = express.Router();
const apiController = // require modifié - fichier consolidé;
const {
  authenticateAPI,
  logAPIAccess,
  validateApiParams,
  securityHeaders,
} = // require modifié - fichier consolidé;
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const API_CONFIG = {
  // Rate limiting spécifique à l'API externe
  rateLimits: {
    public: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 60, // 60 requêtes par minute
      message: {
        success: false,
        error: 'Rate limit atteint',
        message: "Trop de requêtes vers l'API externe",
        code: 'RATE_LIMIT_EXCEEDED',
      },
      standardHeaders: true,
      legacyHeaders: false,
    }),

    sync: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 20, // 20 sync par minute
      message: {
        success: false,
        error: 'Rate limit sync atteint',
        message: 'Trop de requêtes de synchronisation',
        code: 'SYNC_RATE_LIMIT_EXCEEDED',
      },
    }),

    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 100, // 100 requêtes par 15 min
      message: {
        success: false,
        error: 'Rate limit atteint',
        message: 'Trop de requêtes sensibles',
        code: 'SENSITIVE_RATE_LIMIT_EXCEEDED',
      },
    }),
  },

  // Cache pour les routes fréquentes
  cacheControl: {
    health: 'no-cache',
    cartes: 'private, max-age=60',
    stats: 'private, max-age=300',
    sites: 'public, max-age=3600',
    changes: 'private, max-age=60',
    'columns-config': 'public, max-age=3600',
    diagnostic: 'no-cache',
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware global pour l'API externe
router.use(securityHeaders);
router.use(logAPIAccess);
router.use(authenticateAPI);

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(`🌐 [API Externe] ${req.method} ${req.url} - IP: ${req.ip}`);
  next();
});

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = API_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// ============================================
// ROUTES PUBLIQUES (rate limiting modéré)
// ============================================

/**
 * 📊 Vérification de santé
 * GET /api/external/health
 */
router.get('/health', API_CONFIG.rateLimits.public, async (req, res) => {
  try {
    await apiController.healthCheck(req, res);
  } catch (error) {
    console.error('❌ Erreur health:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      code: 'HEALTH_CHECK_FAILED',
    });
  }
});

/**
 * 📋 Liste des sites disponibles
 * GET /api/external/sites
 */
router.get('/sites', API_CONFIG.rateLimits.public, validateApiParams, async (req, res) => {
  try {
    await apiController.getSites(req, res);
  } catch (error) {
    console.error('❌ Erreur sites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération sites',
      code: 'SITES_FETCH_FAILED',
    });
  }
});

/**
 * 🧪 Test CORS
 * GET /api/external/cors-test
 */
router.get('/cors-test', API_CONFIG.rateLimits.public, (req, res) => {
  res.json({
    success: true,
    message: 'API externe accessible via CORS',
    origin: req.headers.origin || 'undefined',
    timestamp: new Date().toISOString(),
    headers: {
      'access-control-allow-origin': req.headers.origin || '*',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'Content-Type, Authorization, X-API-Token',
    },
  });
});

// ============================================
// ROUTES DE DONNÉES (rate limiting standard)
// ============================================

/**
 * 📊 Récupérer les cartes avec filtres
 * GET /api/external/cartes
 */
router.get('/cartes', API_CONFIG.rateLimits.sensitive, validateApiParams, async (req, res) => {
  try {
    await apiController.getCartes(req, res);
  } catch (error) {
    console.error('❌ Erreur getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération cartes',
      code: 'CARTES_FETCH_FAILED',
    });
  }
});

/**
 * 📊 Statistiques
 * GET /api/external/stats
 */
router.get('/stats', API_CONFIG.rateLimits.public, validateApiParams, async (req, res) => {
  try {
    await apiController.getStats(req, res);
  } catch (error) {
    console.error('❌ Erreur getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération statistiques',
      code: 'STATS_FETCH_FAILED',
    });
  }
});

// ============================================
// ROUTES DE SYNCHRONISATION (rate limiting strict)
// ============================================

/**
 * 🔄 Récupérer les changements depuis une date
 * GET /api/external/changes
 */
router.get('/changes', API_CONFIG.rateLimits.sync, validateApiParams, async (req, res) => {
  try {
    // Ajouter des métadonnées
    req.syncRequest = {
      timestamp: new Date().toISOString(),
      clientIp: req.ip,
      userAgent: req.headers['user-agent'],
    };

    await apiController.getChanges(req, res);
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération changements',
      code: 'CHANGES_FETCH_FAILED',
    });
  }
});

/**
 * 🔄 Synchronisation avec fusion intelligente
 * POST /api/external/sync
 */
router.post('/sync', API_CONFIG.rateLimits.sync, validateApiParams, async (req, res) => {
  try {
    // Validation basique du payload
    if (!req.body || typeof req.body !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Payload invalide',
        message: 'Le corps de la requête doit être un objet JSON',
        code: 'INVALID_PAYLOAD',
      });
    }

    // Ajouter des métadonnées
    req.syncRequest = {
      timestamp: new Date().toISOString(),
      clientIp: req.ip,
      userAgent: req.headers['user-agent'],
      dataSize: JSON.stringify(req.body).length,
      recordCount: req.body.donnees?.length || 0,
    };

    // Log de la tentative de sync
    console.log(`🔄 [Sync] Tentative de ${req.body.donnees?.length || 0} enregistrements`);

    await apiController.syncData(req, res);
  } catch (error) {
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur synchronisation',
      details: error.message,
      code: 'SYNC_FAILED',
    });
  }
});

// ============================================
// ROUTES DE MODIFICATIONS (rate limiting standard)
// ============================================

/**
 * 🔄 Récupérer les modifications par site
 * GET /api/external/modifications
 */
router.get(
  '/modifications',
  API_CONFIG.rateLimits.sensitive,
  validateApiParams,
  async (req, res) => {
    try {
      // Valider les paramètres requis
      const { site, derniereSync } = req.query;

      if (!site || !derniereSync) {
        return res.status(400).json({
          success: false,
          error: 'Paramètres manquants',
          message: 'Les paramètres site et derniereSync sont requis',
          code: 'MISSING_PARAMETERS',
        });
      }

      await apiController.getModifications(req, res);
    } catch (error) {
      console.error('❌ Erreur getModifications:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur récupération modifications',
        code: 'MODIFICATIONS_FETCH_FAILED',
      });
    }
  }
);

// ============================================
// ROUTES DE DIAGNOSTIC
// ============================================

/**
 * 🔧 Diagnostic complet de l'API
 * GET /api/external/diagnostic
 */
router.get('/diagnostic', API_CONFIG.rateLimits.public, validateApiParams, async (req, res) => {
  try {
    await apiController.diagnostic(req, res);
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur diagnostic',
      code: 'DIAGNOSTIC_FAILED',
    });
  }
});

/**
 * 📋 Configuration des colonnes
 * GET /api/external/columns-config
 */
router.get('/columns-config', API_CONFIG.rateLimits.public, validateApiParams, (req, res) => {
  try {
    const config = apiController.getColonnesAFusionner();
    res.json({
      success: true,
      config,
      description: 'Configuration des colonnes pour la fusion intelligente',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur columns-config:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur récupération configuration',
      code: 'CONFIG_FETCH_FAILED',
    });
  }
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    name: 'API Externe GESCARD',
    version: '3.0.0-lws',
    description: 'API publique pour synchronisation externe',
    documentation: '/api/external/docs',
    timestamp: new Date().toISOString(),
    endpoints: {
      public: {
        health: {
          method: 'GET',
          path: '/api/external/health',
          description: 'Vérification de santé',
        },
        sites: { method: 'GET', path: '/api/external/sites', description: 'Liste des sites' },
        stats: { method: 'GET', path: '/api/external/stats', description: 'Statistiques globales' },
        'columns-config': {
          method: 'GET',
          path: '/api/external/columns-config',
          description: 'Configuration des colonnes',
        },
        diagnostic: {
          method: 'GET',
          path: '/api/external/diagnostic',
          description: 'Diagnostic complet',
        },
        'cors-test': { method: 'GET', path: '/api/external/cors-test', description: 'Test CORS' },
      },
      protected: {
        cartes: {
          method: 'GET',
          path: '/api/external/cartes',
          description: 'Récupérer les cartes avec filtres',
        },
        changes: {
          method: 'GET',
          path: '/api/external/changes',
          description: 'Changements depuis une date',
        },
        sync: {
          method: 'POST',
          path: '/api/external/sync',
          description: 'Synchronisation avec fusion intelligente',
        },
        modifications: {
          method: 'GET',
          path: '/api/external/modifications',
          description: 'Modifications par site',
        },
      },
    },
    rate_limits: {
      public: '60 requêtes par minute',
      sync: '20 requêtes par minute',
      sensitive: '100 requêtes par 15 minutes',
    },
    authentication: {
      type: 'API Token',
      header: 'X-API-Token',
      query_param: 'api_token',
    },
    examples: {
      get_changes: '/api/external/changes?since=2024-01-01T00:00:00',
      get_cartes: '/api/external/cartes?site=ADJAME&limit=100',
      sync_data: 'POST /api/external/sync avec payload JSON',
    },
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API externe`,
    available_routes: [
      'GET /api/external/health',
      'GET /api/external/sites',
      'GET /api/external/cartes',
      'GET /api/external/stats',
      'GET /api/external/changes',
      'POST /api/external/sync',
      'GET /api/external/modifications',
      'GET /api/external/columns-config',
      'GET /api/external/diagnostic',
      'GET /api/external/cors-test',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;


// ========== routes\journal.js ==========
const express = require('express');
const router = express.Router();
const journalController = // require modifié - fichier consolidé;
const { verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const permission = // require modifié - fichier consolidé;
const rateLimit = require('express-rate-limit');

const JOURNAL_CONFIG = {
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'JOURNAL_RATE_LIMIT',
      },
    }),
    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 10,
      message: {
        success: false,
        error: "Trop d'actions sensibles",
        code: 'SENSITIVE_ACTION_LIMIT',
      },
    }),
    export: rateLimit({
      windowMs: 60 * 60 * 1000,
      max: 5,
      message: {
        success: false,
        error: "Trop d'exports",
        code: 'EXPORT_LIMIT',
      },
    }),
  },
  cacheControl: {
    list: 'private, max-age=10',
    imports: 'private, max-age=30',
    stats: 'private, max-age=300',
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = JOURNAL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging
router.use((req, res, next) => {
  console.log(
    `📋 [Journal] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES
// ============================================

/**
 * 🩺 Vérification de santé
 * GET /api/journal/health
 */
router.get('/health', JOURNAL_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'journal',
    timestamp: new Date().toISOString(),
    endpoints: [
      'GET /api/journal',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'GET /api/journal/actions/annulables',
      'POST /api/journal/:id/annuler',
      'POST /api/journal/annuler-import',
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
    ],
  });
});

/**
 * 🧪 Test du service
 * GET /api/journal/test
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service journal fonctionnel',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// AUTHENTIFICATION
// ============================================

// Authentification requise pour toutes les routes suivantes
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// ============================================
// ROUTES DE CONSULTATION (Admin uniquement)
// ============================================

/**
 * 📋 Liste paginée du journal
 * GET /api/journal
 */
router.get(
  '/',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournal
);

/**
 * 📋 Liste paginée (alias)
 * GET /api/journal/list
 */
router.get(
  '/list',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournal
);

/**
 * 🔍 Détail d'une entrée
 * GET /api/journal/:id
 */
router.get(
  '/:id',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getJournalById
);

/**
 * 📦 Liste des imports
 * GET /api/journal/imports
 */
router.get(
  '/imports',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getImports
);

/**
 * 📦 Détail d'un import
 * GET /api/journal/imports/:batchId
 */
router.get(
  '/imports/:batchId',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getImportDetails
);

/**
 * 📊 Statistiques du journal
 * GET /api/journal/stats
 */
router.get(
  '/stats',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getStats
);

/**
 * 🔄 Actions pouvant être annulées
 * GET /api/journal/actions/annulables
 */
router.get(
  '/actions/annulables',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.getActionsAnnulables
);

// ============================================
// ROUTES D'ACTION (Admin uniquement - rate limiting strict)
// ============================================

/**
 * ❌ Annuler une action
 * POST /api/journal/:id/annuler
 */
router.post(
  '/:id/annuler',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.annulerAction
);

/**
 * ❌ Annuler un import
 * POST /api/journal/annuler-import
 */
router.post(
  '/annuler-import',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.annulerImportation
);

/**
 * 🧹 Nettoyer les vieux logs
 * POST /api/journal/nettoyer
 */
router.post(
  '/nettoyer',
  role.peutAnnulerAction,
  JOURNAL_CONFIG.rateLimits.sensitive,
  journalController.nettoyerJournal
);

// ============================================
// ROUTES D'EXPORT ET DIAGNOSTIC
// ============================================

/**
 * 📤 Exporter le journal
 * GET /api/journal/export
 */
router.get('/export', role.peutVoirJournal, JOURNAL_CONFIG.rateLimits.export, async (req, res) => {
  req.query.export_all = 'true';
  await journalController.getJournal(req, res);
});

/**
 * 🔧 Diagnostic complet
 * GET /api/journal/diagnostic
 */
router.get(
  '/diagnostic',
  role.peutVoirJournal,
  JOURNAL_CONFIG.rateLimits.standard,
  journalController.diagnostic
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

/**
 * 🏠 Page d'accueil de l'API journal
 * GET /api/journal/home
 */
router.get('/home', (req, res) => {
  res.json({
    name: 'API Journal GESCARD',
    version: '3.0.0',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    documentation: '/api/journal/health',
    endpoints: {
      consultation: {
        'GET /': 'Liste paginée (Admin)',
        'GET /list': 'Liste paginée (alias)',
        'GET /imports': 'Liste des imports (Admin)',
        'GET /imports/:batchId': 'Détails import (Admin)',
        'GET /stats': 'Statistiques (Admin)',
        'GET /actions/annulables': 'Actions annulables (Admin)',
      },
      actions: {
        'POST /:id/annuler': 'Annuler action (Admin)',
        'POST /annuler-import': 'Annuler import (Admin)',
        'POST /nettoyer': 'Nettoyer vieux logs (Admin)',
      },
      utilitaires: {
        'GET /export': 'Exporter (Admin)',
        'GET /diagnostic': 'Diagnostic (Admin)',
        'GET /health': 'Santé du service (public)',
        'GET /test': 'Test (public)',
        'GET /home': 'Cette page',
      },
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions sensibles par 15 minutes',
      export: '5 exports par heure',
    },
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas`,
    available_routes: [
      'GET /api/journal/home',
      'GET /api/journal/health',
      'GET /api/journal/test',
      'GET /api/journal',
      'GET /api/journal/list',
      'GET /api/journal/:id',
      'GET /api/journal/imports',
      'GET /api/journal/imports/:batchId',
      'GET /api/journal/stats',
      'GET /api/journal/actions/annulables',
      'POST /api/journal/:id/annuler',
      'POST /api/journal/annuler-import',
      'POST /api/journal/nettoyer',
      'GET /api/journal/export',
      'GET /api/journal/diagnostic',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;


// ========== routes\log.js ==========
const express = require('express');
const router = express.Router();
const logController = // require modifié - fichier consolidé;
const { verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const permission = // require modifié - fichier consolidé;
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const LOG_CONFIG = {
  // Rate limiting spécifique aux logs
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requêtes par minute
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'STANDARD_RATE_LIMIT',
      },
    }),

    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles
      message: {
        success: false,
        error: "Trop d'actions sensibles",
        code: 'SENSITIVE_RATE_LIMIT',
      },
    }),

    export: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 5, // 5 exports par heure
      message: {
        success: false,
        error: "Trop d'exports",
        code: 'EXPORT_RATE_LIMIT',
      },
    }),
  },

  // Cache control
  cacheControl: {
    list: 'private, max-age=5', // 5 secondes
    user: 'private, max-age=10', // 10 secondes
    recent: 'private, max-age=2', // 2 secondes
    stats: 'private, max-age=300', // 5 minutes
  },

  // Routes publiques
  publicRoutes: ['/health', '/test'],
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop();
  const cacheControl = LOG_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(
    `📝 [Logs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * GET /api/logs/health - Santé du service
 */
router.get('/health', LOG_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'logs',
    timestamp: new Date().toISOString(),
    version: '3.0.0-lws',
    roles_autorises: {
      consultation: 'Administrateur uniquement (redirigé vers journal)',
      actions: 'Administrateur uniquement',
      export: 'Administrateur uniquement',
    },
    redirection:
      '⚠️ Ce module est maintenu pour compatibilité. Utilisez /api/journal pour les nouvelles fonctionnalités.',
    endpoints: [
      'GET /api/logs',
      'GET /api/logs/recent',
      'GET /api/logs/user/:utilisateur',
      'GET /api/logs/date-range',
      'GET /api/logs/stats',
      'GET /api/logs/search',
      'GET /api/logs/filtered',
      'GET /api/logs/actions',
      'GET /api/logs/export',
      'GET /api/logs/diagnostic',
      'POST /api/logs',
      'DELETE /api/logs/old',
      'DELETE /api/logs/all',
    ],
  });
});

/**
 * GET /api/logs/test - Test du service
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service logs fonctionnel',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    redirection:
      '⚠️ Ce module est maintenu pour compatibilité. Utilisez /api/journal pour les nouvelles fonctionnalités.',
    roles_autorises: {
      consultation: 'Administrateur uniquement',
      actions: 'Administrateur uniquement',
    },
  });
});

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifierToken);
router.use(permission.peutVoirInfosSensibles);

// ============================================
// ROUTES DE CONSULTATION (Admin uniquement)
// ============================================

/**
 * GET /api/logs/list - Récupérer tous les logs
 * Admin uniquement - redirigé vers journal
 */
router.get('/list', role.peutVoirJournal, LOG_CONFIG.rateLimits.standard, logController.getAllLogs);

/**
 * GET /api/logs - Alias pour la liste
 * Admin uniquement - redirigé vers journal
 */
router.get('/', role.peutVoirJournal, LOG_CONFIG.rateLimits.standard, logController.getAllLogs);

/**
 * GET /api/logs/recent - Récupérer les logs récents
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/recent',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getRecentLogs
);

/**
 * GET /api/logs/user/:utilisateur - Logs par utilisateur
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/user/:utilisateur',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getLogsByUser
);

/**
 * GET /api/logs/date-range - Logs par plage de dates
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/date-range',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getLogsByDateRange
);

/**
 * GET /api/logs/filtered - Logs avec filtres avancés
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/filtered',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getFilteredLogs
);

// ============================================
// ROUTES DE RECHERCHE ET STATISTIQUES (Admin uniquement)
// ============================================

/**
 * GET /api/logs/search - Recherche avancée
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/search',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.searchLogs
);

/**
 * GET /api/logs/stats - Statistiques des logs
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/stats',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getLogStats
);

/**
 * GET /api/logs/actions - Actions fréquentes (auto-complétion)
 * Admin uniquement
 */
router.get(
  '/actions',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.getCommonActions
);

// ============================================
// ROUTES DE CRÉATION (Admin uniquement)
// ============================================

/**
 * POST /api/logs - Créer un nouveau log
 * Admin uniquement
 */
router.post('/', role.peutVoirJournal, LOG_CONFIG.rateLimits.standard, logController.createLog);

// ============================================
// ROUTES DE SUPPRESSION (Admin uniquement)
// ============================================

/**
 * DELETE /api/logs/old - Supprimer les vieux logs
 * Admin uniquement - redirigé vers journal
 */
router.delete(
  '/old',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.sensitive,
  logController.deleteOldLogs
);

/**
 * DELETE /api/logs/all - Supprimer tous les logs
 * Admin uniquement - redirigé vers journal
 */
router.delete(
  '/all',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.sensitive,
  logController.clearAllLogs
);

// ============================================
// ROUTES D'EXPORT (Admin uniquement)
// ============================================

/**
 * GET /api/logs/export - Exporter les logs
 * Admin uniquement - redirigé vers journal
 */
router.get('/export', role.peutVoirJournal, LOG_CONFIG.rateLimits.export, logController.exportLogs);

// ============================================
// ROUTES DE DIAGNOSTIC (Admin uniquement)
// ============================================

/**
 * GET /api/logs/diagnostic - Diagnostic du module
 * Admin uniquement - redirigé vers journal
 */
router.get(
  '/diagnostic',
  role.peutVoirJournal,
  LOG_CONFIG.rateLimits.standard,
  logController.diagnostic
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

/**
 * GET /api/logs/home - Page d'accueil documentée
 */
router.get('/home', (req, res) => {
  const roleInfo = req.user
    ? `Connecté en tant que: ${req.user.nomUtilisateur} (${req.user.role}) - ${req.user.role === 'Administrateur' ? '✅ Accès autorisé' : '❌ Accès restreint'}`
    : 'Non authentifié';

  res.json({
    name: 'API Logs GESCARD',
    description: 'Module de journalisation système (maintenu pour compatibilité)',
    version: '3.0.0-lws',
    timestamp: new Date().toISOString(),
    authentification: roleInfo,
    redirection:
      '⚠️ Ce module est maintenu pour compatibilité ascendante. Pour les nouvelles fonctionnalités (annulation, coordination), utilisez /api/journal',
    roles_autorises: {
      administrateur: '✅ Accès complet (redirigé vers journal)',
      gestionnaire: "❌ Non autorisé (pas d'accès aux logs)",
      chef_equipe: "❌ Non autorisé (pas d'accès aux logs)",
      operateur: "❌ Non autorisé (pas d'accès aux logs)",
    },
    compatibilite: {
      statut: '✅ Maintenu pour compatibilité ascendante',
      redirection_vers: '/api/journal',
      fonctionnalites_nouvelles: [
        "Annulation d'actions",
        'Support de la coordination',
        'Journalisation enrichie (JSON)',
        'Filtrage avancé',
      ],
    },
    user: req.user
      ? {
          id: req.user.id,
          username: req.user.nomUtilisateur,
          role: req.user.role,
          coordination: req.user.coordination,
        }
      : null,
    endpoints: {
      consultation: {
        'GET /list': 'Liste paginée des logs (Admin)',
        'GET /': 'Liste (alias - Admin)',
        'GET /recent': 'Logs récents (Admin)',
        'GET /user/:utilisateur': 'Logs par utilisateur (Admin)',
        'GET /date-range': 'Logs par plage de dates (Admin)',
        'GET /filtered': 'Logs avec filtres avancés (Admin)',
      },
      recherche: {
        'GET /search': 'Recherche avancée (Admin)',
        'GET /stats': 'Statistiques (Admin)',
        'GET /actions': 'Actions fréquentes (Admin)',
      },
      creation: {
        'POST /': 'Créer un log (Admin)',
      },
      suppression: {
        'DELETE /old': 'Supprimer vieux logs (Admin)',
        'DELETE /all': 'Supprimer tous les logs (Admin)',
      },
      export: {
        'GET /export': 'Exporter les logs (Admin)',
      },
      diagnostic: {
        'GET /diagnostic': 'Diagnostic module (Admin)',
        'GET /health': 'Santé service (public)',
        'GET /test': 'Test service (public)',
        'GET /home': 'Cette page',
      },
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions par 15 minutes',
      export: '5 exports par heure',
    },
    cache: {
      list: '5 secondes',
      user: '10 secondes',
      recent: '2 secondes',
      stats: '5 minutes',
    },
    formats_supportes: {
      import: ['CSV'],
      export: ['JSON', 'CSV'],
    },
    migration: {
      recommandation:
        'Pour bénéficier des nouvelles fonctionnalités (annulation, coordination), migrez vers /api/journal',
      documentation: "/api/journal/ pour plus d'informations",
    },
    exemples: {
      curl_liste:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/list?page=1&limit=50"',
      curl_user:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/user/admin"',
      curl_search:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/search?q=import&page=1"',
      curl_export:
        'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/export?format=csv"',
      curl_stats: 'curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/logs/stats"',
    },
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API logs`,
    available_routes: [
      'GET /api/logs/home',
      'GET /api/logs/health',
      'GET /api/logs/test',
      'GET /api/logs/list',
      'GET /api/logs/',
      'GET /api/logs/recent',
      'GET /api/logs/user/:utilisateur',
      'GET /api/logs/date-range',
      'GET /api/logs/filtered',
      'GET /api/logs/search',
      'GET /api/logs/stats',
      'GET /api/logs/actions',
      'GET /api/logs/export',
      'GET /api/logs/diagnostic',
      'POST /api/logs/',
      'DELETE /api/logs/old',
      'DELETE /api/logs/all',
    ],
    redirection: 'Pour les nouvelles fonctionnalités, utilisez /api/journal',
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;


// ========== routes\profils.js ==========
const express = require('express');
const router = express.Router();
const profilController = // require modifié - fichier consolidé;
const { verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const rateLimit = require('express-rate-limit');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const PROFIL_CONFIG = {
  // Rate limiting spécifique au profil
  rateLimits: {
    standard: rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 30, // 30 requêtes par minute
      message: {
        success: false,
        error: 'Trop de requêtes',
        code: 'STANDARD_RATE_LIMIT',
      },
    }),

    sensitive: rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 10, // 10 actions sensibles
      message: {
        success: false,
        error: "Trop d'actions sensibles",
        code: 'SENSITIVE_RATE_LIMIT',
      },
    }),

    password: rateLimit({
      windowMs: 60 * 60 * 1000, // 1 heure
      max: 3, // 3 tentatives de changement de mot de passe par heure
      message: {
        success: false,
        error: 'Trop de tentatives de changement de mot de passe',
        code: 'PASSWORD_RATE_LIMIT',
      },
    }),
  },

  // Cache control
  cacheControl: {
    profil: 'private, max-age=60', // 1 minute
    activity: 'private, max-age=30', // 30 secondes
    stats: 'private, max-age=300', // 5 minutes
    sessions: 'private, max-age=10', // 10 secondes
    health: 'no-cache',
    test: 'no-cache',
    diagnostic: 'no-cache',
  },
};

// ============================================
// MIDDLEWARE
// ============================================

// Middleware de cache-control dynamique
router.use((req, res, next) => {
  const path = req.path.split('/').pop(); // Dernier segment de l'URL
  const cacheControl = PROFIL_CONFIG.cacheControl[path] || 'private, no-cache';
  res.setHeader('Cache-Control', cacheControl);
  next();
});

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(
    `👤 [Profil] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

/**
 * GET /api/profil/health - Santé du service
 */
router.get('/health', PROFIL_CONFIG.rateLimits.standard, (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'profil',
    timestamp: new Date().toISOString(),
    version: '2.0.0-lws',
    endpoints: [
      'GET /api/profil/me',
      'GET /api/profil/:userId',
      'POST /api/profil/change-password',
      'GET /api/profil/activity',
      'GET /api/profil/:userId/activity',
      'GET /api/profil/check-username',
      'PUT /api/profil/username',
      'GET /api/profil/stats',
      'POST /api/profil/deactivate',
      'POST /api/profil/reactivate/:userId',
      'GET /api/profil/export',
      'GET /api/profil/sessions',
      'POST /api/profil/logout-others',
      'POST /api/profil/cache/clear',
      'GET /api/profil/diagnostic',
    ],
  });
});

/**
 * GET /api/profil/test - Test du service
 */
router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service profil fonctionnel',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
  });
});

// ============================================
// ROUTES PROTÉGÉES (authentification requise)
// ============================================
router.use(verifierToken);

// ============================================
// ROUTES DE PROFIL (utilisateur connecté)
// ============================================

/**
 * GET /api/profil/me - Récupérer le profil de l'utilisateur connecté
 */
router.get('/me', PROFIL_CONFIG.rateLimits.standard, profilController.getProfile);

/**
 * PUT /api/profil/me - Mettre à jour le profil
 */
router.put('/me', PROFIL_CONFIG.rateLimits.standard, profilController.updateProfile);

/**
 * POST /api/profil/change-password - Changer le mot de passe
 */
router.post('/change-password', PROFIL_CONFIG.rateLimits.password, profilController.changePassword);

/**
 * GET /api/profil/activity - Activité de l'utilisateur connecté
 */
router.get('/activity', PROFIL_CONFIG.rateLimits.standard, profilController.getUserActivity);

/**
 * GET /api/profil/check-username - Vérifier disponibilité du nom d'utilisateur
 */
router.get(
  '/check-username',
  PROFIL_CONFIG.rateLimits.standard,
  profilController.checkUsernameAvailability
);

/**
 * PUT /api/profil/username - Mettre à jour le nom d'utilisateur
 */
router.put('/username', PROFIL_CONFIG.rateLimits.sensitive, profilController.updateUsername);

/**
 * GET /api/profil/stats - Statistiques du profil
 */
router.get('/stats', PROFIL_CONFIG.rateLimits.standard, profilController.getProfileStats);

/**
 * POST /api/profil/deactivate - Désactiver le compte
 */
router.post('/deactivate', PROFIL_CONFIG.rateLimits.sensitive, profilController.deactivateAccount);

/**
 * GET /api/profil/export - Exporter les données du profil
 */
router.get('/export', PROFIL_CONFIG.rateLimits.standard, profilController.exportProfileData);

/**
 * GET /api/profil/sessions - Sessions actives
 */
router.get('/sessions', PROFIL_CONFIG.rateLimits.standard, profilController.getActiveSessions);

/**
 * POST /api/profil/logout-others - Déconnecter les autres sessions
 */
router.post(
  '/logout-others',
  PROFIL_CONFIG.rateLimits.sensitive,
  profilController.logoutOtherSessions
);

/**
 * POST /api/profil/cache/clear - Nettoyer le cache utilisateur
 */
router.post('/cache/clear', PROFIL_CONFIG.rateLimits.standard, profilController.clearUserCache);

// ============================================
// ROUTES ADMINISTRATEUR (Admin uniquement)
// ============================================

/**
 * GET /api/profil/:userId - Récupérer le profil d'un utilisateur (Admin uniquement)
 */
router.get(
  '/:userId',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.standard,
  profilController.getUserProfile
);

/**
 * GET /api/profil/:userId/activity - Activité d'un utilisateur (Admin uniquement)
 */
router.get(
  '/:userId/activity',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.standard,
  profilController.getUserActivityById
);

/**
 * POST /api/profil/reactivate/:userId - Réactiver un compte (Admin uniquement)
 */
router.post(
  '/reactivate/:userId',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.sensitive,
  profilController.reactivateAccount
);

/**
 * GET /api/profil/diagnostic - Diagnostic du module (Admin uniquement)
 */
router.get(
  '/diagnostic',
  role.peutGererComptes,
  PROFIL_CONFIG.rateLimits.standard,
  profilController.diagnostic
);

// ============================================
// ROUTE D'ACCUEIL
// ============================================

/**
 * GET /api/profil/home - Page d'accueil documentée
 */
router.get('/home', (req, res) => {
  res.json({
    name: 'API Profil GESCARD',
    description: 'Module de gestion des profils utilisateurs',
    version: '2.0.0-lws',
    timestamp: new Date().toISOString(),
    authentifie: !!req.user,
    documentation: {
      mon_profil: '/api/profil/me - Mon profil',
      modifier: '/api/profil/me - PUT - Modifier mon profil',
      mot_de_passe: '/api/profil/change-password - POST - Changer mot de passe',
      activite: '/api/profil/activity - Mon activité',
      statistiques: '/api/profil/stats - Mes statistiques',
      exporter: '/api/profil/export - Exporter mes données',
      sessions: '/api/profil/sessions - Sessions actives',
      username: '/api/profil/username - PUT - Changer nom utilisateur',
    },
    rate_limits: {
      standard: '30 requêtes par minute',
      sensitive: '10 actions sensibles par 15 minutes',
      password: '3 tentatives par heure',
    },
    exemples: {
      curl_profil: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/profil/me',
      curl_activity:
        'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/profil/activity',
      curl_stats: 'curl -H "Authorization: Bearer <token>" http://localhost:3000/api/profil/stats',
    },
  });
});

// ============================================
// GESTION DES ERREURS 404
// ============================================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas dans l'API profil`,
    available_routes: [
      'GET /api/profil/home',
      'GET /api/profil/health',
      'GET /api/profil/test',
      'GET /api/profil/me',
      'GET /api/profil/:userId',
      'GET /api/profil/activity',
      'GET /api/profil/:userId/activity',
      'GET /api/profil/check-username',
      'GET /api/profil/stats',
      'GET /api/profil/export',
      'GET /api/profil/sessions',
      'GET /api/profil/diagnostic',
      'PUT /api/profil/me',
      'PUT /api/profil/username',
      'POST /api/profil/change-password',
      'POST /api/profil/deactivate',
      'POST /api/profil/reactivate/:userId',
      'POST /api/profil/logout-others',
      'POST /api/profil/cache/clear',
    ],
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;


// ========== routes\statistiques.js ==========
// routes/statistiques.js
const express = require('express');
const router = express.Router();
const { verifierToken } = // require modifié - fichier consolidé;
const permission = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const ctrl = // require modifié - fichier consolidé;

// ============================================
// MIDDLEWARE GLOBAUX
// ============================================

// Authentification obligatoire sur toutes les routes
router.use(verifierToken);

// Logging
router.use((req, res, next) => {
  console.log(
    `📊 [Stats] ${req.method} ${req.path} - ${req.user?.nomUtilisateur} (${req.user?.role}) - ${req.user?.coordination || 'toutes coordinations'}`
  );
  next();
});

// Cache-Control navigateur
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'private, max-age=300');
  next();
});

// ============================================
// ROUTES
// ============================================

/**
 * GET /api/statistiques/globales
 * Totaux généraux filtrés selon le rôle
 * Accès : Administrateur, Gestionnaire, Chef d'équipe, Opérateur
 */
router.get('/globales', permission.peutVoirStatistiques, ctrl.globales);

/**
 * GET /api/statistiques/sites
 * Statistiques par site filtrées selon le rôle
 * Accès : Administrateur, Gestionnaire, Chef d'équipe, Opérateur
 */
router.get('/sites', permission.peutVoirStatistiques, ctrl.parSite);

/**
 * GET /api/statistiques/detail
 * Statistiques complètes (globales + sites + évolution)
 * Accès : Administrateur, Gestionnaire, Chef d'équipe, Opérateur
 */
router.get('/detail', permission.peutVoirStatistiques, ctrl.detail);

/**
 * GET /api/statistiques/quick
 * Stats rapides pour tableau de bord
 * Accès : tous les rôles
 */
router.get('/quick', permission.peutVoirStatistiques, ctrl.quick);

/**
 * GET /api/statistiques/evolution
 * Évolution temporelle des imports
 * Paramètres : ?periode=30&interval=day|week|month
 * Accès : Administrateur, Gestionnaire, Chef d'équipe
 */
router.get('/evolution', permission.peutVoirStatistiques, ctrl.evolution);

/**
 * GET /api/statistiques/imports
 * Statistiques par lot d'import
 * Paramètres : ?limit=10
 * Accès : Administrateur, Gestionnaire, Chef d'équipe
 */
router.get('/imports', permission.peutVoirStatistiques, ctrl.parImport);

/**
 * GET /api/statistiques/coordinations
 * Comparaison entre coordinations
 * Accès : Administrateur uniquement
 */
router.get('/coordinations', permission.peutVoirStatistiques, ctrl.parCoordination);

/**
 * POST /api/statistiques/refresh
 * Vider le cache manuellement
 * Accès : Administrateur, Gestionnaire
 */
router.post('/refresh', permission.peutVoirStatistiques, ctrl.refresh);

/**
 * GET /api/statistiques/diagnostic
 * Diagnostic technique complet
 * Accès : Administrateur uniquement
 */
router.get('/diagnostic', role.peutAccederPage('statistiques'), ctrl.diagnostic);

/**
 * GET /api/statistiques
 * Documentation de l'API
 */
router.get('/', (req, res) => {
  res.json({
    name: 'API Statistiques GESCARD',
    version: '3.0.0',
    description: 'Module de statistiques avec filtrage par rôle',
    timestamp: new Date().toISOString(),
    utilisateur: req.user ? `${req.user.nomUtilisateur} (${req.user.role})` : 'Non authentifié',
    acces_par_role: {
      Administrateur: 'Toutes les coordinations, toutes les statistiques',
      Gestionnaire: 'Sa coordination uniquement',
      "Chef d'équipe": 'Sa coordination uniquement',
      Opérateur: 'Son site uniquement',
    },
    endpoints: [
      { method: 'GET', path: '/api/statistiques/globales', description: 'Totaux globaux' },
      { method: 'GET', path: '/api/statistiques/sites', description: 'Par site' },
      { method: 'GET', path: '/api/statistiques/detail', description: 'Tout en un' },
      { method: 'GET', path: '/api/statistiques/quick', description: 'Tableau de bord' },
      { method: 'GET', path: '/api/statistiques/evolution', description: 'Évolution temporelle' },
      { method: 'GET', path: '/api/statistiques/imports', description: "Par lot d'import" },
      {
        method: 'GET',
        path: '/api/statistiques/coordinations',
        description: 'Par coordination (Admin)',
      },
      { method: 'POST', path: '/api/statistiques/refresh', description: 'Vider le cache' },
      { method: 'GET', path: '/api/statistiques/diagnostic', description: 'Diagnostic technique' },
    ],
  });
});

module.exports = router;


// ========== routes\syncRoutes.js ==========
// routes/syncRoutes.js
const express = require('express');
const router = express.Router();
const { body, validationResult } = require('express-validator');

const syncController = // require modifié - fichier consolidé;
const verifySiteToken = // require modifié - fichier consolidé;

// Validation pour le login
const validateLogin = [
  body('site_id').notEmpty().withMessage('site_id requis'),
  body('api_key').notEmpty().withMessage('api_key requis'),
];

// Validation pour l'upload
const validateUpload = [
  body('modifications').isArray().optional(),
  body('last_sync').optional().isISO8601(),
];

/**
 * Routes publiques (sans token)
 */
router.post('/login', validateLogin, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  await syncController.login(req, res);
});

/**
 * Routes protégées (nécessitent un token valide)
 */

// Route de test
router.get('/test', verifySiteToken, (req, res) => {
  res.json({
    success: true,
    message: 'Authentification réussie',
    site: req.site,
    timestamp: new Date().toISOString(),
  });
});

// Upload des modifications
router.post('/upload', verifySiteToken, validateUpload, async (req, res) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  await syncController.upload(req, res);
});

// Download des mises à jour
router.get('/download', verifySiteToken, async (req, res) => {
  await syncController.download(req, res);
});

// Confirmation de réception
router.post('/confirm', verifySiteToken, async (req, res) => {
  await syncController.confirm(req, res);
});

// Statut du site
router.get('/status', verifySiteToken, async (req, res) => {
  await syncController.status(req, res);
});

// Synchronisation des utilisateurs
router.get('/users', verifySiteToken, async (req, res) => {
  await syncController.getUsers(req, res);
});

module.exports = router;


// ========== routes\utilisateurs.js ==========
// routes/utilisateurs.js

const express = require('express');
const router = express.Router();
const ctrl = // require modifié - fichier consolidé;
const { verifierToken } = // require modifié - fichier consolidé;
const role = // require modifié - fichier consolidé;
const rateLimit = require('express-rate-limit');

const RATE = {
  standard: rateLimit({
    windowMs: 60 * 1000,
    max: 30,
    message: { success: false, error: 'Trop de requêtes', code: 'STANDARD_RATE_LIMIT' },
  }),
  sensitive: rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    message: { success: false, error: "Trop d'actions sensibles", code: 'SENSITIVE_RATE_LIMIT' },
  }),
};

// ============================================
// MIDDLEWARE LOGGING
// ============================================
router.use((req, res, next) => {
  console.log(
    `👥 [Utilisateurs] ${req.method} ${req.url} - User: ${req.user?.nomUtilisateur || 'non authentifié'} (${req.user?.role || 'aucun'})`
  );
  next();
});

// ============================================
// ROUTES PUBLIQUES (sans authentification)
// ============================================

router.get('/health', (req, res) => {
  res.json({
    success: true,
    status: 'healthy',
    service: 'utilisateurs',
    timestamp: new Date().toISOString(),
  });
});

router.get('/test', (req, res) => {
  res.json({
    success: true,
    message: 'Service utilisateurs fonctionnel',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
  });
});

// ============================================
// AUTHENTIFICATION (requise pour toutes les routes suivantes)
// ============================================
router.use(verifierToken);

// ============================================
// ROUTES UTILITAIRES (tous les rôles authentifiés)
// ============================================

/**
 * Liste des rôles disponibles — tous les rôles
 * GET /api/utilisateurs/roles
 */
router.get('/roles', RATE.standard, ctrl.getRoles);

/**
 * Vérifier disponibilité du nom d'utilisateur — tous les rôles
 * GET /api/utilisateurs/check-username
 */
router.get('/check-username', RATE.standard, ctrl.checkUsernameAvailability);

// ============================================
// MIDDLEWARE RÔLE — Admin, Gestionnaire, Chef d'équipe
// (appliqué à toutes les routes suivantes)
// ============================================
router.use(role.peutGererComptes);

// ============================================
// ROUTES DE CONSULTATION
// ============================================

/**
 * Liste paginée — filtrée selon le rôle
 * GET /api/utilisateurs
 * GET /api/utilisateurs/list
 */
router.get('/', RATE.standard, ctrl.getAllUsers);
router.get('/list', RATE.standard, ctrl.getAllUsers);

/**
 * Recherche avancée — filtrée selon le rôle
 * GET /api/utilisateurs/search
 */
router.get('/search', RATE.standard, ctrl.searchUsers);

/**
 * Statistiques — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/stats
 */
router.get('/stats', RATE.standard, ctrl.getUserStats);

/**
 * Export — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/export
 */
router.get('/export', RATE.sensitive, ctrl.exportUsers);

/**
 * Liste des coordinations — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/coordinations
 */
router.get('/coordinations', RATE.standard, ctrl.getCoordinations);

/**
 * Diagnostic — Administrateur uniquement (vérifié dans le contrôleur)
 * GET /api/utilisateurs/diagnostic
 */
router.get('/diagnostic', RATE.standard, ctrl.diagnostic);

/**
 * Nettoyer le cache — Administrateur uniquement (vérifié dans le contrôleur)
 * POST /api/utilisateurs/cache/clear
 */
router.post('/cache/clear', RATE.standard, ctrl.clearStatsCache);

/**
 * Page d'accueil documentée
 * GET /api/utilisateurs/home
 */
router.get('/home', (req, res) => {
  res.json({
    name: 'API Utilisateurs GESCARD',
    version: '3.1.0',
    timestamp: new Date().toISOString(),
    utilisateur: req.user ? `${req.user.nomUtilisateur} (${req.user.role})` : 'Non authentifié',
    acces_par_role: {
      Administrateur: 'Gère tous les utilisateurs',
      Gestionnaire: 'Gère les utilisateurs de sa coordination',
      "Chef d'équipe": 'Gère les utilisateurs de son site — crée uniquement des Opérateurs',
      Opérateur: 'Accès lecture seule au profil',
    },
    endpoints: {
      consultation: {
        'GET /': 'Liste (filtrée selon rôle)',
        'GET /list': 'Liste (alias)',
        'GET /:id': 'Détail utilisateur',
        'GET /:id/history': 'Historique (Admin)',
        'GET /search': 'Recherche avancée',
        'GET /stats': 'Statistiques (Admin)',
        'GET /export': 'Export CSV/JSON (Admin)',
        'GET /coordinations': 'Liste coordinations (Admin)',
      },
      creation_modification: {
        'POST /': 'Créer utilisateur',
        'PUT /:id': 'Modifier utilisateur',
        'POST /:id/reset-password': 'Réinitialiser mot de passe',
        'POST /:id/activate': 'Activer',
        'DELETE /:id': 'Désactiver',
      },
      utilitaires: {
        'GET /roles': 'Liste des rôles valides',
        'GET /check-username': 'Vérifier disponibilité',
        'POST /cache/clear': 'Vider cache (Admin)',
        'GET /diagnostic': 'Diagnostic (Admin)',
        'GET /health': 'Santé du service',
      },
    },
    rate_limits: {
      standard: '30 requêtes / minute',
      sensitive: '10 actions / 15 minutes',
    },
  });
});

// ============================================
// ROUTES AVEC PARAMÈTRE :id
// (doivent être après les routes nommées fixes)
// ============================================

/**
 * Détail utilisateur
 * GET /api/utilisateurs/:id
 */
router.get('/:id', RATE.standard, ctrl.getUserById);

/**
 * Historique d'un utilisateur — Administrateur uniquement
 * GET /api/utilisateurs/:id/history
 */
router.get('/:id/history', RATE.standard, ctrl.getUserHistory);

/**
 * Créer utilisateur
 * POST /api/utilisateurs
 */
router.post('/', RATE.sensitive, ctrl.createUser);

/**
 * Modifier utilisateur
 * PUT /api/utilisateurs/:id
 */
router.put('/:id', RATE.sensitive, ctrl.updateUser);

/**
 * Réinitialiser le mot de passe
 * POST /api/utilisateurs/:id/reset-password
 */
router.post('/:id/reset-password', RATE.sensitive, ctrl.resetPassword);

/**
 * Activer un utilisateur
 * POST /api/utilisateurs/:id/activate
 */
router.post('/:id/activate', RATE.sensitive, ctrl.activateUser);

/**
 * Désactiver un utilisateur
 * DELETE /api/utilisateurs/:id
 */
router.delete('/:id', RATE.sensitive, ctrl.deleteUser);

// ============================================
// 404
// ============================================
router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route non trouvée',
    message: `La route ${req.method} ${req.path} n'existe pas`,
    code: 'ROUTE_NOT_FOUND',
  });
});

module.exports = router;


// ========== scripts\diagnostic.js ==========
#!/usr/bin/env node

const axios = require('axios');

// ========== CONFIGURATION ==========
// Mets ici l'URL de ton API sur le VPS (ou localhost si tu testes en local)
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
// En production sur VPS, tu pourras utiliser :
// const API_BASE = 'https://gescardcocody.com/api';

// Ton token API (à garder secret, à mettre dans .env plus tard)
const API_TOKEN = process.env.API_TOKEN || 'CARTES_API_2025_SECRET_TOKEN_NOV';

async function runDiagnostic() {
  console.log('🔍 Diagnostic API GESCard (VPS)');
  console.log(`🌐 API cible: ${API_BASE}`);
  console.log('============================\n');

  let successCount = 0;
  let totalTests = 0;

  try {
    // Test 1: API de base
    totalTests++;
    console.log('1️⃣ Test API de base...');
    try {
      const baseRes = await axios.get(`${API_BASE}/api`);
      console.log(`✅ API de base: ${baseRes.data.message || 'OK'}`);
      successCount++;
    } catch (error) {
      console.log(`❌ Échec API de base: ${error.message}`);
    }

    // Test 2: Health check
    totalTests++;
    console.log('\n2️⃣ Test Health Check...');
    try {
      const healthRes = await axios.get(`${API_BASE}/api/health`);
      console.log(`✅ Health: ${healthRes.data.status}`);
      if (healthRes.data.data && healthRes.data.data.total_cartes) {
        console.log(`📊 Cartes: ${healthRes.data.data.total_cartes}`);
      }
      successCount++;
    } catch (error) {
      console.log(`❌ Échec Health: ${error.message}`);
    }

    // Test 3: CORS
    totalTests++;
    console.log('\n3️⃣ Test CORS...');
    try {
      const corsRes = await axios.get(`${API_BASE}/api/cors-test`);
      console.log(`✅ CORS: ${corsRes.data.message}`);
      successCount++;
    } catch (error) {
      console.log(`❌ Échec CORS: ${error.message}`);
    }

    // Test 4: API externe publique (health)
    totalTests++;
    console.log('\n4️⃣ Test API externe (health)...');
    try {
      const extHealth = await axios.get(`${API_BASE}/api/external/health`);
      console.log(`✅ API externe health: ${extHealth.data.status || 'OK'}`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API externe health non trouvée - OK`);
      } else {
        console.log(`❌ Échec API externe: ${error.message}`);
      }
    }

    // Test 5: API changes (publique)
    totalTests++;
    console.log('\n5️⃣ Test API changes (publique)...');
    try {
      const changesRes = await axios.get(`${API_BASE}/api/external/changes`);
      console.log(`✅ API changes: ${changesRes.data.data?.length || 0} modifications`);
      if (changesRes.data.derniereModification) {
        console.log(`📅 Dernière modif: ${changesRes.data.derniereModification}`);
      }
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API changes non trouvée - OK`);
      } else {
        console.log(`❌ Échec API changes: ${error.message}`);
      }
    }

    // Test 6: API stats (publique)
    totalTests++;
    console.log('\n6️⃣ Test API stats...');
    try {
      const statsRes = await axios.get(`${API_BASE}/api/external/stats`);
      console.log(`✅ API stats accessible`);
      if (statsRes.data.data && statsRes.data.data.global) {
        console.log(`📊 Total: ${statsRes.data.data.global.total_cartes} cartes`);
      }
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API stats non trouvée - OK`);
      } else {
        console.log(`❌ Échec API stats: ${error.message}`);
      }
    }

    // Test 7: API externe protégée (sans token)
    totalTests++;
    console.log('\n7️⃣ Test API protégée (sans token - devrait échouer)...');
    try {
      await axios.get(`${API_BASE}/api/external/cartes`);
      console.log(`❌ Devrait avoir échoué (401)`);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log(`✅ Correctement protégée (401 Unauthorized)`);
        successCount++;
      } else {
        console.log(`✅ Protégée (autre erreur: ${error.response?.status || error.code})`);
        successCount++;
      }
    }

    // Test 8: API externe protégée (avec token)
    totalTests++;
    console.log('\n8️⃣ Test API protégée (avec token)...');
    try {
      const protectedRes = await axios.get(`${API_BASE}/api/external/cartes`, {
        headers: { 'X-API-Token': API_TOKEN },
        params: { limit: 5 }, // Limiter pour éviter de charger trop de données
      });
      console.log(`✅ API protégée accessible avec token`);
      if (protectedRes.data.data) {
        console.log(`📊 Données: ${protectedRes.data.data.length} cartes`);
      }
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Route /api/external/cartes non trouvée - OK`);
      } else {
        console.log(`❌ Erreur token: ${error.response?.data?.error || error.message}`);
      }
    }

    // Test 9: Route protégée JWT (sans token)
    totalTests++;
    console.log('\n9️⃣ Test route protégée JWT (sans token - devrait échouer)...');
    try {
      await axios.get(`${API_BASE}/api/cartes`);
      console.log(`❌ Devrait avoir échoué (401)`);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log(`✅ Correctement protégée (401 Unauthorized)`);
        successCount++;
      } else {
        console.log(`✅ Protégée (${error.response?.status || 'timeout'})`);
        successCount++;
      }
    }

    // Test 10: Route d'accueil des statistiques
    totalTests++;
    console.log('\n🔟 Test route statistiques...');
    try {
      const statsHomeRes = await axios.get(`${API_BASE}/api/statistiques`);
      console.log(`✅ Route statistiques accessible - ${statsHomeRes.data.name || 'OK'}`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Route statistiques non trouvée - OK`);
      } else {
        console.log(`❌ Erreur statistiques: ${error.message}`);
      }
    }

    // Test 11: Synchronisation sites (sans token)
    totalTests++;
    console.log('\n1️⃣1️⃣ Test synchronisation (sans token)...');
    try {
      await axios.get(`${API_BASE}/api/site/health`);
      console.log(`✅ Route sync accessible`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Route sync non trouvée - OK`);
      } else {
        console.log(`✅ Route sync protégée: ${error.response?.status || 'OK'}`);
        successCount++;
      }
    }

    console.log('\n🎯 RÉSULTATS DU DIAGNOSTIC');
    console.log('========================');
    console.log(`✅ Tests réussis: ${successCount}/${totalTests}`);
    console.log(`🌐 API testée: ${API_BASE}`);

    if (successCount === totalTests) {
      console.log('\n🎉 Tous les tests ont réussi ! API prête pour la production.');
    } else {
      const pourcentage = Math.round((successCount / totalTests) * 100);
      console.log(`\n⚠️ ${pourcentage}% des tests ont réussi. Vérifie les routes manquantes.`);
      console.log('📝 Routes à vérifier:');
      console.log('   - /api/external/health');
      console.log('   - /api/external/changes');
      console.log('   - /api/external/stats');
      console.log('   - /api/external/cartes');
      console.log('   - /api/statistiques');
      console.log('   - /api/site/health');
    }
  } catch (error) {
    console.error('\n❌ Diagnostic échoué - Erreur générale:');
    console.error(`Message: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error("💡 Le serveur n'est pas accessible. Vérifie que ton backend tourne bien.");
    } else if (error.code === 'ENOTFOUND') {
      console.error("💡 L'URL n'est pas valide. Vérifie API_BASE.");
    } else if (error.code === 'ETIMEDOUT') {
      console.error('💡 Timeout - Le serveur répond trop lentement ou ne répond pas.');
    }
    process.exit(1);
  }
}

// Exécuter le diagnostic
runDiagnostic();

