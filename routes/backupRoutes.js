const express = require('express');
const router = express.Router();
const { Client } = require('pg');
const PostgreSQLBackup = require('../backup-postgres');
const PostgreSQLRestorer = require('../restore-postgres');

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
  lastBackupDate: null
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
  const validTokens = (process.env.API_TOKENS || '').split(',').map(t => t.trim());
  
  if (apiToken && validTokens.includes(apiToken)) {
    req.user = {
      id: 'api-user',
      nomUtilisateur: 'api-backup',
      profil: 'admin',
      role: 'Administrateur'
    };
    return next();
  }
  
  // Pour les tests en développement
  if (process.env.NODE_ENV !== 'production' && req.query.test === 'true') {
    req.user = {
      id: 'test-user',
      nomUtilisateur: 'test-backup',
      profil: 'admin',
      role: 'Administrateur'
    };
    return next();
  }
  
  return res.status(401).json({
    success: false,
    message: 'Authentification requise',
    code: 'UNAUTHENTICATED'
  });
};

/**
 * Vérification des droits admin
 */
const requireAdmin = (req, res, next) => {
  const userRole = (req.user?.role || req.user?.profil || '').toLowerCase();
  const isAdmin = BACKUP_CONFIG.adminRoles.some(role => 
    userRole.includes(role.toLowerCase())
  );
  
  if (!isAdmin) {
    return res.status(403).json({
      success: false,
      message: 'Action réservée aux administrateurs',
      requiredRoles: BACKUP_CONFIG.adminRoles,
      yourRole: req.user?.role || req.user?.profil,
      code: 'FORBIDDEN_ADMIN_ONLY'
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
  if (BACKUP_CONFIG.lastBackupTime && 
      (now - BACKUP_CONFIG.lastBackupTime) < BACKUP_CONFIG.backupCooldown) {
    const waitTime = Math.ceil((BACKUP_CONFIG.backupCooldown - (now - BACKUP_CONFIG.lastBackupTime)) / 1000);
    return res.status(429).json({
      success: false,
      message: 'Trop de backups rapprochés',
      retryAfter: waitTime,
      code: 'BACKUP_COOLDOWN'
    });
  }
  
  // Vérifier la limite quotidienne (augmentée pour VPS)
  if (BACKUP_CONFIG.backupCountToday >= BACKUP_CONFIG.maxBackupsPerDay) {
    return res.status(429).json({
      success: false,
      message: `Limite quotidienne atteinte (${BACKUP_CONFIG.maxBackupsPerDay})`,
      code: 'BACKUP_DAILY_LIMIT'
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
      code: 'BACKUP_SERVICE_UNAVAILABLE'
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
        created: new Date().toISOString()
      },
      stats: {
        backupsToday: BACKUP_CONFIG.backupCountToday,
        remainingToday: BACKUP_CONFIG.maxBackupsPerDay - BACKUP_CONFIG.backupCountToday
      },
      location: {
        folder: BACKUP_CONFIG.folderName,
        folderId: BACKUP_CONFIG.folderId,
        service: 'Google Drive'
      },
      schedule: {
        nextAutoBackup: `Today at ${BACKUP_CONFIG.autoBackupHour}:00 UTC`,
        autoRestore: process.env.AUTO_RESTORE === 'true'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur backup:', error);
    
    const errorResponse = {
      success: false,
      message: 'Erreur lors de la création du backup',
      error: error.message,
      code: 'BACKUP_CREATION_FAILED'
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
      warning: 'La restauration a été effectuée. Veuillez vérifier l\'intégrité des données.'
    });
    
  } catch (error) {
    console.error('❌ Erreur restauration:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      code: 'RESTORE_FAILED'
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
    const oldestBackup = backups.length > 0 
      ? new Date(Math.min(...backups.map(b => new Date(b.createdISO))))
      : null;
    
    res.json({
      success: true,
      count: backups.length,
      displayed: limitedBackups.length,
      message: backups.length > 0 
        ? `${backups.length} backup(s) disponible(s)`
        : 'Aucun backup trouvé',
      statistics: {
        totalSize: totalSize ? `${Math.round(totalSize / 1024 / 1024)} MB` : 'N/A',
        oldestBackup: oldestBackup?.toLocaleString('fr-FR'),
        newestBackup: backups.length > 0 ? new Date(backups[0].createdISO).toLocaleString('fr-FR') : null,
        averageSize: backups.length > 0 
          ? `${Math.round(totalSize / backups.length / 1024 / 1024)} MB`
          : 'N/A'
      },
      backups: limitedBackups.map(backup => ({
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
        directLink: `https://drive.google.com/uc?export=download&id=${backup.id}`
      })),
      storage: {
        folderName: BACKUP_CONFIG.folderName,
        folderId: BACKUP_CONFIG.folderId,
        service: 'Google Drive'
      },
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur liste backups:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des backups',
      error: error.message,
      code: 'BACKUP_LIST_FAILED'
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
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    await client.connect();
    const countResult = await client.query("SELECT COUNT(*) as total FROM cartes");
    const totalCartes = parseInt(countResult.rows[0].total);
    
    // Récupérer la taille de la DB
    const sizeResult = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    const dbSize = sizeResult.rows[0].size;
    
    await client.end();
    
    const googleDriveConfigured = !!(process.env.GOOGLE_CLIENT_ID && 
                                    process.env.GOOGLE_CLIENT_SECRET && 
                                    process.env.GOOGLE_REFRESH_TOKEN);
    
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
        connection: 'OK'
      },
      
      backup_system: {
        configured: googleDriveConfigured,
        available: hasBackups,
        auto_backup: `daily at ${BACKUP_CONFIG.autoBackupHour}:00 UTC`,
        auto_restore: process.env.AUTO_RESTORE === 'true',
        last_backup: BACKUP_CONFIG.lastBackupTime?.toLocaleString('fr-FR') || null,
        backups_today: BACKUP_CONFIG.backupCountToday,
        remaining_today: BACKUP_CONFIG.maxBackupsPerDay - BACKUP_CONFIG.backupCountToday,
        next_scheduled: nextBackup.toISOString()
      },
      
      google_drive: {
        configured: googleDriveConfigured,
        folder: BACKUP_CONFIG.folderName,
        folder_id: BACKUP_CONFIG.folderId,
        test_endpoint: '/api/backup/test'
      },
      
      endpoints: {
        create: 'POST /api/backup/create',
        list: 'GET /api/backup/list',
        restore: 'POST /api/backup/restore (admin)',
        download: '/api/backup/download/:id',
        status: 'GET /api/backup/status',
        info: 'GET /api/backup/info',
        test: 'GET /api/backup/test'
      },
      
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur status:', error);
    res.status(500).json({
      success: false,
      status: 'error',
      message: 'Erreur lors de la vérification',
      error: error.message,
      code: 'STATUS_CHECK_FAILED'
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
        code: 'MISSING_BACKUP_ID'
      });
    }
    
    const protocol = req.protocol;
    const host = req.get('host');
    
    res.json({
      success: true,
      message: 'Liens de téléchargement générés',
      backupId,
      links: {
        direct: `/api/backup/download/${backupId}`,
        google_drive: `https://drive.google.com/uc?export=download&id=${backupId}`,
        view: `https://drive.google.com/file/d/${backupId}/view`
      },
      instructions: [
        'Pour télécharger directement, utilisez: GET /api/backup/download/:id',
        'Le lien Google Drive est également accessible',
        'Les backups sont conservés indéfiniment'
      ],
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur génération liens:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la génération des liens',
      error: error.message
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
        message: 'ID du backup requis'
      });
    }
    
    console.log(`📥 Téléchargement backup: ${backupId}`);
    res.redirect(`https://drive.google.com/uc?export=download&id=${backupId}`);
    
  } catch (error) {
    console.error('❌ Erreur redirection:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur de redirection',
      error: error.message
    });
  }
});

/**
 * 7. Synchronisation pour application desktop
 * POST /api/backup/sync/local-export
 */
router.post('/sync/local-export', authenticate, requireAdmin, async (req, res) => {
  try {
    const { data, lastSync, client_version, platform } = req.body;
    
    console.log(`📨 Sync depuis application desktop v${client_version || 'unknown'} (${platform || 'unknown'})`);
    
    if (!data || typeof data !== 'object') {
      return res.status(400).json({
        success: false,
        message: 'Données de synchronisation invalides',
        code: 'INVALID_SYNC_DATA'
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
      next_sync_recommendation: '24h'
    });
    
  } catch (error) {
    console.error('❌ Erreur sync:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
        database_url: process.env.DATABASE_URL ? 'configured' : 'missing'
      }
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
          rows: totalRows
        }
      });
    }
    
  } catch (error) {
    console.error('❌ Erreur récupération données:', error);
    res.status(500).json({
      success: false,
      error: error.message
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
      AUTO_RESTORE: process.env.AUTO_RESTORE
    };
    
    const fullyConfigured = Object.values(config).every(v => v === true || v === 'true');
    
    if (!fullyConfigured) {
      return res.json({
        success: false,
        message: 'Configuration Google Drive incomplète',
        config: {
          ...config,
          missing: Object.entries(config)
            .filter(([_, v]) => !v || v === 'false')
            .map(([k]) => k)
        },
        instructions: [
          '1. Obtenez des credentials Google Drive API',
          '2. Ajoutez les variables d\'environnement',
          '3. Utilisez https://developers.google.com/oauthplayground pour obtenir refresh_token'
        ]
      });
    }
    
    if (!backupService) {
      return res.json({
        success: false,
        message: 'Service de backup non initialisé',
        error: 'Vérifiez les dépendances'
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
        last_backup: backups.length > 0 ? backups[0].createdISO : null
      },
      config,
      environment: {
        node_env: process.env.NODE_ENV,
        auto_restore: process.env.AUTO_RESTORE === 'true'
      },
      endpoints: {
        create: 'POST /api/backup/create',
        list: 'GET /api/backup/list',
        status: 'GET /api/backup/status',
        info: 'GET /api/backup/info'
      },
      timestamp: new Date().toISOString()
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
        'L\'API Google Drive doit être activée dans la console Google',
        'Vérifiez que le refresh_token a le scope drive.file',
        'Assurez-vous que le dossier existe ou est accessible'
      ]
    };
    
    if (error.message.includes('invalid_grant')) {
      errorDetails.advice = 'Refresh_token invalide ou expiré. Régénérez-le sur https://developers.google.com/oauthplayground';
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
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
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
    const googleDriveConfigured = !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_REFRESH_TOKEN);
    
    // Récupérer les infos des backups si disponibles
    let backupCount = 0;
    let backupStats = null;
    
    if (backupService) {
      try {
        const backups = await backupService.listBackups();
        backupCount = backups.length;
        
        if (backups.length > 0) {
          const sizes = backups.map(b => b.sizeBytes || 0);
          backupStats = {
            total_backups: backups.length,
            total_size: `${Math.round(sizes.reduce((a, b) => a + b, 0) / 1024 / 1024)} MB`,
            newest: backups[0].created,
            oldest: backups[backups.length - 1].created
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
        type: 'PostgreSQL'
      },
      
      backup_system: {
        google_drive: googleDriveConfigured ? '✅ Configured' : '❌ Not configured',
        auto_backup: 'daily at 02:00 UTC',
        auto_restore: process.env.AUTO_RESTORE === 'true' ? 'enabled' : 'disabled',
        storage: 'Google Drive',
        folder: BACKUP_CONFIG.folderName,
        backups_available: backupCount,
        ...backupStats
      },
      
      configuration: {
        google_drive: {
          client_id: process.env.GOOGLE_CLIENT_ID ? '✅ Set' : '❌ Missing',
          client_secret: process.env.GOOGLE_CLIENT_SECRET ? '✅ Set' : '❌ Missing',
          refresh_token: process.env.GOOGLE_REFRESH_TOKEN ? '✅ Set' : '❌ Missing',
          redirect_uri: process.env.GOOGLE_REDIRECT_URI ? '✅ Set' : '❌ Missing',
          folder_id: BACKUP_CONFIG.folderId
        },
        database: {
          url: process.env.DATABASE_URL ? '✅ Set' : '❌ Missing'
        },
        auto_restore: process.env.AUTO_RESTORE === 'true'
      },
      
      endpoints: {
        public: {
          create_backup: { method: 'POST', path: '/api/backup/create', auth: 'required' },
          list_backups: { method: 'GET', path: '/api/backup/list', auth: 'required' },
          backup_status: { method: 'GET', path: '/api/backup/status', auth: 'required' },
          backup_info: { method: 'GET', path: '/api/backup/info', auth: 'optional' },
          test_drive: { method: 'GET', path: '/api/backup/test', auth: 'none' },
          download_backup: { method: 'GET', path: '/api/backup/download/:id', auth: 'none' }
        },
        protected: {
          restore_backup: { method: 'POST', path: '/api/backup/restore', auth: 'admin_only' },
          sync_export: { method: 'POST', path: '/api/backup/sync/local-export', auth: 'admin_only' },
          sync_get_data: { method: 'GET', path: '/api/backup/sync/get-data', auth: 'admin_only' }
        }
      },
      
      quick_start: [
        '1. Testez la connexion: GET /api/backup/test',
        '2. Créez un backup: POST /api/backup/create',
        '3. Listez les backups: GET /api/backup/list',
        '4. Téléchargez: GET /api/backup/download/:id'
      ],
      
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur info:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur lors de la récupération des informations',
      error: error.message
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
        message: 'Service de backup non disponible'
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
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur nettoyage:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;