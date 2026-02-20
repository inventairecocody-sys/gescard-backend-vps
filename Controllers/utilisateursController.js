const bcrypt = require('bcryptjs');
const jwt = require("jsonwebtoken");
const db = require("../db/db");
const journalController = require("./journalController");

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  saltRounds: 12,              // Niveau de hash bcrypt renforcé
  jwtExpiration: "8h",          // Durée de validité du token (augmentée pour LWS)
  minPasswordLength: 8,         // Longueur minimale mot de passe
  maxLoginAttempts: 5,          // Tentatives max avant blocage
  lockoutDuration: 15 * 60 * 1000, // 15 minutes en ms
  cacheTimeout: 300,            // Cache stats 5 minutes
  statsCache: null,
  statsCacheTime: null,
  
  // Nouveaux rôles selon les spécifications
  validRoles: [
    'Administrateur',
    'Gestionnaire', 
    'Chef d\'équipe',
    'Opérateur'
  ]
};

// Cache des tentatives de connexion (IP -> {attempts, lockUntil})
const loginAttempts = new Map();

// ============================================
// AUTHENTIFICATION OPTIMISÉE
// ============================================

/**
 * Fonction de connexion avec protection brute force
 * POST /api/auth/login
 */
exports.loginUser = async (req, res) => {
  const { NomUtilisateur, MotDePasse } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  const startTime = Date.now();

  try {
    console.log('🔍 [LOGIN] Tentative de connexion:', NomUtilisateur);

    // Vérification des tentatives de connexion (brute force protection)
    const now = Date.now();
    const attemptData = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };

    if (attemptData.lockUntil > now) {
      const waitTime = Math.ceil((attemptData.lockUntil - now) / 1000 / 60);
      console.log(`🚫 [LOGIN] IP ${clientIp} bloquée pour ${waitTime} minutes`);
      return res.status(429).json({ 
        success: false,
        message: `Trop de tentatives. Réessayez dans ${waitTime} minutes.` 
      });
    }

    // Validation des entrées
    if (!NomUtilisateur || !MotDePasse) {
      return res.status(400).json({ 
        success: false,
        message: "Nom d'utilisateur et mot de passe requis" 
      });
    }

    const result = await db.query(
      "SELECT * FROM utilisateurs WHERE nomutilisateur = $1",
      [NomUtilisateur]
    );

    const utilisateur = result.rows[0];

    if (!utilisateur) {
      // Incrémenter les tentatives
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
        console.log(`🔒 [LOGIN] IP ${clientIp} bloquée pour ${CONFIG.lockoutDuration/60000} minutes`);
      }
      loginAttempts.set(clientIp, attemptData);

      console.log('❌ [LOGIN] Utilisateur introuvable');
      return res.status(401).json({ 
        success: false,
        message: "Nom d'utilisateur ou mot de passe incorrect" 
      });
    }

    // Vérifier si le compte est actif
    if (!utilisateur.actif) {
      console.log('❌ [LOGIN] Compte désactivé');
      return res.status(401).json({ 
        success: false,
        message: "Ce compte est désactivé. Contactez un administrateur." 
      });
    }

    // Vérification du mot de passe avec bcrypt
    const isMatch = await bcrypt.compare(MotDePasse, utilisateur.motdepasse);
    console.log('🔍 [LOGIN] Mot de passe valide:', isMatch);

    if (!isMatch) {
      // Incrémenter les tentatives
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
        console.log(`🔒 [LOGIN] IP ${clientIp} bloquée pour ${CONFIG.lockoutDuration/60000} minutes`);
      }
      loginAttempts.set(clientIp, attemptData);

      console.log('❌ [LOGIN] Mot de passe incorrect');
      return res.status(401).json({ 
        success: false,
        message: "Nom d'utilisateur ou mot de passe incorrect" 
      });
    }

    // Réinitialiser les tentatives en cas de succès
    loginAttempts.delete(clientIp);

    // Mettre à jour la dernière connexion
    await db.query(
      'UPDATE utilisateurs SET derniereconnexion = NOW() WHERE id = $1',
      [utilisateur.id]
    );

    // ✅ AJOUT DE LA COORDINATION DANS LE TOKEN JWT
    const token = jwt.sign(
      {
        id: utilisateur.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        role: utilisateur.role,
        agence: utilisateur.agence,
        coordination: utilisateur.coordination // ← NOUVEAU
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    console.log('✅ [LOGIN] Connexion réussie pour:', utilisateur.nomutilisateur);
    console.log(`   Rôle: ${utilisateur.role}, Coordination: ${utilisateur.coordination || 'Aucune'}`);

    // Journaliser la connexion
    await journalController.logAction({
      utilisateurId: utilisateur.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      role: utilisateur.role,
      agence: utilisateur.agence,
      coordination: utilisateur.coordination,
      action: "Connexion au système",
      actionType: "LOGIN",
      tableName: "Utilisateurs",
      recordId: utilisateur.id.toString(),
      ip: clientIp,
      details: `Connexion réussie depuis ${clientIp}`
    });

    const duration = Date.now() - startTime;

    // Retour au frontend
    res.json({
      success: true,
      message: "Connexion réussie",
      token,
      utilisateur: {
        id: utilisateur.id,
        nomComplet: utilisateur.nomcomplet,
        nomUtilisateur: utilisateur.nomutilisateur,
        email: utilisateur.email,
        agence: utilisateur.agence,
        role: utilisateur.role,
        coordination: utilisateur.coordination // ← NOUVEAU
      },
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ [LOGIN] Erreur de connexion :", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Déconnexion
 * POST /api/auth/logout
 */
exports.logoutUser = async (req, res) => {
  try {
    // Journaliser la déconnexion
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: "Déconnexion du système",
      actionType: "LOGOUT",
      tableName: "Utilisateurs",
      recordId: req.user.id.toString(),
      ip: req.ip,
      details: "Déconnexion du système"
    });

    res.json({ 
      success: true,
      message: "Déconnexion réussie",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erreur déconnexion:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Vérifier le token
 * GET /api/auth/verify
 */
exports.verifyToken = async (req, res) => {
  try {
    res.json({
      success: true,
      valid: true,
      user: {
        id: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erreur vérification token:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

// ============================================
// GESTION DES UTILISATEURS OPTIMISÉE
// ============================================

/**
 * Récupérer tous les utilisateurs avec pagination
 * GET /api/utilisateurs
 */
exports.getAllUsers = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent gérer les utilisateurs"
      });
    }

    const { 
      page = 1, 
      limit = 20, 
      role, 
      actif,
      coordination, // ← NOUVEAU filtre
      search,
      sort = 'nomcomplet',
      order = 'asc'
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

    // Filtres
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

    // Tri
    const allowedSortFields = ['nomcomplet', 'nomutilisateur', 'role', 'coordination', 'datecreation', 'derniereconnexion'];
    const sortField = allowedSortFields.includes(sort) ? sort : 'nomcomplet';
    const sortOrder = order.toLowerCase() === 'desc' ? 'DESC' : 'ASC';
    query += ` ORDER BY ${sortField} ${sortOrder}`;

    // Pagination
    query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    // Requête COUNT
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
      db.query(countQuery, countParams)
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
        hasPrev: actualPage > 1
      },
      filtres: {
        search: search || null,
        role: role || null,
        coordination: coordination || null,
        actif: actif || null,
        sort: sortField,
        order: sortOrder
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur récupération utilisateurs:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Récupérer un utilisateur par ID
 * GET /api/utilisateurs/:id
 */
exports.getUserById = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent consulter les autres utilisateurs"
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
        message: "Utilisateur non trouvé" 
      });
    }

    res.json({
      success: true,
      utilisateur: user,
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur récupération utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Créer un nouvel utilisateur
 * POST /api/utilisateurs
 */
exports.createUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent créer des utilisateurs"
      });
    }

    await client.query('BEGIN');
    
    const { 
      NomUtilisateur, 
      NomComplet, 
      Email, 
      Agence, 
      Role, 
      Coordination, // ← NOUVEAU
      MotDePasse 
    } = req.body;

    // Validation
    if (!NomUtilisateur || !NomComplet || !MotDePasse || !Role) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Tous les champs obligatoires doivent être remplis" 
      });
    }

    // Validation du rôle (nouveaux rôles)
    if (!CONFIG.validRoles.includes(Role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Rôle invalide. Rôles valides: ${CONFIG.validRoles.join(', ')}` 
      });
    }

    // Validation du mot de passe
    if (MotDePasse.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères` 
      });
    }

    // Vérifier si l'utilisateur existe déjà
    const existingUser = await client.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1',
      [NomUtilisateur]
    );

    if (existingUser.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Ce nom d'utilisateur existe déjà" 
      });
    }

    // Vérifier si l'email existe déjà
    if (Email) {
      const existingEmail = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1',
        [Email]
      );

      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false,
          message: "Cet email est déjà utilisé" 
        });
      }
    }

    // Hasher le mot de passe
    const hashedPassword = await bcrypt.hash(MotDePasse, CONFIG.saltRounds);

    // Créer l'utilisateur avec coordination
    const result = await client.query(`
      INSERT INTO utilisateurs 
      (nomutilisateur, nomcomplet, email, agence, role, coordination, motdepasse, datecreation, actif)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING id
    `, [
      NomUtilisateur, 
      NomComplet, 
      Email || null, 
      Agence || null, 
      Role, 
      Coordination || null, 
      hashedPassword, 
      new Date(), 
      true
    ]);

    const newUserId = result.rows[0].id;

    // Journaliser la création
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Création utilisateur: ${NomUtilisateur}`,
      actionType: "CREATE_USER",
      tableName: "Utilisateurs",
      recordId: newUserId.toString(),
      oldValue: null,
      newValue: JSON.stringify({
        nomUtilisateur: NomUtilisateur,
        nomComplet: NomComplet,
        email: Email,
        agence: Agence,
        role: Role,
        coordination: Coordination
      }),
      details: `Nouvel utilisateur créé: ${NomComplet} (${Role})`,
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.status(201).json({ 
      success: true,
      message: "Utilisateur créé avec succès", 
      userId: newUserId,
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur création utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Modifier un utilisateur
 * PUT /api/utilisateurs/:id
 */
exports.updateUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent modifier les utilisateurs"
      });
    }

    await client.query('BEGIN');
    
    const { id } = req.params;
    const { NomComplet, Email, Agence, Role, Coordination, Actif } = req.body;

    // Validation du rôle si fourni
    if (Role && !CONFIG.validRoles.includes(Role)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Rôle invalide. Rôles valides: ${CONFIG.validRoles.join(', ')}` 
      });
    }

    // Récupérer l'ancien profil
    const oldUserResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [id]
    );

    const oldUser = oldUserResult.rows[0];
    
    if (!oldUser) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier si l'email existe déjà pour un autre utilisateur
    if (Email && Email !== oldUser.email) {
      const existingEmail = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [Email, id]
      );

      if (existingEmail.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false,
          message: "Cet email est déjà utilisé par un autre utilisateur" 
        });
      }
    }

    // Empêcher l'auto-désactivation pour les admins
    if (parseInt(id) === parseInt(req.user.id) && Actif === false) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Vous ne pouvez pas désactiver votre propre compte" 
      });
    }

    await client.query(`
      UPDATE utilisateurs 
      SET nomcomplet = $1, email = $2, agence = $3, role = $4, coordination = $5, actif = $6
      WHERE id = $7
    `, [
      NomComplet || oldUser.nomcomplet, 
      Email || oldUser.email, 
      Agence || oldUser.agence, 
      Role || oldUser.role, 
      Coordination !== undefined ? Coordination : oldUser.coordination,
      Actif !== undefined ? Actif : oldUser.actif, 
      id
    ]);

    // Récupérer le nouveau profil
    const newUserResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [id]
    );

    const newUser = newUserResult.rows[0];

    // Journaliser la modification
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Modification utilisateur: ${oldUser.nomutilisateur}`,
      actionType: "UPDATE_USER",
      tableName: "Utilisateurs",
      recordId: id,
      oldValue: JSON.stringify({
        nomComplet: oldUser.nomcomplet,
        email: oldUser.email,
        agence: oldUser.agence,
        role: oldUser.role,
        coordination: oldUser.coordination,
        actif: oldUser.actif
      }),
      newValue: JSON.stringify({
        nomComplet: newUser.nomcomplet,
        email: newUser.email,
        agence: newUser.agence,
        role: newUser.role,
        coordination: newUser.coordination,
        actif: newUser.actif
      }),
      details: `Utilisateur modifié: ${NomComplet || oldUser.nomcomplet}`,
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Utilisateur modifié avec succès",
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur modification utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Réinitialiser le mot de passe d'un utilisateur
 * POST /api/utilisateurs/:id/reset-password
 */
exports.resetPassword = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent réinitialiser les mots de passe"
      });
    }

    await client.query('BEGIN');
    
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères` 
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [id]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query(
      'UPDATE utilisateurs SET motdepasse = $1 WHERE id = $2',
      [hashedPassword, id]
    );

    // Journaliser la réinitialisation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Réinitialisation mot de passe utilisateur: ${user.nomutilisateur}`,
      actionType: "RESET_PASSWORD",
      tableName: "Utilisateurs",
      recordId: id,
      details: "Mot de passe réinitialisé par l'administrateur",
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Mot de passe réinitialisé avec succès",
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur réinitialisation mot de passe:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Désactiver un utilisateur
 * DELETE /api/utilisateurs/:id
 */
exports.deleteUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent désactiver des utilisateurs"
      });
    }

    await client.query('BEGIN');
    
    const { id } = req.params;

    // Récupérer les infos de l'utilisateur
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [id]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Empêcher l'auto-suppression
    if (parseInt(id) === parseInt(req.user.id)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Vous ne pouvez pas désactiver votre propre compte" 
      });
    }

    // Désactiver l'utilisateur
    await client.query(
      'UPDATE utilisateurs SET actif = false WHERE id = $1',
      [id]
    );

    // Journaliser la désactivation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Désactivation utilisateur: ${user.nomutilisateur}`,
      actionType: "DELETE_USER",
      tableName: "Utilisateurs",
      recordId: id,
      oldValue: JSON.stringify({ actif: user.actif }),
      newValue: JSON.stringify({ actif: false }),
      details: `Utilisateur désactivé: ${user.nomcomplet} (${user.role})`,
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Utilisateur désactivé avec succès",
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur suppression utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

/**
 * Réactiver un utilisateur
 * POST /api/utilisateurs/:id/activate
 */
exports.activateUser = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent réactiver des utilisateurs"
      });
    }

    await client.query('BEGIN');
    
    const { id } = req.params;

    // Récupérer l'utilisateur
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [id]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    await client.query(
      'UPDATE utilisateurs SET actif = true WHERE id = $1',
      [id]
    );

    // Journaliser la réactivation
    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: `Réactivation utilisateur: ${user.nomutilisateur}`,
      actionType: "ACTIVATE_USER",
      tableName: "Utilisateurs",
      recordId: id,
      oldValue: JSON.stringify({ actif: user.actif }),
      newValue: JSON.stringify({ actif: true }),
      details: "Utilisateur réactivé",
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Utilisateur réactivé avec succès",
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur réactivation utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  } finally {
    client.release();
  }
};

// ============================================
// STATISTIQUES ET RECHERCHE OPTIMISÉES
// ============================================

/**
 * Récupérer les statistiques des utilisateurs avec cache
 * GET /api/utilisateurs/stats
 */
exports.getUserStats = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent consulter les statistiques"
      });
    }

    const { forceRefresh } = req.query;
    
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

    // Activité récente des utilisateurs
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
        taux_activation: stats.rows[0].total_utilisateurs > 0 
          ? Math.round((stats.rows[0].utilisateurs_actifs / stats.rows[0].total_utilisateurs) * 100) 
          : 0,
        roles_distincts: parseInt(stats.rows[0].roles_distincts),
        agences_distinctes: parseInt(stats.rows[0].agences_distinctes),
        coordinations_distinctes: parseInt(stats.rows[0].coordinations_distinctes),
        nouveaux_30j: parseInt(stats.rows[0].nouveaux_30j),
        premier_utilisateur: stats.rows[0].premier_utilisateur,
        dernier_utilisateur: stats.rows[0].dernier_utilisateur
      },
      parRole: rolesStats.rows.map(row => ({
        ...row,
        count: parseInt(row.count),
        actifs: parseInt(row.actifs),
        pourcentage: parseFloat(row.pourcentage)
      })),
      parCoordination: coordinationStats.rows.map(row => ({
        ...row,
        count: parseInt(row.count),
        actifs: parseInt(row.actifs)
      })),
      activiteRecente: recentActivity.rows.map(row => ({
        ...row,
        total_actions: parseInt(row.total_actions),
        actions_24h: parseInt(row.actions_24h)
      })),
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

  } catch (error) {
    console.error("❌ Erreur statistiques utilisateurs:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Rechercher des utilisateurs (version simplifiée pour auto-complétion)
 * GET /api/utilisateurs/search
 */
exports.searchUsers = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent rechercher des utilisateurs"
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

    // Requête COUNT
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
      db.query(countQuery, countParams)
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
        hasPrev: actualPage > 1
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur recherche utilisateurs:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Récupérer l'historique d'un utilisateur
 * GET /api/utilisateurs/:id/history
 */
exports.getUserHistory = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent consulter l'historique des utilisateurs"
      });
    }

    const { id } = req.params;
    const { limit = 50, page = 1 } = req.query;

    const actualPage = Math.max(1, parseInt(page));
    const actualLimit = Math.min(parseInt(limit), 200);
    const offset = (actualPage - 1) * actualLimit;

    // Vérifier que l'utilisateur existe
    const userResult = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1',
      [id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    const startTime = Date.now();

    const history = await db.query(`
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
    `, [id, actualLimit, offset]);

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
        hasPrev: actualPage > 1
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur historique utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Exporter la liste des utilisateurs
 * GET /api/utilisateurs/export
 */
exports.exportUsers = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent exporter les utilisateurs"
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
      // Export CSV
      const csvHeaders = 'NomUtilisateur,NomComplet,Email,Agence,Role,Coordination,DateCreation,DerniereConnexion,Statut\n';
      const csvData = users.rows.map(row => 
        `"${row.nomutilisateur}","${row.nomcomplet}","${row.email || ''}","${row.agence || ''}","${row.role}","${row.coordination || ''}","${row.datecreation}","${row.derniereconnexion || ''}","${row.statut}"`
      ).join('\n');
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.write('\uFEFF'); // BOM UTF-8
      res.send(csvHeaders + csvData);

    } else {
      // Export JSON
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
      res.json({
        success: true,
        data: users.rows,
        exportDate: new Date().toISOString(),
        total: users.rows.length
      });
    }

  } catch (error) {
    console.error("❌ Erreur export utilisateurs:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Vérifier la disponibilité d'un nom d'utilisateur
 * GET /api/utilisateurs/check-username
 */
exports.checkUsernameAvailability = async (req, res) => {
  try {
    const { username, excludeId } = req.query;

    if (!username) {
      return res.status(400).json({ 
        success: false,
        message: "Nom d'utilisateur requis" 
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
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur vérification nom d'utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Récupérer la liste des rôles disponibles
 * GET /api/utilisateurs/roles
 */
exports.getRoles = async (req, res) => {
  try {
    res.json({
      success: true,
      roles: CONFIG.validRoles,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erreur récupération rôles:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Récupérer la liste des coordinations disponibles
 * GET /api/utilisateurs/coordinations
 */
exports.getCoordinations = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent lister les coordinations"
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
      coordinations: result.rows.map(r => r.coordination),
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur récupération coordinations:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Nettoyer le cache des statistiques
 * POST /api/utilisateurs/cache/clear
 */
exports.clearStatsCache = async (req, res) => {
  try {
    CONFIG.statsCache = null;
    CONFIG.statsCacheTime = null;

    res.json({
      success: true,
      message: "Cache des statistiques nettoyé",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("❌ Erreur nettoyage cache:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Diagnostic du module utilisateurs
 * GET /api/utilisateurs/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent accéder au diagnostic"
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
        coordination: req.user.coordination
      },
      statistiques: {
        total_utilisateurs: parseInt(stats.total_utilisateurs),
        utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
        taux_activation: stats.total_utilisateurs > 0 
          ? Math.round((stats.utilisateurs_actifs / stats.total_utilisateurs) * 100) 
          : 0,
        roles_distincts: parseInt(stats.roles_distincts),
        coordinations_distinctes: parseInt(stats.coordinations_distinctes),
        premier_utilisateur: stats.premier_utilisateur,
        dernier_utilisateur: stats.dernier_utilisateur
      },
      stockage: {
        taille_table: stats.table_size_pretty,
        taille_bytes: parseInt(stats.table_size)
      },
      config: {
        saltRounds: CONFIG.saltRounds,
        jwtExpiration: CONFIG.jwtExpiration,
        minPasswordLength: CONFIG.minPasswordLength,
        maxLoginAttempts: CONFIG.maxLoginAttempts,
        lockoutDuration: CONFIG.lockoutDuration / 60000 + ' minutes',
        cacheTimeout: CONFIG.cacheTimeout,
        validRoles: CONFIG.validRoles
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      endpoints: [
        '/api/auth/login',
        '/api/auth/logout',
        '/api/auth/verify',
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
        '/api/utilisateurs/diagnostic'
      ]
    });

  } catch (error) {
    console.error("❌ Erreur diagnostic:", error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};