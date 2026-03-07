// Controllers/coordinationsController.js
// CRUD complet sur la table `coordinations` — Administrateur uniquement

const db = require('../db/db');

// ─── Helpers ────────────────────────────────────────────────────────────────

const isAdmin = (req, res) => {
  if (req.user?.role !== 'Administrateur') {
    res.status(403).json({ success: false, message: 'Réservé aux Administrateurs' });
    return false;
  }
  return true;
};

const journal = async (req, action, details = '') => {
  try {
    const journalService = require('../Services/journalService');
    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      action,
      actionType: action.toUpperCase().replace(/\s+/g, '_'),
      tableName: 'coordinations',
      details,
      ip: req.ip,
    });
  } catch (e) {
    console.warn('⚠️ Journal non écrit:', e.message);
  }
};

// ─── GET /api/coordinations ──────────────────────────────────────────────────
// Liste toutes les coordinations avec stats (nb sites, nb agents)
const listerCoordinations = async (req, res) => {
  try {
    const result = await db.query(`
      SELECT
        c.id,
        c.nom,
        c.code,
        c.responsable,
        c.telephone,
        c.email,
        c.region,
        c.ville_principale,
        c.description,
        c.is_active,
        c.created_at,
        c.updated_at,
        COUNT(DISTINCT s.id)          AS nb_sites,
        COUNT(DISTINCT u.id)          AS nb_utilisateurs
      FROM coordinations c
      LEFT JOIN sites s       ON s.coordination_id = c.id AND s.is_active = true
      LEFT JOIN utilisateurs u ON u.coordination_id = c.id AND u.actif = true
      GROUP BY c.id
      ORDER BY c.id ASC
    `);

    res.json({
      success: true,
      coordinations: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error('❌ listerCoordinations:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── GET /api/coordinations/:id ──────────────────────────────────────────────
const getCoordination = async (req, res) => {
  try {
    const { id } = req.params;
    const result = await db.query('SELECT * FROM coordinations WHERE id = $1', [id]);
    if (!result.rows.length) {
      return res.status(404).json({ success: false, message: 'Coordination introuvable' });
    }
    res.json({ success: true, coordination: result.rows[0] });
  } catch (error) {
    console.error('❌ getCoordination:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── POST /api/coordinations ─────────────────────────────────────────────────
const creerCoordination = async (req, res) => {
  if (!isAdmin(req, res)) return;

  try {
    const {
      nom,
      code,
      responsable,
      telephone,
      email,
      region,
      ville_principale,
      description,
      is_active = true,
    } = req.body;

    if (!nom?.trim() || !code?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Le nom et le code sont obligatoires',
      });
    }

    // Vérifier unicité du code
    const existing = await db.query('SELECT id FROM coordinations WHERE UPPER(code) = UPPER($1)', [
      code.trim(),
    ]);
    if (existing.rows.length) {
      return res.status(409).json({
        success: false,
        message: `Le code "${code.toUpperCase()}" est déjà utilisé`,
      });
    }

    const result = await db.query(
      `
      INSERT INTO coordinations
        (nom, code, responsable, telephone, email, region, ville_principale, description, is_active, created_by)
      VALUES ($1, UPPER($2), $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `,
      [
        nom.trim(),
        code.trim(),
        responsable || null,
        telephone || null,
        email || null,
        region || null,
        ville_principale || null,
        description || null,
        is_active,
        req.user.id,
      ]
    );

    await journal(
      req,
      'Création coordination',
      `Nouvelle coordination: ${nom} (${code.toUpperCase()})`
    );

    console.log(
      `✅ Coordination créée: ${nom} (${code.toUpperCase()}) par ${req.user.nomUtilisateur}`
    );

    res.status(201).json({
      success: true,
      message: `Coordination "${nom}" créée avec succès`,
      coordination: result.rows[0],
    });
  } catch (error) {
    console.error('❌ creerCoordination:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── PUT /api/coordinations/:id ──────────────────────────────────────────────
const modifierCoordination = async (req, res) => {
  if (!isAdmin(req, res)) return;

  try {
    const { id } = req.params;
    const {
      nom,
      code,
      responsable,
      telephone,
      email,
      region,
      ville_principale,
      description,
      is_active,
    } = req.body;

    if (!nom?.trim() || !code?.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Le nom et le code sont obligatoires',
      });
    }

    // Vérifier que la coordination existe
    const existing = await db.query('SELECT id FROM coordinations WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Coordination introuvable' });
    }

    // Vérifier unicité du code (excluant soi-même)
    const codeConflict = await db.query(
      'SELECT id FROM coordinations WHERE UPPER(code) = UPPER($1) AND id != $2',
      [code.trim(), id]
    );
    if (codeConflict.rows.length) {
      return res.status(409).json({
        success: false,
        message: `Le code "${code.toUpperCase()}" est déjà utilisé par une autre coordination`,
      });
    }

    const result = await db.query(
      `
      UPDATE coordinations SET
        nom             = $1,
        code            = UPPER($2),
        responsable     = $3,
        telephone       = $4,
        email           = $5,
        region          = $6,
        ville_principale = $7,
        description     = $8,
        is_active       = $9,
        updated_by      = $10,
        updated_at      = NOW()
      WHERE id = $11
      RETURNING *
    `,
      [
        nom.trim(),
        code.trim(),
        responsable || null,
        telephone || null,
        email || null,
        region || null,
        ville_principale || null,
        description || null,
        is_active ?? true,
        req.user.id,
        id,
      ]
    );

    await journal(
      req,
      'Modification coordination',
      `Coordination modifiée: ${nom} (${code.toUpperCase()})`
    );

    res.json({
      success: true,
      message: `Coordination "${nom}" modifiée avec succès`,
      coordination: result.rows[0],
    });
  } catch (error) {
    console.error('❌ modifierCoordination:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

// ─── DELETE /api/coordinations/:id ───────────────────────────────────────────
const supprimerCoordination = async (req, res) => {
  if (!isAdmin(req, res)) return;

  try {
    const { id } = req.params;

    // Vérifier que la coordination existe
    const existing = await db.query('SELECT nom, code FROM coordinations WHERE id = $1', [id]);
    if (!existing.rows.length) {
      return res.status(404).json({ success: false, message: 'Coordination introuvable' });
    }

    const { nom, code } = existing.rows[0];

    // Vérifier qu'aucun site actif ne dépend de cette coordination
    const sitesActifs = await db.query(
      'SELECT COUNT(*) FROM sites WHERE coordination_id = $1 AND is_active = true',
      [id]
    );
    if (parseInt(sitesActifs.rows[0].count) > 0) {
      return res.status(409).json({
        success: false,
        message: `Impossible de supprimer : ${sitesActifs.rows[0].count} site(s) actif(s) dépendent de cette coordination`,
      });
    }

    // Vérifier qu'aucun utilisateur actif n'est lié
    const utilisateursActifs = await db.query(
      'SELECT COUNT(*) FROM utilisateurs WHERE coordination_id = $1 AND actif = true',
      [id]
    );
    if (parseInt(utilisateursActifs.rows[0].count) > 0) {
      return res.status(409).json({
        success: false,
        message: `Impossible de supprimer : ${utilisateursActifs.rows[0].count} utilisateur(s) actif(s) dépendent de cette coordination`,
      });
    }

    await db.query('DELETE FROM coordinations WHERE id = $1', [id]);

    await journal(req, 'Suppression coordination', `Coordination supprimée: ${nom} (${code})`);

    console.log(`🗑️ Coordination supprimée: ${nom} (${code}) par ${req.user.nomUtilisateur}`);

    res.json({
      success: true,
      message: `Coordination "${nom}" supprimée avec succès`,
    });
  } catch (error) {
    console.error('❌ supprimerCoordination:', error);
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  listerCoordinations,
  getCoordination,
  creerCoordination,
  modifierCoordination,
  supprimerCoordination,
};
