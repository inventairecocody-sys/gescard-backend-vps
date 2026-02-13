const db = require('../db/db');

// 🔧 CONFIGURATION API EXTERNE - OPTIMISÉE POUR LWS
const API_CONFIG = {
  // Limites augmentées pour LWS
  maxResults: 10000,           // Augmenté de 1000 → 10000
  defaultLimit: 100,
  maxSyncRecords: 5000,        // Augmenté de 500 → 5000
  maxBatchSize: 1000,          // Nouveau : taille des lots pour traitement
  exportMaxRows: 100000,       // Nouveau : max pour exports
  enableCompression: true,     // Nouveau : compression GZIP
  
  SITES: [
    "ADJAME",
    "CHU D'ANGRE", 
    "UNIVERSITE DE COCODY",
    "LYCEE HOTELIER",
    "BINGERVILLE",
    "SITE_6",
    "SITE_7",
    "SITE_8", 
    "SITE_9",
    "SITE_10"
  ]
};

// ====================================================
// 🔄 FONCTIONS DE FUSION INTELLIGENTE (inchangées - excellentes)
// ====================================================

/**
 * Met à jour une carte existante avec fusion intelligente des données
 */
exports.mettreAJourCarte = async (client, carteExistante, nouvellesDonnees) => {
  let updated = false;
  const updates = [];
  const params = [];
  let paramCount = 0;

  // ✅ TOUTES LES COLONNES PRINCIPALES À FUSIONNER
  const colonnesAFusionner = {
    'LIEU D\'ENROLEMENT': 'texte',
    'SITE DE RETRAIT': 'texte', 
    'RANGEMENT': 'texte',
    'NOM': 'texte',
    'PRENOMS': 'texte',
    'LIEU NAISSANCE': 'texte',
    'CONTACT': 'contact',
    'CONTACT DE RETRAIT': 'contact',
    'DELIVRANCE': 'delivrance',
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date'
  };

  for (const [colonne, type] of Object.entries(colonnesAFusionner)) {
    const valeurExistante = carteExistante[colonne] || '';
    const nouvelleValeur = nouvellesDonnees[colonne]?.toString().trim() || '';

    switch (type) {
      
      case 'delivrance':
        const isOuiExistante = valeurExistante.toUpperCase() === 'OUI';
        const isOuiNouvelle = nouvelleValeur.toUpperCase() === 'OUI';
        
        if (isOuiExistante && !isOuiNouvelle && nouvelleValeur) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "OUI" → "${nouvelleValeur}" (priorité nom)`);
        }
        else if (!isOuiExistante && isOuiNouvelle && valeurExistante) {
          console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé vs "OUI"`);
        }
        else if (valeurExistante && nouvelleValeur && valeurExistante !== nouvelleValeur) {
          await exports.resoudreConflitNom(client, updates, params, colonne, 
            valeurExistante, nouvelleValeur, carteExistante, nouvellesDonnees, updated);
        }
        else if (nouvelleValeur && !valeurExistante) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "" → "${nouvelleValeur}" (ajout)`);
        }
        break;

      case 'contact':
        if (exports.estContactPlusComplet(nouvelleValeur, valeurExistante)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;

      case 'date':
        const dateExistante = valeurExistante ? new Date(valeurExistante) : null;
        const nouvelleDate = nouvelleValeur ? new Date(nouvelleValeur) : null;
        
        if (nouvelleDate && exports.estDatePlusRecente(nouvelleDate, dateExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleDate);
          updated = true;
          console.log(`  🔄 ${colonne}: ${valeurExistante} → ${nouvelleValeur} (plus récente)`);
        }
        break;

      case 'texte':
      default:
        if (exports.estValeurPlusComplete(nouvelleValeur, valeurExistante, colonne)) {
          updates.push(`"${colonne}" = $${++paramCount}`);
          params.push(nouvelleValeur);
          updated = true;
          console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (plus complet)`);
        }
        break;
    }
  }

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
    console.log(`✅ Carte ${carteExistante.nom} ${carteExistante.prenoms} mise à jour: ${updates.length - 1} champs`);
  }

  return { updated };
};

// ✅ Résoudre les conflits entre noms dans DELIVRANCE
exports.resoudreConflitNom = async (client, updates, params, colonne, 
  valeurExistante, nouvelleValeur, carteExistante, nouvellesDonnees, updated) => {
  
  const dateExistante = carteExistante["DATE DE DELIVRANCE"];
  const nouvelleDate = nouvellesDonnees["DATE DE DELIVRANCE"] ? 
    new Date(nouvellesDonnees["DATE DE DELIVRANCE"]) : null;
  
  if (nouvelleDate && (!dateExistante || nouvelleDate > new Date(dateExistante))) {
    updates.push(`"${colonne}" = $${++params.length}`);
    params.push(nouvelleValeur);
    updated = true;
    console.log(`  🔄 ${colonne}: "${valeurExistante}" → "${nouvelleValeur}" (date plus récente)`);
  } else {
    console.log(`  ✅ ${colonne}: "${valeurExistante}" gardé (date plus récente ou égale)`);
  }
};

// ✅ Vérifier si un contact est plus complet
exports.estContactPlusComplet = (nouveauContact, ancienContact) => {
  if (!nouveauContact) return false;
  if (!ancienContact) return true;
  
  const hasIndicatifComplet = (contact) => contact.startsWith('+225') || contact.startsWith('00225');
  const isNumerique = (contact) => /^[\d+\s\-()]+$/.test(contact);
  
  if (hasIndicatifComplet(nouveauContact) && !hasIndicatifComplet(ancienContact)) return true;
  if (isNumerique(nouveauContact) && !isNumerique(ancienContact)) return true;
  if (nouveauContact.length > ancienContact.length) return true;
  
  return false;
};

// ✅ Vérifier si une date est plus récente
exports.estDatePlusRecente = (nouvelleDate, dateExistante, colonne) => {
  if (!dateExistante) return true;
  
  if (colonne === 'DATE DE DELIVRANCE') {
    return nouvelleDate > dateExistante;
  }
  
  return false;
};

// ✅ Vérifier si une valeur texte est plus complète
exports.estValeurPlusComplete = (nouvelleValeur, valeurExistante, colonne) => {
  if (!nouvelleValeur) return false;
  if (!valeurExistante) return true;
  
  switch (colonne) {
    case 'NOM':
    case 'PRENOMS':
      const hasAccents = (texte) => /[àâäéèêëîïôöùûüÿçñ]/i.test(texte);
      if (hasAccents(nouvelleValeur) && !hasAccents(valeurExistante)) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;
      
    case 'LIEU NAISSANCE':
    case 'LIEU D\'ENROLEMENT':
      const motsNouveaux = nouvelleValeur.split(/\s+/).length;
      const motsExistants = valeurExistante.split(/\s+/).length;
      if (motsNouveaux > motsExistants) return true;
      if (nouvelleValeur.length > valeurExistante.length) return true;
      break;
      
    default:
      if (nouvelleValeur.length > valeurExistante.length) return true;
  }
  
  return false;
};

// ====================================================
// 🔹 ROUTES API PUBLIQUES OPTIMISÉES POUR LWS
// ====================================================

/**
 * VÉRIFICATION DE SANTÉ ENRICHIE
 * GET /api/external/health
 */
exports.healthCheck = async (req, res) => {
  try {
    const dbTest = await db.query('SELECT 1 as test, version() as postgres_version, NOW() as server_time');
    
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_cartes,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites_actifs,
        COUNT(DISTINCT nom) as beneficiaires_uniques,
        COUNT(CASE WHEN dateimport > NOW() - INTERVAL '24 hours' THEN 1 END) as imports_24h
      FROM cartes
    `);

    const sitesStats = await db.query(`
      SELECT 
        "SITE DE RETRAIT" as site,
        COUNT(*) as total_cartes,
        COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' THEN 1 END) as cartes_retirees
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
          total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
        },
        environment: process.env.NODE_ENV || 'production'
      },
      database: {
        status: 'connected',
        version: dbTest.rows[0].postgres_version.split(',')[0],
        server_time: dbTest.rows[0].server_time
      },
      statistics: {
        total_cartes: parseInt(statsResult.rows[0].total_cartes),
        sites_actifs: parseInt(statsResult.rows[0].sites_actifs),
        beneficiaires_uniques: parseInt(statsResult.rows[0].beneficiaires_uniques),
        imports_24h: parseInt(statsResult.rows[0].imports_24h)
      },
      sites_configures: API_CONFIG.SITES,
      sites_statistiques: sitesStats.rows,
      api: {
        version: '3.0.0',
        environment: process.env.NODE_ENV || 'production',
        max_results: API_CONFIG.maxResults,
        max_sync: API_CONFIG.maxSyncRecords,
        rate_limit: '1000 req/min',
        features: [
          'fusion_intelligente', 
          'gestion_conflits', 
          'synchronisation_multicolonne',
          'compression_gzip',
          'batch_processing'
        ]
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur API healthCheck:', error);
    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * RÉCUPÉRATION DES CHANGEMENTS OPTIMISÉE
 * GET /api/external/changes?since=2024-01-01T00:00:00&limit=5000
 */
exports.getChanges = async (req, res) => {
  try {
    const { since, limit = API_CONFIG.maxResults } = req.query;
    
    console.log('📡 Récupération des changements depuis:', since);
    
    const sinceDate = since 
      ? new Date(since)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const actualLimit = Math.min(parseInt(limit), API_CONFIG.maxResults);
    
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
        TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI:SS') as dateimport,
        'UPDATE' as operation
      FROM cartes 
      WHERE dateimport > $1
      ORDER BY dateimport ASC
      LIMIT $2
    `;
    
    const result = await db.query(query, [sinceDate, actualLimit]);
    
    const derniereModification = result.rows.length > 0
      ? result.rows[result.rows.length - 1].dateimport
      : sinceDate.toISOString();
    
    // Ajouter en-têtes pour pagination
    res.setHeader('X-Total-Count', result.rows.length);
    res.setHeader('X-Last-Modified', derniereModification);
    
    res.json({
      success: true,
      data: result.rows,
      pagination: {
        total: result.rows.length,
        limit: actualLimit,
        hasMore: result.rows.length === actualLimit
      },
      derniereModification: derniereModification,
      since: sinceDate.toISOString(),
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    console.error('❌ Erreur getChanges:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des changements',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * SYNCHRONISATION AVEC FUSION INTELLIGENTE ET TRAITEMENT PAR LOTS
 * POST /api/external/sync
 */
exports.syncData = async (req, res) => {
  const client = await db.getClient();
  const startTime = Date.now();
  
  try {
    await client.query('BEGIN');
    
    const { donnees, source = 'python_app', batch_id } = req.body;
    
    if (!donnees || !Array.isArray(donnees)) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Format invalide',
        message: 'Le champ "donnees" doit être un tableau'
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
        message: `Taille maximum: 100MB, reçu: ${Math.round(totalSize / 1024 / 1024)}MB`
      });
    }

    if (donnees.length > API_CONFIG.maxSyncRecords) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(400).json({
        success: false,
        error: 'Trop d\'enregistrements',
        message: `Maximum ${API_CONFIG.maxSyncRecords} enregistrements par requête`
      });
    }

    console.log(`🔄 Synchronisation intelligente: ${donnees.length} enregistrements depuis ${source}`);

    // Traitement par lots pour optimiser la mémoire
    const BATCH_SIZE = API_CONFIG.maxBatchSize;
    let imported = 0;
    let updated = 0;
    let duplicates = 0;
    let errors = 0;
    const errorDetails = [];

    for (let i = 0; i < donnees.length; i += BATCH_SIZE) {
      const batch = donnees.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i/BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(donnees.length/BATCH_SIZE);
      
      console.log(`📦 Traitement lot ${batchNum}/${totalBatches} (${batch.length} enregistrements)`);
      
      for (let j = 0; j < batch.length; j++) {
        const item = batch[j];
        const index = i + j;
        
        try {
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Enregistrement ${index}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item["SITE DE RETRAIT"]?.toString().trim() || '';

          const existingCarte = await client.query(
            `SELECT * FROM cartes 
             WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
            [nom, prenoms, siteRetrait]
          );

          if (existingCarte.rows.length > 0) {
            const carteExistante = existingCarte.rows[0];
            const resultUpdate = await exports.mettreAJourCarte(client, carteExistante, item);
            
            if (resultUpdate.updated) {
              updated++;
            } else {
              duplicates++;
            }
            
          } else {
            const insertData = {
              "LIEU D'ENROLEMENT": item["LIEU D'ENROLEMENT"]?.toString().trim() || '',
              "SITE DE RETRAIT": siteRetrait,
              "RANGEMENT": item["RANGEMENT"]?.toString().trim() || '',
              "NOM": nom,
              "PRENOMS": prenoms,
              "DATE DE NAISSANCE": item["DATE DE NAISSANCE"] ? new Date(item["DATE DE NAISSANCE"]) : null,
              "LIEU NAISSANCE": item["LIEU NAISSANCE"]?.toString().trim() || '',
              "CONTACT": item["CONTACT"]?.toString().trim() || '',
              "DELIVRANCE": item["DELIVRANCE"]?.toString().trim() || '',
              "CONTACT DE RETRAIT": item["CONTACT DE RETRAIT"]?.toString().trim() || '',
              "DATE DE DELIVRANCE": item["DATE DE DELIVRANCE"] ? new Date(item["DATE DE DELIVRANCE"]) : null,
              "sourceimport": source,
              "batch_id": batch_id || null
            };

            await client.query(`
              INSERT INTO cartes (
                "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
                "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
                "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", sourceimport, batch_id
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, Object.values(insertData));

            imported++;
          }

        } catch (error) {
          errors++;
          errorDetails.push(`Enregistrement ${index}: ${error.message}`);
          console.error(`❌ Erreur enregistrement ${index}:`, error.message);
        }
      }
      
      // Libérer la mémoire après chaque lot
      if (global.gc) {
        global.gc();
      }
    }

    await client.query('COMMIT');
    client.release();

    const duration = Date.now() - startTime;
    const successRate = donnees.length > 0 
      ? Math.round(((imported + updated) / donnees.length) * 100) 
      : 0;

    console.log(`✅ Sync UP réussie en ${duration}ms: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`);

    res.json({
      success: true,
      message: 'Synchronisation avec fusion intelligente réussie',
      stats: {
        imported,
        updated, 
        duplicates,
        errors,
        totalProcessed: donnees.length,
        successRate
      },
      performance: {
        duration_ms: duration,
        records_per_second: Math.round(donnees.length / (duration / 1000)),
        batch_size: BATCH_SIZE,
        total_batches: Math.ceil(donnees.length / BATCH_SIZE)
      },
      fusion: {
        strategy: "intelligente_multicolonnes",
        colonnes_traitees: Object.keys(exports.getColonnesAFusionner())
      },
      batch_info: {
        batch_id: batch_id || 'N/A',
        source: source,
        timestamp: new Date().toISOString()
      },
      errorDetails: errorDetails.slice(0, 10)
    });

  } catch (error) {
    await client.query('ROLLBACK');
    client.release();
    console.error('❌ Erreur syncData:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la synchronisation',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * CONFIGURATION DES COLONNES À FUSIONNER
 */
exports.getColonnesAFusionner = () => {
  return {
    'LIEU D\'ENROLEMENT': 'texte',
    'SITE DE RETRAIT': 'texte', 
    'RANGEMENT': 'texte',
    'NOM': 'texte',
    'PRENOMS': 'texte',
    'LIEU NAISSANCE': 'texte',
    'CONTACT': 'contact',
    'CONTACT DE RETRAIT': 'contact',
    'DELIVRANCE': 'delivrance',
    'DATE DE NAISSANCE': 'date',
    'DATE DE DELIVRANCE': 'date'
  };
};

/**
 * RÉCUPÉRATION DES CARTES AVEC FILTRES OPTIMISÉE
 * GET /api/external/cartes
 */
exports.getCartes = async (req, res) => {
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
      export_all = 'false'
    } = req.query;

    // Pour LWS, on permet des exports plus grands
    const actualLimit = export_all === 'true' 
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
        hasPrev: actualPage > 1
      },
      filters: req.query,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur API getCartes:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des cartes',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * STATISTIQUES DÉTAILLÉES ENRICHIES
 * GET /api/external/stats
 */
exports.getStats = async (req, res) => {
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
        COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days' THEN 1 END) as imports_7j
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
      LIMIT 10
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
          taux_retrait_global: totalCartes > 0 
            ? Math.round((cartesRetirees / totalCartes) * 100) 
            : 0,
          sites_actifs: parseInt(global.sites_actifs),
          beneficiaires_uniques: parseInt(global.beneficiaires_uniques),
          premiere_importation: global.premiere_importation,
          derniere_importation: global.derniere_importation,
          total_batches: parseInt(global.total_batches || 0),
          imports_7j: parseInt(global.imports_7j || 0)
        },
        top_sites: topSites.rows,
        recent_activity: recentActivity.rows,
        sites_configures: API_CONFIG.SITES,
        system: {
          max_results: API_CONFIG.maxResults,
          max_sync: API_CONFIG.maxSyncRecords,
          environment: process.env.NODE_ENV || 'production'
        }
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur API getStats:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des statistiques',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * MODIFICATIONS PAR SITE
 * GET /api/external/modifications?site=ADJAME&derniereSync=2024-01-01T00:00:00
 */
exports.getModifications = async (req, res) => {
  try {
    const { site, derniereSync, limit = 1000 } = req.query;

    if (!site || !derniereSync) {
      return res.status(400).json({
        success: false,
        error: 'Paramètres manquants: site et derniereSync requis'
      });
    }

    if (!API_CONFIG.SITES.includes(site)) {
      return res.status(400).json({
        success: false,
        error: 'Site non reconnu',
        message: `Sites valides: ${API_CONFIG.SITES.join(', ')}`
      });
    }

    const actualLimit = Math.min(parseInt(limit), API_CONFIG.maxResults);

    let query = `
      SELECT * FROM cartes 
      WHERE "SITE DE RETRAIT" = $1 
      AND dateimport > $2
      ORDER BY dateimport ASC
      LIMIT $3
    `;

    const result = await db.query(query, [site, new Date(derniereSync), actualLimit]);

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
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('❌ Erreur getModifications:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur lors de la récupération des modifications',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * LISTE DES SITES CONFIGURÉS
 * GET /api/external/sites
 */
exports.getSites = async (req, res) => {
  try {
    // Récupérer aussi les sites avec données
    const sitesActifs = await db.query(`
      SELECT DISTINCT "SITE DE RETRAIT" as site
      FROM cartes 
      WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      ORDER BY site
    `);

    res.json({
      success: true,
      sites_configures: API_CONFIG.SITES,
      sites_actifs: sitesActifs.rows.map(row => row.site),
      total_configures: API_CONFIG.SITES.length,
      total_actifs: sitesActifs.rows.length,
      description: "Sites avec synchronisation intelligente multi-colonnes",
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur getSites:', error);
    res.status(500).json({
      success: false,
      error: 'Erreur serveur',
      details: error.message
    });
  }
};

/**
 * DIAGNOSTIC COMPLET DU SERVICE
 * GET /api/external/diagnostic
 */
exports.diagnostic = async (req, res) => {
  try {
    const memory = process.memoryUsage();
    const uptime = process.uptime();
    
    // Test DB rapide
    const dbTest = await db.query('SELECT 1 as test');
    
    // Compter les données
    const stats = await db.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(DISTINCT "SITE DE RETRAIT") as sites,
        MAX(dateimport) as last_import
      FROM cartes
    `);

    res.json({
      success: true,
      timestamp: new Date().toISOString(),
      service: 'api-external',
      environment: process.env.NODE_ENV || 'development',
      status: 'operational',
      database: {
        connected: dbTest.rows.length > 0,
        total_cartes: parseInt(stats.rows[0].total),
        sites_actifs: parseInt(stats.rows[0].sites),
        dernier_import: stats.rows[0].last_import
      },
      system: {
        uptime: Math.floor(uptime / 3600) + 'h ' + Math.floor((uptime % 3600) / 60) + 'm',
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
          total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memory.rss / 1024 / 1024) + 'MB'
        },
        node_version: process.version
      },
      config: {
        maxResults: API_CONFIG.maxResults,
        maxSyncRecords: API_CONFIG.maxSyncRecords,
        maxBatchSize: API_CONFIG.maxBatchSize,
        sites: API_CONFIG.SITES
      },
      endpoints: {
        health: '/api/external/health',
        changes: '/api/external/changes?since=...',
        sync: '/api/external/sync (POST)',
        cartes: '/api/external/cartes',
        stats: '/api/external/stats',
        modifications: '/api/external/modifications?site=...&derniereSync=...',
        sites: '/api/external/sites',
        diagnostic: '/api/external/diagnostic'
      }
    });
  } catch (error) {
    console.error('❌ Erreur diagnostic:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Export de la configuration
exports.API_CONFIG = API_CONFIG;