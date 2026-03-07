// ============================================
// CONTROLLER AUTHENTIFICATION
// ============================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../db/db');
const journalService = require('../Services/journalService'); // ✅ Service indépendant

const CONFIG = {
  saltRounds: 12,
  jwtExpiration: '8h',
  minPasswordLength: 8,
  maxLoginAttempts: 5,
  lockoutDuration: 15 * 60 * 1000, // 15 minutes en millisecondes
  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

// Map pour stocker les tentatives de connexion par IP
const loginAttempts = new Map();

/**
 * Nettoie périodiquement les anciennes entrées de loginAttempts
 * (toutes les 30 minutes)
 */
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, data] of loginAttempts.entries()) {
      if (data.lockUntil < now && data.attempts === 0) {
        loginAttempts.delete(ip);
      }
    }
  },
  30 * 60 * 1000
);

// ============================================
// LOGIN USER
// ============================================
const loginUser = async (req, res) => {
  const { NomUtilisateur, MotDePasse } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  const startTime = Date.now();

  try {
    console.log('🔍 [LOGIN] Tentative de connexion:', NomUtilisateur);

    // ============================================
    // 1. VÉRIFICATION DES TENTATIVES
    // ============================================
    const now = Date.now();
    const attemptData = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };

    if (attemptData.lockUntil > now) {
      const waitTime = Math.ceil((attemptData.lockUntil - now) / 1000 / 60);
      return res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${waitTime} minute${waitTime > 1 ? 's' : ''}.`,
      });
    }

    // ============================================
    // 2. VALIDATION DES CHAMPS
    // ============================================
    if (!NomUtilisateur || !MotDePasse) {
      return res.status(400).json({
        success: false,
        message: "Nom d'utilisateur et mot de passe requis",
      });
    }

    // ============================================
    // 3. RECHERCHE DE L'UTILISATEUR
    // ============================================
    const result = await db.query('SELECT * FROM utilisateurs WHERE nomutilisateur = $1', [
      NomUtilisateur,
    ]);

    const utilisateur = result.rows[0];

    if (!utilisateur) {
      // Mauvais nom d'utilisateur
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
      }
      loginAttempts.set(clientIp, attemptData);

      return res.status(401).json({
        success: false,
        message: "Nom d'utilisateur ou mot de passe incorrect",
      });
    }

    // ============================================
    // 4. VÉRIFICATION DU COMPTE ACTIF
    // ============================================
    if (!utilisateur.actif) {
      return res.status(401).json({
        success: false,
        message: 'Ce compte est désactivé. Contactez un administrateur.',
      });
    }

    // ============================================
    // 5. VÉRIFICATION DU MOT DE PASSE
    // ============================================
    const isMatch = await bcrypt.compare(MotDePasse, utilisateur.motdepasse);

    if (!isMatch) {
      // Mauvais mot de passe
      attemptData.attempts++;
      if (attemptData.attempts >= CONFIG.maxLoginAttempts) {
        attemptData.lockUntil = now + CONFIG.lockoutDuration;
      }
      loginAttempts.set(clientIp, attemptData);

      return res.status(401).json({
        success: false,
        message: "Nom d'utilisateur ou mot de passe incorrect",
      });
    }

    // ============================================
    // 6. CONNEXION RÉUSSIE
    // ============================================
    // Réinitialiser les tentatives
    loginAttempts.delete(clientIp);

    // Mettre à jour la dernière connexion
    await db.query('UPDATE utilisateurs SET derniereconnexion = NOW() WHERE id = $1', [
      utilisateur.id,
    ]);

    // Générer le token JWT
    const token = jwt.sign(
      {
        id: utilisateur.id,
        nomUtilisateur: utilisateur.nomutilisateur,
        nomComplet: utilisateur.nomcomplet,
        role: utilisateur.role,
        agence: utilisateur.agence,
        coordination: utilisateur.coordination,
        coordination_id: utilisateur.coordination_id || null, // Si vous avez cette colonne
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    console.log('✅ [LOGIN] Connexion réussie pour:', utilisateur.nomutilisateur);

    // Journalisation de la connexion
    await journalService.logAction({
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
    });

    // Récupérer le site principal de l'utilisateur (pour auto-config Python)
    const siteResult = await db.query(
      `SELECT s.id as site_id, s.api_key
       FROM utilisateur_sites us
       JOIN sites s ON us.site_id = s.id
       WHERE us.utilisateur_id = $1 AND us.est_site_principal = true
       LIMIT 1`,
      [utilisateur.id]
    );
    const sitePrincipal = siteResult.rows[0] || null;

    const duration = Date.now() - startTime;

    res.json({
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
      performance: { durationMs: duration },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [LOGIN] Erreur de connexion :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// LOGOUT USER
// ============================================
const logoutUser = async (req, res) => {
  try {
    // Vérifier que req.user existe
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié',
      });
    }

    // Journaliser la déconnexion
    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur || req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet || req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: 'Déconnexion du système',
      actionType: 'LOGOUT',
      tableName: 'utilisateurs',
      recordId: req.user.id.toString(),
      ip: req.ip,
      details: 'Déconnexion du système',
    });

    res.json({
      success: true,
      message: 'Déconnexion réussie',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur déconnexion:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res) => {
  try {
    // Vérifier que req.user existe
    if (!req.user) {
      return res.status(401).json({
        success: false,
        valid: false,
        message: 'Token invalide',
      });
    }

    // Optionnel : vérifier que l'utilisateur existe toujours en base
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

    res.json({
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
    console.error('❌ Erreur vérification token:', error);
    res.status(500).json({
      success: false,
      valid: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// REFRESH TOKEN
// ============================================
const refreshToken = async (req, res) => {
  try {
    // Vérifier que req.user existe
    if (!req.user || !req.user.id) {
      return res.status(401).json({
        success: false,
        message: 'Utilisateur non authentifié',
      });
    }

    // Générer un nouveau token
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

    res.json({
      success: true,
      token: newToken,
      message: 'Token rafraîchi avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur rafraîchissement token:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// FORGOT PASSWORD
// ============================================
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: 'Email requis',
      });
    }

    // Rechercher l'utilisateur par email
    const result = await db.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      // Pour des raisons de sécurité, on ne révèle pas si l'email existe
      return res.json({
        success: true,
        message: 'Si cet email existe, un lien de réinitialisation a été envoyé',
        timestamp: new Date().toISOString(),
      });
    }

    const utilisateur = result.rows[0];

    // Générer un token de réinitialisation (valable 1h)
    const resetToken = jwt.sign({ id: utilisateur.id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    // TODO: Envoyer un email avec le lien de réinitialisation
    // Lien: https://gescardcocody.com/reset-password?token=${resetToken}

    console.log(
      `📧 [FORGOT] Lien de réinitialisation pour ${utilisateur.nomutilisateur}:`,
      resetToken
    );

    // Journaliser la demande
    await journalService.logAction({
      utilisateurId: utilisateur.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      action: 'Demande de réinitialisation de mot de passe',
      actionType: 'FORGOT_PASSWORD',
      tableName: 'utilisateurs',
      recordId: utilisateur.id.toString(),
      ip: req.ip,
      details: `Demande de réinitialisation depuis ${req.ip}`,
    });

    res.json({
      success: true,
      message: 'Si cet email existe, un lien de réinitialisation a été envoyé',
      // En développement, on peut renvoyer le token pour test
      ...(process.env.NODE_ENV === 'development' && { resetToken }),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur mot de passe oublié:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  }
};

// ============================================
// RESET PASSWORD
// ============================================
const resetPassword = async (req, res) => {
  const client = await db.getClient();

  try {
    const { token, newPassword } = req.body;

    // ============================================
    // 1. VALIDATION DES CHAMPS
    // ============================================
    if (!token || !newPassword) {
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

    // ============================================
    // 2. VÉRIFICATION DU TOKEN
    // ============================================
    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (error) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide ou expiré',
      });
    }

    if (!decoded || !decoded.id) {
      return res.status(401).json({
        success: false,
        message: 'Token invalide',
      });
    }

    // ============================================
    // 3. MISE À JOUR DU MOT DE PASSE
    // ============================================
    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query('BEGIN');

    // Vérifier que l'utilisateur existe toujours
    const userCheck = await client.query(
      'SELECT id, nomutilisateur, nomcomplet FROM utilisateurs WHERE id = $1',
      [decoded.id]
    );

    if (userCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({
        success: false,
        message: 'Utilisateur introuvable',
      });
    }

    const utilisateur = userCheck.rows[0];

    // Mettre à jour le mot de passe
    await client.query('UPDATE utilisateurs SET motdepasse = $1 WHERE id = $2', [
      hashedPassword,
      decoded.id,
    ]);

    await client.query('COMMIT');

    // Journaliser la réinitialisation
    await journalService.logAction({
      utilisateurId: decoded.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      action: 'Réinitialisation de mot de passe',
      actionType: 'RESET_PASSWORD',
      tableName: 'utilisateurs',
      recordId: decoded.id.toString(),
      ip: req.ip,
      details: 'Réinitialisation de mot de passe réussie',
    });

    res.json({
      success: true,
      message: 'Mot de passe réinitialisé avec succès',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Erreur réinitialisation:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined,
    });
  } finally {
    client.release();
  }
};

// ============================================
// EXPORT
// ============================================
module.exports = {
  loginUser,
  logoutUser,
  verifyToken,
  refreshToken,
  forgotPassword,
  resetPassword,
};
