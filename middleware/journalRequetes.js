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
const PERFORMANCES_LOG_FILE = path.join(LOGS_DIR, 'performances-lentes.log');

// Créer le dossier logs s'il n'existe pas
if (!fs.existsSync(LOGS_DIR)) {
  fs.mkdirSync(LOGS_DIR, { recursive: true });
  console.log(`📁 Dossier de logs créé: ${LOGS_DIR}`);
}

// ============================================
// FONCTIONS UTILITAIRES
// ============================================

/**
 * Génère un ID unique pour chaque requête
 */
const genererIdUnique = () => {
  return crypto.randomBytes(8).toString('hex');
};

/**
 * Formate la date au format ISO
 */
const formaterDate = (date = new Date()) => {
  return date.toISOString();
};

/**
 * Écrit un message dans un fichier de log (asynchrone)
 */
const ecrireLog = (fichier, message) => {
  const ligne = `[${formaterDate()}] ${message}\n`;
  fs.appendFile(fichier, ligne, (err) => {
    if (err) console.error('❌ Erreur écriture log:', err.message);
  });
};

/**
 * Nettoie les objets sensibles (mots de passe)
 */
const nettoyerObjetsSensibles = (obj) => {
  if (!obj || typeof obj !== 'object') return obj;

  const nettoye = { ...obj };
  const champsSensibles = [
    'motDePasse',
    'confirmationMotDePasse',
    'password',
    'currentPassword',
    'newPassword',
  ];

  champsSensibles.forEach((champ) => {
    if (nettoye[champ]) nettoye[champ] = '[MASQUÉ]';
  });

  return nettoye;
};

// ============================================
// MIDDLEWARE PRINCIPAL
// ============================================

/**
 * Middleware de journalisation des requêtes
 */
const journalRequetes = (req, res, next) => {
  const debut = Date.now();
  const idRequete = genererIdUnique();

  // Ajouter l'ID à la requête pour traçabilité
  req.idRequete = idRequete;

  // Ajouter l'ID dans les en-têtes de réponse
  res.setHeader('X-Request-ID', idRequete);

  // Capturer l'IP réelle (derrière proxy)
  const ipReelle =
    req.headers['x-forwarded-for'] ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
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
    referer: req.headers['referer'] || req.headers['referrer'] || null,
    utilisateur: req.user
      ? {
          id: req.user.id,
          nom: req.user.nomUtilisateur || req.user.NomUtilisateur,
          role: req.user.role || req.user.Role,
          coordination: req.user.coordination,
        }
      : 'non authentifié',
  };

  // Log entrant dans la console
  console.log(`\n📥 [${idRequete}] ${req.method} ${req.url}`);
  console.log(
    `   👤 Utilisateur: ${typeof infosRequete.utilisateur === 'object' ? infosRequete.utilisateur.nom || 'anonyme' : 'anonyme'} (${typeof infosRequete.utilisateur === 'object' ? infosRequete.utilisateur.role || 'aucun' : 'aucun'})`
  );
  console.log(`   🌐 IP: ${ipReelle}`);

  // Log entrant dans le fichier
  ecrireLog(REQUETES_LOG_FILE, `IN  ${JSON.stringify(infosRequete)}`);

  // Capturer le corps de la requête pour les logs (sans mots de passe)
  if (req.body && Object.keys(req.body).length > 0) {
    const corpsLog = nettoyerObjetsSensibles(req.body);
    console.log(`   📦 Corps:`, corpsLog);
    req.corpsLog = corpsLog; // Stocker pour la réponse
  }

  // Intercepter la méthode res.json pour logger la réponse
  const jsonOriginal = res.json;
  res.json = function (donnees) {
    const duree = Date.now() - debut;
    const statusCode = res.statusCode;

    // Déterminer le niveau de log
    const niveau = statusCode >= 500 ? '❌ ERREUR' : statusCode >= 400 ? '⚠️ ALERTE' : '✅ SUCCÈS';

    // Préparer les infos de réponse
    const infosReponse = {
      id: idRequete,
      duree: `${duree}ms`,
      statusCode,
      niveau: niveau.trim(),
      taille: JSON.stringify(donnees).length,
    };

    // Log dans la console
    console.log(`${niveau} [${idRequete}] ${req.method} ${req.url}`);
    console.log(`   ⏱️  Temps: ${duree}ms | Code: ${statusCode}`);

    // Log détaillé pour les erreurs
    if (statusCode >= 400) {
      console.log(`   📋 Détails erreur:`, {
        message: donnees.erreur || donnees.message || 'Erreur inconnue',
        code: donnees.code,
      });

      // Log d'erreur dans fichier séparé
      ecrireLog(
        ERREURS_LOG_FILE,
        JSON.stringify({
          requete: infosRequete,
          reponse: infosReponse,
          erreur: donnees,
          corpsRequete: req.corpsLog || null,
        })
      );
    }

    // Log de la réponse dans le fichier principal
    ecrireLog(
      REQUETES_LOG_FILE,
      `OUT ${JSON.stringify({
        ...infosReponse,
        utilisateur: infosRequete.utilisateur,
      })}`
    );

    // Restaurer et appeler la méthode originale
    return jsonOriginal.call(this, donnees);
  };

  // Marquer que nous avons intercepté
  res._jsonIntercepte = true;

  // Gérer les erreurs de la requête
  res.on('finish', () => {
    // Si la réponse n'a pas utilisé res.json (ex: res.send, res.end)
    if (!res._jsonIntercepte) {
      const duree = Date.now() - debut;
      console.log(`⚪ [${idRequete}] ${req.method} ${req.url} - ${res.statusCode} - ${duree}ms`);

      ecrireLog(
        REQUETES_LOG_FILE,
        `OUT ${JSON.stringify({
          id: idRequete,
          duree: `${duree}ms`,
          statusCode: res.statusCode,
          utilisateur: infosRequete.utilisateur,
        })}`
      );
    }
  });

  next();
};

// ============================================
// MIDDLEWARE SPÉCIFIQUES
// ============================================

/**
 * Middleware pour logger les performances (à utiliser sur des routes spécifiques)
 * @param {number} seuil - Durée en ms au-delà de laquelle la requête est considérée lente
 */
const loggerPerformance = (seuil = 1000) => {
  return (req, res, next) => {
    const debut = Date.now();

    res.on('finish', () => {
      const duree = Date.now() - debut;
      if (duree > seuil) {
        console.log(`🐢 Requête lente [${duree}ms] ${req.method} ${req.url}`);

        // Log des requêtes lentes dans un fichier spécifique
        ecrireLog(
          PERFORMANCES_LOG_FILE,
          JSON.stringify({
            timestamp: formaterDate(),
            duree,
            methode: req.method,
            url: req.url,
            utilisateur: req.user?.nomUtilisateur || 'anonyme',
            ip: req.headers['x-forwarded-for'] || req.ip,
          })
        );
      }
    });

    next();
  };
};

// ============================================
// FONCTIONS DE MAINTENANCE
// ============================================

/**
 * Nettoie les vieux logs (archive)
 * @param {number} jours - Nombre de jours de conservation
 */
const nettoyerVieuxLogs = (jours = 30) => {
  try {
    const maintenant = Date.now();
    const limite = maintenant - jours * 24 * 60 * 60 * 1000;
    let fichiersTraites = 0;

    [REQUETES_LOG_FILE, ERREURS_LOG_FILE, PERFORMANCES_LOG_FILE].forEach((fichier) => {
      if (fs.existsSync(fichier)) {
        const stats = fs.statSync(fichier);
        if (stats.mtimeMs < limite) {
          // Archiver
          const dateStr = formaterDate().split('T')[0];
          const archive = `${fichier}.${dateStr}.old`;

          // Si l'archive existe déjà, ajouter un timestamp
          if (fs.existsSync(archive)) {
            const timestamp = Date.now();
            fs.renameSync(fichier, `${fichier}.${timestamp}.old`);
          } else {
            fs.renameSync(fichier, archive);
          }

          console.log(`📦 Log archivé: ${path.basename(archive)}`);
          fichiersTraites++;
        }
      }
    });

    if (fichiersTraites > 0) {
      console.log(`✅ ${fichiersTraites} fichier(s) de log archivé(s)`);
    }
  } catch (error) {
    console.error('❌ Erreur nettoyage logs:', error.message);
  }
};

// Exécuter le nettoyage une fois au démarrage
nettoyerVieuxLogs(30);

// Nettoyage périodique (tous les jours)
setInterval(() => nettoyerVieuxLogs(30), 24 * 60 * 60 * 1000);

// ============================================
// EXPORTS
// ============================================

module.exports = journalRequetes;
module.exports.loggerPerformance = loggerPerformance;
module.exports.nettoyerVieuxLogs = nettoyerVieuxLogs;
