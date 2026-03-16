// ========== CONTROLLER AUTHENTIFICATION (SÉCURISÉ) ==========

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const journalService = require('../Services/journalService');
const {
  serverError,
  badRequest,
  unauthorized,
  notFound,
  tooManyRequests,
} = require('../utils/errorResponse');

// ✅ Import du système de ban centralisé (évite le doublon avec securityMiddleware)
const { recordAuthFailure } = require('../middleware/securityMiddleware');

const CONFIG = {
  saltRounds: 12,
  jwtExpiration: '8h',
  minPasswordLength: 8,
  maxLoginAttempts: 5,
  lockoutDuration: 15 * 60 * 1000,
  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

// Map locale uniquement pour afficher le temps restant à l'utilisateur
const loginAttempts = new Map();

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts.entries()) {
      if (data.lockUntil < now) loginAttempts.delete(ip);
    }
  },
  30 * 60 * 1000
);

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

// Message générique — ne distingue JAMAIS "utilisateur inconnu" vs "mauvais mdp"
const INVALID_CREDENTIALS_MSG = 'Identifiant ou mot de passe incorrect. Veuillez réessayer.';

// ============================================
// LOGIN USER
// ============================================
const loginUser = async (req, res) => {
  const { NomUtilisateur, MotDePasse } = req.body;
  const clientIp = getClientIP(req);
  const startTime = Date.now();

  try {
    // ── 1. Validation des champs ──
    if (
      !NomUtilisateur ||
      !MotDePasse ||
      typeof NomUtilisateur !== 'string' ||
      typeof MotDePasse !== 'string'
    ) {
      recordAuthFailure(clientIp);
      return badRequest(res, "Nom d'utilisateur et mot de passe requis.", 'MISSING_CREDENTIALS');
    }

    // Longueur max pour éviter les attaques par payload
    if (NomUtilisateur.length > 100 || MotDePasse.length > 200) {
      recordAuthFailure(clientIp);
      return badRequest(res, INVALID_CREDENTIALS_MSG, 'INVALID_CREDENTIALS');
    }

    // ── 2. Vérification du lockout local (pour le message de temps restant) ──
    const now = Date.now();
    const attemptData = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };

    if (attemptData.lockUntil > now) {
      const waitTime = Math.ceil((attemptData.lockUntil - now) / 1000 / 60);
      return tooManyRequests(
        res,
        `Trop de tentatives. Réessayez dans ${waitTime} minute${waitTime > 1 ? 's' : ''}.`,
        'ACCOUNT_LOCKED'
      );
    }

    // ── 3. Recherche de l'utilisateur ──
    const result = await db.query('SELECT * FROM utilisateurs WHERE nomutilisateur = $1', [
      NomUtilisateur.trim(),
    ]);

    const utilisateur = result.rows[0];

    // ── 4. Vérification mot de passe (timing constant même si utilisateur inexistant) ──
    const fakeHash = '$2a$12$fakehashfakehashfakehashfakehashfakehashfakehashfakehashfa';
    const passwordToCheck = utilisateur ? utilisateur.motdepasse : fakeHash;
    const isMatch = await bcrypt.compare(MotDePasse, passwordToCheck);

    if (!utilisateur || !isMatch) {
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
      }
      loginAttempts.set(clientIp, attemptData);
      recordAuthFailure(clientIp);

      return res.status(401).json({
        success: false,
        code: 'INVALID_CREDENTIALS',
        message: INVALID_CREDENTIALS_MSG,
      });
    }

    // ── 5. Vérification du compte actif ──
    if (!utilisateur.actif) {
      return res.status(401).json({
        success: false,
        code: 'ACCOUNT_DISABLED',
        message: 'Votre compte est désactivé. Contactez un administrateur.',
      });
    }

    // ── 6. Connexion réussie — réinitialiser les tentatives ──
    loginAttempts.delete(clientIp);

    await db.query('UPDATE utilisateurs SET derniereconnexion = NOW() WHERE id = $1', [
      utilisateur.id,
    ]);

    const token = jwt.sign(
      {
        id: utilisateur.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        role: utilisateur.role,
        agence: utilisateur.agence,
        coordination: utilisateur.coordination,
        coordination_id: utilisateur.coordination_id || null,
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    // Journalisation (ne bloque pas la réponse si ça échoue)
    journalService
      .logAction({
        utilisateurId: utilisateur.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        role: utilisateur.role,
        agence: utilisateur.agence,
        coordination: utilisateur.coordination,
        action: 'Connexion au système',
        actionType: 'LOGIN',
        tableName: 'utilisateurs',
        recordId: utilisateur.id.toString(),
        ip: clientIp,
        details: `Connexion réussie depuis ${clientIp}`,
      })
      .catch((err) => console.error('⚠️ Journalisation login échouée:', err.message));

    // Site principal
    let sitePrincipal = null;
    try {
      const siteResult = await db.query(
        `SELECT s.id as site_id, s.api_key
         FROM utilisateur_sites us
         JOIN sites s ON us.site_id = s.id
         WHERE us.utilisateur_id = $1 AND us.est_site_principal = true
         LIMIT 1`,
        [utilisateur.id]
      );
      sitePrincipal = siteResult.rows[0] || null;
    } catch (e) {
      // Table optionnelle
    }

    return res.json({
      success: true,
      code: 'LOGIN_SUCCESS',
      message: 'Connexion réussie',
      token,
      utilisateur: {
        id: utilisateur.id,
        nomComplet: utilisateur.nomcomplet,
        nomUtilisateur: utilisateur.nomutilisateur,
        email: utilisateur.email,
        agence: utilisateur.agence,
        role: utilisateur.role,
        coordination: utilisateur.coordination,
        coordination_id: utilisateur.coordination_id,
        site_id: sitePrincipal?.site_id || null,
        site_api_key: sitePrincipal?.api_key || null,
      },
      performance: { durationMs: Date.now() - startTime },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'LOGIN');
  }
};

// ============================================
// LOGOUT USER
// ============================================
const logoutUser = async (req, res) => {
  try {
    if (!req.user?.id) {
      return unauthorized(res, 'Utilisateur non authentifié.', 'NOT_AUTHENTICATED');
    }

    journalService
      .logAction({
        utilisateurId: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination,
        action: 'Déconnexion du système',
        actionType: 'LOGOUT',
        tableName: 'utilisateurs',
        recordId: req.user.id.toString(),
        ip: req.ip,
        details: 'Déconnexion du système',
      })
      .catch(() => {});

    return res.json({
      success: true,
      code: 'LOGOUT_SUCCESS',
      message: 'Vous avez été déconnecté avec succès.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'LOGOUT');
  }
};

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res) => {
  try {
    if (!req.user) {
      return unauthorized(res, 'Token invalide ou expiré.', 'INVALID_TOKEN');
    }

    const result = await db.query('SELECT id, actif FROM utilisateurs WHERE id = $1', [
      req.user.id,
    ]);

    if (result.rows.length === 0 || !result.rows[0].actif) {
      return unauthorized(res, 'Ce compte est inexistant ou désactivé.', 'ACCOUNT_INACTIVE');
    }

    return res.json({
      success: true,
      valid: true,
      user: {
        id: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination,
        coordination_id: req.user.coordination_id,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'VERIFY_TOKEN');
  }
};

// ============================================
// REFRESH TOKEN
// ============================================
const refreshToken = async (req, res) => {
  try {
    if (!req.user?.id) {
      return unauthorized(res, 'Utilisateur non authentifié.', 'NOT_AUTHENTICATED');
    }

    const newToken = jwt.sign(
      {
        id: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination,
        coordination_id: req.user.coordination_id,
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    return res.json({
      success: true,
      code: 'TOKEN_REFRESHED',
      token: newToken,
      message: 'Session prolongée avec succès.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'REFRESH_TOKEN');
  }
};

// ============================================
// FORGOT PASSWORD
// ============================================
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || email.length > 255) {
      return badRequest(res, 'Veuillez fournir une adresse email valide.', 'INVALID_EMAIL');
    }

    // Réponse identique que l'email existe ou non (évite l'énumération d'emails)
    const GENERIC_MSG =
      'Si cet email est associé à un compte, un lien de réinitialisation a été envoyé.';

    const result = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE email = $1 AND actif = true',
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.json({ success: true, message: GENERIC_MSG, timestamp: new Date().toISOString() });
    }

    const utilisateur = result.rows[0];
    const resetToken = jwt.sign({ id: utilisateur.id, purpose: 'reset' }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    console.log(`📧 [FORGOT] Demande de réinitialisation pour: ${utilisateur.nomutilisateur}`);
    // TODO: Envoyer l'email avec le lien (ne pas logger le token)
    // await emailService.sendResetLink(email, resetToken);

    journalService
      .logAction({
        utilisateurId: utilisateur.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        action: 'Demande de réinitialisation de mot de passe',
        actionType: 'FORGOT_PASSWORD',
        tableName: 'utilisateurs',
        recordId: utilisateur.id.toString(),
        ip: req.ip,
        details: `Demande depuis ${req.ip}`,
      })
      .catch(() => {});

    return res.json({
      success: true,
      message: GENERIC_MSG,
      // Token visible en dev uniquement (avant implémentation email)
      ...(process.env.NODE_ENV === 'development' && { resetToken }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    return serverError(res, error, 'FORGOT_PASSWORD');
  }
};

// ============================================
// RESET PASSWORD
// ============================================
const resetPassword = async (req, res) => {
  const client = await db.getClient();

  try {
    const { token, newPassword } = req.body;

    if (!token || !newPassword || typeof token !== 'string' || typeof newPassword !== 'string') {
      return badRequest(res, 'Token et nouveau mot de passe requis.', 'MISSING_FIELDS');
    }

    if (newPassword.length < CONFIG.minPasswordLength) {
      return badRequest(
        res,
        `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères.`,
        'PASSWORD_TOO_SHORT'
      );
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return unauthorized(
        res,
        'Ce lien est invalide ou a expiré. Faites une nouvelle demande.',
        'TOKEN_EXPIRED'
      );
    }

    if (!decoded?.id || decoded.purpose !== 'reset') {
      return unauthorized(res, 'Token de réinitialisation invalide.', 'INVALID_RESET_TOKEN');
    }

    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query('BEGIN');

    const userCheck = await client.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1 AND actif = true',
      [decoded.id]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return notFound(res, 'Utilisateur introuvable.', 'USER_NOT_FOUND');
    }

    const utilisateur = userCheck.rows[0];

    await client.query('UPDATE utilisateurs SET motdepasse = $1 WHERE id = $2', [
      hashedPassword,
      decoded.id,
    ]);

    await client.query('COMMIT');

    journalService
      .logAction({
        utilisateurId: decoded.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        action: 'Réinitialisation de mot de passe',
        actionType: 'RESET_PASSWORD',
        tableName: 'utilisateurs',
        recordId: decoded.id.toString(),
        ip: req.ip,
        details: 'Réinitialisation réussie',
      })
      .catch(() => {});

    return res.json({
      success: true,
      code: 'PASSWORD_RESET_SUCCESS',
      message: 'Mot de passe mis à jour avec succès. Vous pouvez maintenant vous connecter.',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return serverError(res, error, 'RESET_PASSWORD');
  } finally {
    client.release();
  }
};

module.exports = {
  loginUser,
  logoutUser,
  verifyToken,
  refreshToken,
  forgotPassword,
  resetPassword,
};
