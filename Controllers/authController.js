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
  lockoutDuration: 15 * 60 * 1000,

  validRoles: ['Administrateur', 'Gestionnaire', "Chef d'équipe", 'Opérateur'],
};

const loginAttempts = new Map();

// ============================================
// LOGIN USER
// ============================================
const loginUser = async (req, res) => {
  const { NomUtilisateur, MotDePasse } = req.body;
  const clientIp = req.ip || req.connection.remoteAddress;
  const startTime = Date.now();

  try {
    console.log('🔍 [LOGIN] Tentative de connexion:', NomUtilisateur);

    const now = Date.now();
    const attemptData = loginAttempts.get(clientIp) || { attempts: 0, lockUntil: 0 };

    if (attemptData.lockUntil > now) {
      const waitTime = Math.ceil((attemptData.lockUntil - now) / 1000 / 60);
      return res.status(429).json({
        success: false,
        message: `Trop de tentatives. Réessayez dans ${waitTime} minutes.`,
      });
    }

    if (!NomUtilisateur || !MotDePasse) {
      return res.status(400).json({
        success: false,
        message: "Nom d'utilisateur et mot de passe requis",
      });
    }

    const result = await db.query('SELECT * FROM utilisateurs WHERE nomutilisateur = $1', [
      NomUtilisateur,
    ]);

    const utilisateur = result.rows[0];

    if (!utilisateur) {
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

    if (!utilisateur.actif) {
      return res.status(401).json({
        success: false,
        message: 'Ce compte est désactivé. Contactez un administrateur.',
      });
    }

    const isMatch = await bcrypt.compare(MotDePasse, utilisateur.motdepasse);

    if (!isMatch) {
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
      },
      process.env.JWT_SECRET,
      { expiresIn: CONFIG.jwtExpiration }
    );

    console.log('✅ [LOGIN] Connexion réussie pour:', utilisateur.nomutilisateur);

    // ✅ Utilisation du service
    await journalService.logAction({
      utilisateurId: utilisateur.id,
      nomUtilisateur: utilisateur.nomutilisateur,
      nomComplet: utilisateur.nomcomplet,
      role: utilisateur.role,
      agence: utilisateur.agence,
      coordination: utilisateur.coordination,
      action: 'Connexion au système',
      actionType: 'LOGIN',
      tableName: 'Utilisateurs',
      recordId: utilisateur.id.toString(),
      ip: clientIp,
      details: `Connexion réussie depuis ${clientIp}`,
    });

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
      },
      performance: { duration },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ [LOGIN] Erreur de connexion :', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// LOGOUT USER
// ============================================
const logoutUser = async (req, res) => {
  try {
    await journalService.logAction({
      utilisateurId: req.user.id,
      nomUtilisateur: req.user.nomUtilisateur,
      nomComplet: req.user.nomComplet,
      role: req.user.role,
      agence: req.user.agence,
      coordination: req.user.coordination,
      action: 'Déconnexion du système',
      actionType: 'LOGOUT',
      tableName: 'Utilisateurs',
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
      error: error.message,
    });
  }
};

// ============================================
// VERIFY TOKEN
// ============================================
const verifyToken = async (req, res) => {
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
        coordination: req.user.coordination,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur vérification token:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
    });
  }
};

// ============================================
// REFRESH TOKEN
// ============================================
const refreshToken = async (req, res) => {
  try {
    const newToken = jwt.sign(
      {
        id: req.user.id,
        nomUtilisateur: req.user.nomUtilisateur,
        nomComplet: req.user.nomComplet,
        role: req.user.role,
        agence: req.user.agence,
        coordination: req.user.coordination,
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
      error: error.message,
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

    const result = await db.query('SELECT id, nomutilisateur FROM utilisateurs WHERE email = $1', [
      email,
    ]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        message: 'Aucun compte associé à cet email',
      });
    }

    const resetToken = jwt.sign({ id: result.rows[0].id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.json({
      success: true,
      message: 'Instructions envoyées par email',
      resetToken,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur mot de passe oublié:', error);
    res.status(500).json({
      success: false,
      message: 'Erreur serveur',
      error: error.message,
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

    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const hashedPassword = await bcrypt.hash(newPassword, CONFIG.saltRounds);

    await client.query('BEGIN');

    await client.query('UPDATE utilisateurs SET motdepasse = $1 WHERE id = $2', [
      hashedPassword,
      decoded.id,
    ]);

    await client.query('COMMIT');

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
      error: error.message,
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
