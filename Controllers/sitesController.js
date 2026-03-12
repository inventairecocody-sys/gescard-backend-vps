// ============================================
// Controllers/sitesController.js
// ============================================

const db = require('../db/db');
const journalService = require('../Services/journalService');

// ============================================
// GET ALL SITES
// ============================================
const getAllSites = async (req, res) => {
  try {
    const acteur = req.user;

    let query = `
      SELECT
        s.id, s.nom, s.coordination_id,
        c.nom     AS coordination_nom,
        c.code    AS coordination_code,
        s.adresse, s.telephone, s.email,
        s.responsable_nom, s.responsable_email,
        s.is_active,
        s.total_cards, s.pending_cards, s.synced_cards, s.conflict_cards,
        s.sync_frequency,
        TO_CHAR(s.created_at,    'YYYY-MM-DD HH24:MI:SS') AS created_at,
        TO_CHAR(s.updated_at,    'YYYY-MM-DD HH24:MI:SS') AS updated_at,
        TO_CHAR(s.last_sync_at,  'YYYY-MM-DD HH24:MI:SS') AS last_sync_at
      FROM sites s
      JOIN coordinations c ON c.id = s.coordination_id
      WHERE 1=1
    `;
    const params = [];

    // Filtrage selon le rôle
    if (acteur.role === 'Gestionnaire' && acteur.coordination_id) {
      params.push(acteur.coordination_id);
      query += ` AND s.coordination_id = $${params.length}`;
    } else if (acteur.role === "Chef d'équipe" && acteur.agence) {
      params.push(acteur.agence);
      query += ` AND s.nom = $${params.length}`;
    }

    // Filtres optionnels
    const { coordination_id, is_active, search } = req.query;

    if (coordination_id && acteur.role === 'Administrateur') {
      params.push(parseInt(coordination_id));
      query += ` AND s.coordination_id = $${params.length}`;
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      query += ` AND s.is_active = $${params.length}`;
    }
    if (search && search.trim() !== '') {
      params.push(`%${search.trim()}%`);
      query += ` AND (s.nom ILIKE $${params.length} OR s.id ILIKE $${params.length})`;
    }

    query += ` ORDER BY c.nom, s.nom`;

    const startTime = Date.now();
    const result = await db.query(query, params);

    res.json({
      success: true,
      sites: result.rows,
      total: result.rows.length,
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération sites:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// GET SITE BY ID
// ============================================
const getSiteById = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `SELECT
         s.id, s.nom, s.coordination_id,
         c.nom  AS coordination_nom,
         c.code AS coordination_code,
         s.adresse, s.telephone, s.email,
         s.responsable_nom, s.responsable_email,
         s.api_key, s.is_active,
         s.total_cards, s.pending_cards, s.synced_cards, s.conflict_cards,
         s.sync_frequency, s.last_sync_error,
         TO_CHAR(s.created_at,   'YYYY-MM-DD HH24:MI:SS') AS created_at,
         TO_CHAR(s.updated_at,   'YYYY-MM-DD HH24:MI:SS') AS updated_at,
         TO_CHAR(s.last_sync_at, 'YYYY-MM-DD HH24:MI:SS') AS last_sync_at
       FROM sites s
       JOIN coordinations c ON c.id = s.coordination_id
       WHERE s.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Site non trouvé' });
    }

    const site = result.rows[0];

    // Vérification périmètre selon rôle
    const acteur = req.user;
    if (
      acteur.role === 'Gestionnaire' &&
      acteur.coordination_id &&
      site.coordination_id !== acteur.coordination_id
    ) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé à ce site' });
    }
    if (acteur.role === "Chef d'équipe" && acteur.agence && site.nom !== acteur.agence) {
      return res.status(403).json({ success: false, message: 'Accès non autorisé à ce site' });
    }

    // Utilisateurs liés au site
    let utilisateurs = [];
    try {
      const usersResult = await db.query(
        `SELECT u.id, u.nomcomplet, u.nomutilisateur, u.role, u.actif,
                us.est_site_principal
         FROM utilisateur_sites us
         JOIN utilisateurs u ON u.id = us.utilisateur_id
         WHERE us.site_id = $1
         ORDER BY us.est_site_principal DESC, u.nomcomplet`,
        [id]
      );
      utilisateurs = usersResult.rows;
    } catch (e) {
      console.warn('⚠️ Impossible de récupérer les utilisateurs du site:', e.message);
    }

    res.json({
      success: true,
      site: { ...site, utilisateurs },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// CREATE SITE  (Admin uniquement)
// ============================================
const createSite = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const {
      Nom,
      CoordinationId,
      Adresse,
      Telephone,
      Email,
      ResponsableNom,
      ResponsableEmail,
      SyncFrequency = 30,
    } = req.body;

    if (!Nom || !CoordinationId) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Le nom et la coordination sont obligatoires',
      });
    }

    // Vérifier que la coordination existe
    const coordResult = await client.query(
      'SELECT id, nom, code FROM coordinations WHERE id = $1',
      [parseInt(CoordinationId)]
    );
    if (coordResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Coordination introuvable' });
    }

    // Vérifier qu'un site avec ce nom n'existe pas déjà dans cette coordination
    const existingResult = await client.query(
      'SELECT id FROM sites WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1)) AND coordination_id = $2',
      [Nom, parseInt(CoordinationId)]
    );
    if (existingResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Un site avec ce nom existe déjà dans cette coordination',
      });
    }

    // L'id est généré automatiquement par le trigger trg_before_insert_site
    const result = await client.query(
      `INSERT INTO sites
         (nom, coordination_id, adresse, telephone, email,
          responsable_nom, responsable_email, sync_frequency,
          is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, NOW(), NOW())
       RETURNING id, nom`,
      [
        Nom.trim(),
        parseInt(CoordinationId),
        Adresse || null,
        Telephone || null,
        Email || null,
        ResponsableNom || null,
        ResponsableEmail || null,
        SyncFrequency,
      ]
    );

    const newSite = result.rows[0];

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Création site: ${newSite.nom}`,
      actionType: 'CREATE_SITE',
      tableName: 'Sites',
      recordId: newSite.id,
      oldValue: null,
      newValue: JSON.stringify({ Nom, CoordinationId, Adresse, Telephone, Email }),
      details: `Nouveau site créé: ${newSite.nom} (${newSite.id})`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.status(201).json({
      success: true,
      message: 'Site créé avec succès',
      siteId: newSite.id,
      nom: newSite.nom,
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur création site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// UPDATE SITE  (Admin uniquement)
// ============================================
const updateSite = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const oldResult = await client.query('SELECT * FROM sites WHERE id = $1', [id]);
    if (oldResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Site non trouvé' });
    }
    const oldSite = oldResult.rows[0];

    const {
      Nom,
      CoordinationId,
      Adresse,
      Telephone,
      Email,
      ResponsableNom,
      ResponsableEmail,
      SyncFrequency,
      IsActive,
    } = req.body;

    // Vérifier doublon de nom si on change le nom ou la coordination
    const newNom = Nom !== undefined ? Nom.trim() : oldSite.nom;
    const newCoordId =
      CoordinationId !== undefined ? parseInt(CoordinationId) : oldSite.coordination_id;

    if (Nom !== undefined || CoordinationId !== undefined) {
      const dupeResult = await client.query(
        `SELECT id FROM sites
         WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))
           AND coordination_id = $2
           AND id != $3`,
        [newNom, newCoordId, id]
      );
      if (dupeResult.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Un site avec ce nom existe déjà dans cette coordination',
        });
      }
    }

    await client.query(
      `UPDATE sites SET
         nom               = $1,
         coordination_id   = $2,
         adresse           = $3,
         telephone         = $4,
         email             = $5,
         responsable_nom   = $6,
         responsable_email = $7,
         sync_frequency    = $8,
         is_active         = $9,
         updated_at        = NOW()
       WHERE id = $10`,
      [
        newNom,
        newCoordId,
        Adresse !== undefined ? Adresse : oldSite.adresse,
        Telephone !== undefined ? Telephone : oldSite.telephone,
        Email !== undefined ? Email : oldSite.email,
        ResponsableNom !== undefined ? ResponsableNom : oldSite.responsable_nom,
        ResponsableEmail !== undefined ? ResponsableEmail : oldSite.responsable_email,
        SyncFrequency !== undefined ? SyncFrequency : oldSite.sync_frequency,
        IsActive !== undefined ? IsActive : oldSite.is_active,
        id,
      ]
    );

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Modification site: ${oldSite.nom}`,
      actionType: 'UPDATE_SITE',
      tableName: 'Sites',
      recordId: id,
      oldValue: JSON.stringify({
        nom: oldSite.nom,
        coordination_id: oldSite.coordination_id,
        is_active: oldSite.is_active,
      }),
      newValue: JSON.stringify({
        nom: newNom,
        coordination_id: newCoordId,
        is_active: IsActive !== undefined ? IsActive : oldSite.is_active,
      }),
      details: `Site modifié: ${newNom}`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Site modifié avec succès',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur modification site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// DELETE SITE  (Admin uniquement)
// ============================================
const deleteSite = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const siteResult = await client.query('SELECT * FROM sites WHERE id = $1', [id]);
    if (siteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Site non trouvé' });
    }
    const site = siteResult.rows[0];

    // Bloquer suppression si des cartes sont liées
    const cartesResult = await client.query(
      'SELECT COUNT(*) as total FROM cartes WHERE site_proprietaire_id = $1 AND deleted_at IS NULL',
      [id]
    );
    const nbCartes = parseInt(cartesResult.rows[0].total);
    if (nbCartes > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Impossible de supprimer ce site : ${nbCartes} carte(s) lui sont associées`,
      });
    }

    // Bloquer suppression si des utilisateurs sont liés
    const usersResult = await client.query(
      'SELECT COUNT(*) as total FROM utilisateur_sites WHERE site_id = $1',
      [id]
    );
    const nbUsers = parseInt(usersResult.rows[0].total);
    if (nbUsers > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: `Impossible de supprimer ce site : ${nbUsers} utilisateur(s) y sont affectés. Réaffectez-les d'abord.`,
      });
    }

    await client.query('DELETE FROM sites WHERE id = $1', [id]);

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Suppression site: ${site.nom}`,
      actionType: 'DELETE_SITE',
      tableName: 'Sites',
      recordId: id,
      oldValue: JSON.stringify({
        id: site.id,
        nom: site.nom,
        coordination_id: site.coordination_id,
      }),
      newValue: null,
      details: `Site supprimé: ${site.nom} (${id})`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: 'Site supprimé avec succès',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur suppression site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// TOGGLE SITE ACTIF/INACTIF  (Admin uniquement)
// ============================================
const toggleSiteActif = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    const siteResult = await client.query('SELECT id, nom, is_active FROM sites WHERE id = $1', [
      id,
    ]);
    if (siteResult.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Site non trouvé' });
    }

    const site = siteResult.rows[0];
    const newStatus = !site.is_active;

    await client.query('UPDATE sites SET is_active = $1, updated_at = NOW() WHERE id = $2', [
      newStatus,
      id,
    ]);

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `${newStatus ? 'Activation' : 'Désactivation'} site: ${site.nom}`,
      actionType: 'TOGGLE_SITE',
      tableName: 'Sites',
      recordId: id,
      oldValue: JSON.stringify({ is_active: site.is_active }),
      newValue: JSON.stringify({ is_active: newStatus }),
      details: `Site ${newStatus ? 'activé' : 'désactivé'}: ${site.nom}`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    res.json({
      success: true,
      message: `Site ${newStatus ? 'activé' : 'désactivé'} avec succès`,
      is_active: newStatus,
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur toggle site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  } finally {
    client.release();
  }
};

// ============================================
// REFRESH STATS D'UN SITE  (Admin uniquement)
// ============================================
const refreshSiteStats = async (req, res) => {
  try {
    const { id } = req.params;

    const siteResult = await db.query('SELECT id FROM sites WHERE id = $1', [id]);
    if (siteResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Site non trouvé' });
    }

    // Appel de la fonction PostgreSQL existante
    await db.query('SELECT refresh_site_stats($1)', [id]);

    const updated = await db.query(
      'SELECT total_cards, pending_cards, synced_cards, conflict_cards FROM sites WHERE id = $1',
      [id]
    );

    res.json({
      success: true,
      message: 'Statistiques rafraîchies',
      stats: updated.rows[0],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur refresh stats site:', error);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: error.message });
  }
};

// ============================================
// DIAGNOSTIC  (Admin uniquement)
// ============================================
const diagnostic = async (req, res) => {
  try {
    const startTime = Date.now();

    const result = await db.query(`
      SELECT
        COUNT(*)                                        AS total_sites,
        COUNT(*) FILTER (WHERE is_active = true)        AS sites_actifs,
        COUNT(*) FILTER (WHERE is_active = false)       AS sites_inactifs,
        COALESCE(SUM(total_cards), 0)                   AS total_cartes,
        COALESCE(SUM(pending_cards), 0)                 AS cartes_en_attente,
        COALESCE(SUM(synced_cards), 0)                  AS cartes_synchronisees,
        COUNT(DISTINCT coordination_id)                 AS coordinations_distinctes,
        pg_size_pretty(pg_total_relation_size('sites')) AS table_size
      FROM sites
    `);

    res.json({
      success: true,
      service: 'sites',
      statistiques: {
        total_sites: parseInt(result.rows[0].total_sites),
        sites_actifs: parseInt(result.rows[0].sites_actifs),
        sites_inactifs: parseInt(result.rows[0].sites_inactifs),
        total_cartes: parseInt(result.rows[0].total_cartes),
        cartes_en_attente: parseInt(result.rows[0].cartes_en_attente),
        cartes_synchronisees: parseInt(result.rows[0].cartes_synchronisees),
        coordinations_distinctes: parseInt(result.rows[0].coordinations_distinctes),
      },
      stockage: { taille_table: result.rows[0].table_size },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic sites:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getAllSites,
  getSiteById,
  createSite,
  updateSite,
  deleteSite,
  toggleSiteActif,
  refreshSiteStats,
  diagnostic,
};
