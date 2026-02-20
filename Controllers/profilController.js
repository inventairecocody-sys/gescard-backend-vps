const bcrypt = require('bcryptjs');
const db = require("../db/db");
const journalController = require("./journalController");

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  saltRounds: 12,              // Niveau de hash bcrypt
  minPasswordLength: 8,         // Longueur minimale mot de passe
  maxActivityLimit: 1000,       // Max activités à retourner
  sessionTimeout: 3600000,      // 1 heure en ms
  cacheTimeout: 300,            // Cache stats 5 minutes
  statsCache: new Map(),        // Cache pour les stats utilisateur
  statsCacheTime: new Map()
};

// ============================================
// FONCTIONS UTILITAIRES DE VÉRIFICATION
// ============================================

/**
 * Vérifie si l'utilisateur peut accéder/modifier un profil
 */
const peutAccederProfil = (req, userIdCible) => {
  const role = req.user?.role;
  const userId = req.user?.id;

  // Admin peut tout voir
  if (role === 'Administrateur') {
    return { autorise: true };
  }

  // Gestionnaire, Chef d'équipe, Opérateur ne voient que leur propre profil
  if (parseInt(userId) === parseInt(userIdCible)) {
    return { autorise: true };
  }

  return { 
    autorise: false, 
    message: "Vous ne pouvez accéder qu'à votre propre profil" 
  };
};

// ============================================
// CONTROLEUR PROFIL OPTIMISÉ POUR LWS
// ============================================

/**
 * Récupérer le profil de l'utilisateur connecté
 * GET /api/profil
 */
exports.getProfile = async (req, res) => {
  try {
    const userId = req.user.id;

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
        actif,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
      FROM utilisateurs 
      WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Ne pas retourner le mot de passe
    delete user.motdepasse;

    res.json({
      success: true,
      user,
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur récupération profil:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Récupérer le profil d'un utilisateur par ID (Admin uniquement)
 * GET /api/profil/:userId
 */
exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;

    // Vérifier les droits
    const droits = peutAccederProfil(req, userId);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        message: droits.message
      });
    }

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
        actif,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
      FROM utilisateurs 
      WHERE id = $1`,
      [userId]
    );

    const user = result.rows[0];
    
    if (!user) {
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Ne pas retourner le mot de passe
    delete user.motdepasse;

    res.json({
      success: true,
      user,
      performance: {
        queryTime: Date.now() - startTime
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur récupération profil utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Changer le mot de passe
 * POST /api/profil/change-password
 */
exports.changePassword = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    // Validation
    if (!currentPassword || !newPassword) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Les mots de passe sont requis" 
      });
    }

    if (newPassword.length < CONFIG.minPasswordLength) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères` 
      });
    }

    if (confirmPassword && newPassword !== confirmPassword) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Les mots de passe ne correspondent pas" 
      });
    }

    // Vérifier la complexité (optionnel)
    const hasUpperCase = /[A-Z]/.test(newPassword);
    const hasLowerCase = /[a-z]/.test(newPassword);
    const hasNumbers = /\d/.test(newPassword);

    if (!(hasUpperCase && hasLowerCase && hasNumbers)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre" 
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier le mot de passe actuel
    const isMatch = await bcrypt.compare(currentPassword, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return res.status(401).json({ 
        success: false,
        message: "Mot de passe actuel incorrect" 
      });
    }

    // Vérifier que le nouveau mot de passe est différent
    const isSamePassword = await bcrypt.compare(newPassword, user.motdepasse);
    if (isSamePassword) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Le nouveau mot de passe doit être différent de l'ancien" 
      });
    }

    // Hasher le nouveau mot de passe
    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    // Mettre à jour le mot de passe
    await client.query(
      'UPDATE utilisateurs SET motdepasse = $1, derniereconnexion = NOW() WHERE id = $2',
      [hashedPassword, userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: user.id,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: "Changement de mot de passe",
      actionType: "UPDATE_PASSWORD",
      tableName: "Utilisateurs",
      recordId: user.id.toString(),
      details: "Modification du mot de passe",
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Mot de passe modifié avec succès",
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur changement mot de passe:", error);
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
 * Mettre à jour le profil
 * PUT /api/profil
 */
exports.updateProfile = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    const { nomComplet, email, agence } = req.body;
    const userId = req.user.id;

    // Validation
    if (!nomComplet || nomComplet.trim() === '') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Le nom complet est requis" 
      });
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Format d'email invalide" 
      });
    }

    // Récupérer l'ancien profil
    const oldProfileResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [userId]
    );

    const oldProfile = oldProfileResult.rows[0];
    
    if (!oldProfile) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier si l'email est déjà utilisé par un autre utilisateur
    if (email && email !== oldProfile.email) {
      const emailCheck = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return res.status(400).json({ 
          success: false,
          message: "Cet email est déjà utilisé" 
        });
      }
    }

    // Mettre à jour le profil
    await client.query(
      'UPDATE utilisateurs SET nomcomplet = $1, email = $2, agence = $3 WHERE id = $4',
      [nomComplet.trim(), email || null, agence || null, userId]
    );

    // Récupérer le nouveau profil
    const newProfileResult = await client.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        actif 
      FROM utilisateurs WHERE id = $1`,
      [userId]
    );

    const newProfile = newProfileResult.rows[0];

    // Journaliser si des changements ont eu lieu
    const changes = [];
    if (oldProfile.nomcomplet !== newProfile.nomcomplet) changes.push('nom complet');
    if (oldProfile.email !== newProfile.email) changes.push('email');
    if (oldProfile.agence !== newProfile.agence) changes.push('agence');

    if (changes.length > 0) {
      await journalController.logAction({
        utilisateurId: userId,
        nomUtilisateur: oldProfile.nomutilisateur,
        nomComplet: oldProfile.nomcomplet,
        role: oldProfile.role,
        agence: oldProfile.agence,
        coordination: oldProfile.coordination,
        action: "Modification du profil",
        actionType: "UPDATE_PROFILE",
        tableName: "Utilisateurs",
        recordId: userId.toString(),
        oldValue: JSON.stringify({
          nomComplet: oldProfile.nomcomplet,
          email: oldProfile.email,
          agence: oldProfile.agence
        }),
        newValue: JSON.stringify({
          nomComplet: newProfile.nomcomplet,
          email: newProfile.email,
          agence: newProfile.agence
        }),
        details: `Modification: ${changes.join(', ')}`,
        ip: req.ip
      });
    }

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Profil mis à jour avec succès",
      user: newProfile,
      changes: changes.length > 0 ? changes : ['aucun changement'],
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur mise à jour profil:", error);
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
 * Récupérer l'activité de l'utilisateur
 * GET /api/profil/activity
 */
exports.getUserActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const { limit = 20, page = 1 } = req.query;

    const actualLimit = Math.min(parseInt(limit), CONFIG.maxActivityLimit);
    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        detailsaction,
        importbatchid,
        annulee,
        coordination
       FROM journalactivite 
       WHERE utilisateurid = $1 
       ORDER BY dateaction DESC 
       LIMIT $2 OFFSET $3`,
      [userId, actualLimit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1',
      [userId]
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      activities: result.rows,
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
    console.error("❌ Erreur récupération activités:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Récupérer l'activité d'un utilisateur (Admin uniquement)
 * GET /api/profil/:userId/activity
 */
exports.getUserActivityById = async (req, res) => {
  try {
    const { userId } = req.params;

    // Vérifier les droits (Admin uniquement)
    if (req.user.role !== 'Administrateur') {
      return res.status(403).json({
        success: false,
        message: "Seuls les administrateurs peuvent consulter l'activité des autres utilisateurs"
      });
    }

    const { limit = 20, page = 1 } = req.query;

    const actualLimit = Math.min(parseInt(limit), CONFIG.maxActivityLimit);
    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    const startTime = Date.now();

    const result = await db.query(
      `SELECT 
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        detailsaction,
        importbatchid,
        annulee,
        coordination
       FROM journalactivite 
       WHERE utilisateurid = $1 
       ORDER BY dateaction DESC 
       LIMIT $2 OFFSET $3`,
      [userId, actualLimit, offset]
    );

    const countResult = await db.query(
      'SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1',
      [userId]
    );

    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / actualLimit);

    res.json({
      success: true,
      userId: parseInt(userId),
      activities: result.rows,
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
    console.error("❌ Erreur récupération activités utilisateur:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Vérifier la disponibilité du nom d'utilisateur
 * GET /api/profil/check-username
 */
exports.checkUsernameAvailability = async (req, res) => {
  try {
    const { username } = req.query;
    const userId = req.user.id;

    if (!username || username.trim() === '') {
      return res.status(400).json({ 
        success: false,
        message: "Nom d'utilisateur requis" 
      });
    }

    // Validation du format
    const usernameRegex = /^[a-zA-Z0-9._-]{3,30}$/;
    if (!usernameRegex.test(username)) {
      return res.status(400).json({
        success: false,
        message: "Le nom d'utilisateur doit contenir 3-30 caractères (lettres, chiffres, . _ -)"
      });
    }

    const startTime = Date.now();

    const result = await db.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1 AND id != $2',
      [username.trim(), userId]
    );

    const isAvailable = result.rows.length === 0;

    res.json({
      success: true,
      available: isAvailable,
      message: isAvailable ? "Nom d'utilisateur disponible" : "Nom d'utilisateur déjà utilisé",
      performance: {
        queryTime: Date.now() - startTime
      },
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
 * Mettre à jour le nom d'utilisateur
 * PUT /api/profil/username
 */
exports.updateUsername = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    const { newUsername, password } = req.body;
    const userId = req.user.id;

    // Validation
    if (!newUsername || newUsername.trim() === '') {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Nouveau nom d'utilisateur requis" 
      });
    }

    // Validation du format
    const usernameRegex = /^[a-zA-Z0-9._-]{3,30}$/;
    if (!usernameRegex.test(newUsername)) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Le nom d'utilisateur doit contenir 3-30 caractères (lettres, chiffres, . _ -)"
      });
    }

    // Vérifier le mot de passe pour sécurité
    if (!password) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        success: false,
        message: "Mot de passe requis pour modifier le nom d'utilisateur"
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(password, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return res.status(401).json({ 
        success: false,
        message: "Mot de passe incorrect" 
      });
    }

    // Vérifier si le nom d'utilisateur est disponible
    const checkResult = await client.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1 AND id != $2',
      [newUsername.trim(), userId]
    );

    if (checkResult.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Ce nom d'utilisateur est déjà utilisé" 
      });
    }

    // Mettre à jour le nom d'utilisateur
    await client.query(
      'UPDATE utilisateurs SET nomutilisateur = $1 WHERE id = $2',
      [newUsername.trim(), userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: userId,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: "Changement de nom d'utilisateur",
      actionType: "UPDATE_USERNAME",
      tableName: "Utilisateurs",
      recordId: userId.toString(),
      oldValue: JSON.stringify({ nomUtilisateur: user.nomutilisateur }),
      newValue: JSON.stringify({ nomUtilisateur: newUsername.trim() }),
      details: `Changement de nom d'utilisateur`,
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Nom d'utilisateur modifié avec succès",
      newUsername: newUsername.trim(),
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur changement nom d'utilisateur:", error);
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
 * Statistiques du profil
 * GET /api/profil/stats
 */
exports.getProfileStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const { forceRefresh } = req.query;

    // Vérifier le cache
    const cacheKey = `user_stats_${userId}`;
    if (!forceRefresh && 
        CONFIG.statsCache.has(cacheKey) && 
        CONFIG.statsCacheTime.has(cacheKey) && 
        (Date.now() - CONFIG.statsCacheTime.get(cacheKey)) < CONFIG.cacheTimeout * 1000) {
      return res.json({
        success: true,
        ...CONFIG.statsCache.get(cacheKey),
        cached: true,
        cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime.get(cacheKey)) / 1000) + 's'
      });
    }

    const startTime = Date.now();

    // Statistiques des actions
    const activityStats = await db.query(
      `SELECT 
        COUNT(*) as total_actions,
        COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as actions_7j,
        COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as actions_30j,
        COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as actions_24h
       FROM journalactivite 
       WHERE utilisateurid = $1`,
      [userId]
    );

    // Dernière connexion
    const lastLoginResult = await db.query(
      `SELECT dateaction 
       FROM journalactivite 
       WHERE utilisateurid = $1 AND actiontype = 'LOGIN' 
       ORDER BY dateaction DESC 
       LIMIT 1`,
      [userId]
    );

    // Première connexion
    const firstLoginResult = await db.query(
      `SELECT MIN(dateaction) as first_action
       FROM journalactivite 
       WHERE utilisateurid = $1`,
      [userId]
    );

    // Actions les plus fréquentes
    const frequentActions = await db.query(
      `SELECT 
        actiontype,
        COUNT(*) as count
       FROM journalactivite 
       WHERE utilisateurid = $1 
       GROUP BY actiontype 
       ORDER BY count DESC 
       LIMIT 5`,
      [userId]
    );

    // Répartition par jour (30 derniers jours)
    const dailyActivity = await db.query(
      `SELECT 
        DATE(dateaction) as jour,
        COUNT(*) as count
       FROM journalactivite 
       WHERE utilisateurid = $1 AND dateaction > NOW() - INTERVAL '30 days'
       GROUP BY DATE(dateaction)
       ORDER BY jour DESC`,
      [userId]
    );

    const statsData = {
      stats: {
        totalActions: parseInt(activityStats.rows[0].total_actions),
        actionsLast24h: parseInt(activityStats.rows[0].actions_24h),
        actionsLast7Days: parseInt(activityStats.rows[0].actions_7j),
        actionsLast30Days: parseInt(activityStats.rows[0].actions_30j),
        lastLogin: lastLoginResult.rows[0]?.dateaction || null,
        firstAction: firstLoginResult.rows[0]?.first_action || null,
        memberSince: firstLoginResult.rows[0]?.first_action 
          ? Math.ceil((Date.now() - new Date(firstLoginResult.rows[0].first_action)) / (1000 * 60 * 60 * 24)) + ' jours'
          : 'N/A'
      },
      frequentActions: frequentActions.rows.map(a => ({
        ...a,
        count: parseInt(a.count),
        pourcentage: activityStats.rows[0].total_actions > 0 
          ? Math.round((a.count / activityStats.rows[0].total_actions) * 100) 
          : 0
      })),
      dailyActivity: dailyActivity.rows,
      performance: {
        queryTime: Date.now() - startTime
      }
    };

    // Mettre en cache
    CONFIG.statsCache.set(cacheKey, statsData);
    CONFIG.statsCacheTime.set(cacheKey, Date.now());

    res.json({
      success: true,
      ...statsData,
      cached: false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur statistiques profil:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Désactiver le compte
 * POST /api/profil/deactivate
 */
exports.deactivateAccount = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    const { password, reason } = req.body;
    const userId = req.user.id;

    if (!password) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Mot de passe requis pour désactiver le compte" 
      });
    }

    // Récupérer l'utilisateur
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    // Vérifier le mot de passe
    const isMatch = await bcrypt.compare(password, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return res.status(401).json({ 
        success: false,
        message: "Mot de passe incorrect" 
      });
    }

    // Vérifier si déjà inactif
    if (!user.actif) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Le compte est déjà désactivé" 
      });
    }

    // Désactiver le compte
    await client.query(
      'UPDATE utilisateurs SET actif = false, date_desactivation = NOW() WHERE id = $1',
      [userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: userId,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: "Désactivation du compte",
      actionType: "DEACTIVATE_ACCOUNT",
      tableName: "Utilisateurs",
      recordId: userId.toString(),
      details: reason ? `Désactivation: ${reason}` : "Désactivation du compte",
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Compte désactivé avec succès",
      note: "Votre compte a été désactivé. Contactez un administrateur pour le réactiver.",
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur désactivation compte:", error);
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
 * Réactiver le compte (via admin)
 * POST /api/profil/reactivate/:userId
 */
exports.reactivateAccount = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    const { userId } = req.params;
    const adminId = req.user.id;

    // Vérifier les droits admin
    if (req.user.role !== 'Administrateur') {
      await client.query('ROLLBACK');
      return res.status(403).json({ 
        success: false,
        message: "Permission refusée - Action réservée aux administrateurs" 
      });
    }

    // Récupérer l'utilisateur à réactiver
    const userResult = await client.query(
      'SELECT * FROM utilisateurs WHERE id = $1',
      [userId]
    );

    const user = userResult.rows[0];
    
    if (!user) {
      await client.query('ROLLBACK');
      return res.status(404).json({ 
        success: false,
        message: "Utilisateur non trouvé" 
      });
    }

    if (user.actif) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false,
        message: "Le compte est déjà actif" 
      });
    }

    // Réactiver le compte
    await client.query(
      'UPDATE utilisateurs SET actif = true, date_reactivation = NOW() WHERE id = $1',
      [userId]
    );

    // ✅ JOURNALISATION
    await journalController.logAction({
      utilisateurId: adminId,
      nomUtilisateur: req.user.nomutilisateur,
      nomComplet: req.user.nomcomplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: "Réactivation de compte",
      actionType: "REACTIVATE_ACCOUNT",
      tableName: "Utilisateurs",
      recordId: userId.toString(),
      details: `Compte réactivé par admin: ${user.nomutilisateur}`,
      ip: req.ip
    });

    await client.query('COMMIT');

    const duration = Date.now() - startTime;

    res.json({ 
      success: true,
      message: "Compte réactivé avec succès",
      user: {
        id: user.id,
        nomUtilisateur: user.nomutilisateur,
        actif: true
      },
      performance: {
        duration
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error("❌ Erreur réactivation compte:", error);
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
 * Exporter les données du profil
 * GET /api/profil/export
 */
exports.exportProfileData = async (req, res) => {
  try {
    const userId = req.user.id;
    const { format = 'json' } = req.query;

    const startTime = Date.now();

    // Données du profil
    const profileResult = await db.query(
      `SELECT 
        id, 
        nomutilisateur, 
        nomcomplet, 
        email, 
        agence, 
        role,
        coordination,
        actif,
        TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
        TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
      FROM utilisateurs 
      WHERE id = $1`,
      [userId]
    );

    // Historique des activités
    const activitiesResult = await db.query(
      `SELECT 
        actiontype,
        action,
        TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
        tablename,
        detailsaction,
        importbatchid,
        annulee,
        coordination
       FROM journalactivite 
       WHERE utilisateurid = $1 
       ORDER BY dateaction DESC`,
      [userId]
    );

    const exportData = {
      profile: profileResult.rows[0],
      activities: activitiesResult.rows,
      exportDate: new Date().toISOString(),
      totalActivities: activitiesResult.rows.length,
      generatedBy: req.user.nomutilisateur
    };

    const filename = `profil-${req.user.nomutilisateur}-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      // Export CSV
      const csvHeaders = 'Type,Action,Date,Table,Détails,BatchID,Annulée\n';
      const csvData = activitiesResult.rows.map(row => 
        `"${row.actiontype || ''}","${(row.action || '').replace(/"/g, '""')}","${row.dateaction || ''}","${row.tablename || ''}","${(row.detailsaction || '').replace(/"/g, '""')}","${row.importbatchid || ''}","${row.annulee ? 'Oui' : 'Non'}"`
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
        ...exportData,
        performance: {
          queryTime: Date.now() - startTime
        }
      });
    }

  } catch (error) {
    console.error("❌ Erreur export données profil:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Sessions actives (si vous gérez les sessions)
 * GET /api/profil/sessions
 */
exports.getActiveSessions = async (req, res) => {
  try {
    const userId = req.user.id;

    // À implémenter selon votre système de sessions
    // Exemple avec des tokens JWT stockés en base
    const result = await db.query(
      `SELECT 
        id,
        token,
        created_at,
        last_activity,
        ip_address,
        user_agent
      FROM user_sessions 
      WHERE user_id = $1 AND expires_at > NOW()
      ORDER BY last_activity DESC`,
      [userId]
    );

    res.json({
      success: true,
      sessions: result.rows,
      total: result.rows.length,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur récupération sessions:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Déconnecter toutes les autres sessions
 * POST /api/profil/logout-others
 */
exports.logoutOtherSessions = async (req, res) => {
  try {
    const userId = req.user.id;
    const currentSessionId = req.sessionId; // À adapter

    await db.query(
      'DELETE FROM user_sessions WHERE user_id = $1 AND id != $2',
      [userId, currentSessionId]
    );

    res.json({
      success: true,
      message: "Autres sessions déconnectées avec succès",
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error("❌ Erreur déconnexion autres sessions:", error);
    res.status(500).json({ 
      success: false,
      message: "Erreur serveur", 
      error: error.message 
    });
  }
};

/**
 * Nettoyer le cache des stats utilisateur
 * POST /api/profil/cache/clear
 */
exports.clearUserCache = async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user_stats_${userId}`;
    
    CONFIG.statsCache.delete(cacheKey);
    CONFIG.statsCacheTime.delete(cacheKey);

    res.json({
      success: true,
      message: "Cache utilisateur nettoyé",
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
 * Diagnostic du profil (Admin uniquement)
 * GET /api/profil/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    // Vérifier les droits
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
        COUNT(CASE WHEN NOT actif THEN 1 END) as utilisateurs_inactifs,
        MIN(datecreation) as premier_utilisateur,
        MAX(datecreation) as dernier_utilisateur,
        COUNT(DISTINCT role) as roles_distincts,
        COUNT(DISTINCT agence) as agences_distinctes,
        COUNT(DISTINCT coordination) as coordinations_distinctes
      FROM utilisateurs
    `);

    // Statistiques par coordination
    const coordinationStats = await db.query(`
      SELECT 
        coordination,
        COUNT(*) as total_utilisateurs,
        COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs
      FROM utilisateurs
      WHERE coordination IS NOT NULL
      GROUP BY coordination
      ORDER BY total_utilisateurs DESC
    `);

    const stats = result.rows[0];

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'profil',
      utilisateur: {
        role: req.user.role,
        coordination: req.user.coordination
      },
      statistiques: {
        total_utilisateurs: parseInt(stats.total_utilisateurs),
        utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
        utilisateurs_inactifs: parseInt(stats.utilisateurs_inactifs),
        taux_activation: stats.total_utilisateurs > 0 
          ? Math.round((stats.utilisateurs_actifs / stats.total_utilisateurs) * 100) 
          : 0,
        premier_utilisateur: stats.premier_utilisateur,
        dernier_utilisateur: stats.dernier_utilisateur,
        roles_distincts: parseInt(stats.roles_distincts),
        agences_distinctes: parseInt(stats.agences_distinctes),
        coordinations_distinctes: parseInt(stats.coordinations_distinctes)
      },
      coordination_stats: coordinationStats.rows,
      config: {
        saltRounds: CONFIG.saltRounds,
        minPasswordLength: CONFIG.minPasswordLength,
        maxActivityLimit: CONFIG.maxActivityLimit,
        cacheTimeout: CONFIG.cacheTimeout
      },
      performance: {
        queryTime: Date.now() - startTime
      },
      endpoints: [
        '/api/profil',
        '/api/profil/:userId',
        '/api/profil/change-password',
        '/api/profil/activity',
        '/api/profil/:userId/activity',
        '/api/profil/check-username',
        '/api/profil/username',
        '/api/profil/stats',
        '/api/profil/deactivate',
        '/api/profil/reactivate/:userId',
        '/api/profil/export',
        '/api/profil/sessions',
        '/api/profil/logout-others',
        '/api/profil/cache/clear',
        '/api/profil/diagnostic'
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