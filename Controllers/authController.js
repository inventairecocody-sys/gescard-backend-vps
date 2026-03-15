// ========== CONTROLLER AUTHENTIFICATION (SÉCURISÉ) ==========

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const journalService = require('../Services/journalService');

// ✅ Import du système de ban centralisé (évite le doublon avec securityMiddleware)
const { recordAuthFailure } = require('../middleware/securityMiddleware');

const CONFIG = {
  saltRounds: 12,
  jwtExpiration: '8h',
  minPasswordLength: 8,
  // Ces valeurs sont maintenant gérées par securityMiddleware
  // mais on garde maxLoginAttempts pour la logique applicative (message à l'utilisateur)
  maxLoginAttempts: 5,
  lockoutDuration: 15 * 60 * 1000,
  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

// Map locale uniquement pour afficher le temps restant à l'utilisateur
// Le vrai blocage est géré par securityMiddleware (évite doublon)
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

// Message d'erreur générique — ne distingue JAMAIS "email inconnu" vs "mauvais mdp"
const INVALID_CREDENTIALS_MSG = "Nom d'utilisateur ou mot de passe incorrect";

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
      // Compter quand même comme tentative (évite l'énumération via 400 vs 401)
      recordAuthFailure(clientIp);
      return res.status(400).json({
        success: false,
        message: "Nom d'utilisateur et mot de passe requis",
      });
    }

    // Longueur max pour éviter les attaques par payload
    if (NomUtilisateur.length > 100 || MotDePasse.length > 200) {
      recordAuthFailure(clientIp);
      return res.status(400).json({ success: false, message: INVALID_CREDENTIALS_MSG });
    }

    // ── 2. Vérification du lockout local (pour le message de temps restant) ──
    const now = Date.now();
    const attemptData = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };

    if (attemptData.lockUntil > now) {
      const waitTime = Math.ceil((attemptData.lockUntil - now) / 1000 / 60);
      return res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${waitTime} minute${waitTime > 1 ? 's' : ''}.`,
      });
    }

    // ── 3. Recherche de l'utilisateur ──
    const result = await db.query('SELECT * FROM utilisateurs WHERE nomutilisateur = $1', [
      NomUtilisateur.trim(),
    ]);

    const utilisateur = result.rows[0];

    // ── 4. Vérification mot de passe (même si utilisateur inexistant → timing constant) ──
    // On fait TOUJOURS bcrypt.compare pour éviter les timing attacks
    const fakeHash = '$2a$12$fakehashfakehashfakehashfakehashfakehashfakehashfakehashfa';
    const passwordToCheck = utilisateur ? utilisateur.motdepasse : fakeHash;
    const isMatch = await bcrypt.compare(MotDePasse, passwordToCheck);

    if (!utilisateur || !isMatch) {
      // Enregistrer l'échec dans les DEUX systèmes
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
      }
      loginAttempts.set(clientIp, attemptData);

      // Notifier le système de ban centralisé
      recordAuthFailure(clientIp);

      // ✅ Message identique que l'utilisateur existe ou non
      return res.status(401).json({ success: false, message: INVALID_CREDENTIALS_MSG });
    }

    // ── 5. Vérification du compte actif ──
    if (!utilisateur.actif) {
      // Ne pas révéler que le compte existe mais est désactivé via un message différent
      // On retourne quand même un message spécifique car c'est une UX nécessaire
      return res.status(401).json({
        success: false,
        message: 'Ce compte est désactivé. Contactez un administrateur.',
      });
    }

    // ── 6. Connexion réussie ──
    // Réinitialiser les tentatives
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

    // Journalisation (ne pas bloquer la réponse si ça échoue)
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
    console.error('❌ [LOGIN] Erreur:', error.message);
    return res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      // ✅ Jamais error.message en production
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// LOGOUT USER
// ============================================
const logoutUser = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Utilisateur non authentifié' });
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
      message: 'Déconnexion réussie',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur déconnexion:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, valid: false, message: 'Token invalide' });
    }

    const result = await db.query('SELECT id, actif FROM utilisateurs WHERE id = $1', [
      req.user.id,
    ]);
    if (result.rows.length === 0 || !result.rows[0].actif) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: 'Utilisateur inexistant ou désactivé',
      });
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
    console.error('❌ Erreur vérification token:', error.message);
    return res.status(500).json({ success: false, valid: false, message: 'Erreur serveur' });
  }
};

// ============================================
// REFRESH TOKEN
// ============================================
const refreshToken = async (req, res) => {
  try {
    if (!req.user?.id) {
      return res.status(401).json({ success: false, message: 'Utilisateur non authentifié' });
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
      token: newToken,
      message: 'Token rafraîchi avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur refresh token:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
  }
};

// ============================================
// FORGOT PASSWORD
// ============================================
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string' || email.length > 255) {
      return res.status(400).json({ success: false, message: 'Email requis' });
    }

    // ✅ Réponse identique que l'email existe ou non (évite l'énumération d'emails)
    const GENERIC_MSG = 'Si cet email existe, un lien de réinitialisation a été envoyé';

    const result = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE email = $1 AND actif = true',
      [email.trim().toLowerCase()]
    );

    if (result.rows.length === 0) {
      // ✅ Même réponse — pas de "cet email n'existe pas"
      return res.json({ success: true, message: GENERIC_MSG, timestamp: new Date().toISOString() });
    }

    const utilisateur = result.rows[0];
    const resetToken = jwt.sign({ id: utilisateur.id, purpose: 'reset' }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    // ✅ CORRIGÉ : Ne jamais logger le token en clair
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
      // ✅ Token en dev uniquement, et seulement si la feature email n'est pas implémentée
      ...(process.env.NODE_ENV === 'development' && { resetToken }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur forgot password:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
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
      return res.status(400).json({
        success: false,
        message: 'Token et nouveau mot de passe requis',
      });
    }

    if (newPassword.length < CONFIG.minPasswordLength) {
      return res.status(400).json({
        success: false,
        message: `Le mot de passe doit contenir au moins ${CONFIG.minPasswordLength} caractères`,
      });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch {
      return res.status(401).json({ success: false, message: 'Token invalide ou expiré' });
    }

    // ✅ Vérifier que le token a bien été émis pour un reset
    if (!decoded?.id || decoded.purpose !== 'reset') {
      return res.status(401).json({ success: false, message: 'Token invalide' });
    }

    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query('BEGIN');

    const userCheck = await client.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1 AND actif = true',
      [decoded.id]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Utilisateur introuvable' });
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
      message: 'Mot de passe réinitialisé avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('❌ Erreur reset password:', error.message);
    return res.status(500).json({ success: false, message: 'Erreur serveur' });
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
