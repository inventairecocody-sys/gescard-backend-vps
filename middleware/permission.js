// ============================================
// middleware/permission.js
// ============================================
// Permissions spéciales pour les fonctionnalités avancées
// - Gestion des statistiques avec filtrage par coordination
// - Masquage des informations sensibles selon le rôle
// ============================================

const { normaliserRole, CONFIG_ROLES } = require('./verificationRole');

/**
 * Middleware pour gérer l'accès aux statistiques
 * Ajoute req.filtreStats avec la valeur appropriée:
 * - 'tout' pour Admin
 * - 'coordination' pour Gestionnaire
 * - false pour les autres (refusé)
 */
const peutVoirStatistiques = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);
    
    if (!role) {
      return res.status(401).json({
        erreur: "Non authentifié",
        message: "Vous devez être connecté pour voir les statistiques"
      });
    }

    const configRole = CONFIG_ROLES[role];
    
    if (!configRole) {
      return res.status(403).json({
        erreur: "Rôle inconnu",
        message: "Votre rôle n'est pas reconnu dans le système"
      });
    }

    const modeVue = configRole.peutVoirStatistiques;

    // Vérifier si l'utilisateur a le droit de voir les stats
    if (!modeVue) {
      return res.status(403).json({
        erreur: "Accès refusé",
        message: "Vous n'avez pas les droits pour voir les statistiques",
        role: role
      });
    }

    // Ajouter le filtre à la requête
    req.filtreStats = {
      mode: modeVue, // 'tout' ou 'coordination'
      coordination: req.user?.coordination || null // Pour le filtrage
    };

    // Log en développement
    if (process.env.NODE_ENV === 'development') {
      console.log(`📊 Accès statistiques - Rôle: ${role}, Mode: ${modeVue}`);
    }

    next();
  } catch (error) {
    console.error("Erreur dans peutVoirStatistiques:", error);
    return res.status(500).json({
      erreur: "Erreur serveur",
      message: "Une erreur est survenue lors de la vérification des droits"
    });
  }
};

/**
 * Middleware pour gérer la visibilité des informations sensibles
 * Ajoute req.optionsMasquage avec la configuration appropriée
 * 
 * Informations sensibles gérées:
 * - Adresses IP
 * - Anciennes valeurs (dans le journal)
 * - Nouvelles valeurs (dans le journal)
 * - Informations personnelles
 */
const peutVoirInfosSensibles = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);
    
    if (!role) {
      // Utilisateur non connecté: tout masquer par défaut
      req.optionsMasquage = {
        ip: true,
        anciennesValeurs: true,
        nouvellesValeurs: true,
        informationsPersonnelles: true,
        detailsConnexion: true
      };
      return next();
    }

    // Configuration du masquage selon le rôle
    switch(role) {
      case 'Administrateur':
        // Admin voit tout
        req.optionsMasquage = {
          ip: false,           // Voit les IPs
          anciennesValeurs: false, // Voit les anciennes valeurs
          nouvellesValeurs: false, // Voit les nouvelles valeurs
          informationsPersonnelles: false, // Voit toutes les infos
          detailsConnexion: false // Voit les détails de connexion
        };
        break;

      case 'Gestionnaire':
        // Gestionnaire: voit presque tout sauf IP
        req.optionsMasquage = {
          ip: true,            // Masque les IPs
          anciennesValeurs: false, // Voit les anciennes valeurs
          nouvellesValeurs: false, // Voit les nouvelles valeurs
          informationsPersonnelles: false, // Voit les infos personnelles
          detailsConnexion: true // Masque les détails de connexion
        };
        break;

      case "Chef d'équipe":
        // Chef d'équipe: voit le minimum
        req.optionsMasquage = {
          ip: true,            // Masque les IPs
          anciennesValeurs: true, // Masque les anciennes valeurs
          nouvellesValeurs: true, // Masque les nouvelles valeurs
          informationsPersonnelles: true, // Masque les infos personnelles
          detailsConnexion: true // Masque les détails de connexion
        };
        break;

      case 'Opérateur':
        // Opérateur: tout masquer
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: true,
          nouvellesValeurs: true,
          informationsPersonnelles: true,
          detailsConnexion: true
        };
        break;

      default:
        // Par défaut: tout masquer
        req.optionsMasquage = {
          ip: true,
          anciennesValeurs: true,
          nouvellesValeurs: true,
          informationsPersonnelles: true,
          detailsConnexion: true
        };
    }

    // Ajouter le rôle pour référence
    req.optionsMasquage.role = role;

    next();
  } catch (error) {
    console.error("Erreur dans peutVoirInfosSensibles:", error);
    // En cas d'erreur, on masque tout par sécurité
    req.optionsMasquage = { ip: true, anciennesValeurs: true, toutes: true };
    next();
  }
};

/**
 * Middleware pour filtrer les données sensibles dans les réponses
 * À utiliser dans les contrôleurs après avoir récupéré les données
 */
const filtrerDonneesSensibles = (donnees, optionsMasquage) => {
  if (!donnees || !optionsMasquage) return donnees;

  // Si c'est un tableau, filtrer chaque élément
  if (Array.isArray(donnees)) {
    return donnees.map(item => filtrerDonneesSensibles(item, optionsMasquage));
  }

  // Si c'est un objet, créer une copie filtrée
  if (typeof donnees === 'object') {
    const donneesFiltrees = { ...donnees };

    // Masquer les IPs
    if (optionsMasquage.ip && donneesFiltrees.ip) {
      donneesFiltrees.ip = '***.***.***.***';
    }

    // Masquer les anciennes valeurs
    if (optionsMasquage.anciennesValeurs && donneesFiltrees.anciennes_valeurs) {
      donneesFiltrees.anciennes_valeurs = '[MASQUÉ]';
    }

    // Masquer les nouvelles valeurs
    if (optionsMasquage.nouvellesValeurs && donneesFiltrees.nouvelles_valeurs) {
      donneesFiltrees.nouvelles_valeurs = '[MASQUÉ]';
    }

    // Masquer les informations personnelles
    if (optionsMasquage.informationsPersonnelles) {
      const champsPersonnels = ['email', 'telephone', 'adresse', 'dateNaissance'];
      champsPersonnels.forEach(champ => {
        if (donneesFiltrees[champ]) {
          donneesFiltrees[champ] = '[MASQUÉ]';
        }
      });
    }

    return donneesFiltrees;
  }

  return donnees;
};

/**
 * Middleware utilitaire pour vérifier si l'utilisateur a un rôle spécifique
 */
const aRole = (rolesAutorises) => {
  return (req, res, next) => {
    const role = normaliserRole(req.user?.role);
    
    if (!role) {
      return res.status(401).json({ erreur: "Non authentifié" });
    }

    const rolesList = Array.isArray(rolesAutorises) ? rolesAutorises : [rolesAutorises];
    const rolesNormalises = rolesList.map(r => normaliserRole(r));

    if (rolesNormalises.includes(role)) {
      return next();
    }

    return res.status(403).json({
      erreur: "Accès refusé",
      message: "Vous n'avez pas le rôle requis pour cette action",
      rolesRequis: rolesList,
      votreRole: role
    });
  };
};

/**
 * Middleware pour vérifier si l'utilisateur est dans la bonne coordination
 */
const estDansCoordination = (paramCoordination) => {
  return (req, res, next) => {
    const coordinationUtilisateur = req.user?.coordination;
    const coordinationCible = req.params[paramCoordination] || req.body.coordination;

    if (!coordinationUtilisateur) {
      return res.status(403).json({
        erreur: "Accès refusé",
        message: "Vous n'êtes pas associé à une coordination"
      });
    }

    // Admin peut tout voir
    if (normaliserRole(req.user?.role) === 'Administrateur') {
      return next();
    }

    if (coordinationUtilisateur === coordinationCible) {
      return next();
    }

    return res.status(403).json({
      erreur: "Accès refusé",
      message: "Vous ne pouvez accéder qu'aux données de votre coordination"
    });
  };
};

module.exports = {
  peutVoirStatistiques,
  peutVoirInfosSensibles,
  filtrerDonneesSensibles,
  aRole,
  estDansCoordination
};