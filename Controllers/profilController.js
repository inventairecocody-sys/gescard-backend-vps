const bcrypt = require('bcryptjs');
const db = require('../db/db');
const journalController = require('../Services/journalService');
const {
  serverError,
  notFound,
  forbidden,
  badRequest,
  unauthorized,
} = require('../utils/errorResponse');

const CONFIG = {
  saltRounds: 12,
  minPasswordLength: 8,
  maxActivityLimit: 1000,
  sessionTimeout: 3600000,
  cacheTimeout: 300,
  statsCache: new Map(),
  statsCacheTime: new Map(),
};

const peutAccederProfil = (req, userIdCible) => {
  const role = req.user?.role;
  const userId = req.user?.id;
  if (role === 'Administrateur') return { autorise: true };
  if (parseInt(userId) === parseInt(userIdCible)) return { autorise: true };
  return { autorise: false, message: "Vous ne pouvez accéder qu'à votre propre profil" };
};

// ── GET /api/profil ──
exports.getProfile = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, actif,
              TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
              TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
       FROM utilisateurs WHERE id = $1`,
      [req.user.id]
    );
    const user = result.rows[0];
    if (!user) return notFound(res, 'Utilisateur non trouvé');
    delete user.motdepasse;
    res.json({ success: true, user, timestamp: new Date().toISOString() });
  } catch (error) {
    return serverError(res, error, 'getProfile');
  }
};

// ── GET /api/profil/:userId ──
exports.getUserProfile = async (req, res) => {
  try {
    const { userId } = req.params;
    const droits = peutAccederProfil(req, userId);
    if (!droits.autorise) return forbidden(res, droits.message);

    const result = await db.query(
      `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, actif,
              TO_CHAR(datecreation, 'YYYY-MM-DD HH24:MI:SS') as datecreation,
              TO_CHAR(derniereconnexion, 'YYYY-MM-DD HH24:MI:SS') as derniereconnexion
       FROM utilisateurs WHERE id = $1`,
      [parseInt(userId)]
    );
    const user = result.rows[0];
    if (!user) return notFound(res, 'Utilisateur non trouvé');
    delete user.motdepasse;
    res.json({ success: true, user, timestamp: new Date().toISOString() });
  } catch (error) {
    return serverError(res, error, 'getUserProfile');
  }
};

// ── POST /api/profil/change-password ──
exports.changePassword = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { currentPassword, newPassword, confirmPassword } = req.body;
    const userId = req.user.id;

    if (!currentPassword || !newPassword) return badRequest(res, 'Les mots de passe sont requis');
    if (newPassword.length < CONFIG.minPasswordLength)
      return badRequest(
        res,
        `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`
      );
    if (confirmPassword && newPassword !== confirmPassword)
      return badRequest(res, 'Les mots de passe ne correspondent pas');
    if (!/[A-Z]/.test(newPassword) || !/[a-z]/.test(newPassword) || !/\d/.test(newPassword))
      return badRequest(
        res,
        'Le mot de passe doit contenir au moins une majuscule, une minuscule et un chiffre'
      );

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }

    const isMatch = await bcrypt.compare(currentPassword, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return unauthorized(res, 'Mot de passe actuel incorrect');
    }

    const isSame = await bcrypt.compare(newPassword, user.motdepasse);
    if (isSame) {
      await client.query('ROLLBACK');
      return badRequest(res, "Le nouveau mot de passe doit être différent de l'ancien");
    }

    const hashed = await bcrypt.hash(newPassword, CONFIG.saltRounds);
    await client.query(
      'UPDATE utilisateurs SET motdepasse = $1, derniereconnexion = NOW() WHERE id = $2',
      [hashed, userId]
    );

    await journalController.logAction({
      utilisateurId: user.id,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: 'Changement de mot de passe',
      actionType: 'UPDATE_PASSWORD',
      tableName: 'Utilisateurs',
      recordId: user.id.toString(),
      details: 'Modification du mot de passe',
      ip: req.ip,
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Mot de passe modifié avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'changePassword');
  } finally {
    client.release();
  }
};

// ── PUT /api/profil ──
exports.updateProfile = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { nomComplet, email, agence } = req.body;
    const userId = req.user.id;

    if (!nomComplet?.trim()) return badRequest(res, 'Le nom complet est requis');
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return badRequest(res, "Format d'email invalide");

    const oldResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const oldProfile = oldResult.rows[0];
    if (!oldProfile) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }

    if (email && email !== oldProfile.email) {
      const emailCheck = await client.query(
        'SELECT id FROM utilisateurs WHERE email = $1 AND id != $2',
        [email, userId]
      );
      if (emailCheck.rows.length > 0) {
        await client.query('ROLLBACK');
        return badRequest(res, 'Cet email est déjà utilisé');
      }
    }

    await client.query(
      'UPDATE utilisateurs SET nomcomplet = $1, email = $2, agence = $3 WHERE id = $4',
      [nomComplet.trim(), email || null, agence || null, userId]
    );

    const newResult = await client.query(
      `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, actif FROM utilisateurs WHERE id = $1`,
      [userId]
    );
    const newProfile = newResult.rows[0];

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
        action: 'Modification du profil',
        actionType: 'UPDATE_PROFILE',
        tableName: 'Utilisateurs',
        recordId: userId.toString(),
        oldValue: JSON.stringify({
          nomComplet: oldProfile.nomcomplet,
          email: oldProfile.email,
          agence: oldProfile.agence,
        }),
        newValue: JSON.stringify({
          nomComplet: newProfile.nomcomplet,
          email: newProfile.email,
          agence: newProfile.agence,
        }),
        details: `Modification: ${changes.join(', ')}`,
        ip: req.ip,
      });
    }

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Profil mis à jour avec succès',
      user: newProfile,
      changes: changes.length > 0 ? changes : ['aucun changement'],
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'updateProfile');
  } finally {
    client.release();
  }
};

// ── GET /api/profil/activity ──
exports.getUserActivity = async (req, res) => {
  try {
    const userId = req.user.id;
    const actualLimit = Math.min(parseInt(req.query.limit) || 20, CONFIG.maxActivityLimit);
    const actualPage = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (actualPage - 1) * actualLimit;

    const [result, countResult] = await Promise.all([
      db.query(
        `SELECT actiontype, action, TO_CHAR(dateaction,'YYYY-MM-DD HH24:MI:SS') as dateaction, tablename, detailsaction, importbatchid, annulee, coordination FROM journalactivite WHERE utilisateurid = $1 ORDER BY dateaction DESC LIMIT $2 OFFSET $3`,
        [userId, actualLimit, offset]
      ),
      db.query('SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1', [userId]),
    ]);

    const total = parseInt(countResult.rows[0].total);
    res.json({
      success: true,
      activities: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'getUserActivity');
  }
};

// ── GET /api/profil/:userId/activity ──
exports.getUserActivityById = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur')
      return forbidden(
        res,
        "Seuls les administrateurs peuvent consulter l'activité des autres utilisateurs"
      );

    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return badRequest(res, 'ID invalide');

    const actualLimit = Math.min(parseInt(req.query.limit) || 20, CONFIG.maxActivityLimit);
    const actualPage = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (actualPage - 1) * actualLimit;

    const [result, countResult] = await Promise.all([
      db.query(
        `SELECT actiontype, action, TO_CHAR(dateaction,'YYYY-MM-DD HH24:MI:SS') as dateaction, tablename, detailsaction, importbatchid, annulee, coordination FROM journalactivite WHERE utilisateurid = $1 ORDER BY dateaction DESC LIMIT $2 OFFSET $3`,
        [userId, actualLimit, offset]
      ),
      db.query('SELECT COUNT(*) as total FROM journalactivite WHERE utilisateurid = $1', [userId]),
    ]);

    const total = parseInt(countResult.rows[0].total);
    res.json({
      success: true,
      userId,
      activities: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'getUserActivityById');
  }
};

// ── GET /api/profil/check-username ──
exports.checkUsernameAvailability = async (req, res) => {
  try {
    const { username } = req.query;
    if (!username?.trim()) return badRequest(res, "Nom d'utilisateur requis");
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(username))
      return badRequest(
        res,
        "Le nom d'utilisateur doit contenir 3-30 caractères (lettres, chiffres, . _ -)"
      );

    const result = await db.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1 AND id != $2',
      [username.trim(), req.user.id]
    );
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

// ── PUT /api/profil/username ──
exports.updateUsername = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { newUsername, password } = req.body;
    const userId = req.user.id;

    if (!newUsername?.trim()) return badRequest(res, "Nouveau nom d'utilisateur requis");
    if (!/^[a-zA-Z0-9._-]{3,30}$/.test(newUsername))
      return badRequest(
        res,
        "Le nom d'utilisateur doit contenir 3-30 caractères (lettres, chiffres, . _ -)"
      );
    if (!password) return badRequest(res, "Mot de passe requis pour modifier le nom d'utilisateur");

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }

    const isMatch = await bcrypt.compare(password, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return unauthorized(res, 'Mot de passe incorrect');
    }

    const check = await client.query(
      'SELECT id FROM utilisateurs WHERE nomutilisateur = $1 AND id != $2',
      [newUsername.trim(), userId]
    );
    if (check.rows.length > 0) {
      await client.query('ROLLBACK');
      return badRequest(res, "Ce nom d'utilisateur est déjà utilisé");
    }

    await client.query('UPDATE utilisateurs SET nomutilisateur = $1 WHERE id = $2', [
      newUsername.trim(),
      userId,
    ]);

    await journalController.logAction({
      utilisateurId: userId,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: "Changement de nom d'utilisateur",
      actionType: 'UPDATE_USERNAME',
      tableName: 'Utilisateurs',
      recordId: userId.toString(),
      oldValue: JSON.stringify({ nomUtilisateur: user.nomutilisateur }),
      newValue: JSON.stringify({ nomUtilisateur: newUsername.trim() }),
      details: "Changement de nom d'utilisateur",
      ip: req.ip,
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      message: "Nom d'utilisateur modifié avec succès",
      newUsername: newUsername.trim(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'updateUsername');
  } finally {
    client.release();
  }
};

// ── GET /api/profil/stats ──
exports.getProfileStats = async (req, res) => {
  try {
    const userId = req.user.id;
    const cacheKey = `user_stats_${userId}`;

    if (
      !req.query.forceRefresh &&
      CONFIG.statsCache.has(cacheKey) &&
      Date.now() - CONFIG.statsCacheTime.get(cacheKey) < CONFIG.cacheTimeout * 1000
    ) {
      return res.json({
        success: true,
        ...CONFIG.statsCache.get(cacheKey),
        cached: true,
        timestamp: new Date().toISOString(),
      });
    }

    const [activityStats, lastLogin, firstLogin, frequentActions, dailyActivity] =
      await Promise.all([
        db.query(
          `SELECT COUNT(*) as total_actions, COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '7 days' THEN 1 END) as actions_7j, COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '30 days' THEN 1 END) as actions_30j, COUNT(CASE WHEN dateaction >= CURRENT_DATE - INTERVAL '1 day' THEN 1 END) as actions_24h FROM journalactivite WHERE utilisateurid = $1`,
          [userId]
        ),
        db.query(
          `SELECT dateaction FROM journalactivite WHERE utilisateurid = $1 AND actiontype = 'LOGIN' ORDER BY dateaction DESC LIMIT 1`,
          [userId]
        ),
        db.query(
          `SELECT MIN(dateaction) as first_action FROM journalactivite WHERE utilisateurid = $1`,
          [userId]
        ),
        db.query(
          `SELECT actiontype, COUNT(*) as count FROM journalactivite WHERE utilisateurid = $1 GROUP BY actiontype ORDER BY count DESC LIMIT 5`,
          [userId]
        ),
        db.query(
          `SELECT DATE(dateaction) as jour, COUNT(*) as count FROM journalactivite WHERE utilisateurid = $1 AND dateaction > NOW() - INTERVAL '30 days' GROUP BY DATE(dateaction) ORDER BY jour DESC`,
          [userId]
        ),
      ]);

    const total = parseInt(activityStats.rows[0].total_actions);
    const statsData = {
      stats: {
        totalActions: total,
        actionsLast24h: parseInt(activityStats.rows[0].actions_24h),
        actionsLast7Days: parseInt(activityStats.rows[0].actions_7j),
        actionsLast30Days: parseInt(activityStats.rows[0].actions_30j),
        lastLogin: lastLogin.rows[0]?.dateaction || null,
        firstAction: firstLogin.rows[0]?.first_action || null,
        memberSince: firstLogin.rows[0]?.first_action
          ? Math.ceil(
              (Date.now() - new Date(firstLogin.rows[0].first_action)) / (1000 * 60 * 60 * 24)
            ) + ' jours'
          : 'N/A',
      },
      frequentActions: frequentActions.rows.map((a) => ({
        ...a,
        count: parseInt(a.count),
        pourcentage: total > 0 ? Math.round((a.count / total) * 100) : 0,
      })),
      dailyActivity: dailyActivity.rows,
    };

    CONFIG.statsCache.set(cacheKey, statsData);
    CONFIG.statsCacheTime.set(cacheKey, Date.now());

    res.json({ success: true, ...statsData, cached: false, timestamp: new Date().toISOString() });
  } catch (error) {
    return serverError(res, error, 'getProfileStats');
  }
};

// ── POST /api/profil/deactivate ──
exports.deactivateAccount = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    const { password, reason } = req.body;
    const userId = req.user.id;

    if (!password) return badRequest(res, 'Mot de passe requis pour désactiver le compte');

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }

    const isMatch = await bcrypt.compare(password, user.motdepasse);
    if (!isMatch) {
      await client.query('ROLLBACK');
      return unauthorized(res, 'Mot de passe incorrect');
    }
    if (!user.actif) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Le compte est déjà désactivé');
    }

    await client.query(
      'UPDATE utilisateurs SET actif = false, date_desactivation = NOW() WHERE id = $1',
      [userId]
    );

    await journalController.logAction({
      utilisateurId: userId,
      nomUtilisateur: user.nomutilisateur,
      nomComplet: user.nomcomplet,
      role: user.role,
      agence: user.agence,
      coordination: user.coordination,
      action: 'Désactivation du compte',
      actionType: 'DEACTIVATE_ACCOUNT',
      tableName: 'Utilisateurs',
      recordId: userId.toString(),
      details: reason ? `Désactivation: ${reason.substring(0, 200)}` : 'Désactivation du compte',
      ip: req.ip,
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Compte désactivé avec succès',
      note: 'Contactez un administrateur pour le réactiver.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'deactivateAccount');
  } finally {
    client.release();
  }
};

// ── POST /api/profil/reactivate/:userId ──
exports.reactivateAccount = async (req, res) => {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    if (req.user.role !== 'Administrateur')
      return forbidden(res, 'Permission refusée - Action réservée aux administrateurs');

    const userId = parseInt(req.params.userId);
    if (isNaN(userId)) return badRequest(res, 'ID invalide');

    const userResult = await client.query('SELECT * FROM utilisateurs WHERE id = $1', [userId]);
    const user = userResult.rows[0];
    if (!user) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur non trouvé');
    }
    if (user.actif) {
      await client.query('ROLLBACK');
      return badRequest(res, 'Le compte est déjà actif');
    }

    await client.query(
      'UPDATE utilisateurs SET actif = true, date_reactivation = NOW() WHERE id = $1',
      [userId]
    );

    await journalController.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomutilisateur,
      nomComplet: req.user.nomcomplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: 'Réactivation de compte',
      actionType: 'REACTIVATE_ACCOUNT',
      tableName: 'Utilisateurs',
      recordId: userId.toString(),
      details: `Compte réactivé: ${user.nomutilisateur}`,
      ip: req.ip,
    });

    await client.query('COMMIT');
    res.json({
      success: true,
      message: 'Compte réactivé avec succès',
      user: { id: user.id, nomUtilisateur: user.nomutilisateur, actif: true },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'reactivateAccount');
  } finally {
    client.release();
  }
};

// ── GET /api/profil/export ──
exports.exportProfileData = async (req, res) => {
  try {
    const userId = req.user.id;
    const format = req.query.format === 'csv' ? 'csv' : 'json';

    const [profileResult, activitiesResult] = await Promise.all([
      db.query(
        `SELECT id, nomutilisateur, nomcomplet, email, agence, role, coordination, actif, TO_CHAR(datecreation,'YYYY-MM-DD HH24:MI:SS') as datecreation, TO_CHAR(derniereconnexion,'YYYY-MM-DD HH24:MI:SS') as derniereconnexion FROM utilisateurs WHERE id = $1`,
        [userId]
      ),
      db.query(
        `SELECT actiontype, action, TO_CHAR(dateaction,'YYYY-MM-DD HH24:MI:SS') as dateaction, tablename, detailsaction, importbatchid, annulee, coordination FROM journalactivite WHERE utilisateurid = $1 ORDER BY dateaction DESC`,
        [userId]
      ),
    ]);

    const filename = `profil-${req.user.nomutilisateur}-${new Date().toISOString().split('T')[0]}`;

    if (format === 'csv') {
      const csvHeaders = 'Type,Action,Date,Table,Détails,BatchID,Annulée\n';
      const csvData = activitiesResult.rows
        .map(
          (row) =>
            `"${row.actiontype || ''}","${(row.action || '').replace(/"/g, '""')}","${row.dateaction || ''}","${row.tablename || ''}","${(row.detailsaction || '').replace(/"/g, '""')}","${row.importbatchid || ''}","${row.annulee ? 'Oui' : 'Non'}"`
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
        profile: profileResult.rows[0],
        activities: activitiesResult.rows,
        exportDate: new Date().toISOString(),
        totalActivities: activitiesResult.rows.length,
      });
    }
  } catch (error) {
    return serverError(res, error, 'exportProfileData');
  }
};

// ── GET /api/profil/sessions ──
exports.getActiveSessions = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, created_at, last_activity, ip_address, user_agent FROM user_sessions WHERE user_id = $1 AND expires_at > NOW() ORDER BY last_activity DESC`,
      [req.user.id]
    );
    // ✅ Ne jamais retourner le token brut
    res.json({
      success: true,
      sessions: result.rows,
      total: result.rows.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'getActiveSessions');
  }
};

// ── POST /api/profil/logout-others ──
exports.logoutOtherSessions = async (req, res) => {
  try {
    await db.query('DELETE FROM user_sessions WHERE user_id = $1 AND id != $2', [
      req.user.id,
      req.sessionId,
    ]);
    res.json({
      success: true,
      message: 'Autres sessions déconnectées',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'logoutOtherSessions');
  }
};

// ── POST /api/profil/cache/clear ──
exports.clearUserCache = async (req, res) => {
  try {
    const cacheKey = `user_stats_${req.user.id}`;
    CONFIG.statsCache.delete(cacheKey);
    CONFIG.statsCacheTime.delete(cacheKey);
    res.json({
      success: true,
      message: 'Cache utilisateur nettoyé',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'clearUserCache');
  }
};

// ── GET /api/profil/diagnostic ──
exports.diagnostic = async (req, res) => {
  try {
    if (req.user.role !== 'Administrateur')
      return forbidden(res, 'Seuls les administrateurs peuvent accéder au diagnostic');

    const [result, coordinationStats] = await Promise.all([
      db.query(
        `SELECT COUNT(*) as total_utilisateurs, COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs, COUNT(CASE WHEN NOT actif THEN 1 END) as utilisateurs_inactifs, MIN(datecreation) as premier_utilisateur, MAX(datecreation) as dernier_utilisateur, COUNT(DISTINCT role) as roles_distincts, COUNT(DISTINCT agence) as agences_distinctes, COUNT(DISTINCT coordination) as coordinations_distinctes FROM utilisateurs`
      ),
      db.query(
        `SELECT coordination, COUNT(*) as total_utilisateurs, COUNT(CASE WHEN actif THEN 1 END) as utilisateurs_actifs FROM utilisateurs WHERE coordination IS NOT NULL GROUP BY coordination ORDER BY total_utilisateurs DESC`
      ),
    ]);

    const stats = result.rows[0];
    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'profil',
      statistiques: {
        total_utilisateurs: parseInt(stats.total_utilisateurs),
        utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
        utilisateurs_inactifs: parseInt(stats.utilisateurs_inactifs),
        taux_activation:
          stats.total_utilisateurs > 0
            ? Math.round((stats.utilisateurs_actifs / stats.total_utilisateurs) * 100)
            : 0,
        premier_utilisateur: stats.premier_utilisateur,
        dernier_utilisateur: stats.dernier_utilisateur,
        roles_distincts: parseInt(stats.roles_distincts),
        agences_distinctes: parseInt(stats.agences_distinctes),
        coordinations_distinctes: parseInt(stats.coordinations_distinctes),
      },
      coordination_stats: coordinationStats.rows,
    });
  } catch (error) {
    return serverError(res, error, 'diagnostic');
  }
};
