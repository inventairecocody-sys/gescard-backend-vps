// ============================================
// middleware/journalRequetes.js
// ============================================
// Journalisation détaillée de toutes les requêtes HTTP
// Ajouté en premier middleware dans server.js
// ============================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Configuration
const LOGS_DIR = path.join(__dirname, '../../logs');
const REQUETES_LOG_FILE = path.join(LOGS_DIR, 'requetes.log');
const ERREURS_LOG_FILE = path.join(LOGS_DIR, 'erreurs.log');

// Créer le dossier logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// Fonction pour générer un ID unique
const genererIdUnique = () => {
  return crypto.randomBytes(8).toString('hex');
};

// Fonction pour formater la date
const formaterDate = (date = new Date()) => {
  return date.toISOString();
};

// Fonction pour écrire dans un fichier de log
const ecrireLog = (fichier, message) => {
  const ligne = `[${formaterDate()}] ${message}\n`;
  fs.appendFile(fichier, ligne, (err) => {
    if (err) console.error('Erreur écriture log:', err);
  });
};

// Middleware principal
const journalRequetes = (req, res, next) => {
  const debut = Date.now();
  const idRequete = genererIdUnique();
  
  // Ajouter l'ID à la requête pour traçabilité
  req.idRequete = idRequete;
  
  // Ajouter l'ID dans les en-têtes de réponse
  res.setHeader('X-Request-ID', idRequete);
  
  // Capturer l'IP réelle (derrière proxy)
  const ipReelle = req.headers['x-forwarded-for'] || 
                   req.connection.remoteAddress || 
                   req.ip || 
                   '0.0.0.0';
  
  // Informations de base sur la requête
  const infosRequete = {
    id: idRequete,
    timestamp: formaterDate(),
    methode: req.method,
    url: req.originalUrl || req.url,
    ip: ipReelle,
    userAgent: req.headers['user-agent'] || 'inconnu',
    utilisateur: req.user ? {
      id: req.user.id,
      nom: req.user.nomUtilisateur,
      role: req.user.role,
      coordination: req.user.coordination
    } : 'non authentifié'
  };

  // Log entrant dans la console
  console.log(`\n📥 [${idRequete}] ${req.method} ${req.url}`);
  console.log(`   👤 Utilisateur: ${infosRequete.utilisateur.nom || 'anonyme'} (${infosRequete.utilisateur.role || 'aucun'})`);
  console.log(`   🌐 IP: ${ipReelle}`);
  
  // Log entrant dans le fichier
  ecrireLog(REQUETES_LOG_FILE, `IN  ${JSON.stringify(infosRequete)}`);

  // Capturer le corps de la requête pour les logs (sans mots de passe)
  if (req.body && Object.keys(req.body).length > 0) {
    const corpsLog = { ...req.body };
    if (corpsLog.motDePasse) corpsLog.motDePasse = '[MASQUÉ]';
    if (corpsLog.confirmationMotDePasse) corpsLog.confirmationMotDePasse = '[MASQUÉ]';
    
    console.log(`   📦 Corps:`, corpsLog);
    req.corpsLog = corpsLog; // Stocker pour la réponse
  }

  // Intercepter la méthode res.json pour logger la réponse
  const jsonOriginal = res.json;
  res.json = function(donnees) {
    const duree = Date.now() - debut;
    const statusCode = res.statusCode;
    
    // Déterminer le niveau de log
    const niveau = statusCode >= 500 ? '❌ ERREUR' : 
                   statusCode >= 400 ? '⚠️ ALERTE' : 
                   '✅ SUCCÈS';
    
    // Préparer les infos de réponse
    const infosReponse = {
      id: idRequete,
      duree: `${duree}ms`,
      statusCode,
      niveau: niveau.trim(),
      taille: JSON.stringify(donnees).length
    };

    // Log dans la console
    console.log(`${niveau} [${idRequete}] ${req.method} ${req.url}`);
    console.log(`   ⏱️  Temps: ${duree}ms | Code: ${statusCode}`);
    
    // Log détaillé pour les erreurs
    if (statusCode >= 400) {
      console.log(`   📋 Détails erreur:`, {
        message: donnees.erreur || donnees.message || 'Erreur inconnue',
        details: donnees
      });
      
      // Log d'erreur dans fichier séparé
      ecrireLog(ERREURS_LOG_FILE, JSON.stringify({
        requete: infosRequete,
        reponse: infosReponse,
        erreur: donnees,
        corpsRequete: req.corpsLog || null
      }));
    }

    // Log de la réponse dans le fichier principal
    ecrireLog(REQUETES_LOG_FILE, `OUT ${JSON.stringify({
      ...infosReponse,
      utilisateur: infosRequete.utilisateur
    })}`);

    // Restaurer et appeler la méthode originale
    return jsonOriginal.call(this, donnees);
  };

  // Gérer les erreurs de la requête
  res.on('finish', () => {
    // Si la réponse n'a pas utilisé res.json (ex: res.send, res.end)
    if (!res._jsonIntercepte) {
      const duree = Date.now() - debut;
      console.log(`⚪ [${idRequete}] ${req.method} ${req.url} - ${res.statusCode} - ${duree}ms`);
      
      ecrireLog(REQUETES_LOG_FILE, `OUT ${JSON.stringify({
        id: idRequete,
        duree: `${duree}ms`,
        statusCode: res.statusCode,
        utilisateur: infosRequete.utilisateur
      })}`);
    }
  });

  // Marquer que nous avons intercepté
  res._jsonIntercepte = true;
  
  next();
};

// Middleware pour logger les performances (à utiliser sur des routes spécifiques)
const loggerPerformance = (seuil = 1000) => {
  return (req, res, next) => {
    const debut = Date.now();
    
    res.on('finish', () => {
      const duree = Date.now() - debut;
      if (duree > seuil) {
        console.log(`🐢 Requête lente [${duree}ms] ${req.method} ${req.url}`);
        
        // Log des requêtes lentes dans un fichier spécifique
        ecrireLog(path.join(LOGS_DIR, 'performances-lentes.log'), 
          JSON.stringify({
            timestamp: formaterDate(),
            duree,
            methode: req.method,
            url: req.url,
            utilisateur: req.user?.nomUtilisateur || 'anonyme'
          })
        );
      }
    });
    
    next();
  };
};

// Middleware pour nettoyer les vieux logs (à exécuter périodiquement)
const nettoyerVieuxLogs = (jours = 30) => {
  try {
    const maintenant = Date.now();
    const limite = maintenant - (jours * 24 * 60 * 60 * 1000);
    
    [REQUETES_LOG_FILE, ERREURS_LOG_FILE].forEach(fichier => {
      if (fs.existsSync(fichier)) {
        const stats = fs.statSync(fichier);
        if (stats.mtimeMs < limite) {
          // Archiver ou supprimer
          const archive = `${fichier}.${formaterDate().split('T')[0]}.old`;
          fs.renameSync(fichier, archive);
          console.log(`📦 Log archivé: ${path.basename(archive)}`);
        }
      }
    });
  } catch (error) {
    console.error('Erreur nettoyage logs:', error);
  }
};

// Exécuter le nettoyage une fois au démarrage
nettoyerVieuxLogs(30);

module.exports = journalRequetes;
module.exports.loggerPerformance = loggerPerformance;
module.exports.nettoyerVieuxLogs = nettoyerVieuxLogs;