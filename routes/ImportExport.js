const express = require('express');
const router = express.Router();
const importExportController = require('../Controllers/importExportController');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { verifyToken } = require('../middleware/auth');
const { importExportAccess, importExportRateLimit, validateFileUpload } = require('../middleware/importExportAccess');

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
    'application/vnd.oasis.opendocument.spreadsheet'
  ]
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
    const random = Math.round(Math.random() * 1E9);
    const safeFileName = file.originalname
      .replace(/[^a-zA-Z0-9.\-_]/g, '_')
      .replace(/\s+/g, '_');
    
    // Ajouter l'ID utilisateur pour traçabilité
    const userId = req.user?.id || 'anonymous';
    cb(null, `import-${userId}-${timestamp}-${random}-${safeFileName}`);
  }
});

const fileFilter = (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const isValidExt = UPLOAD_CONFIG.allowedExtensions.includes(ext);
  const isValidMime = UPLOAD_CONFIG.allowedMimeTypes.includes(file.mimetype);

  if (isValidExt || isValidMime) {
    cb(null, true);
  } else {
    cb(new Error(`Format non supporté. Formats acceptés: ${UPLOAD_CONFIG.allowedExtensions.join(', ')}`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: UPLOAD_CONFIG.maxFileSize,
    files: UPLOAD_CONFIG.maxFiles
  }
});

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifyToken);
router.use(importExportAccess);

// Middleware de logging spécifique
router.use((req, res, next) => {
  console.log(`📦 [ImportExport] ${req.method} ${req.url} - User: ${req.user?.NomUtilisateur}`);
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
  importExportRateLimit,
  upload.single('file'),
  validateFileUpload,
  importExportController.importCSV
);

/**
 * 📤 EXPORT EXCEL LIMITÉ
 * GET /api/import-export/export
 */
router.get('/export', importExportRateLimit, importExportController.exportExcel);

/**
 * 📤 EXPORT CSV LIMITÉ
 * GET /api/import-export/export/csv
 */
router.get('/export/csv', importExportRateLimit, importExportController.exportCSV);

/**
 * 🔍 EXPORT CSV PAR SITE
 * GET /api/import-export/export/site
 */
router.get('/export/site', importExportRateLimit, importExportController.exportCSVBySite);

/**
 * 📋 TÉLÉCHARGER TEMPLATE
 * GET /api/import-export/template
 */
router.get('/template', importExportController.downloadTemplate);

/**
 * 🏢 LISTE DES SITES
 * GET /api/import-export/sites
 */
router.get('/sites', importExportController.getSitesList);

/**
 * 🩺 DIAGNOSTIC COMPLET
 * GET /api/import-export/diagnostic
 */
router.get('/diagnostic', importExportController.diagnostic);

// ============================================
// ROUTES D'EXPORT COMPLET
// ============================================

/**
 * 🚀 EXPORT EXCEL COMPLET (toutes les données)
 * GET /api/import-export/export/complete
 */
router.get('/export/complete', importExportRateLimit, importExportController.exportCompleteExcel);

/**
 * 🚀 EXPORT CSV COMPLET (toutes les données)
 * GET /api/import-export/export/complete/csv
 */
router.get('/export/complete/csv', importExportRateLimit, importExportController.exportCompleteCSV);

/**
 * 🚀 EXPORT "TOUT EN UN" (choix automatique du format)
 * GET /api/import-export/export/all
 */
router.get('/export/all', importExportRateLimit, importExportController.exportAllData);

// ============================================
// ROUTES DE COMPATIBILITÉ (avec redirection)
// ============================================

/**
 * 📥 IMPORT EXCEL (alias)
 * POST /api/import-export/import
 */
router.post('/import', importExportRateLimit, upload.single('file'), importExportController.importCSV);

/**
 * 🔄 IMPORT SMART SYNC
 * POST /api/import-export/import/smart-sync
 */
router.post('/import/smart-sync', importExportRateLimit, upload.single('file'), importExportController.importSmartSync);

/**
 * 📤 EXPORT STREAMING (redirige vers complet)
 * GET /api/import-export/export/stream
 */
router.get('/export/stream', importExportRateLimit, importExportController.exportCompleteCSV);

/**
 * 🎛️ EXPORT FILTRÉ (par site)
 * GET /api/import-export/export/filtered
 */
router.get('/export/filtered', importExportRateLimit, importExportController.exportCSVBySite);

/**
 * 🔍 EXPORT RÉSULTATS (alias)
 * GET /api/import-export/export-resultats
 */
router.get('/export-resultats', importExportRateLimit, importExportController.exportCSVBySite);

/**
 * 📤 EXPORT OPTIMISÉ (redirige vers complet)
 * GET /api/import-export/export/optimized
 */
router.get('/export/optimized', importExportRateLimit, importExportController.exportCompleteCSV);

// ============================================
// ROUTES DE STATISTIQUES ET MONITORING
// ============================================

/**
 * 📊 STATISTIQUES D'EXPORT
 * GET /api/import-export/stats
 */
router.get('/stats', importExportRateLimit, async (req, res) => {
  try {
    const db = require('../db/db');
    
    const totalResult = await db.query('SELECT COUNT(*) as total FROM cartes');
    const totalRows = parseInt(totalResult.rows[0].total);
    
    const sitesResult = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site, 
        COUNT(*) as count,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as retirees
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      GROUP BY "SITE DE RETRAIT" 
      ORDER BY count DESC
      LIMIT 10
    `);
    
    const lastImportResult = await db.query(`
      SELECT 
        MAX(dateimport) as last_import,
        COUNT(DISTINCT importbatchid) as import_count,
        COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days' THEN 1 END) as imports_7j
      FROM cartes 
    `);

    // Statistiques des exports
    const exportStats = importExportController._controller?.activeExports?.size || 0;
    const importStats = importExportController._controller?.activeImports?.size || 0;

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      stats: {
        total_cartes: totalRows,
        top_sites: sitesResult.rows,
        imports: {
          dernier: lastImportResult.rows[0].last_import,
          total_batches: parseInt(lastImportResult.rows[0].import_count || 0),
          imports_7j: parseInt(lastImportResult.rows[0].imports_7j || 0)
        },
        en_cours: {
          exports_actifs: exportStats,
          imports_actifs: importStats
        }
      },
      export_capacite: {
        limite_standard: '5000 lignes',
        complet_max: '1,000,000 lignes',
        recommandation: totalRows > 50000 
          ? 'Utilisez /export/all pour le format optimal'
          : 'Toutes les routes fonctionnent'
      }
    });
  } catch (error) {
    console.error('❌ Erreur stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * 📊 STATUT DES EXPORTS EN COURS
 * GET /api/import-export/status
 */
router.get('/status', importExportRateLimit, (req, res) => {
  const controller = importExportController._controller;
  
  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    exports_actifs: Array.from(controller?.activeExports?.entries() || []).map(([id, data]) => ({
      id,
      type: data.type,
      started_at: new Date(data.startTime).toISOString(),
      elapsed_ms: Date.now() - data.startTime
    })),
    imports_actifs: Array.from(controller?.activeImports?.entries() || []).map(([id, data]) => ({
      id,
      file: data.file,
      started_at: new Date(data.startTime).toISOString(),
      elapsed_ms: Date.now() - data.startTime
    })),
    file_attente: controller?.exportQueue?.length || 0
  });
});

// ============================================
// ROUTES DE TEST
// ============================================

/**
 * 🧪 TEST EXPORT
 * GET /api/import-export/test/export
 */
router.get('/test/export', importExportRateLimit, async (req, res) => {
  try {
    const db = require('../db/db');
    const result = await db.query('SELECT COUNT(*) as total FROM cartes');
    const totalRows = parseInt(result.rows[0].total);
    
    res.json({
      success: true,
      message: 'Service d\'export opérationnel',
      timestamp: new Date().toISOString(),
      data: {
        total_cartes: totalRows,
        environnement: process.env.NODE_ENV || 'development',
        endpoints_disponibles: {
          export_limite: [
            { method: 'GET', path: '/api/import-export/export', description: 'Excel limité (5000 lignes)' },
            { method: 'GET', path: '/api/import-export/export/csv', description: 'CSV limité (5000 lignes)' },
            { method: 'GET', path: '/api/import-export/export/site', description: 'CSV par site' }
          ],
          export_complet: [
            { method: 'GET', path: '/api/import-export/export/complete', description: 'Excel complet (toutes les données)' },
            { method: 'GET', path: '/api/import-export/export/complete/csv', description: 'CSV complet (toutes les données)' },
            { method: 'GET', path: '/api/import-export/export/all', description: 'Choix automatique du format' }
          ],
          import: [
            { method: 'POST', path: '/api/import-export/import/csv', description: 'Import CSV' },
            { method: 'POST', path: '/api/import-export/import/smart-sync', description: 'Import avec fusion intelligente' }
          ]
        },
        recommandations: [
          totalRows > 50000 ? 
            `📊 ${totalRows.toLocaleString()} cartes: utilisez /export/all` :
            `✅ ${totalRows.toLocaleString()} cartes: toutes les routes fonctionnent`,
          totalRows > 20000 ? 
            '⚡ CSV recommandé pour les gros volumes' :
            '📈 Excel parfait pour les volumes modérés'
        ]
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
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
    features: [
      '✅ Export CSV optimisé (streaming par lots)',
      '✅ Export Excel avec style professionnel',
      '✅ Export COMPLET (toutes les données)',
      '✅ Import CSV avec validation',
      '✅ Import Smart Sync (fusion intelligente)',
      '✅ Export par site',
      '✅ Template d\'import Excel',
      '✅ File d\'attente et gestion mémoire',
      '✅ Monitoring des exports en cours'
    ],
    config: {
      max_file_size: '100MB',
      max_export_rows: '1,000,000',
      max_batch_size: 10000,
      concurrent_exports: 3,
      formats_supportes: ['.csv', '.xlsx', '.xls']
    },
    quick_start: [
      '1️⃣ Pour exporter TOUT: GET /api/import-export/export/all',
      '2️⃣ Pour exporter en Excel: GET /api/import-export/export/complete',
      '3️⃣ Pour exporter en CSV: GET /api/import-export/export/complete/csv',
      '4️⃣ Pour importer: POST /api/import-export/import/csv (multipart/form-data)',
      '5️⃣ Pour le template: GET /api/import-export/template',
      '6️⃣ Pour le diagnostic: GET /api/import-export/diagnostic',
      '7️⃣ Pour les stats: GET /api/import-export/stats'
    ]
  });
});

/**
 * 🩺 SANTÉ DU SERVICE
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
    stats: {
      exports_actifs: controller?.activeExports?.size || 0,
      imports_actifs: controller?.activeImports?.size || 0,
      file_attente: controller?.exportQueue?.length || 0
    },
    endpoints: {
      import: {
        csv: 'POST /import/csv',
        smart: 'POST /import/smart-sync'
      },
      export_limite: {
        excel: 'GET /export (max 5000)',
        csv: 'GET /export/csv (max 5000)',
        site: 'GET /export/site'
      },
      export_complet: {
        excel: 'GET /export/complete',
        csv: 'GET /export/complete/csv',
        auto: 'GET /export/all'
      },
      utilitaires: {
        template: 'GET /template',
        sites: 'GET /sites',
        diagnostic: 'GET /diagnostic',
        stats: 'GET /stats',
        status: 'GET /status',
        test: 'GET /test'
      }
    },
    recommandations: [
      '🚀 Utilisez /export/all pour exporter TOUTES vos données',
      '📊 /export/complete pour Excel, /export/complete/csv pour CSV',
      '⚡ CSV recommandé pour plus de 20,000 lignes',
      '💡 /export et /export/csv sont limités à 5000 lignes',
      '📈 Vérifiez /diagnostic pour voir le volume total'
    ]
  });
});

// ============================================
// ROUTE D'ACCUEIL
// ============================================

router.get('/', (req, res) => {
  res.json({
    title: 'API Import/Export COMPLETE pour LWS',
    description: 'Exportez toutes vos données avec des performances optimisées',
    version: '4.0.0-lws',
    documentation: 'https://github.com/votre-projet/docs',
    timestamp: new Date().toISOString(),
    endpoints: {
      export_complet: {
        description: '🔵 Exporter TOUTES les données (recommandé)',
        routes: {
          tout_en_un: {
            path: '/api/import-export/export/all',
            method: 'GET',
            description: 'Choix intelligent entre Excel et CSV selon le volume',
            exemple: 'curl -H "Authorization: Bearer <token>" https://api/import-export/export/all'
          },
          excel_complet: {
            path: '/api/import-export/export/complete',
            method: 'GET',
            description: 'Export COMPLET en Excel avec formatage professionnel'
          },
          csv_complet: {
            path: '/api/import-export/export/complete/csv',
            method: 'GET',
            description: 'Export COMPLET en CSV avec streaming optimisé'
          }
        }
      },
      export_limite: {
        description: '🟢 Export limité à 5000 lignes (compatibilité)',
        routes: {
          excel: '/api/import-export/export',
          csv: '/api/import-export/export/csv',
          site: '/api/import-export/export/site?site=ADJAME'
        }
      },
      import: {
        description: '🟡 Importer des données',
        routes: {
          csv: {
            path: '/api/import-export/import/csv',
            method: 'POST',
            description: 'Import CSV avec validation',
            format: 'multipart/form-data'
          },
          smart: {
            path: '/api/import-export/import/smart-sync',
            method: 'POST',
            description: 'Import avec fusion intelligente (évite les doublons)'
          }
        }
      },
      utilitaires: {
        description: '⚪ Outils complémentaires',
        routes: {
          sites: '/api/import-export/sites',
          template: '/api/import-export/template',
          diagnostic: '/api/import-export/diagnostic',
          stats: '/api/import-export/stats',
          status: '/api/import-export/status',
          health: '/api/import-export/health',
          test: '/api/import-export/test'
        }
      }
    },
    conseils_pratiques: [
      {
        situation: 'Moins de 5,000 cartes',
        conseil: 'Utilisez /export ou /export/csv'
      },
      {
        situation: 'Entre 5,000 et 50,000 cartes',
        conseil: 'Utilisez /export/all ou /export/complete/csv'
      },
      {
        situation: 'Plus de 50,000 cartes',
        conseil: 'Utilisez /export/complete/csv (streaming optimisé)'
      },
      {
        situation: 'Import avec doublons',
        conseil: 'Utilisez /import/smart-sync pour la fusion intelligente'
      }
    ],
    performance: {
      max_export_rows: '1,000,000',
      max_file_size: '100MB',
      concurrent_exports: 3,
      traitement_par_lots: '10,000 lignes par lot',
      streaming: 'Oui (CSV)'
    }
  });
});

module.exports = router;