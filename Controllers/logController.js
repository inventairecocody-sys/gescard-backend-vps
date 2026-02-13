const db = require('../db/db');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  defaultLimit: 50,
  maxLimit: 10000,            // Pour les exports
  minSearchLength: 2,          // Longueur min pour recherche
  maxRetentionDays: 365,       // Conservation max 1 an
  defaultRetentionDays: 90,    // Conservation par défaut
  cacheTimeout: 300,           // Cache stats 5 minutes
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
    'RESTAURATION'
  ]
};

// ============================================
// CONTROLEUR LOG OPTIMISÉ POUR LWS
// ============================================

/**
 * Récupérer tous les logs avec pagination
 * GET /api/logs
 */
exports.getAllLogs = async (req, res) => {
  try {
    const { page = 1, limit = CONFIG.defaultLimit, export_all = 'false' } = req.query;
    
    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = export_all === 'true' 
      ? CONFIG.maxLimit 
      : Math.min(parseInt(limit), CONFIG.maxLimit);
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    // Requête principale avec pagination
    const result = await db.query(`
      SELECT 
        logid,
        utilisateur,
        action,
        TO_CHAR(dateheure, 'YYYY-MM-DD HH24:MI:SS') as dateheure,
        EXTRACT(EPOCH FROM dateheure) as timestamp
      FROM log 
      ORDER BY dateheure DESC
      LIMIT $1 OFFSET $2
    `, [actualLimit, offset]);

    // Compter le total
    const countResult = await db.query('SELECT COUNT(*) as total FROM log');
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    const duration = Date.now() - startTime;

    // Headers pour export
    if (export_all === 'true') {
      res.setHeader('X-Total-Rows', total);
      res.setHeader('X-Query-Time', `${duration}ms`);
    }

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1
      },
      performance: {
        queryTime: duration,
        returnedRows: result.rows.length
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getAllLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * Créer un nouveau log
 * POST /api/logs
 */
exports.createLog = async (req, res) => {
  try {
    const { Utilisateur, Action } = req.body;

    if (!Utilisateur || !Action) {
      return res.status(400).json({
        success: false,
        error: 'Utilisateur et Action sont requis'
      });
    }

    const result = await db.query(
      'INSERT INTO log (utilisateur, action, dateheure) VALUES ($1, $2, NOW()) RETURNING *',
      [Utilisateur.trim(), Action.trim()]
    );

    res.json({
      success: true,
      message: 'Log ajouté avec succès',
      log: result.rows[0],
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur createLog:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Récupérer les logs par utilisateur
 * GET /api/logs/user/:utilisateur
 */
exports.getLogsByUser = async (req, res) => {
  try {
    const { utilisateur } = req.params;
    const { page = 1, limit = CONFIG.defaultLimit } = req.query;

    if (!utilisateur) {
      return res.status(400).json({
        success: false,
        error: 'Le nom d\'utilisateur est requis'
      });
    }

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), CONFIG.maxLimit);
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        logid,
        utilisateur,
        action,
        TO_CHAR(dateheure, 'YYYY-MM-DD HH24:MI:SS') as dateheure
      FROM log 
      WHERE utilisateur = $1
      ORDER BY dateheure DESC
      LIMIT $2 OFFSET $3
    `, [utilisateur, actualLimit, offset]);

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM log WHERE utilisateur = $1',
      [utilisateur]
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      utilisateur,
      logs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getLogsByUser:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Récupérer les logs par plage de dates
 * GET /api/logs/date-range
 */
exports.getLogsByDateRange = async (req, res) => {
  try {
    const { dateDebut, dateFin, page = 1, limit = CONFIG.defaultLimit } = req.query;

    if (!dateDebut || !dateFin) {
      return res.status(400).json({
        success: false,
        error: 'Les dates de début et fin sont requises'
      });
    }

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), CONFIG.maxLimit);
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        logid,
        utilisateur,
        action,
        TO_CHAR(dateheure, 'YYYY-MM-DD HH24:MI:SS') as dateheure
      FROM log 
      WHERE dateheure BETWEEN $1 AND $2
      ORDER BY dateheure DESC
      LIMIT $3 OFFSET $4
    `, [
      new Date(dateDebut), 
      new Date(dateFin + ' 23:59:59'),
      actualLimit, 
      offset
    ]);

    const countResult = await db.query(`
      SELECT COUNT(*) as total FROM log 
      WHERE dateheure BETWEEN $1 AND $2
    `, [new Date(dateDebut), new Date(dateFin + ' 23:59:59')]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      dateDebut,
      dateFin,
      logs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getLogsByDateRange:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Récupérer les logs récents
 * GET /api/logs/recent
 */
exports.getRecentLogs = async (req, res) => {
  try {
    const { limit = CONFIG.defaultLimit } = req.query;
    const actualLimit = Math.min(parseInt(limit), CONFIG.maxLimit);

    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        logid,
        utilisateur,
        action,
        TO_CHAR(dateheure, 'YYYY-MM-DD HH24:MI:SS') as dateheure
      FROM log 
      ORDER BY dateheure DESC 
      LIMIT $1
    `, [actualLimit]);

    res.json({
      success: true,
      logs: result.rows,
      count: result.rows.length,
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getRecentLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Supprimer les vieux logs
 * DELETE /api/logs/old
 */
exports.deleteOldLogs = async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    const { days = CONFIG.defaultRetentionDays } = req.query;
    const retentionDays = Math.min(parseInt(days), CONFIG.maxRetentionDays);

    if (retentionDays < 30) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        error: 'La période minimum est de 30 jours'
      });
    }

    // Compter les logs à supprimer
    const countResult = await client.query(`
      SELECT COUNT(*) as count 
      FROM log 
      WHERE dateheure < CURRENT_DATE - INTERVAL '${retentionDays} days'
    `);

    const count = parseInt(countResult.rows[0].count);

    if (count === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        message: 'Aucun log à supprimer',
        deletedCount: 0
      });
    }

    // Journaliser la suppression si un utilisateur est connecté
    if (req.user) {
      await client.query(
        'INSERT INTO log (utilisateur, action, dateheure) VALUES ($1, $2, NOW())',
        [req.user.NomUtilisateur || 'System', `SUPPRESSION_LOGS_ANCIENS: ${count} logs >${retentionDays}j`]
      );
    }

    // Supprimer les vieux logs
    const result = await client.query(`
      DELETE FROM log 
      WHERE dateheure < CURRENT_DATE - INTERVAL '${retentionDays} days'
      RETURNING logid
    `);

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Logs supprimés avec succès`,
      deletedCount: result.rows.length,
      retentionDays,
      dateLimite: new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString(),
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur deleteOldLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Statistiques des logs avec cache
 * GET /api/logs/stats
 */
exports.getLogStats = async (req, res) => {
  try {
    const { forceRefresh, periode = 30 } = req.query;
    
    // Vérifier le cache
    if (!forceRefresh && 
        CONFIG.statsCache && 
        CONFIG.statsCacheTime && 
        (Date.now() - CONFIG.statsCacheTime) < CONFIG.cacheTimeout * 1000) {
      return res.json({
        success: true,
        ...CONFIG.statsCache,
        cached: true,
        cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime) / 1000) + 's'
      });
    }

    const jours = Math.min(parseInt(periode), 365);
    const startTime = Date.now();

    // Statistiques par utilisateur
    const userStats = await db.query(`
      SELECT 
        utilisateur,
        COUNT(*) as total_actions,
        MAX(dateheure) as derniere_action,
        MIN(dateheure) as premiere_action,
        COUNT(CASE WHEN dateheure > NOW() - INTERVAL '7 days' THEN 1 END) as actions_7j
      FROM log 
      GROUP BY utilisateur 
      ORDER BY total_actions DESC
      LIMIT 20
    `);

    // Statistiques par jour (30 derniers jours)
    const dailyStats = await db.query(`
      SELECT 
        CAST(dateheure AS DATE) as date,
        COUNT(*) as total_actions,
        COUNT(DISTINCT utilisateur) as utilisateurs_actifs
      FROM log 
      WHERE dateheure >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY CAST(dateheure AS DATE)
      ORDER BY date DESC
    `);

    // Actions les plus fréquentes
    const actionStats = await db.query(`
      SELECT 
        action,
        COUNT(*) as count,
        COUNT(DISTINCT utilisateur) as utilisateurs_distincts,
        MAX(dateheure) as derniere_utilisation
      FROM log 
      GROUP BY action 
      ORDER BY count DESC 
      LIMIT 20
    `);

    // Statistiques temporelles
    const timeStats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN dateheure > NOW() - INTERVAL '24 hours' THEN 1 END) as dernieres_24h,
        COUNT(CASE WHEN dateheure > NOW() - INTERVAL '7 days' THEN 1 END) as dernieres_7j,
        COUNT(CASE WHEN dateheure > NOW() - INTERVAL '30 days' THEN 1 END) as dernieres_30j,
        MIN(dateheure) as premier_log,
        MAX(dateheure) as dernier_log,
        COUNT(DISTINCT utilisateur) as utilisateurs_total
      FROM log
    `);

    const total = parseInt(timeStats.rows[0].total);

    const statsData = {
      resume: {
        total_logs: total,
        total_utilisateurs: parseInt(timeStats.rows[0].utilisateurs_total),
        dernier_log: timeStats.rows[0].dernier_log,
        premier_log: timeStats.rows[0].premier_log,
        dernieres_24h: parseInt(timeStats.rows[0].dernieres_24h),
        dernieres_7j: parseInt(timeStats.rows[0].dernieres_7j),
        dernieres_30j: parseInt(timeStats.rows[0].dernieres_30j)
      },
      parUtilisateur: userStats.rows.map(row => ({
        ...row,
        total_actions: parseInt(row.total_actions),
        pourcentage: total > 0 ? Math.round((row.total_actions / total) * 100) : 0
      })),
      parJour: dailyStats.rows.map(row => ({
        ...row,
        total_actions: parseInt(row.total_actions),
        utilisateurs_actifs: parseInt(row.utilisateurs_actifs)
      })),
      actionsFrequentes: actionStats.rows.map(row => ({
        ...row,
        count: parseInt(row.count),
        pourcentage: total > 0 ? Math.round((row.count / total) * 100) : 0
      })),
      periode_jours: jours,
      performance: {
        queryTime: Date.now() - startTime
      }
    };

    // Mettre en cache
    CONFIG.statsCache = statsData;
    CONFIG.statsCacheTime = Date.now();

    res.json({
      success: true,
      ...statsData,
      cached: false,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getLogStats:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Recherche avancée dans les logs
 * GET /api/logs/search
 */
exports.searchLogs = async (req, res) => {
  try {
    const { 
      q, 
      page = 1, 
      limit = CONFIG.defaultLimit,
      dateDebut,
      dateFin,
      exact = 'false'
    } = req.query;

    if (!q || q.trim() === '') {
      return res.status(400).json({ 
        success: false,
        error: 'Le terme de recherche est requis' 
      });
    }

    if (q.trim().length < CONFIG.minSearchLength) {
      return res.json({
        success: true,
        logs: [],
        total: 0,
        message: `Minimum ${CONFIG.minSearchLength} caractères requis`
      });
    }

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), CONFIG.maxLimit);
    const offset = (actualPage - 1) * actualLimit;

    let searchTerm;
    let query = `
      SELECT 
        logid,
        utilisateur,
        action,
        TO_CHAR(dateheure, 'YYYY-MM-DD HH24:MI:SS') as dateheure
      FROM log 
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Mode recherche (exact ou partiel)
    if (exact === 'true') {
      paramCount++;
      query += ` AND (utilisateur = $${paramCount} OR action = $${paramCount})`;
      params.push(q.trim());
    } else {
      paramCount++;
      searchTerm = `%${q.trim()}%`;
      query += ` AND (utilisateur ILIKE $${paramCount} OR action ILIKE $${paramCount})`;
      params.push(searchTerm);
    }

    // Filtres de date
    if (dateDebut) {
      paramCount++;
      query += ` AND dateheure >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dateheure <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }

    // Requête COUNT
    let countQuery = query.replace(
      /SELECT[\s\S]*?FROM/,
      'SELECT COUNT(*) as total FROM'
    );
    countQuery = countQuery.split('ORDER BY')[0];

    // Ajout du tri et pagination
    query += ` ORDER BY dateheure DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    const startTime = Date.now();

    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, params.slice(0, paramCount))
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1
      },
      recherche: {
        terme: q,
        mode: exact === 'true' ? 'exact' : 'partiel',
        dateDebut: dateDebut || null,
        dateFin: dateFin || null
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur searchLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Supprimer tous les logs (admin seulement)
 * DELETE /api/logs/all
 */
exports.clearAllLogs = async (req, res) => {
  const client = await db.getClient();
  
  try {
    await client.query('BEGIN');
    
    // Vérifier les permissions
    if (!req.user || !req.user.role || !req.user.role.toLowerCase().includes('admin')) {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        success: false,
        error: 'Permission refusée - Réservé aux administrateurs' 
      });
    }

    // Compter avant suppression
    const countResult = await client.query('SELECT COUNT(*) as total FROM log');
    const total = parseInt(countResult.rows[0].total);

    if (total === 0) {
      await client.query('ROLLBACK');
      return res.json({
        success: true,
        message: 'Aucun log à supprimer',
        deletedCount: 0
      });
    }

    // Journaliser l'action avant suppression
    await client.query(
      'INSERT INTO log (utilisateur, action, dateheure) VALUES ($1, $2, NOW())',
      [req.user.NomUtilisateur || 'Admin', `SUPPRESSION_TOTALE_LOGS: ${total} logs`]
    );

    // Supprimer tous les logs
    const result = await client.query('DELETE FROM log RETURNING logid');
    
    await client.query('COMMIT');
    
    res.json({ 
      success: true,
      message: 'Tous les logs ont été supprimés avec succès',
      deletedCount: result.rows.length,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur clearAllLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Exporter les logs
 * GET /api/logs/export
 */
exports.exportLogs = async (req, res) => {
  try {
    const { format = 'json', dateDebut, dateFin, utilisateur } = req.query;

    let query = `
      SELECT 
        logid,
        utilisateur,
        action,
        TO_CHAR(dateheure, 'YYYY-MM-DD HH24:MI:SS') as dateheure,
        EXTRACT(EPOCH FROM dateheure) as timestamp
      FROM log 
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Appliquer les filtres
    if (dateDebut) {
      paramCount++;
      query += ` AND dateheure >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dateheure <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }

    if (utilisateur) {
      paramCount++;
      query += ` AND utilisateur = $${paramCount}`;
      params.push(utilisateur);
    }

    query += ` ORDER BY dateheure DESC`;

    const startTime = Date.now();
    const result = await db.query(query, params);

    const filename = `logs-export-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      // Export CSV
      const csvHeaders = 'ID,Utilisateur,Action,DateHeure,Timestamp\n';
      const csvData = result.rows.map(row => 
        `${row.logid},"${row.utilisateur.replace(/"/g, '""')}","${row.action.replace(/"/g, '""')}","${row.dateheure}",${row.timestamp}`
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.write('\uFEFF'); // BOM UTF-8
      res.send(csvHeaders + csvData);

    } else if (format === 'json') {
      // Export JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        exportDate: new Date().toISOString(),
        total: result.rows.length,
        filters: { dateDebut, dateFin, utilisateur },
        logs: result.rows,
        performance: {
          queryTime: Date.now() - startTime
        }
      });

    } else {
      res.status(400).json({
        success: false,
        error: 'Format non supporté. Utilisez json ou csv'
      });
    }

  } catch (err) {
    console.error('❌ Erreur exportLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Méthode utilitaire pour logger les actions
 */
exports.logAction = async (utilisateur, action) => {
  try {
    if (!utilisateur || !action) {
      console.warn('⚠️ Tentative de log avec paramètres manquants');
      return;
    }

    await db.query(
      'INSERT INTO log (utilisateur, action, dateheure) VALUES ($1, $2, NOW())',
      [utilisateur.trim(), action.trim()]
    );
  } catch (err) {
    console.error('❌ Erreur lors de la journalisation:', err.message);
  }
};

/**
 * Récupérer les logs avec filtres avancés
 * GET /api/logs/filtered
 */
exports.getFilteredLogs = async (req, res) => {
  try {
    const {
      utilisateur,
      action,
      dateDebut,
      dateFin,
      page = 1,
      limit = CONFIG.defaultLimit,
      sort = 'desc'
    } = req.query;

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), CONFIG.maxLimit);
    const offset = (actualPage - 1) * actualLimit;

    let query = 'SELECT logid, utilisateur, action, TO_CHAR(dateheure, \'YYYY-MM-DD HH24:MI:SS\') as dateheure FROM log WHERE 1=1';
    const params = [];
    let paramCount = 0;

    // Filtres
    if (utilisateur && utilisateur.trim() !== '') {
      paramCount++;
      query += ` AND utilisateur ILIKE $${paramCount}`;
      params.push(`%${utilisateur.trim()}%`);
    }

    if (action && action.trim() !== '') {
      paramCount++;
      query += ` AND action ILIKE $${paramCount}`;
      params.push(`%${action.trim()}%`);
    }

    if (dateDebut) {
      paramCount++;
      query += ` AND dateheure >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dateheure <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }

    // Requête COUNT
    let countQuery = query.replace(
      /SELECT[\s\S]*?FROM/,
      'SELECT COUNT(*) as total FROM'
    );

    // Tri
    query += ` ORDER BY dateheure ${sort === 'asc' ? 'ASC' : 'DESC'}`;
    
    // Pagination
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    const startTime = Date.now();

    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, params.slice(0, paramCount))
    ]);

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    // Suggestions pour auto-complétion
    let suggestions = [];
    if (!action && result.rows.length > 0) {
      suggestions = CONFIG.commonActions.filter(a => 
        !result.rows.some(r => r.action === a)
      ).slice(0, 5);
    }

    res.json({
      success: true,
      logs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages,
        hasNext: actualPage < totalPages,
        hasPrev: actualPage > 1
      },
      filtres: {
        utilisateur: utilisateur || null,
        action: action || null,
        dateDebut: dateDebut || null,
        dateFin: dateFin || null,
        sort
      },
      suggestions,
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getFilteredLogs:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Obtenir les actions fréquentes pour auto-complétion
 * GET /api/logs/actions
 */
exports.getCommonActions = async (req, res) => {
  try {
    const { search } = req.query;

    let actions = CONFIG.commonActions;

    if (search && search.trim() !== '') {
      const searchTerm = search.toLowerCase();
      actions = actions.filter(a => 
        a.toLowerCase().includes(searchTerm)
      );
    }

    // Récupérer aussi les actions réelles de la base
    const dbActions = await db.query(`
      SELECT DISTINCT action, COUNT(*) as frequency
      FROM log
      GROUP BY action
      ORDER BY frequency DESC
      LIMIT 10
    `);

    res.json({
      success: true,
      suggestions: actions,
      populaires: dbActions.rows,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ Erreur getCommonActions:', err);
    res.status(500).json({ 
      success: false,
      error: err.message 
    });
  }
};

/**
 * Diagnostic du système de logs
 * GET /api/logs/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        COUNT(*) as total_logs,
        COUNT(DISTINCT utilisateur) as utilisateurs_distincts,
        COUNT(DISTINCT action) as actions_distinctes,
        MIN(dateheure) as premier_log,
        MAX(dateheure) as dernier_log,
        COUNT(CASE WHEN dateheure > NOW() - INTERVAL '24 hours' THEN 1 END) as logs_24h,
        COUNT(CASE WHEN dateheure > NOW() - INTERVAL '7 days' THEN 1 END) as logs_7j,
        pg_total_relation_size('log') as table_size,
        pg_size_pretty(pg_total_relation_size('log')) as table_size_pretty
      FROM log
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'logs',
      statistiques: {
        total_logs: parseInt(stats.total_logs),
        utilisateurs_distincts: parseInt(stats.utilisateurs_distincts),
        actions_distinctes: parseInt(stats.actions_distinctes),
        premier_log: stats.premier_log,
        dernier_log: stats.dernier_log,
        logs_24h: parseInt(stats.logs_24h),
        logs_7j: parseInt(stats.logs_7j)
      },
      stockage: {
        taille_table: stats.table_size_pretty,
        taille_bytes: parseInt(stats.table_size)
      },
      config: CONFIG,
      performance: {
        queryTime: Date.now() - startTime
      },
      endpoints: [
        '/api/logs',
        '/api/logs/user/:utilisateur',
        '/api/logs/date-range',
        '/api/logs/recent',
        '/api/logs/stats',
        '/api/logs/search',
        '/api/logs/filtered',
        '/api/logs/export',
        '/api/logs/actions',
        '/api/logs/diagnostic'
      ]
    });

  } catch (err) {
    console.error('❌ Erreur diagnostic:', err);
    res.status(500).json({
      success: false,
      error: err.message
    });
  }
};