// ============================================
// CONTROLLER JOURNAL
// ============================================

const db = require('../db/db');
const journalService = require('../Services/journalService');

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
