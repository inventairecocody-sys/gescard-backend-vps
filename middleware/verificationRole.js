// ============================================
// middleware/verificationRole.js
// ============================================

// ============================================
// CONFIGURATION DES RÔLES
// ============================================
const CONFIG_ROLES = {
  Administrateur: {
    niveau: 100,
    pages: ['*'], // Toutes les pages
    peutImporterExporter: true,
    peutVoirStatistiques: 'tout',
    colonnesModifiables: 'toutes',
    peutAnnulerAction: true,
    peutVoirJournal: true,
    peutGererComptes: true,
    peutVoirInfosSensibles: true // Voir IP, anciennes valeurs, etc.
  },
  Gestionnaire: {
    niveau: 80,
    pages: ['accueil', 'inventaire', 'profil', 'deconnexion', 'import-export', 'statistiques'],
    peutImporterExporter: true,
    peutVoirStatistiques: 'coordination', // Seulement sa coordination
    colonnesModifiables: 'toutes',
    peutAnnulerAction: false,
    peutVoirJournal: false, // ❌ Gestionnaire ne voit pas le journal
    peutGererComptes: false, // ❌ Gestionnaire ne gère pas les comptes
    peutVoirInfosSensibles: false
  },
  "Chef d'équipe": {
    niveau: 60,
    pages: ['accueil', 'inventaire', 'profil', 'deconnexion'],
    peutImporterExporter: false,
    peutVoirStatistiques: false,
    colonnesModifiables: ['delivrance', 'CONTACT DE RETRAIT', 'DATE DE DELIVRANCE'],
    peutAnnulerAction: false,
    peutVoirJournal: false,
    peutGererComptes: false,
    peutVoirInfosSensibles: false
  },
  Opérateur: {
    niveau: 40,
    pages: ['accueil', 'inventaire', 'profil', 'deconnexion'],
    peutImporterExporter: false,
    peutVoirStatistiques: false,
    colonnesModifiables: [], // Aucune modification
    peutAnnulerAction: false,
    peutVoirJournal: false,
    peutGererComptes: false,
    peutVoirInfosSensibles: false
  }
};

// ============================================
// FONCTIONS DE NORMALISATION
// ============================================
const normaliserRole = (role) => {
  if (!role) return null;
  
  const correspondances = {
    'administrateur': 'Administrateur',
    'admin': 'Administrateur',
    'gestionnaire': 'Gestionnaire',
    'superviseur': 'Gestionnaire', // Ancien rôle mappé vers Gestionnaire
    'chef d\'équipe': "Chef d'équipe",
    'chef': "Chef d'équipe",
    'operateur': 'Opérateur',
    'opérateur': 'Opérateur'
  };
  
  const roleMin = role.toLowerCase().trim();
  return correspondances[roleMin] || role;
};

// ============================================
// MIDDLEWARES
// ============================================

/**
 * Vérifier l'accès à une page
 * @param {string} nomPage - Nom de la page demandée
 */
const peutAccederPage = (nomPage) => {
  return (req, res, next) => {
    const role = normaliserRole(req.user?.role);
    
    if (!role) {
      return res.status(401).json({ 
        erreur: "Non authentifié",
        message: "Utilisateur non authentifié ou rôle manquant"
      });
    }

    const configRole = CONFIG_ROLES[role];
    
    if (!configRole) {
      return res.status(403).json({
        erreur: "Rôle inconnu",
        votreRole: role
      });
    }

    if (configRole.pages.includes('*') || configRole.pages.includes(nomPage)) {
      return next();
    }

    return res.status(403).json({
      erreur: "Accès refusé",
      page: nomPage,
      votreRole: role,
      message: "Vous n'avez pas les droits pour accéder à cette page"
    });
  };
};

/**
 * Vérifier les droits d'import/export
 */
const peutImporterExporter = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];
  
  if (configRole?.peutImporterExporter) {
    return next();
  }

  return res.status(403).json({
    erreur: "Action non autorisée",
    message: "Seuls les administrateurs et gestionnaires peuvent importer/exporter"
  });
};

/**
 * Vérifier les droits de modification d'une carte
 * Middleware complexe qui vérifie:
 * 1. Si l'utilisateur a le droit de modifier des cartes
 * 2. Pour les chefs d'équipe, vérifie la coordination
 * 3. Ajoute req.colonnesAutorisees pour le filtrage ultérieur
 */
const peutModifierCarte = async (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);
    const carteId = req.params.id;
    const configRole = CONFIG_ROLES[role];

    if (!configRole) {
      return res.status(403).json({ erreur: "Rôle non reconnu" });
    }

    // Opérateur : non
    if (role === 'Opérateur') {
      return res.status(403).json({ 
        erreur: "Action non autorisée",
        message: "Les opérateurs ne peuvent pas modifier les cartes" 
      });
    }

    // Chef d'équipe : vérifications supplémentaires
    if (role === "Chef d'équipe") {
      // Vérifier que l'ID de carte est présent
      if (!carteId) {
        return res.status(400).json({ erreur: "ID de carte manquant" });
      }

      const db = require('../db/db');
      
      try {
        const carte = await db.requete(
          'SELECT coordination FROM cartes WHERE id = $1',
          [carteId]
        );

        if (carte.lignes.length === 0) {
          return res.status(404).json({ 
            erreur: "Carte non trouvée",
            message: "Aucune carte trouvée avec cet ID"
          });
        }

        // Vérifier la coordination
        if (carte.lignes[0].coordination === req.user.coordination) {
          // Ajouter les colonnes autorisées à la requête
          req.colonnesAutorisees = configRole.colonnesModifiables;
          return next();
        }

        return res.status(403).json({ 
          erreur: "Accès refusé",
          message: "Vous ne pouvez modifier que les cartes de votre coordination" 
        });
      } catch (dbError) {
        console.error("Erreur base de données dans peutModifierCarte:", dbError);
        return res.status(500).json({ 
          erreur: "Erreur serveur",
          message: "Impossible de vérifier les droits sur cette carte"
        });
      }
    }

    // Admin et Gestionnaire : tout permis
    req.colonnesAutorisees = configRole.colonnesModifiables;
    next();
  } catch (error) {
    console.error("Erreur dans peutModifierCarte:", error);
    return res.status(500).json({ 
      erreur: "Erreur serveur",
      message: "Une erreur est survenue lors de la vérification des droits"
    });
  }
};

/**
 * Vérifier les droits d'annulation (Admin uniquement)
 */
const peutAnnulerAction = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];
  
  if (configRole?.peutAnnulerAction) {
    return next();
  }

  return res.status(403).json({
    erreur: "Action non autorisée",
    message: "Seuls les administrateurs peuvent annuler des actions"
  });
};

/**
 * Vérifier l'accès au journal (Admin uniquement)
 */
const peutVoirJournal = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];
  
  if (configRole?.peutVoirJournal) {
    return next();
  }

  return res.status(403).json({
    erreur: "Accès refusé",
    message: "Seuls les administrateurs peuvent consulter le journal"
  });
};

/**
 * Vérifier l'accès à la gestion des comptes (Admin uniquement)
 */
const peutGererComptes = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];
  
  if (configRole?.peutGererComptes) {
    return next();
  }

  return res.status(403).json({
    erreur: "Accès refusé",
    message: "Seuls les administrateurs peuvent gérer les comptes utilisateurs"
  });
};

/**
 * Middleware pour ajouter les infos de rôle à req
 * Utile pour les contrôleurs qui ont besoin des permissions
 */
const ajouterInfosRole = (req, res, next) => {
  const role = normaliserRole(req.user?.role);
  const configRole = CONFIG_ROLES[role];
  
  if (configRole) {
    req.infosRole = {
      role: role,
      niveau: configRole.niveau,
      peutVoirStatistiques: configRole.peutVoirStatistiques,
      colonnesModifiables: configRole.colonnesModifiables,
      peutVoirInfosSensibles: configRole.peutVoirInfosSensibles
    };
  }
  
  next();
};

module.exports = {
  // Middlewares principaux
  peutAccederPage,
  peutImporterExporter,
  peutModifierCarte,
  peutAnnulerAction,
  peutVoirJournal,
  peutGererComptes,
  ajouterInfosRole,
  
  // Utilitaires
  normaliserRole,
  CONFIG_ROLES
};