const bcrypt = require('bcryptjs');
const db = require('../db/db');
const journalService = require('../Services/journalService');
const { serverError, notFound, forbidden, badRequest } = require('../utils/errorResponse');

const CONFIG = {
  saltRounds: 12,
  minPasswordLength: 8,
  cacheTimeout: 300,
  statsCache: null,
  statsCacheTime: null,
  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

const peutGererUtilisateur = (acteur, cible = null) => {
  if (acteur.role === 'Administrateur') return true;
  if (acteur.role === 'Gestionnaire') return !cible || cible.coordination === acteur.coordination;
  if (acteur.role === "Chef d'équipe") return !cible || cible.agence === acteur.agence;
  return false;
};

const buildUserFilter = (acteur, params = [], baseWhere = 'WHERE 1=1') => {
  if (acteur.role === 'Administrateur') return { where: baseWhere, params };
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

// ── GET ALL USERS ──
const getAllUsers = async (req, res) => {
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role))
      return forbidden(res);

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
    let query = `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, TO_CHAR(datecreation,'YYYY-MM-DD HH24:MI:SS') as datecreation, TO_CHAR(derniereconnexion,'YYYY-MM-DD HH24:MI:SS') as derniereconnexion, actif FROM utilisateurs ${where}`;

    if (search?.trim()) {
      params.push(`%${search.trim()}%`);
      const idx = params.length;
      query += ` AND (nomutilisateur ILIKE $${idx} OR nomcomplet ILIKE $${idx} OR email ILIKE $${idx})`;
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

    // ✅ CORRIGÉ : countQuery utilise les mêmes filtres que la query principale
    const { where: whereC, params: countBaseParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    let countParams = [...countBaseParams];
    let countQuery = `SELECT COUNT(*) as total FROM utilisateurs ${whereC}`;
    if (search?.trim()) {
      countParams.push(`%${search.trim()}%`);
      const idx = countParams.length;
      countQuery += ` AND (nomutilisateur ILIKE $${idx} OR nomcomplet ILIKE $${idx} OR email ILIKE $${idx})`;
    }
    if (role) {
      countParams.push(role);
      countQuery += ` AND role = $${countParams.length}`;
    }
    if (coordination && acteur.role === 'Administrateur') {
      countParams.push(coordination);
      countQuery += ` AND coordination = $${countParams.length}`;
    }
    if (actif !== undefined) {
      countParams.push(actif === 'true');
      countQuery += ` AND actif = $${countParams.length}`;
    }

    const startTime = Date.now();
    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, countParams),
    ]);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      utilisateurs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
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
    return serverError(res, error, 'getAllUsers');
  }
};

// ── GET USER BY ID ──
const getUserById = async (req, res) => {
  try {
    const acteur = req.user;
    const userId = parseInt(req.params.id);
    if (isNaN(userId) || userId <= 0) return badRequest(res, 'ID utilisateur invalide');

    const isSelf = parseInt(acteur.id) === userId;
    if (!isSelf && !['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role))
      return forbidden(res);

    const startTime = Date.now();
    const result = await db.query(
      `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, TO_CHAR(datecreation,'YYYY-MM-DD HH24:MI:SS') as datecreation, TO_CHAR(derniereconnexion,'YYYY-MM-DD HH24:MI:SS') as derniereconnexion, actif FROM utilisateurs WHERE id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user) return notFound(res, 'Utilisateur non trouvé');
    if (!isSelf && !peutGererUtilisateur(acteur, user))
      return forbidden(res, 'Accès non autorisé à cet utilisateur');

    let sites = [];
    try {
      const sitesResult = await db.query(
        `SELECT s.id, s.nom, s.coordination_id, c.nom as coordination_nom, us.est_site_principal FROM utilisateur_sites us JOIN sites s ON us.site_id = s.id LEFT JOIN coordinations c ON c.id = s.coordination_id WHERE us.utilisateur_id = $1 ORDER BY us.est_site_principal DESC, s.nom`,
        [userId]
      );
      sites = sitesResult.rows;
    } catch {
      /* table optionnelle */
    }

    res.json({
      success: true,
      utilisateur: {
        ...user,
        nomUtilisateur: user.nomutilisateur,
        nomComplet: user.nomcomplet,
        derniereConnexion: user.derniereconnexion,
        dateCreation: user.datecreation,
        sites,
      },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'getUserById');
  }
};

// ── CREATE USER ──
const createUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return forbidden(res);
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

    if (!NomUtilisateur || !NomComplet || !MotDePasse || !Role) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Champs obligatoires manquants');
    }
    if (Role !== 'Administrateur' && (!SiteIds || SiteIds.length === 0)) {
      await client.query('ROLLBACK');
      return badRequest(res, "Au moins un site doit être associé à l'utilisateur");
    }
    if (!CONFIG.validRoles.includes(Role)) {
      await client.query('ROLLBACK');
      return badRequest(res, `Rôle invalide. Rôles valides: ${CONFIG.validRoles.join(', ')}`);
    }
    if (MotDePasse.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return badRequest(
        res,
        `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`
      );
    }

    if (acteur.role === 'Gestionnaire') {
      if (Coordination && Coordination !== acteur.coordination) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Vous ne pouvez créer des utilisateurs que dans votre coordination');
      }
      if (['Administrateur', 'Gestionnaire'].includes(Role)) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Vous ne pouvez pas créer un compte Administrateur ou Gestionnaire');
      }
    }
    if (acteur.role === "Chef d'équipe") {
      if (Agence && Agence !== acteur.agence) {
        await client.query('ROLLBACK');
        return forbidden(res, 'Vous ne pouvez créer des utilisateurs que dans votre site');
      }
      if (Role !== 'Opérateur') {
        await client.query('ROLLBACK');
        return forbidden(res, "Un Chef d'équipe ne peut créer que des Opérateurs");
      }
    }

    const existing = await client.query('SELECT id FROM utilisateurs WHERE nomutilisateur = $1', [
      NomUtilisateur,
    ]);
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return badRequest(res, "Ce nom d'utilisateur existe déjà");
    }
    if (Email) {
      const existingEmail = await client.query('SELECT id FROM utilisateurs WHERE email = $1', [
        Email,
      ]);
      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Cet email est déjà utilisé');
      }
    }

    let resolvedCoordinationId = CoordinationId || null;
    if (!resolvedCoordinationId && Coordination) {
      const coordResult = await client.query(
        'SELECT id FROM coordinations WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))',
        [Coordination]
      );
      if (coordResult.rows.length > 0) resolvedCoordinationId = coordResult.rows[0].id;
    }

    const hashedPassword = await bcrypt.hash(MotDePasse, CONFIG.saltRounds);
    const result = await client.query(
      `INSERT INTO utilisateurs (nomutilisateur, nomcomplet, email, agence, role, coordination, coordination_id, motdepasse, datecreation, actif, sync_timestamp, updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),NOW()) RETURNING id`,
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

    if (SiteIds?.length > 0) {
      for (let i = 0; i < SiteIds.length; i++) {
        await client.query(
          `INSERT INTO utilisateur_sites (utilisateur_id, site_id, est_site_principal) VALUES ($1,$2,$3) ON CONFLICT (utilisateur_id, site_id) DO NOTHING`,
          [newUserId, SiteIds[i], i === 0]
        );
      }
    } else if (Agence) {
      const siteResult = await client.query(
        'SELECT id FROM sites WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1))',
        [Agence]
      );
      if (siteResult.rows.length > 0) {
        await client.query(
          `INSERT INTO utilisateur_sites (utilisateur_id, site_id, est_site_principal) VALUES ($1,$2,true) ON CONFLICT (utilisateur_id, site_id) DO NOTHING`,
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
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'createUser');
  } finally {
    client.release();
  }
};

// ── UPDATE USER ──
const updateUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return forbidden(res);
    }
    await client.query('BEGIN');

    const userId = parseInt(req.params.id);
    if (isNaN(userId) || userId <= 0) {
      await client.query('ROLLBACK');
      return badRequest(res, 'ID utilisateur invalide');
    }

    const { NomComplet, Email, Agence, Role, Coordination, CoordinationId, Actif, SiteIds } =
      req.body;
    if (Role && !CONFIG.validRoles.includes(Role)) {
      await client.query('ROLLBACK');
      return badRequest(res, `Rôle invalide. Rôles valides: ${CONFIG.validRoles.join(', ')}`);
    }

    const oldUserResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const oldUser = oldUserResult.rows[0];
    if (!oldUser) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }
    if (!peutGererUtilisateur(acteur, oldUser)) {
      await client.query('ROLLBACK');
      return forbidden(res, 'Accès non autorisé à cet utilisateur');
    }

    if (Email && Email !== oldUser.email) {
      const existingEmail = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [Email, userId]
      );
      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Email déjà utilisé');
      }
    }
    if (parseInt(req.params.id) === parseInt(req.user.id) && Actif === false) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Vous ne pouvez pas désactiver votre propre compte');
    }

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
      `UPDATE utilisateurs SET nomcomplet=$1, email=$2, agence=$3, role=$4, coordination=$5, coordination_id=$6, actif=$7, updated_at=NOW(), sync_timestamp=NOW() WHERE id=$8`,
      [
        NomComplet || oldUser.nomcomplet,
        Email || oldUser.email,
        Agence !== undefined ? Agence : oldUser.agence,
        Role || oldUser.role,
        newCoordination,
        resolvedCoordinationId,
        Actif !== undefined ? Actif : oldUser.actif,
        userId,
      ]
    );

    if (SiteIds !== undefined) {
      const targetRole = Role || oldUser.role;
      if (targetRole !== 'Administrateur' && SiteIds.length === 0) {
        await client.query('ROLLBACK');
        return badRequest(
          res,
          'Impossible de retirer tous les sites : au moins un site est obligatoire'
        );
      }
      await client.query('DELETE FROM utilisateur_sites WHERE utilisateur_id = $1', [userId]);
      for (let i = 0; i < SiteIds.length; i++) {
        await client.query(
          `INSERT INTO utilisateur_sites (utilisateur_id, site_id, est_site_principal) VALUES ($1,$2,$3) ON CONFLICT (utilisateur_id, site_id) DO NOTHING`,
          [userId, SiteIds[i], i === 0]
        );
      }
    }

    const newUser = (await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]))
      .rows[0];
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
      recordId: String(userId),
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
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'updateUser');
  } finally {
    client.release();
  }
};

// ── DELETE USER ──
const deleteUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return forbidden(res);
    }
    await client.query('BEGIN');
    const userId = parseInt(req.params.id);
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }
    if (!peutGererUtilisateur(acteur, user)) {
      await client.query('ROLLBACK');
      return forbidden(res, 'Accès non autorisé à cet utilisateur');
    }
    if (userId === parseInt(req.user.id)) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Vous ne pouvez pas désactiver votre propre compte');
    }
    await client.query('UPDATE utilisateurs SET actif = false, updated_at = NOW() WHERE id = $1', [
      userId,
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
      recordId: String(userId),
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
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'deleteUser');
  } finally {
    client.release();
  }
};

// ── ACTIVATE USER ──
const activateUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return forbidden(res);
    }
    await client.query('BEGIN');
    const userId = parseInt(req.params.id);
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }
    if (!peutGererUtilisateur(acteur, user)) {
      await client.query('ROLLBACK');
      return forbidden(res, 'Accès non autorisé à cet utilisateur');
    }
    await client.query('UPDATE utilisateurs SET actif = true, updated_at = NOW() WHERE id = $1', [
      userId,
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
      recordId: String(userId),
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
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'activateUser');
  } finally {
    client.release();
  }
};

// ── PURGE USER (suppression définitive) ──
const purgeUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  try {
    const acteur = req.user;
    // Réservé aux Administrateurs uniquement
    if (acteur.role !== 'Administrateur') {
      client.release();
      return forbidden(res, 'Seul un Administrateur peut supprimer définitivement un compte');
    }
    await client.query('BEGIN');
    const userId = parseInt(req.params.id);
    if (isNaN(userId) || userId <= 0) {
      await client.query('ROLLBACK');
      return badRequest(res, 'ID utilisateur invalide');
    }
    if (userId === parseInt(req.user.id)) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Vous ne pouvez pas supprimer votre propre compte');
    }
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }
    // Supprimer les liaisons sites
    await client.query('DELETE FROM utilisateur_sites WHERE utilisateur_id = $1', [userId]);
    // Supprimer l'utilisateur définitivement
    await client.query('DELETE FROM utilisateurs WHERE id = $1', [userId]);
    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Suppression définitive utilisateur: ${user.nomutilisateur}`,
      actionType: 'PURGE_USER',
      tableName: 'Utilisateurs',
      recordId: String(userId),
      oldValue: JSON.stringify({
        nomUtilisateur: user.nomutilisateur,
        nomComplet: user.nomcomplet,
        role: user.role,
      }),
      newValue: null,
      details: `Compte supprimé définitivement: ${user.nomcomplet} (${user.role})`,
      ip: req.ip,
    });
    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Utilisateur supprimé définitivement',
      performance: { duration: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'purgeUser');
  } finally {
    client.release();
  }
};

// ── RESET PASSWORD ──
const resetPassword = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role)) {
      client.release();
      return forbidden(res);
    }
    await client.query('BEGIN');
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return badRequest(
        res,
        `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`
      );
    }
    const userId = parseInt(req.params.id);
    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }
    if (!peutGererUtilisateur(acteur, user)) {
      await client.query('ROLLBACK');
      return forbidden(res, 'Accès non autorisé à cet utilisateur');
    }
    const hashed = await bcrypt.hash(newPassword, CONFIG.saltRounds);
    await client.query(
      'UPDATE utilisateurs SET motdepasse = $1, updated_at = NOW() WHERE id = $2',
      [hashed, userId]
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
      recordId: String(userId),
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
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'resetPassword');
  } finally {
    client.release();
  }
};

// ── GET USER STATS ──
const getUserStats = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') return forbidden(res, 'Réservé aux Administrateurs');
    if (
      !req.query.forceRefresh &&
      CONFIG.statsCache &&
      CONFIG.statsCacheTime &&
      Date.now() - CONFIG.statsCacheTime < CONFIG.cacheTimeout * 1000
    )
      return res.json({
        success: true,
        ...CONFIG.statsCache,
        cached: true,
        cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime) / 1000) + 's',
      });

    const startTime = Date.now();
    const [stats, rolesStats, coordinationStats, recentActivity] = await Promise.all([
      db.query(
        `SELECT COUNT(*) as total_utilisateurs, COUNT(CASE WHEN actif=true THEN 1 END) as utilisateurs_actifs, COUNT(CASE WHEN actif=false THEN 1 END) as utilisateurs_inactifs, COUNT(DISTINCT role) as roles_distincts, COUNT(DISTINCT agence) as agences_distinctes, COUNT(DISTINCT coordination) as coordinations_distinctes, MIN(datecreation) as premier_utilisateur, MAX(datecreation) as dernier_utilisateur, COUNT(CASE WHEN datecreation > NOW() - INTERVAL '30 days' THEN 1 END) as nouveaux_30j FROM utilisateurs`
      ),
      db.query(
        `SELECT role, COUNT(*) as count, COUNT(CASE WHEN actif=true THEN 1 END) as actifs, ROUND(COUNT(*)*100.0/(SELECT COUNT(*) FROM utilisateurs),2) as pourcentage FROM utilisateurs GROUP BY role ORDER BY count DESC`
      ),
      db.query(
        `SELECT coordination, COUNT(*) as count, COUNT(CASE WHEN actif=true THEN 1 END) as actifs FROM utilisateurs WHERE coordination IS NOT NULL GROUP BY coordination ORDER BY count DESC`
      ),
      db.query(
        `SELECT u.nomutilisateur, u.nomcomplet, u.role, u.coordination, COUNT(j.journalid) as total_actions, MAX(j.dateaction) as derniere_action, COUNT(CASE WHEN j.dateaction > NOW() - INTERVAL '24 hours' THEN 1 END) as actions_24h FROM utilisateurs u LEFT JOIN journalactivite j ON u.id = j.utilisateurid WHERE j.dateaction >= CURRENT_DATE - INTERVAL '7 days' GROUP BY u.id, u.nomutilisateur, u.nomcomplet, u.role, u.coordination ORDER BY total_actions DESC LIMIT 10`
      ),
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
    return serverError(res, error, 'getUserStats');
  }
};

// ── SEARCH USERS ──
// ✅ CORRIGÉ : countQuery maintenant cohérent avec la query principale (mêmes filtres)
const searchUsers = async (req, res) => {
  try {
    const acteur = req.user;
    if (!['Administrateur', 'Gestionnaire', "Chef d'équipe"].includes(acteur.role))
      return forbidden(res);

    const { q, role, coordination, actif, page = 1, limit = 20 } = req.query;
    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), 100);
    const offset = (actualPage - 1) * actualLimit;

    const { where, params: baseParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    let params = [...baseParams];
    let query = `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, actif FROM utilisateurs ${where}`;

    if (q?.trim()) {
      params.push(`%${q.trim()}%`);
      const idx = params.length;
      query += ` AND (nomutilisateur ILIKE $${idx} OR nomcomplet ILIKE $${idx} OR email ILIKE $${idx})`;
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

    // ✅ countQuery avec les mêmes filtres de recherche
    const { where: whereC, params: countBaseParams } = buildUserFilter(acteur, [], 'WHERE 1=1');
    let countParams = [...countBaseParams];
    let countQuery = `SELECT COUNT(*) as total FROM utilisateurs ${whereC}`;
    if (q?.trim()) {
      countParams.push(`%${q.trim()}%`);
      const idx = countParams.length;
      countQuery += ` AND (nomutilisateur ILIKE $${idx} OR nomcomplet ILIKE $${idx} OR email ILIKE $${idx})`;
    }
    if (role) {
      countParams.push(role);
      countQuery += ` AND role = $${countParams.length}`;
    }
    if (coordination && acteur.role === 'Administrateur') {
      countParams.push(coordination);
      countQuery += ` AND coordination = $${countParams.length}`;
    }
    if (actif !== undefined) {
      countParams.push(actif === 'true');
      countQuery += ` AND actif = $${countParams.length}`;
    }

    const startTime = Date.now();
    const [result, countResult] = await Promise.all([
      db.query(query, params),
      db.query(countQuery, countParams),
    ]);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      success: true,
      utilisateurs: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'searchUsers');
  }
};

// ── GET USER HISTORY ──
const getUserHistory = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') return forbidden(res, 'Réservé aux Administrateurs');
    const userId = parseInt(req.params.id);
    const actualLimit = Math.min(parseInt(req.query.limit) || 50, 200);
    const actualPage = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (actualPage - 1) * actualLimit;
    const userResult = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1',
      [userId]
    );
    if (userResult.rows.length === 0) return notFound(res, 'Utilisateur non trouvé');
    const startTime = Date.now();
    const [history, countResult] = await Promise.all([
      db.query(
        `SELECT journalid, actiontype, action, TO_CHAR(dateaction,'YYYY-MM-DD HH24:MI:SS') as dateaction, tablename, recordid, detailsaction, iputilisateur, annulee FROM journalactivite WHERE utilisateurid = $1 ORDER BY dateaction DESC LIMIT $2 OFFSET $3`,
        [userId, actualLimit, offset]
      ),
      db.query('SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1', [userId]),
    ]);
    const total = parseInt(countResult.rows[0].total);
    res.json({
      success: true,
      utilisateur: userResult.rows[0],
      historique: history.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      performance: { queryTime: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'getUserHistory');
  }
};

// ── EXPORT USERS ──
const exportUsers = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') return forbidden(res, 'Réservé aux Administrateurs');
    const format = req.query.format === 'csv' ? 'csv' : 'json';
    const users = await db.query(
      `SELECT nomutilisateur, nomcomplet, email, agence, role, coordination, TO_CHAR(datecreation,'YYYY-MM-DD HH24:MI:SS') as datecreation, TO_CHAR(derniereconnexion,'YYYY-MM-DD HH24:MI:SS') as derniereconnexion, CASE WHEN actif=true THEN 'Actif' ELSE 'Inactif' END as statut FROM utilisateurs ORDER BY nomcomplet`
    );
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
    return serverError(res, error, 'exportUsers');
  }
};

// ── CHECK USERNAME ──
const checkUsernameAvailability = async (req, res) => {
  try {
    const { username, excludeId } = req.query;
    if (!username) return badRequest(res, "Nom d'utilisateur requis");
    let query = 'SELECT id FROM utilisateurs WHERE nomutilisateur = $1';
    const params = [username];
    if (excludeId) {
      query += ' AND id != $2';
      params.push(parseInt(excludeId));
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
    return serverError(res, error, 'checkUsernameAvailability');
  }
};

// ── GET ROLES ──
const getRoles = async (req, res) => {
  res.json({ success: true, roles: CONFIG.validRoles, timestamp: new Date().toISOString() });
};

// ── GET COORDINATIONS ──
const getCoordinations = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') return forbidden(res, 'Réservé aux Administrateurs');
    const result = await db.query(
      `SELECT DISTINCT coordination FROM utilisateurs WHERE coordination IS NOT NULL AND coordination != '' ORDER BY coordination`
    );
    res.json({
      success: true,
      coordinations: result.rows.map((r) => r.coordination),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'getCoordinations');
  }
};

// ── GET SITES LIST ──
const getSitesList = async (req, res) => {
  try {
    const acteur = req.user;
    let query = `SELECT s.id, s.nom, s.coordination_id, c.nom as coordination_nom, c.code as coordination_code FROM sites s JOIN coordinations c ON c.id = s.coordination_id WHERE s.is_active = true`;
    const params = [];
    if (acteur.role === 'Gestionnaire' && acteur.coordination_id) {
      params.push(acteur.coordination_id);
      query += ` AND s.coordination_id = $${params.length}`;
    }
    if (acteur.role === "Chef d'équipe" && acteur.agence) {
      params.push(acteur.agence);
      query += ` AND s.nom = $${params.length}`;
    }
    query += ` ORDER BY c.nom, s.nom`;
    const result = await db.query(query, params);
    res.json({ success: true, sites: result.rows, timestamp: new Date().toISOString() });
  } catch (error) {
    return serverError(res, error, 'getSitesList');
  }
};

// ── CLEAR STATS CACHE ──
const clearStatsCache = async (req, res) => {
  CONFIG.statsCache = null;
  CONFIG.statsCacheTime = null;
  res.json({
    success: true,
    message: 'Cache des statistiques nettoyé',
    timestamp: new Date().toISOString(),
  });
};

// ── DIAGNOSTIC ──
const diagnostic = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') return forbidden(res, 'Réservé aux Administrateurs');
    const startTime = Date.now();
    const result = await db.query(
      `SELECT COUNT(*) as total_utilisateurs, COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs, COUNT(DISTINCT role) as roles_distincts, COUNT(DISTINCT coordination) as coordinations_distinctes, MIN(datecreation) as premier_utilisateur, MAX(datecreation) as dernier_utilisateur, pg_total_relation_size('utilisateurs') as table_size, pg_size_pretty(pg_total_relation_size('utilisateurs')) as table_size_pretty FROM utilisateurs`
    );
    const stats = result.rows[0];
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'utilisateurs',
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
    return serverError(res, error, 'diagnostic');
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  updateUser,
  deleteUser,
  purgeUser,
  activateUser,
  resetPassword,
  getUserStats,
  searchUsers,
  getUserHistory,
  exportUsers,
  checkUsernameAvailability,
  getRoles,
  getCoordinations,
  getSitesList,
  clearStatsCache,
  diagnostic,
};
