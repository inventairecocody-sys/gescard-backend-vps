const db = require('../db/db');
const annulationService = require('../Services/annulationService');

// 🔧 CONFIGURATION API EXTERNE - OPTIMISÉE POUR LWS
const API_CONFIG = {
  maxResults: 5000, // Augmenté de 1000 → 5000 pour LWS
  defaultLimit: 100,
  maxSyncRecords: 2000, // Augmenté de 500 → 2000 pour LWS
  maxBatchSize: 500, // Taille des lots pour traitement mémoire
  maxFileSize: '100mb', // Limite de taille de fichier pour LWS
  enableCompression: true, // Activer la compression des réponses
  exportMaxRows: 10000, // Export complet jusqu'à 10000 lignes

  SITES: [
    'ADJAME',
    "CHU D'ANGRE",
    'UNIVERSITE DE COCODY',
    'LYCEE HOTELIER',
    'BINGERVILLE',
    'SITE_6',
    'SITE_7',
    'SITE_8',
    'SITE_9',
    'SITE_10',
  ],
};

// ====================================================
// 🔄 FONCTIONS DE FUSION INTELLIGENTE
// ====================================================

/**
 * Met à jour une carte existante avec fusion intelligente des données
 * @param {Object} client - Client PostgreSQL (transaction)
 * @param {Object} carteExistante - Données actuelles de la carte
 * @param {Object} nouvellesDonnees - Nouvelles données à fusionner
 * @returns {Object} Résultat de la mise à jour
 */
const mettreAJourCarte = async (client, carteExistante, nouvellesDonnees) => {
  let updated = false;
  const updates = [];
  const params = [];
  let paramCount = 0;

  // ✅ TOUTES LES COLONNES PRINCIPALES À FUSIONNER
  const colonnesAFusionner = {
    // Colonnes texte avec priorité aux valeurs les plus complètes
    "LIEU D'ENROLEMENT": 'texte',
    'SITE DE RETRAIT': 'texte',
    RANGEMENT: 'texte',
    NOM: 'texte',
    PRENOMS: 'texte',
    'LIEU NAISSANCE': 'texte',
    CONTACT: 'contact',
    'CONTACT DE RETRAIT': 'contact',
    DELIVRANCE: 'delivrance', // Gestion spéciale
    // Colonnes dates avec priorité aux plus récentes
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date',
  };

  for (const [colonne, type] of Object.entries(colonnesAFusionner)) {
    const valeurExistante = carteExistante[colonne] || '';
    const nouvelleValeur = nouvellesDonnees[colonne]?.toString().trim() || '';

    // 🔄 FUSION INTELLIGENTE PAR TYPE DE COLONNE
    switch (type) {
      case 'delivrance':
        // ✅ LOGIQUE SPÉCIALE POUR DELIVRANCE
        const isOuiExistante = valeurExistante.toUpperCase() === 'OUI';
        const isOuiNouvelle = nouvelleValeur.toUpperCase() === 'OUI';

        // PRIORITÉ AUX NOMS SUR "OUI"
        if (isOuiExistante && !isOuiNouvelle && nouvelleValeur) {
          // "OUI" → Nom : METTRE À JOUR
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "OUI" → "${nouvelleValeur}" (priorité nom)`);
        } else if (!isOuiExistante && isOuiNouvelle && valeurExistante) {
          // Nom → "OUI" : GARDER le nom
          console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé vs "OUI"`);
        } else if (valeurExistante && nouvelleValeur && valeurExistante !== nouvelleValeur) {
          // Conflit entre deux noms → priorité date récente
          const dateExistante = carteExistante['DATE DE DELIVRANCE'];
          const nouvelleDate = nouvellesDonnees['DATE DE DELIVRANCE']
            ? new Date(nouvellesDonnees['DATE DE DELIVRANCE'])
            : null;

          if (nouvelleDate && (!dateExistante || nouvelleDate > new Date(dateExistante))) {
            updates.push(`"${colonne}" = $${++paramCount}`);
            params.push(nouvelleValeur);
            updated = true;
            console.log(
              `  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (date plus récente)`
            );
          } else {
            console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé (date plus récente ou égale)`);
          }
        } else if (nouvelleValeur && !valeurExistante) {
          // Vide → Valeur : AJOUTER
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "" → "${nouvelleValeur}" (ajout)`);
        }
        break;

      case 'contact':
        // ✅ CONTACTS : Priorité aux numéros les plus complets
        if (estContactPlusComplet(nouvelleValeur, valeurExistante)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;

      case 'date':
        // ✅ DATES : Priorité aux dates les plus récentes
        const dateExistante = valeurExistante ? new Date(valeurExistante) : null;
        const nouvelleDate = nouvelleValeur ? new Date(nouvelleValeur) : null;

        if (nouvelleDate && estDatePlusRecente(nouvelleDate, dateExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleDate);
          updated = true;
          console.log(`  🔄 ${colonne}: ${valeurExistante} → ${nouvelleValeur} (plus récente)`);
        }
        break;

      case 'texte':
      default:
        // ✅ TEXTE : Priorité aux valeurs les plus complètes
        if (estValeurPlusComplete(nouvelleValeur, valeurExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;
    }
  }

  // Application des mises à jour
  if (updated && updates.length > 0) {
    updates.push(`dateimport = $${++paramCount}`);
    params.push(new Date());
    params.push(carteExistante.id);

    const updateQuery = `
      UPDATE cartes 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount}
    `;

    await client.query(updateQuery, params);
    console.log(
      `✅ Carte ${carteExistante.nom} ${carteExistante.prenoms} mise à jour: ${updates.length - 1} champs`
    );
  }

  return { updated };
};

/**
 * Résout les conflits entre noms dans DELIVRANCE
 */
const resoudreConflitNom = async (
  client,
  updates,
  params,
  colonne,
  valeurExistante,
  nouvelleValeur,
  carteExistante,
  nouvellesDonnees,
  updated
) => {
  const dateExistante = carteExistante['DATE DE DELIVRANCE'];
  const nouvelleDate = nouvellesDonnees['DATE DE DELIVRANCE']
    ? new Date(nouvellesDonnees['DATE DE DELIVRANCE'])
    : null;

  if (nouvelleDate && (!dateExistante || nouvelleDate > new Date(dateExistante))) {
    updates.push(`"${colonne}" = $${++params.length}`);
    params.push(nouvelleValeur);
    updated = true;
    console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (date plus récente)`);
  } else {
    console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé (date plus récente ou égale)`);
  }
};

/**
 * Vérifie si un contact est plus complet (indicatif, longueur, format)
 */
const estContactPlusComplet = (nouveauContact, ancienContact) => {
  if (!nouveauContact) return false;
  if (!ancienContact) return true;

  // Priorité aux numéros avec indicatif complet
  const hasIndicatifComplet = (contact) =>
    contact.startsWith('+225') || contact.startsWith('00225');
  const isNumerique = (contact) => /^[\d+\s\-()]+$/.test(contact);

  // Règles de priorité
  if (hasIndicatifComplet(nouveauContact) && !hasIndicatifComplet(ancienContact)) return true;
  if (isNumerique(nouveauContact) && !isNumerique(ancienContact)) return true;
  if (nouveauContact.length > ancienContact.length) return true;

  return false;
};

/**
 * Vérifie si une date est plus récente (avec règles spécifiques)
 */
const estDatePlusRecente = (nouvelleDate, dateExistante, colonne) => {
  if (!dateExistante) return true;

  // Pour DATE DE DELIVRANCE, priorité absolue à la plus récente
  if (colonne === 'DATE DE DELIVRANCE') {
    return nouvelleDate > dateExistante;
  }

  // Pour DATE DE NAISSANCE, on garde celle qui est renseignée (pas de priorité de récence)
  return false; // On ne change pas la date de naissance existante
};

/**
 * Vérifie si une valeur texte est plus complète
 */
const estValeurPlusComplete = (nouvelleValeur, valeurExistante, colonne) => {
  if (!nouvelleValeur) return false;
  if (!valeurExistante) return true;

  // Règles spécifiques par colonne
  switch (colonne) {
    case 'NOM':
    case 'PRENOMS':
      // Pour les noms, priorité aux versions avec accents/caractères complets
      const hasAccents = (texte) => /[àâäéèêëîïôöùûüÿçñ]/i.test(texte);
      if (hasAccents(nouvelleValeur) && !hasAccents(valeurExistante)) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;

    case 'LIEU NAISSANCE':
    case "LIEU D'ENROLEMENT":
      // Pour les lieux, priorité aux noms complets
      const motsNouveaux = nouvelleValeur.split(/\s+/).length;
      const motsExistants = valeurExistante.split(/\s+/).length;
      if (motsNouveaux > motsExistants) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;

    default:
      // Règle générale : priorité aux valeurs plus longues
      if (nouvelleValeur.length > valeurExistante.length) return true;
  }

  return false;
};

// ====================================================
// 🔹 NOUVELLES FONCTIONS POUR GESTION DES CARTES (INTÉRIEUR)
// ====================================================

/**
 * Récupérer toutes les cartes avec pagination
 * GET /api/cartes
 */
const getToutesCartes = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 50;
    const offset = (page - 1) * limit;
    const recherche = req.query.recherche || '';

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport
      FROM cartes
    `;

    const params = [];
    let paramCount = 0;

    // Filtre par coordination si l'utilisateur n'est pas admin
    if (req.infosRole?.peutVoirStatistiques === 'coordination' && req.user.coordination) {
      paramCount++;
      query += ` WHERE coordination = $${paramCount}`;
      params.push(req.user.coordination);
    }

    // Recherche textuelle
    if (recherche) {
      paramCount++;
      const searchCondition = ` (nom ILIKE $${paramCount} OR prenoms ILIKE $${paramCount} OR contact ILIKE $${paramCount})`;
      query += query.includes('WHERE') ? ` AND${searchCondition}` : ` WHERE${searchCondition}`;
      params.push(`%${recherche}%`);
    }

    // Compter le total
    const countQuery = query
      .replace(/SELECT.*FROM/, 'SELECT COUNT(*) as total FROM')
      .split(' ORDER BY')[0];

    const countResult = await db.requete(countQuery, params);
    const total = parseInt(countResult.lignes[0].total);

    // Ajouter pagination et tri
    query += ` ORDER BY id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await db.requete(query, params);

    res.json({
      success: true,
      data: result.lignes,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error('❌ Erreur getToutesCartes:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la récupération des cartes',
      details: error.message,
    });
  }
};

/**
 * Récupérer une carte par ID
 * GET /api/cartes/:id
 */
const getCarteParId = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.requete(
      `SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport
       FROM cartes WHERE id = $1`,
      [id]
    );

    if (result.lignes.length === 0) {
      return res.status(404).json({
        success: false,
        erreur: 'Carte non trouvée',
      });
    }

    // Vérifier la coordination pour les chefs d'équipe
    if (
      req.infosRole?.role === "Chef d'équipe" &&
      result.lignes[0].coordination !== req.user.coordination
    ) {
      return res.status(403).json({
        success: false,
        erreur: 'Vous ne pouvez consulter que les cartes de votre coordination',
      });
    }

    res.json({
      success: true,
      data: result.lignes[0],
    });
  } catch (error) {
    console.error('❌ Erreur getCarteParId:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la récupération de la carte',
      details: error.message,
    });
  }
};

/**
 * Créer une nouvelle carte
 * POST /api/cartes
 */
const createCarte = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const {
      "LIEU D'ENROLEMENT": lieuEnrolement,
      'SITE DE RETRAIT': siteRetrait,
      rangement,
      nom,
      prenoms,
      'DATE DE NAISSANCE': dateNaissance,
      'LIEU NAISSANCE': lieuNaissance,
      contact,
      delivrance,
      'CONTACT DE RETRAIT': contactRetrait,
      'DATE DE DELIVRANCE': dateDelivrance,
    } = req.body;

    // Validation
    if (!nom || !prenoms) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        erreur: 'Nom et prénoms sont obligatoires',
      });
    }

    // Ajouter la coordination depuis l'utilisateur connecté
    const coordination = req.user.coordination || null;

    const insertQuery = `
      INSERT INTO cartes (
        "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, dateimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      RETURNING id
    `;

    const result = await client.query(insertQuery, [
      lieuEnrolement || '',
      siteRetrait || '',
      rangement || '',
      nom,
      prenoms,
      dateNaissance || null,
      lieuNaissance || '',
      contact || '',
      delivrance || '',
      contactRetrait || '',
      dateDelivrance || null,
      coordination,
    ]);

    const newId = result.rows[0].id;

    // 📝 ENREGISTRER DANS LE JOURNAL
    await annulationService.enregistrerAction(
      req.user.id,
      req.user.nomUtilisateur,
      req.user.nomComplet || req.user.nomUtilisateur,
      req.user.role,
      req.user.agence || '',
      `Création de la carte pour ${nom} ${prenoms}`,
      'INSERT',
      'cartes',
      newId,
      null, // Pas d'anciennes valeurs
      req.body, // Nouvelles valeurs
      req.ip,
      null, // importBatchId
      coordination
    );

    await client.query('COMMIT');
    client.release();

    res.status(201).json({
      success: true,
      message: 'Carte créée avec succès',
      id: newId,
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur createCarte:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la création de la carte',
      details: error.message,
    });
  }
};

/**
 * Modifier une carte existante
 * PUT /api/cartes/:id
 */
const updateCarte = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Récupérer la carte existante
    const carteExistante = await client.query('SELECT * FROM cartes WHERE id = $1', [id]);

    if (carteExistante.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        success: false,
        erreur: 'Carte non trouvée',
      });
    }

    const ancienneCarte = carteExistante.rows[0];

    // 🔍 FILTRER LES COLONNES SELON LE RÔLE
    let donneesAModifier = { ...req.body };

    // Si colonnesAutorisees est un tableau (Chef d'équipe), ne garder que ces colonnes
    if (Array.isArray(req.colonnesAutorisees) && req.colonnesAutorisees.length > 0) {
      donneesAModifier = {};
      req.colonnesAutorisees.forEach((col) => {
        if (req.body[col] !== undefined) {
          donneesAModifier[col] = req.body[col];
        }
      });

      // Vérifier qu'il y a au moins une modification
      if (Object.keys(donneesAModifier).length === 0) {
        await client.query('ROLLBACK');
        client.release();
        return res.status(400).json({
          success: false,
          erreur: 'Aucune modification valide',
          message: `Vous ne pouvez modifier que: ${req.colonnesAutorisees.join(', ')}`,
        });
      }
    }

    // Construire la requête UPDATE dynamique
    const updates = [];
    const params = [];
    let paramCount = 0;

    for (const [key, value] of Object.entries(donneesAModifier)) {
      paramCount++;
      updates.push(`"${key}" = $${paramCount}`);
      params.push(value);
    }

    // Toujours mettre à jour dateimport
    paramCount++;
    updates.push(`dateimport = $${paramCount}`);
    params.push(new Date());

    // Ajouter l'ID à la fin
    params.push(id);

    const updateQuery = `
      UPDATE cartes 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount + 1}
    `;

    await client.query(updateQuery, params);

    // Récupérer la carte modifiée pour le journal
    const carteModifiee = await client.query('SELECT * FROM cartes WHERE id = $1', [id]);

    // 📝 ENREGISTRER DANS LE JOURNAL
    await annulationService.enregistrerAction(
      req.user.id,
      req.user.nomUtilisateur,
      req.user.nomComplet || req.user.nomUtilisateur,
      req.user.role,
      req.user.agence || '',
      `Modification de la carte #${id}`,
      'UPDATE',
      'cartes',
      id,
      ancienneCarte, // Anciennes valeurs complètes
      carteModifiee.rows[0], // Nouvelles valeurs complètes
      req.ip,
      null,
      ancienneCarte.coordination || req.user.coordination
    );

    await client.query('COMMIT');
    client.release();

    res.json({
      success: true,
      message: 'Carte modifiée avec succès',
      modifications: Object.keys(donneesAModifier),
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur updateCarte:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la modification de la carte',
      details: error.message,
    });
  }
};

/**
 * Supprimer une carte
 * DELETE /api/cartes/:id
 */
const deleteCarte = async (req, res) => {
  const client = await db.pool.connect();

  try {
    await client.query('BEGIN');

    const { id } = req.params;

    // Récupérer la carte avant suppression
    const carteASupprimer = await client.query('SELECT * FROM cartes WHERE id = $1', [id]);

    if (carteASupprimer.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        success: false,
        erreur: 'Carte non trouvée',
      });
    }

    // Vérifier la coordination pour les chefs d'équipe (normalement déjà fait par middleware)
    if (
      req.infosRole?.role === "Chef d'équipe" &&
      carteASupprimer.rows[0].coordination !== req.user.coordination
    ) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(403).json({
        success: false,
        erreur: 'Vous ne pouvez supprimer que les cartes de votre coordination',
      });
    }

    // Supprimer la carte
    await client.query('DELETE FROM cartes WHERE id = $1', [id]);

    // 📝 ENREGISTRER DANS LE JOURNAL
    await annulationService.enregistrerAction(
      req.user.id,
      req.user.nomUtilisateur,
      req.user.nomComplet || req.user.nomUtilisateur,
      req.user.role,
      req.user.agence || '',
      `Suppression de la carte #${id}`,
      'DELETE',
      'cartes',
      id,
      carteASupprimer.rows[0], // Anciennes valeurs pour restauration
      null, // Pas de nouvelles valeurs
      req.ip,
      null,
      carteASupprimer.rows[0].coordination
    );

    await client.query('COMMIT');
    client.release();

    res.json({
      success: true,
      message: 'Carte supprimée avec succès',
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur deleteCarte:', error);
    res.status(500).json({
      success: false,
      erreur: 'Erreur lors de la suppression de la carte',
      details: error.message,
    });
  }
};

// ====================================================
// 🔹 ROUTES API PUBLIQUES (existantes)
// ====================================================

/**
 * Vérification de santé du service
 * GET /api/external/health
 */
const healthCheck = async (req, res) => {
  try {
    const dbTest = await db.query(
      'SELECT 1 as test, version() as postgres_version, NOW() as server_time'
    );

    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques
      FROM cartes
    `);

    const sitesStats = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL 
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
    `);

    // Infos système pour LWS
    const memory = process.memoryUsage();
    const uptime = process.uptime();
    const hours = Math.floor(uptime / 3600);
    const minutes = Math.floor((uptime % 3600) / 60);

    res.json({
      success: true,
      status: 'healthy',
      server: {
        name: 'CartesProject API',
        version: '3.0.0-lws',
        uptime: `${hours}h ${minutes}m`,
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memory.rss / 1024 / 1024) + 'MB',
        },
        node_version: process.version,
        platform: process.platform,
        environment: process.env.NODE_ENV || 'development',
      },
      database: {
        status: 'connected',
        version: dbTest.rows[0].postgres_version.split(',')[0],
        server_time: dbTest.rows[0].server_time,
      },
      statistics: {
        total_cartes: parseInt(statsResult.rows[0].total_cartes),
        sites_actifs: parseInt(statsResult.rows[0].sites_actifs),
        beneficiaires_uniques: parseInt(statsResult.rows[0].beneficiaires_uniques),
      },
      sites_configures: API_CONFIG.SITES,
      sites_statistiques: sitesStats.rows,
      api: {
        max_results: API_CONFIG.maxResults,
        max_sync: API_CONFIG.maxSyncRecords,
        max_batch_size: API_CONFIG.maxBatchSize,
        max_file_size: API_CONFIG.maxFileSize,
        export_max_rows: API_CONFIG.exportMaxRows,
        rate_limit: '1000 req/min',
        features: [
          'fusion_intelligente',
          'gestion_conflits',
          'synchronisation_multicolonne',
          'compression_gzip',
          'traitement_par_lots',
          'export_complet',
        ],
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API healthCheck:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Récupère les changements depuis une date
 * GET /api/external/changes?since=2024-01-01T00:00:00
 */
const getChanges = async (req, res) => {
  try {
    const { since } = req.query;

    console.log('📡 Récupération des changements depuis:', since);

    // Si since n'est pas fourni, utiliser 24h
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 24 * 60 * 60 * 1000); // 24h par défaut

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        coordination,
        dateimport,
        'UPDATE' as operation
      FROM cartes 
      WHERE dateimport > $1
      ORDER BY dateimport ASC
      LIMIT ${API_CONFIG.maxResults}
    `;

    const result = await db.query(query, [sinceDate]);

    const derniereModification =
      result.rows.length > 0
        ? result.rows[result.rows.length - 1].dateimport
        : sinceDate.toISOString();

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification: derniereModification,
      since: sinceDate.toISOString(),
      timestamp: new Date().toISOString(),
      note: 'Utilisez le paramètre ?since=YYYY-MM-DDTHH:mm:ss pour la synchronisation incrémentielle',
    });
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des changements',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Synchronisation avec fusion intelligente (optimisé pour LWS)
 * POST /api/external/sync
 */
const syncData = async (req, res) => {
  const client = await db.getClient();

  try {
    await client.query('BEGIN');

    const { donnees, source = 'python_app', batch_id } = req.body;

    if (!donnees || !Array.isArray(donnees)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Format invalide',
        message: 'Le champ "donnees" doit être un tableau',
      });
    }

    // Vérifier la taille pour LWS
    const totalSize = JSON.stringify(donnees).length;
    const maxSizeBytes = 100 * 1024 * 1024; // 100MB

    if (totalSize > maxSizeBytes) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(413).json({
        success: false,
        error: 'Données trop volumineuses',
        message: `Taille maximum: 100MB, reçu: ${Math.round(totalSize / 1024 / 1024)}MB`,
      });
    }

    if (donnees.length > API_CONFIG.maxSyncRecords) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: "Trop d'enregistrements",
        message: `Maximum ${API_CONFIG.maxSyncRecords} enregistrements par requête`,
      });
    }

    console.log(
      `🔄 Synchronisation intelligente: ${donnees.length} enregistrements depuis ${source}`
    );

    // Traitement par lots pour optimiser la mémoire
    const BATCH_SIZE = API_CONFIG.maxBatchSize;
    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    let errors = 0;
    const errorDetails = [];
    const startTime = Date.now();

    for (let i = 0; i < donnees.length; i += BATCH_SIZE) {
      const batch = donnees.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(donnees.length / BATCH_SIZE);

      console.log(
        `📦 Traitement lot ${batchNum}/${totalBatches} (${batch.length} enregistrements)`
      );

      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const index = i + j;

        try {
          // Validation des champs obligatoires
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Enregistrement ${index}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item['SITE DE RETRAIT']?.toString().trim() || '';

          // ✅ Vérifier si la carte existe
          const existingCarte = await client.query(
            `SELECT * FROM cartes 
             WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
            [nom, prenoms, siteRetrait]
          );

          if (existingCarte.rows.length > 0) {
            // ✅ CARTE EXISTANTE - FUSION INTELLIGENTE
            const carteExistante = existingCarte.rows[0];
            const resultUpdate = await mettreAJourCarte(client, carteExistante, item);

            if (resultUpdate.updated) {
              updated++;

              // 📝 ENREGISTRER DANS LE JOURNAL POUR LA MISE À JOUR
              await annulationService.enregistrerAction(
                null, // utilisateurId (synchronisation externe)
                'SYSTEM',
                'Synchronisation externe',
                source,
                null,
                `Mise à jour via synchronisation (batch ${batch_id || 'N/A'})`,
                'UPDATE',
                'cartes',
                carteExistante.id,
                carteExistante,
                item,
                req.ip,
                batch_id,
                carteExistante.coordination
              );
            } else {
              duplicates++;
            }
          } else {
            // ✅ NOUVELLE CARTE - INSÉRER
            const insertData = {
              "LIEU D'ENROLEMENT": item["LIEU D'ENROLEMENT"]?.toString().trim() || '',
              'SITE DE RETRAIT': siteRetrait,
              RANGEMENT: item['RANGEMENT']?.toString().trim() || '',
              NOM: nom,
              PRENOMS: prenoms,
              'DATE DE NAISSANCE': item['DATE DE NAISSANCE']
                ? new Date(item['DATE DE NAISSANCE'])
                : null,
              'LIEU NAISSANCE': item['LIEU NAISSANCE']?.toString().trim() || '',
              CONTACT: item['CONTACT']?.toString().trim() || '',
              DELIVRANCE: item['DELIVRANCE']?.toString().trim() || '',
              'CONTACT DE RETRAIT': item['CONTACT DE RETRAIT']?.toString().trim() || '',
              'DATE DE DELIVRANCE': item['DATE DE DELIVRANCE']
                ? new Date(item['DATE DE DELIVRANCE'])
                : null,
              sourceimport: source,
              batch_id: batch_id || null,
              coordination: item.coordination || null,
            };

            const insertResult = await client.query(
              `
              INSERT INTO cartes (
                "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
                "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
                "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", sourceimport, batch_id, coordination
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
              RETURNING id
            `,
              Object.values(insertData)
            );

            imported++;

            // 📝 ENREGISTRER DANS LE JOURNAL POUR L'INSERTION
            await annulationService.enregistrerAction(
              null, // utilisateurId (synchronisation externe)
              'SYSTEM',
              'Synchronisation externe',
              source,
              null,
              `Insertion via synchronisation (batch ${batch_id || 'N/A'})`,
              'INSERT',
              'cartes',
              insertResult.rows[0].id,
              null,
              item,
              req.ip,
              batch_id,
              insertData.coordination
            );
          }
        } catch (error) {
          errors++;
          errorDetails.push(`Enregistrement ${index}: ${error.message}`);
          console.error(`❌ Erreur enregistrement ${index}:`, error.message);
        }
      }

      // Libérer la mémoire après chaque lot (si disponible)
      if (global.gc) {
        global.gc();
      }
    }

    await client.query('COMMIT');
    client.release();

    const duration = Date.now() - startTime;
    const successRate =
      donnees.length > 0 ? Math.round(((imported + updated) / donnees.length) * 100) : 0;

    console.log(
      `✅ Sync UP réussie en ${duration}ms: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`
    );

    res.json({
      success: true,
      message: 'Synchronisation avec fusion intelligente réussie',
      stats: {
        imported,
        updated,
        duplicates,
        errors,
        totalProcessed: donnees.length,
        successRate,
      },
      fusion: {
        strategy: 'intelligente_multicolonnes',
        rules: [
          "DELIVRANCE: noms prioritaires sur 'OUI' + dates récentes",
          'CONTACTS: numéros complets avec indicatif prioritaire',
          'NOMS/PRENOMS: versions avec accents et caractères complets',
          'LIEUX: noms géographiques complets',
          'DATES: plus récentes pour délivrance, conservation pour naissance',
          'TEXTES: valeurs les plus longues et complètes',
        ],
        colonnes_traitees: Object.keys(getColonnesAFusionner()),
      },
      performance: {
        duration_ms: duration,
        processing_mode: 'batch',
        batch_size: BATCH_SIZE,
        total_batches: Math.ceil(donnees.length / BATCH_SIZE),
        records_per_second: Math.round(donnees.length / (duration / 1000)),
      },
      batch_info: {
        batch_id: batch_id || 'N/A',
        source: source,
        timestamp: new Date().toISOString(),
      },
      errorDetails: errorDetails.slice(0, 10), // Limiter à 10 erreurs
    });
  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la synchronisation',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Retourne la configuration des colonnes à fusionner
 * GET /api/external/columns-config
 */
const getColonnesAFusionner = () => {
  return {
    "LIEU D'ENROLEMENT": 'texte',
    'SITE DE RETRAIT': 'texte',
    RANGEMENT: 'texte',
    NOM: 'texte',
    PRENOMS: 'texte',
    'LIEU NAISSANCE': 'texte',
    CONTACT: 'contact',
    'CONTACT DE RETRAIT': 'contact',
    DELIVRANCE: 'delivrance',
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date',
  };
};

/**
 * Récupère les cartes avec filtres (optimisé pour LWS)
 * GET /api/external/cartes
 */
const getCartes = async (req, res) => {
  try {
    const {
      nom,
      prenom,
      contact,
      siteRetrait,
      lieuNaissance,
      dateDebut,
      dateFin,
      delivrance,
      page = 1,
      limit = API_CONFIG.defaultLimit,
      export_all = 'false', // Pour les exports complets
    } = req.query;

    // Pour LWS, on permet des exports plus grands
    const actualLimit =
      export_all === 'true'
        ? API_CONFIG.exportMaxRows
        : Math.min(parseInt(limit), API_CONFIG.maxResults);

    const actualPage = Math.max(1, parseInt(page));
    const offset = (actualPage - 1) * actualLimit;

    let query = `
      SELECT 
        id,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
        rangement,
        nom,
        prenoms,
        TO_CHAR("DATE DE NAISSANCE", 'YYYY-MM-DD') as "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        TO_CHAR("DATE DE DELIVRANCE", 'YYYY-MM-DD') as "DATE DE DELIVRANCE",
        coordination,
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport
      FROM cartes 
      WHERE 1=1
    `;

    const params = [];
    let paramCount = 0;

    // Appliquer les filtres
    if (nom) {
      paramCount++;
      query += ` AND nom ILIKE $${paramCount}`;
      params.push(`%${nom}%`);
    }

    if (prenom) {
      paramCount++;
      query += ` AND prenoms ILIKE $${paramCount}`;
      params.push(`%${prenom}%`);
    }

    if (contact) {
      paramCount++;
      query += ` AND contact ILIKE $${paramCount}`;
      params.push(`%${contact}%`);
    }

    if (siteRetrait) {
      paramCount++;
      query += ` AND "SITE DE RETRAIT" ILIKE $${paramCount}`;
      params.push(`%${siteRetrait}%`);
    }

    if (lieuNaissance) {
      paramCount++;
      query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
      params.push(`%${lieuNaissance}%`);
    }

    if (dateDebut) {
      paramCount++;
      query += ` AND dateimport >= $${paramCount}`;
      params.push(new Date(dateDebut));
    }

    if (dateFin) {
      paramCount++;
      query += ` AND dateimport <= $${paramCount}`;
      params.push(new Date(dateFin + ' 23:59:59'));
    }

    if (delivrance) {
      paramCount++;
      query += ` AND delivrance ILIKE $${paramCount}`;
      params.push(`%${delivrance}%`);
    }

    // Pagination
    query += ` ORDER BY id DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(actualLimit, offset);

    const result = await db.query(query, params);

    // Compter le total
    let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
    const countParams = [];

    let countParamCount = 0;
    if (nom) {
      countParamCount++;
      countQuery += ` AND nom ILIKE $${countParamCount}`;
      countParams.push(`%${nom}%`);
    }
    if (prenom) {
      countParamCount++;
      countQuery += ` AND prenoms ILIKE $${countParamCount}`;
      countParams.push(`%${prenom}%`);
    }
    if (contact) {
      countParamCount++;
      countQuery += ` AND contact ILIKE $${countParamCount}`;
      countParams.push(`%${contact}%`);
    }
    if (siteRetrait) {
      countParamCount++;
      countQuery += ` AND "SITE DE RETRAIT" ILIKE $${countParamCount}`;
      countParams.push(`%${siteRetrait}%`);
    }
    if (lieuNaissance) {
      countParamCount++;
      countQuery += ` AND "LIEU NAISSANCE" ILIKE $${countParamCount}`;
      countParams.push(`%${lieuNaissance}%`);
    }
    if (dateDebut) {
      countParamCount++;
      countQuery += ` AND dateimport >= $${countParamCount}`;
      countParams.push(new Date(dateDebut));
    }
    if (dateFin) {
      countParamCount++;
      countQuery += ` AND dateimport <= $${countParamCount}`;
      countParams.push(new Date(dateFin + ' 23:59:59'));
    }
    if (delivrance) {
      countParamCount++;
      countQuery += ` AND delivrance ILIKE $${countParamCount}`;
      countParams.push(`%${delivrance}%`);
    }

    const countResult = await db.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    // Headers pour les exports
    if (export_all === 'true') {
      res.setHeader('X-Total-Rows', total);
      res.setHeader('X-Export-Type', 'complete');
      res.setHeader('Content-Type', 'application/json');
    }

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        page: actualPage,
        limit: actualLimit,
        total: total,
        totalPages: Math.ceil(total / actualLimit),
        hasNext: actualPage < Math.ceil(total / actualLimit),
        hasPrev: actualPage > 1,
      },
      filters: {
        nom: nom || null,
        prenom: prenom || null,
        contact: contact || null,
        siteRetrait: siteRetrait || null,
        lieuNaissance: lieuNaissance || null,
        dateDebut: dateDebut || null,
        dateFin: dateFin || null,
        delivrance: delivrance || null,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des cartes',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Statistiques détaillées (enrichies pour LWS)
 * GET /api/external/stats
 */
const getStats = async (req, res) => {
  try {
    const globalStats = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques,
        MIN(dateimport) as premiere_importation,
        MAX(dateimport) as derniere_importation,
        COUNT(DISTINCT batch_id) as total_batches,
        AVG(EXTRACT(EPOCH FROM (dateimport - LAG(dateimport) OVER (ORDER BY dateimport)))) as avg_import_interval
      FROM cartes
    `);

    const topSites = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees,
        ROUND(COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) * 100.0 / COUNT(*), 2) as taux_retrait
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      GROUP BY "SITE DE RETRAIT"
      ORDER BY total_cartes DESC
    `);

    const recentActivity = await db.query(`
      SELECT 
        DATE(dateimport) as jour,
        COUNT(*) as imports,
        COUNT(DISTINCT batch_id) as batches
      FROM cartes
      WHERE dateimport > NOW() - INTERVAL '7 days'
      GROUP BY DATE(dateimport)
      ORDER BY jour DESC
    `);

    const global = globalStats.rows[0];
    const totalCartes = parseInt(global.total_cartes);
    const cartesRetirees = parseInt(global.cartes_retirees);

    res.json({
      success: true,
      data: {
        global: {
          total_cartes: totalCartes,
          cartes_retirees: cartesRetirees,
          taux_retrait_global:
            totalCartes > 0 ? Math.round((cartesRetirees / totalCartes) * 100) : 0,
          sites_actifs: parseInt(global.sites_actifs),
          beneficiaires_uniques: parseInt(global.beneficiaires_uniques),
          premiere_importation: global.premiere_importation,
          derniere_importation: global.derniere_importation,
          total_batches: parseInt(global.total_batches || 0),
        },
        top_sites: topSites.rows,
        recent_activity: recentActivity.rows,
        sites_configures: API_CONFIG.SITES,
        system: {
          max_capacity: API_CONFIG.maxResults,
          max_sync: API_CONFIG.maxSyncRecords,
          max_batch_size: API_CONFIG.maxBatchSize,
          environment: process.env.NODE_ENV || 'production',
        },
      },
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur API getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Récupère les modifications par site
 * GET /api/external/modifications?site=ADJAME&derniereSync=2024-01-01T00:00:00
 */
const getModifications = async (req, res) => {
  try {
    const { site, derniereSync, limit = 1000 } = req.query;

    if (!site || !derniereSync) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres manquants: site et derniereSync requis',
      });
    }

    if (!API_CONFIG.SITES.includes(site)) {
      return res.status(400).json({
        success: false,
        error: 'Site non reconnu',
        message: `Sites valides: ${API_CONFIG.SITES.join(', ')}`,
      });
    }

    let query = `
      SELECT * FROM cartes 
      WHERE "SITE DE RETRAIT" = $1 
      AND dateimport > $2
      ORDER BY dateimport ASC
      LIMIT $3
    `;

    const result = await db.query(query, [site, new Date(derniereSync), limit]);

    let derniereModification = derniereSync;
    if (result.rows.length > 0) {
      derniereModification = result.rows[result.rows.length - 1].dateimport;
    }

    res.json({
      success: true,
      data: result.rows,
      total: result.rows.length,
      derniereModification: derniereModification,
      site: site,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getModifications:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des modifications',
      details: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};

/**
 * Retourne la liste des sites configurés
 * GET /api/external/sites
 */
const getSites = async (req, res) => {
  try {
    res.json({
      success: true,
      sites: API_CONFIG.SITES,
      total_sites: API_CONFIG.SITES.length,
      description: '10 sites avec synchronisation intelligente multi-colonnes',
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('❌ Erreur getSites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      details: error.message,
    });
  }
};

// Export des fonctions
module.exports = {
  // Nouvelles fonctions internes
  getToutesCartes,
  getCarteParId,
  createCarte,
  updateCarte,
  deleteCarte,

  // Fonctions de fusion (exportées pour tests)
  mettreAJourCarte,
  resoudreConflitNom,
  estContactPlusComplet,
  estDatePlusRecente,
  estValeurPlusComplete,

  // Routes API publiques
  healthCheck,
  getChanges,
  syncData,
  getColonnesAFusionner,
  getCartes,
  getStats,
  getModifications,
  getSites,
  API_CONFIG,
};
