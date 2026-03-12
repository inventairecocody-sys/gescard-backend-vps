// Controllers/agencesController.js
const { pool } = require('../db/db');

// ── Helpers ──────────────────────────────────────────────────
const isAdmin = (r) => r === 'Administrateur';
const isGest = (r) => r === 'Gestionnaire';
const isChef = (r) => r === "Chef d'équipe";
const isAdminOrGest = (r) => isAdmin(r) || isGest(r);

// ─────────────────────────────────────────────────────────────
// GET /api/agences
// Retourne les agences selon le rôle de l'utilisateur
// ─────────────────────────────────────────────────────────────
const getAllAgences = async (req, res) => {
  const client = await pool.connect();
  try {
    const { role, coordination_id } = req.user;
    const { coordination_id: filterCoord, is_active } = req.query;

    let where = 'WHERE 1=1';
    const params = [];

    // Gestionnaire : uniquement sa coordination
    if (isGest(role)) {
      params.push(coordination_id);
      where += ` AND a.coordination_id = $${params.length}`;
    }
    // Chef d'équipe : uniquement son agence
    else if (isChef(role)) {
      if (req.user.agence_id) {
        params.push(req.user.agence_id);
        where += ` AND a.id = $${params.length}`;
      }
    }

    // Filtres optionnels (Admin/Gestionnaire)
    if (filterCoord && isAdminOrGest(role)) {
      params.push(parseInt(filterCoord));
      where += ` AND a.coordination_id = $${params.length}`;
    }
    if (is_active !== undefined) {
      params.push(is_active === 'true');
      where += ` AND a.is_active = $${params.length}`;
    }

    const result = await client.query(
      `
      SELECT
        a.id,
        a.nom,
        a.coordination_id,
        c.nom        AS coordination_nom,
        c.code       AS coordination_code,
        a.responsable,
        a.telephone,
        a.email,
        a.adresse,
        a.description,
        a.is_active,
        a.created_at,
        a.updated_at,
        COUNT(DISTINCT s.id)  AS nombre_sites,
        COUNT(DISTINCT us.utilisateur_id) AS nombre_agents
      FROM agences a
      LEFT JOIN coordinations c  ON c.id = a.coordination_id
      LEFT JOIN sites s          ON s.agence_id = a.id AND s.is_active = true
      LEFT JOIN utilisateur_sites us ON us.site_id = s.id
      ${where}
      GROUP BY a.id, c.nom, c.code
      ORDER BY c.nom, a.nom
    `,
      params
    );

    res.json({
      success: true,
      agences: result.rows.map((a) => ({
        ...a,
        nombre_sites: parseInt(a.nombre_sites) || 0,
        nombre_agents: parseInt(a.nombre_agents) || 0,
      })),
      total: result.rows.length,
    });
  } catch (err) {
    console.error('❌ getAllAgences:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/agences/:id
// ─────────────────────────────────────────────────────────────
const getAgenceById = async (req, res) => {
  const client = await pool.connect();
  try {
    const { id } = req.params;
    const agenceId = parseInt(id);
    if (isNaN(agenceId) || agenceId <= 0)
      return res.status(400).json({ success: false, message: 'ID invalide' });

    const result = await client.query(
      `
      SELECT
        a.*,
        c.nom  AS coordination_nom,
        c.code AS coordination_code
      FROM agences a
      LEFT JOIN coordinations c ON c.id = a.coordination_id
      WHERE a.id = $1
    `,
      [agenceId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Agence non trouvée' });

    const agence = result.rows[0];

    // Sites de cette agence
    const sitesRes = await client.query(
      `
      SELECT id, nom, is_active, total_cards, pending_cards, synced_cards
      FROM sites
      WHERE agence_id = $1
      ORDER BY nom
    `,
      [agenceId]
    );

    agence.sites = sitesRes.rows;

    res.json({ success: true, agence });
  } catch (err) {
    console.error('❌ getAgenceById:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// POST /api/agences — Admin uniquement
// ─────────────────────────────────────────────────────────────
const createAgence = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isAdmin(req.user.role))
      return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });

    const { Nom, CoordinationId, Responsable, Telephone, Email, Adresse, Description } = req.body;

    if (!Nom || !Nom.trim())
      return res.status(400).json({ success: false, message: 'Le nom est obligatoire' });
    if (!CoordinationId)
      return res.status(400).json({ success: false, message: 'La coordination est obligatoire' });

    // Vérifier que la coordination existe
    const coordCheck = await client.query('SELECT id FROM coordinations WHERE id = $1', [
      CoordinationId,
    ]);
    if (coordCheck.rows.length === 0)
      return res.status(400).json({ success: false, message: 'Coordination introuvable' });

    // Vérifier doublon
    const doublon = await client.query(
      'SELECT id FROM agences WHERE LOWER(nom) = LOWER($1) AND coordination_id = $2',
      [Nom.trim(), CoordinationId]
    );
    if (doublon.rows.length > 0)
      return res.status(400).json({
        success: false,
        message: 'Une agence avec ce nom existe déjà dans cette coordination',
      });

    const result = await client.query(
      `
      INSERT INTO agences (nom, coordination_id, responsable, telephone, email, adresse, description, is_active, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, $8)
      RETURNING *
    `,
      [
        Nom.trim(),
        CoordinationId,
        Responsable || null,
        Telephone || null,
        Email || null,
        Adresse || null,
        Description || null,
        req.user.nomutilisateur || req.user.nomUtilisateur,
      ]
    );

    res.status(201).json({
      success: true,
      message: 'Agence créée avec succès',
      agence: result.rows[0],
    });
  } catch (err) {
    console.error('❌ createAgence:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// PUT /api/agences/:id — Admin uniquement
// ─────────────────────────────────────────────────────────────
const updateAgence = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isAdmin(req.user.role))
      return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });

    const agenceId = parseInt(req.params.id);
    if (isNaN(agenceId) || agenceId <= 0)
      return res.status(400).json({ success: false, message: 'ID invalide' });

    const existing = await client.query('SELECT * FROM agences WHERE id = $1', [agenceId]);
    if (existing.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Agence non trouvée' });

    const old = existing.rows[0];
    const { Nom, Responsable, Telephone, Email, Adresse, Description, IsActive } = req.body;

    const result = await client.query(
      `
      UPDATE agences SET
        nom         = $1,
        responsable = $2,
        telephone   = $3,
        email       = $4,
        adresse     = $5,
        description = $6,
        is_active   = $7,
        updated_by  = $8,
        updated_at  = NOW()
      WHERE id = $9
      RETURNING *
    `,
      [
        Nom !== undefined ? Nom.trim() : old.nom,
        Responsable !== undefined ? Responsable : old.responsable,
        Telephone !== undefined ? Telephone : old.telephone,
        Email !== undefined ? Email : old.email,
        Adresse !== undefined ? Adresse : old.adresse,
        Description !== undefined ? Description : old.description,
        IsActive !== undefined ? IsActive : old.is_active,
        req.user.nomutilisateur || req.user.nomUtilisateur,
        agenceId,
      ]
    );

    res.json({
      success: true,
      message: 'Agence modifiée avec succès',
      agence: result.rows[0],
    });
  } catch (err) {
    console.error('❌ updateAgence:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// DELETE /api/agences/:id — Admin uniquement
// ─────────────────────────────────────────────────────────────
const deleteAgence = async (req, res) => {
  const client = await pool.connect();
  try {
    if (!isAdmin(req.user.role))
      return res.status(403).json({ success: false, message: 'Accès réservé aux administrateurs' });

    const agenceId = parseInt(req.params.id);
    if (isNaN(agenceId) || agenceId <= 0)
      return res.status(400).json({ success: false, message: 'ID invalide' });

    const existing = await client.query('SELECT * FROM agences WHERE id = $1', [agenceId]);
    if (existing.rows.length === 0)
      return res.status(404).json({ success: false, message: 'Agence non trouvée' });

    // Vérifier qu'aucun site n'y est lié
    const sitesLies = await client.query('SELECT COUNT(*) FROM sites WHERE agence_id = $1', [
      agenceId,
    ]);
    if (parseInt(sitesLies.rows[0].count) > 0)
      return res.status(400).json({
        success: false,
        message: `Impossible de supprimer : ${sitesLies.rows[0].count} site(s) rattaché(s) à cette agence`,
      });

    await client.query('DELETE FROM agences WHERE id = $1', [agenceId]);

    res.json({ success: true, message: 'Agence supprimée avec succès' });
  } catch (err) {
    console.error('❌ deleteAgence:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  } finally {
    client.release();
  }
};

// ─────────────────────────────────────────────────────────────
// GET /api/agences/stats — Stats par agence
// ─────────────────────────────────────────────────────────────
const getStatsAgences = async (req, res) => {
  const client = await pool.connect();
  try {
    const { role, coordination_id, agence_id } = req.user;

    let where = 'WHERE 1=1';
    const params = [];

    if (isGest(role)) {
      params.push(coordination_id);
      where += ` AND a.coordination_id = $${params.length}`;
    } else if (isChef(role) && agence_id) {
      params.push(agence_id);
      where += ` AND a.id = $${params.length}`;
    }

    const result = await client.query(
      `
      SELECT
        a.id,
        a.nom                                        AS agence_nom,
        c.nom                                        AS coordination_nom,
        COUNT(DISTINCT s.id)                         AS nombre_sites,
        COUNT(DISTINCT u.id)                         AS nombre_agents,
        COALESCE(SUM(s.total_cards),   0)            AS total_cartes,
        COALESCE(SUM(s.pending_cards), 0)            AS cartes_en_attente,
        COALESCE(SUM(s.synced_cards),  0)            AS cartes_synchronisees,
        COALESCE(SUM(s.conflict_cards),0)            AS cartes_conflits,
        ROUND(
          CASE WHEN SUM(s.total_cards) > 0
            THEN SUM(s.synced_cards)::numeric / SUM(s.total_cards) * 100
            ELSE 0
          END, 1
        )                                            AS taux_sync
      FROM agences a
      LEFT JOIN coordinations c       ON c.id = a.coordination_id
      LEFT JOIN sites s               ON s.agence_id = a.id
      LEFT JOIN utilisateur_sites us  ON us.site_id = s.id
      LEFT JOIN utilisateurs u        ON u.id = us.utilisateur_id AND u.actif = true
      ${where}
      GROUP BY a.id, a.nom, c.nom
      ORDER BY c.nom, a.nom
    `,
      params
    );

    res.json({
      success: true,
      stats: result.rows.map((r) => ({
        ...r,
        nombre_sites: parseInt(r.nombre_sites) || 0,
        nombre_agents: parseInt(r.nombre_agents) || 0,
        total_cartes: parseInt(r.total_cartes) || 0,
        cartes_en_attente: parseInt(r.cartes_en_attente) || 0,
        cartes_synchronisees: parseInt(r.cartes_synchronisees) || 0,
        cartes_conflits: parseInt(r.cartes_conflits) || 0,
        taux_sync: parseFloat(r.taux_sync) || 0,
      })),
    });
  } catch (err) {
    console.error('❌ getStatsAgences:', err.message);
    res.status(500).json({ success: false, message: 'Erreur serveur', error: err.message });
  } finally {
    client.release();
  }
};

module.exports = {
  getAllAgences,
  getAgenceById,
  createAgence,
  updateAgence,
  deleteAgence,
  getStatsAgences,
};
