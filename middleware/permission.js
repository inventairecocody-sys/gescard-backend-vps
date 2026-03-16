// ============================================
// middleware/permission.js
// ============================================
// Permissions spéciales pour les fonctionnalités avancées
// - Gestion des statistiques avec filtrage par coordination
// - Masquage des informations sensibles selon le rôle
// ============================================

const { normaliserRole, CONFIG_ROLES } = require('./verificationRole');
const { serverError, unauthorized, forbidden } = require('../utils/errorResponse');

const isDev = process.env.NODE_ENV === 'development';

// ============================================
// STATISTIQUES
// ============================================

/**
 * Vérifie l'accès aux statistiques et ajoute req.filtreStats
 * - mode 'tout'         → Administrateur
 * - mode 'coordination' → Gestionnaire
 * - false               → accès refusé
 */
const peutVoirStatistiques = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);

    if (!role) {
      return unauthorized(
        res,
        'Veuillez vous connecter pour accéder aux statistiques.',
        'UNAUTHENTICATED'
      );
    }

    const configRole = CONFIG_ROLES[role];

    if (!configRole) {
      return forbidden(res, "Votre rôle n'est pas reconnu dans le système.", 'UNKNOWN_ROLE');
    }

    const modeVue = configRole.peutVoirStatistiques;

    if (!modeVue) {
      return forbidden(res, "Vous n'avez pas accès aux statistiques.", 'STATS_ACCESS_DENIED');
    }

    req.filtreStats = {
      mode: modeVue,
      coordination: req.user?.coordination || null,
    };

    if (isDev) {
      console.log(`📊 [PERMISSION] Statistiques — Rôle: ${role}, Mode: ${modeVue}`);
    }

    next();
  } catch (error) {
    return serverError(res, error, 'PERMISSION_STATS');
  }
};

// ============================================
// INFOS SENSIBLES
// ============================================

/**
 * Configure req.optionsMasquage selon le rôle de l'utilisateur.
 * Ne bloque jamais la requête — masque les données à la source.
 */
const peutVoirInfosSensibles = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);

    // Utilisateur non connecté : tout masquer par défaut
    if (!role) {
      req.optionsMasquage = {
        ip: true,
        anciennesValeurs: true,
        nouvellesValeurs: true,
        informationsPersonnelles: true,
        detailsConnexion: true,
      };
      return next();
    }

    switch (role) {
      case 'Administrateur':
        req.optionsMasquage = {
          ip: false,
          anciennesValeurs: false,
          nouvellesValeurs: false,
          informationsPersonnelles: false,
          detailsConnexion: false,
        };
        break;

      case 'Gestionnaire':
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: false,
          nouvellesValeurs: false,
          informationsPersonnelles: false,
          detailsConnexion: true,
        };
        break;

      case "Chef d'équipe":
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: true,
          nouvellesValeurs: true,
          informationsPersonnelles: true,
          detailsConnexion: true,
        };
        break;

      case 'Opérateur':
      default:
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: true,
          nouvellesValeurs: true,
          informationsPersonnelles: true,
          detailsConnexion: true,
        };
    }

    req.optionsMasquage.role = role;

    if (isDev) {
      console.log(`🔒 [PERMISSION] Masquage configuré pour ${role}:`, req.optionsMasquage);
    }

    next();
  } catch (error) {
    // En cas d'erreur, masquer tout par sécurité et continuer
    console.error('❌ [PERMISSION] Erreur peutVoirInfosSensibles:', error);
    req.optionsMasquage = {
      ip: true,
      anciennesValeurs: true,
      nouvellesValeurs: true,
      informationsPersonnelles: true,
      detailsConnexion: true,
      toutes: true,
    };
    next();
  }
};

// ============================================
// FILTRE DONNÉES SENSIBLES
// ============================================

/**
 * Filtre les données sensibles dans une réponse selon les options de masquage.
 * À appeler dans les controllers après récupération des données.
 */
const filtrerDonneesSensibles = (donnees, optionsMasquage) => {
  if (!donnees || !optionsMasquage) return donnees;

  if (Array.isArray(donnees)) {
    return donnees.map((item) => filtrerDonneesSensibles(item, optionsMasquage));
  }

  if (typeof donnees === 'object') {
    const donneesFiltrees = { ...donnees };

    if (optionsMasquage.ip) {
      ['ip', 'ipUtilisateur', 'iputilisateur'].forEach((champ) => {
        if (donneesFiltrees[champ]) donneesFiltrees[champ] = '***.***.***.**';
      });
    }

    if (optionsMasquage.anciennesValeurs) {
      ['anciennes_valeurs', 'oldvalue', 'oldValue'].forEach((champ) => {
        if (donneesFiltrees[champ]) donneesFiltrees[champ] = '[Accès restreint]';
      });
    }

    if (optionsMasquage.nouvellesValeurs) {
      ['nouvelles_valeurs', 'newvalue', 'newValue'].forEach((champ) => {
        if (donneesFiltrees[champ]) donneesFiltrees[champ] = '[Accès restreint]';
      });
    }

    if (optionsMasquage.informationsPersonnelles) {
      [
        'email',
        'Email',
        'telephone',
        'contact',
        'CONTACT',
        'adresse',
        'dateNaissance',
        'DATE_DE_NAISSANCE',
        'nom',
        'prenom',
      ].forEach((champ) => {
        if (donneesFiltrees[champ]) donneesFiltrees[champ] = '[Accès restreint]';
      });
    }

    return donneesFiltrees;
  }

  return donnees;
};

// ============================================
// VÉRIFICATION DE RÔLE
// ============================================

/**
 * Vérifie que l'utilisateur possède un des rôles autorisés.
 */
const aRole = (rolesAutorises) => {
  return (req, res, next) => {
    const role = normaliserRole(req.user?.role);

    if (!role) {
      return unauthorized(
        res,
        'Veuillez vous connecter pour accéder à cette ressource.',
        'UNAUTHENTICATED'
      );
    }

    const rolesList = Array.isArray(rolesAutorises) ? rolesAutorises : [rolesAutorises];
    const rolesNormalises = rolesList.map((r) => normaliserRole(r));

    if (rolesNormalises.includes(role)) {
      return next();
    }

    return forbidden(
      res,
      "Vous n'avez pas les droits nécessaires pour effectuer cette action.",
      'FORBIDDEN_ROLE',
      // Détails visibles uniquement en développement
      isDev ? { rolesRequis: rolesList, votreRole: role } : undefined
    );
  };
};

// ============================================
// VÉRIFICATION DE COORDINATION
// ============================================

/**
 * Vérifie que l'utilisateur accède uniquement aux données de sa coordination.
 * Les Administrateurs ont accès à toutes les coordinations.
 */
const estDansCoordination = (paramCoordination) => {
  return (req, res, next) => {
    const coordinationUtilisateur = req.user?.coordination;
    const coordinationCible = req.params[paramCoordination] || req.body.coordination;

    if (!coordinationUtilisateur) {
      return forbidden(res, "Vous n'êtes associé à aucune coordination.", 'NO_COORDINATION');
    }

    // Administrateur : accès total
    if (normaliserRole(req.user?.role) === 'Administrateur') {
      return next();
    }

    if (coordinationUtilisateur === coordinationCible) {
      return next();
    }

    return forbidden(
      res,
      "Vous ne pouvez accéder qu'aux données de votre coordination.",
      'WRONG_COORDINATION',
      isDev
        ? { votreCoordination: coordinationUtilisateur, coordinationRequise: coordinationCible }
        : undefined
    );
  };
};

module.exports = {
  peutVoirStatistiques,
  peutVoirInfosSensibles,
  filtrerDonneesSensibles,
  aRole,
  estDansCoordination,
};
