const db = require('../db/db');
const journalController = require('./journalController');

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
