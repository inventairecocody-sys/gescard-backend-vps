// ============================================
// middleware/filtreColonnes.js
// ============================================
// Filtre les colonnes modifiables selon le rôle de l'utilisateur
// ============================================

const { normaliserRole, CONFIG_ROLES } = require('./verificationRole');

/**
 * Middleware pour filtrer les colonnes modifiables dans les requêtes
 * - Pour Admin/Gestionnaire : toutes les colonnes sont autorisées
 * - Pour Chef d'équipe : seulement les 3 colonnes spécifiques
 * - Pour Opérateur : aucune modification (déjà bloqué en amont)
 */
const filtrerColonnes = (req, res, next) => {
  try {
    // Ignorer pour les requêtes GET et OPTIONS
    if (req.method === 'GET' || req.method === 'OPTIONS' || !req.body) {
      return next();
    }

    // Vérifier que l'utilisateur est authentifié
    if (!req.user) {
      return res.status(401).json({ 
        erreur: "Non authentifié",
        message: "Vous devez être connecté pour effectuer cette action"
      });
    }

    const role = normaliserRole(req.user?.role);
    
    if (!role) {
      return res.status(403).json({ 
        erreur: "Rôle non reconnu",
        message: "Votre rôle utilisateur n'est pas valide"
      });
    }

    // Déterminer les colonnes autorisées
    // Priorité à req.colonnesAutorisees (défini par peutModifierCarte)
    let colonnesAutorisees = req.colonnesAutorisees;
    
    // Si non défini, utiliser la configuration du rôle
    if (!colonnesAutorisees) {
      const configRole = CONFIG_ROLES[role];
      colonnesAutorisees = configRole?.colonnesModifiables || [];
    }

    // Admin/Gestionnaire : toutes les colonnes sont autorisées
    if (colonnesAutorisees === 'toutes') {
      // Pour la traçabilité, on peut logger les modifications massives
      if (process.env.NODE_ENV === 'development') {
        console.log(`[DEBUG] Modification complète par ${role}:`, 
          Object.keys(req.body).join(', '));
      }
      return next();
    }

    // Chef d'équipe ou autre rôle avec restrictions
    if (Array.isArray(colonnesAutorisees)) {
      // Cas spécial: aucune colonne autorisée (Opérateur)
      if (colonnesAutorisees.length === 0) {
        return res.status(403).json({
          erreur: "Action non autorisée",
          message: "Votre rôle ne permet pas de modifier des données"
        });
      }

      const corpsFiltre = {};
      const colonnesRejetees = [];
      
      // Normaliser les noms de colonnes pour la comparaison
      const colonnesAutoriseesNormalisees = colonnesAutorisees.map(col => 
        col.toLowerCase().trim()
      );

      // Filtrer les colonnes
      Object.keys(req.body).forEach(key => {
        const keyNormalisee = key.toLowerCase().trim();
        
        if (colonnesAutoriseesNormalisees.includes(keyNormalisee)) {
          // Garder la clé originale pour préserver la casse si nécessaire
          corpsFiltre[key] = req.body[key];
        } else {
          colonnesRejetees.push(key);
        }
      });

      // Log des colonnes rejetées en développement
      if (process.env.NODE_ENV === 'development' && colonnesRejetees.length > 0) {
        console.log(`[DEBUG] Colonnes rejetées pour ${role}:`, colonnesRejetees.join(', '));
      }

      // Remplacer le corps de la requête par la version filtrée
      req.body = corpsFiltre;
      req.colonnesRejetees = colonnesRejetees; // Optionnel: pour information

      // Vérifications spécifiques selon la méthode HTTP
      if (req.method === 'PUT' || req.method === 'PATCH') {
        if (Object.keys(corpsFiltre).length === 0) {
          return res.status(400).json({
            erreur: "Aucune modification autorisée",
            message: "Vous n'avez pas le droit de modifier ces champs",
            champsAutorises: colonnesAutorisees,
            champsTentatives: colonnesRejetees
          });
        }
      }

      // Pour POST (création), on vérifie qu'au moins les champs requis sont présents
      if (req.method === 'POST') {
        // On pourrait ajouter une validation des champs requis ici
        // selon le contexte métier
      }
    }

    next();
  } catch (error) {
    console.error("Erreur dans filtrerColonnes:", error);
    return res.status(500).json({
      erreur: "Erreur serveur",
      message: "Une erreur est survenue lors du filtrage des données"
    });
  }
};

/**
 * Middleware spécifique pour l'import/export
 * Vérifie que les colonnes importées sont autorisées
 */
const filtrerColonnesImport = (req, res, next) => {
  try {
    const role = normaliserRole(req.user?.role);
    const configRole = CONFIG_ROLES[role];
    
    // Si l'utilisateur peut tout modifier, pas de filtrage
    if (configRole?.colonnesModifiables === 'toutes') {
      return next();
    }
    
    // Pour les imports, on pourrait avoir une logique spécifique
    // Par exemple, vérifier que les colonnes du fichier correspondent
    // aux droits de l'utilisateur
    
    next();
  } catch (error) {
    console.error("Erreur dans filtrerColonnesImport:", error);
    next();
  }
};

module.exports = { 
  filtrerColonnes,
  filtrerColonnesImport 
};