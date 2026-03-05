// Controllers/utilisateursController.js

const bcrypt = require('bcryptjs');
const db = require('../db/db');
const journalService = require('../Services/journalService');

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
