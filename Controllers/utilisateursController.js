// ============================================
// CONTROLLER UTILISATEURS
// ============================================

const bcrypt = require('bcryptjs');
const db = require('../db/db');
const journalService = require('../Services/journalService'); // ✅ Service indépendant

const CONFIG = {
  saltRounds: 12,
  minPasswordLength: 8,
  cacheTimeout: 300,
  statsCache: null,
  statsCacheTime: null,

  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

// ============================================
// GET ALL USERS
// ============================================
const getAllUsers = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent gérer les utilisateurs',
      });
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

    let query = `
      SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination, 
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion,
        actif 
      FROM utilisateurs 
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (search && search.trim() !== '') {
      paramCount++;
      query += ` AND (nomutilisateur ILIKE $${paramCount} OR nomcomplet ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      params.push(`%${search.trim()}%`);
    }

    if (role) {
      paramCount++;
      query += ` AND role = $${paramCount}`;
      params.push(role);
    }

    if (coordination) {
      paramCount++;
      query += ` AND coordination = $${paramCount}`;
      params.push(coordination);
    }

    if (actif !== undefined) {
      paramCount++;
      query += ` AND actif = $${paramCount}`;
      params.push(actif === 'true');
    }

    const allowedSortFields = [
      'nomcomplet',
      'nomutilisateur',
      'role',
      'coordination',
      'datecreation',
      'derniereconnexion',
    ];
    const sortField = allowedSortFields.includes(sort) ? sort : 'nomcomplet';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    query += ` ORDER BY ${sortField} ${sortOrder}`;

    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    let countQuery = 'SELECT COUNT(*) as total FROM utilisateurs WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (search && search.trim() !== '') {
      countParamCount++;
      countQuery += ` AND (nomutilisateur ILIKE $${countParamCount} OR nomcomplet ILIKE $${countParamCount} OR email ILIKE $${countParamCount})`;
      countParams.push(`%${search.trim()}%`);
    }

    if (role) {
      countParamCount++;
      countQuery += ` AND role = $${countParamCount}`;
      countParams.push(role);
    }

    if (coordination) {
      countParamCount++;
      countQuery += ` AND coordination = $${countParamCount}`;
      countParams.push(coordination);
    }

    if (actif !== undefined) {
      countParamCount++;
      countQuery += ` AND actif = $${countParamCount}`;
      countParams.push(actif === 'true');
    }

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
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération utilisateurs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// GET USER BY ID
// ============================================
const getUserById = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent consulter les autres utilisateurs',
      });
    }

    const { id } = req.params;

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion,
        actif 
      FROM utilisateurs 
      WHERE id = $1`,
      [id]
    );

    const user = result.rows[0];

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    res.json({
      success: true,
      utilisateur: user,
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// CREATE USER
// ============================================
const createUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();

  try {
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent créer des utilisateurs',
      });
    }

    await client.query('BEGIN');

    const { NomUtilisateur, NomComplet, Email, Agence, Role, Coordination, MotDePasse } = req.body;

    if (!NomUtilisateur || !NomComplet || !MotDePasse || !Role) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Tous les champs obligatoires doivent être remplis',
      });
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

    const existingUser = await client.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1',
      [NomUtilisateur]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Ce nom d'utilisateur existe déjà",
      });
    }

    if (Email) {
      const existingEmail = await client.query('SELECT id FROM utilisateurs WHERE email = $1', [
        Email,
      ]);

      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà utilisé',
        });
      }
    }

    const hashedPassword = await bcrypt.hash(MotDePasse, CONFIG.saltRounds);

    const result = await client.query(
      `
      INSERT INTO utilisateurs 
      (nomutilisateur, nomcomplet, email, agence, role, coordination, motdepasse, datecreation, actif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `,
      [
        NomUtilisateur,
        NomComplet,
        Email || null,
        Agence || null,
        Role,
        Coordination || null,
        hashedPassword,
        new Date(),
        true,
      ]
    );

    const newUserId = result.rows[0].id;

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
      newValue: JSON.stringify({
        nomUtilisateur: NomUtilisateur,
        nomComplet: NomComplet,
        email: Email,
        agence: Agence,
        role: Role,
        coordination: Coordination,
      }),
      details: `Nouvel utilisateur créé: ${NomComplet} (${Role})`,
      ip: req.ip,
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.status(201).json({
      success: true,
      message: 'Utilisateur créé avec succès',
      userId: newUserId,
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur création utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
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
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent modifier les utilisateurs',
      });
    }

    await client.query('BEGIN');

    const { id } = req.params;
    const { NomComplet, Email, Agence, Role, Coordination, Actif } = req.body;

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
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    if (Email && Email !== oldUser.email) {
      const existingEmail = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [Email, id]
      );

      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          success: false,
          message: 'Cet email est déjà utilisé par un autre utilisateur',
        });
      }
    }

    if (parseInt(id) === parseInt(req.user.id) && Actif === false) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas désactiver votre propre compte',
      });
    }

    await client.query(
      `
      UPDATE utilisateurs 
      SET nomcomplet = $1, email = $2, agence = $3, role = $4, coordination = $5, actif = $6
      WHERE id = $7
    `,
      [
        NomComplet || oldUser.nomcomplet,
        Email || oldUser.email,
        Agence || oldUser.agence,
        Role || oldUser.role,
        Coordination !== undefined ? Coordination : oldUser.coordination,
        Actif !== undefined ? Actif : oldUser.actif,
        id,
      ]
    );

    const newUserResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);

    const newUser = newUserResult.rows[0];

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

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Utilisateur modifié avec succès',
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur modification utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
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
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent désactiver des utilisateurs',
      });
    }

    await client.query('BEGIN');

    const { id } = req.params;

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    if (parseInt(id) === parseInt(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: 'Vous ne pouvez pas désactiver votre propre compte',
      });
    }

    await client.query('UPDATE utilisateurs SET actif = false WHERE id = $1', [id]);

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

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Utilisateur désactivé avec succès',
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur suppression utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
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
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent réactiver des utilisateurs',
      });
    }

    await client.query('BEGIN');

    const { id } = req.params;

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [id]);

    const user = userResult.rows[0];

    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    await client.query('UPDATE utilisateurs SET actif = true WHERE id = $1', [id]);

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

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Utilisateur réactivé avec succès',
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réactivation utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
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
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent réinitialiser les mots de passe',
      });
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
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query('UPDATE utilisateurs SET motdepasse = $1 WHERE id = $2', [
      hashedPassword,
      id,
    ]);

    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Réinitialisation mot de passe utilisateur: ${user.nomutilisateur}`,
      actionType: 'RESET_PASSWORD',
      tableName: 'Utilisateurs',
      recordId: id,
      details: "Mot de passe réinitialisé par l'administrateur",
      ip: req.ip,
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès',
      performance: {
        duration,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réinitialisation mot de passe:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
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
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent consulter les statistiques',
      });
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

    const stats = await db.query(`
      SELECT 
        COUNT(*) as total_utilisateurs,
        COUNT(CASE WHEN actif = true THEN 1 END) as utilisateurs_actifs,
        COUNT(CASE WHEN actif = false THEN 1 END) as utilisateurs_inactifs,
        COUNT(DISTINCT role) as roles_distincts,
        COUNT(DISTINCT agence) as agences_distinctes,
        COUNT(DISTINCT coordination) as coordinations_distinctes,
        MIN(datecreation) as premier_utilisateur,
        MAX(datecreation) as dernier_utilisateur,
        COUNT(CASE WHEN datecreation > NOW() - INTERVAL '30 days' THEN 1 END) as nouveaux_30j
      FROM utilisateurs
    `);

    const rolesStats = await db.query(`
      SELECT 
        role,
        COUNT(*) as count,
        COUNT(CASE WHEN actif = true THEN 1 END) as actifs,
        ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM utilisateurs), 2) as pourcentage
      FROM utilisateurs 
      GROUP BY role 
      ORDER BY count DESC
    `);

    const coordinationStats = await db.query(`
      SELECT 
        coordination,
        COUNT(*) as count,
        COUNT(CASE WHEN actif = true THEN 1 END) as actifs
      FROM utilisateurs 
      WHERE coordination IS NOT NULL
      GROUP BY coordination 
      ORDER BY count DESC
    `);

    const recentActivity = await db.query(`
      SELECT 
        u.nomutilisateur,
        u.nomcomplet,
        u.role,
        u.coordination,
        COUNT(j.journalid) as total_actions,
        MAX(j.dateaction) as derniere_action,
        COUNT(CASE WHEN j.dateaction > NOW() - INTERVAL '24 hours' THEN 1 END) as actions_24h
      FROM utilisateurs u
      LEFT JOIN journalactivite j ON u.id = j.utilisateurid
      WHERE j.dateaction >= CURRENT_DATE - INTERVAL '7 days'
      GROUP BY u.id, u.nomutilisateur, u.nomcomplet, u.role, u.coordination
      ORDER BY total_actions DESC
      LIMIT 10
    `);

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
      parRole: rolesStats.rows.map((row) => ({
        ...row,
        count: parseInt(row.count),
        actifs: parseInt(row.actifs),
        pourcentage: parseFloat(row.pourcentage),
      })),
      parCoordination: coordinationStats.rows.map((row) => ({
        ...row,
        count: parseInt(row.count),
        actifs: parseInt(row.actifs),
      })),
      activiteRecente: recentActivity.rows.map((row) => ({
        ...row,
        total_actions: parseInt(row.total_actions),
        actions_24h: parseInt(row.actions_24h),
      })),
      performance: {
        queryTime: Date.now() - startTime,
      },
    };

    CONFIG.statsCache = statsData;
    CONFIG.statsCacheTime = Date.now();

    res.json({
      success: true,
      ...statsData,
      cached: false,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur statistiques utilisateurs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// SEARCH USERS
// ============================================
const searchUsers = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent rechercher des utilisateurs',
      });
    }

    const { q, role, coordination, actif, page = 1, limit = 20 } = req.query;

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), 100);
    const offset = (actualPage - 1) * actualLimit;

    let query = `
      SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination, 
        actif 
      FROM utilisateurs 
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    if (q && q.trim() !== '') {
      paramCount++;
      query += ` AND (nomutilisateur ILIKE $${paramCount} OR nomcomplet ILIKE $${paramCount} OR email ILIKE $${paramCount})`;
      params.push(`%${q.trim()}%`);
    }

    if (role) {
      paramCount++;
      query += ` AND role = $${paramCount}`;
      params.push(role);
    }

    if (coordination) {
      paramCount++;
      query += ` AND coordination = $${paramCount}`;
      params.push(coordination);
    }

    if (actif !== undefined) {
      paramCount++;
      query += ` AND actif = $${paramCount}`;
      params.push(actif === 'true');
    }

    query += ` ORDER BY nomcomplet LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    let countQuery = 'SELECT COUNT(*) as total FROM utilisateurs WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (q && q.trim() !== '') {
      countParamCount++;
      countQuery += ` AND (nomutilisateur ILIKE $${countParamCount} OR nomcomplet ILIKE $${countParamCount} OR email ILIKE $${countParamCount})`;
      countParams.push(`%${q.trim()}%`);
    }

    if (role) {
      countParamCount++;
      countQuery += ` AND role = $${countParamCount}`;
      countParams.push(role);
    }

    if (coordination) {
      countParamCount++;
      countQuery += ` AND coordination = $${countParamCount}`;
      countParams.push(coordination);
    }

    if (actif !== undefined) {
      countParamCount++;
      countQuery += ` AND actif = $${countParamCount}`;
      countParams.push(actif === 'true');
    }

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
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur recherche utilisateurs:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// GET USER HISTORY
// ============================================
const getUserHistory = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent consulter l'historique des utilisateurs",
      });
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
      return res.status(404).json({
        success: false,
        message: 'Utilisateur non trouvé',
      });
    }

    const startTime = Date.now();

    const history = await db.query(
      `
      SELECT 
        journalid,
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        recordid,
        detailsaction,
        iputilisateur,
        annulee
      FROM journalactivite 
      WHERE utilisateurid = $1 
      ORDER BY dateaction DESC 
      LIMIT $2 OFFSET $3
    `,
      [id, actualLimit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1',
      [id]
    );

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
      performance: {
        queryTime: Date.now() - startTime,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur historique utilisateur:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// EXPORT USERS
// ============================================
const exportUsers = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent exporter les utilisateurs',
      });
    }

    const { format = 'json' } = req.query;

    const users = await db.query(`
      SELECT 
        nomutilisateur,
        nomcomplet,
        email,
        agence,
        role,
        coordination,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion,
        CASE WHEN actif = true THEN 'Actif' ELSE 'Inactif' END as statut
      FROM utilisateurs 
      ORDER BY nomcomplet
    `);

    const filename = `utilisateurs-export-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csvHeaders =
        'NomUtilisateur,NomComplet,Email,Agence,Role,Coordination,DateCreation,DerniereConnexion,Statut\n';
      const csvData = users.rows
        .map(
          (row) =>
            `"${row.nomutilisateur}","${row.nomcomplet}","${row.email || ''}","${row.agence || ''}","${row.role}","${row.coordination || ''}","${row.datecreation}","${row.derniereconnexion || ''}","${row.statut}"`
        )
        .join('\n');

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
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
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// CHECK USERNAME AVAILABILITY
// ============================================
const checkUsernameAvailability = async (req, res) => {
  try {
    const { username, excludeId } = req.query;

    if (!username) {
      return res.status(400).json({
        success: false,
        message: "Nom d'utilisateur requis",
      });
    }

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
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// GET ROLES
// ============================================
const getRoles = async (req, res) => {
  try {
    res.json({
      success: true,
      roles: CONFIG.validRoles,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération rôles:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// GET COORDINATIONS
// ============================================
const getCoordinations = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent lister les coordinations',
      });
    }

    const result = await db.query(`
      SELECT DISTINCT coordination 
      FROM utilisateurs 
      WHERE coordination IS NOT NULL AND coordination != ''
      ORDER BY coordination
    `);

    res.json({
      success: true,
      coordinations: result.rows.map((r) => r.coordination),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur récupération coordinations:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
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
    console.error('❌ Erreur nettoyage cache:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// DIAGNOSTIC
// ============================================
const diagnostic = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: 'Seuls les administrateurs peuvent accéder au diagnostic',
      });
    }

    const startTime = Date.now();

    const result = await db.query(`
      SELECT 
        COUNT(*) as total_utilisateurs,
        COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs,
        COUNT(DISTINCT role) as roles_distincts,
        COUNT(DISTINCT coordination) as coordinations_distinctes,
        MIN(datecreation) as premier_utilisateur,
        MAX(datecreation) as dernier_utilisateur,
        pg_total_relation_size('utilisateurs') as table_size,
        pg_size_pretty(pg_total_relation_size('utilisateurs')) as table_size_pretty
      FROM utilisateurs
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'utilisateurs',
      utilisateur: {
        role: req.user.role,
        coordination: req.user.coordination,
      },
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
      stockage: {
        taille_table: stats.table_size_pretty,
        taille_bytes: parseInt(stats.table_size),
      },
      config: {
        saltRounds: CONFIG.saltRounds,
        minPasswordLength: CONFIG.minPasswordLength,
        cacheTimeout: CONFIG.cacheTimeout,
        validRoles: CONFIG.validRoles,
      },
      performance: {
        queryTime: Date.now() - startTime,
      },
      endpoints: [
        '/api/utilisateurs',
        '/api/utilisateurs/:id',
        '/api/utilisateurs/:id/reset-password',
        '/api/utilisateurs/:id/activate',
        '/api/utilisateurs/stats',
        '/api/utilisateurs/search',
        '/api/utilisateurs/:id/history',
        '/api/utilisateurs/export',
        '/api/utilisateurs/check-username',
        '/api/utilisateurs/roles',
        '/api/utilisateurs/coordinations',
        '/api/utilisateurs/cache/clear',
        '/api/utilisateurs/diagnostic',
      ],
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: error.message,
    });
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
