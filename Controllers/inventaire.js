const db = require('../db/db');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  defaultLimit: 50,
  maxLimit: 10000,           // Limite max pour les exports
  searchMinLength: 2,         // Longueur min pour recherche
  cacheTimeout: 300,          // Cache de 5 minutes pour les stats
  statsCache: null,
  statsCacheTime: null
};

// ============================================
// FONCTIONS UTILITAIRES DE FILTRAGE
// ============================================

/**
 * Ajoute le filtre de coordination à une requête SQL selon le rôle
 */
const ajouterFiltreCoordination = (req, query, params, colonne = 'coordination') => {
  const role = req.user?.role;
  const coordination = req.user?.coordination;
  
  // Admin voit tout
  if (role === 'Administrateur') {
    return { query, params };
  }
  
  // Gestionnaire et Chef d'équipe: filtrés par coordination
  if ((role === 'Gestionnaire' || role === "Chef d'équipe") && coordination) {
    return {
      query: query + ` AND ${colonne} = $${params.length + 1}`,
      params: [...params, coordination]
    };
  }
  
  // Opérateur: voit tout mais en lecture seule (pas de filtre)
  return { query, params };
};

/**
 * Vérifie si l'utilisateur peut voir les informations sensibles
 */
const peutVoirInfosSensibles = (req) => {
  return req.user?.role === 'Administrateur';
};

/**
 * Masque les informations sensibles selon le rôle
 */
const masquerInfosSensibles = (req, carte) => {
  if (!carte) return carte;
  
  const role = req.user?.role;
  
  // Admin voit tout
  if (role === 'Administrateur') {
    return carte;
  }
  
  // Créer une copie pour ne pas modifier l'original
  const carteMasquee = { ...carte };
  
  // Gestionnaire et Chef d'équipe: voient tout (pas d'infos ultra-sensibles dans l'inventaire)
  if (role === 'Gestionnaire' || role === "Chef d'équipe") {
    return carteMasquee;
  }
  
  // Opérateur: masquer certaines infos si nécessaire
  if (role === 'Opérateur') {
    // Par exemple, masquer les contacts partiellement
    if (carteMasquee.contact && carteMasquee.contact.length > 4) {
      carteMasquee.contact = carteMasquee.contact.slice(0, -4) + '****';
    }
    if (carteMasquee["CONTACT DE RETRAIT"] && carteMasquee["CONTACT DE RETRAIT"].length > 4) {
      carteMasquee["CONTACT DE RETRAIT"] = carteMasquee["CONTACT DE RETRAIT"].slice(0, -4) + '****';
    }
  }
  
  return carteMasquee;
};

/**
 * Masque les informations sensibles sur un tableau de cartes
 */
const masquerInfosSensiblesTableau = (req, cartes) => {
  if (!Array.isArray(cartes)) return cartes;
  return cartes.map(carte => masquerInfosSensibles(req, carte));
};

// ============================================
// CONTROLEUR D'INVENTAIRE OPTIMISÉ POUR LWS
// ============================================
const inventaireController = {
  
  /**
   * 🔍 RECHERCHE MULTICRITÈRES AVEC PAGINATION - OPTIMISÉE POUR LWS
   * GET /api/inventaire/recherche
   */
  rechercheCartes: async (req, res) => {
    try {
      const {
        nom,
        prenom, 
        contact,
        siteRetrait,
        lieuNaissance, 
        dateNaissance,
        rangement,
        delivrance,
        page = 1,
        limit = CONFIG.defaultLimit,
        export_all = 'false'
      } = req.query;

      console.log(`📦 Recherche par ${req.user.nomUtilisateur} (${req.user.role}):`, req.query);

      // ✅ PAGINATION ADAPTATIVE
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = export_all === 'true' 
        ? CONFIG.maxLimit 
        : Math.min(parseInt(limit), CONFIG.maxLimit);
      const offset = (pageNum - 1) * limitNum;

      // ✅ CONSTRUCTION DYNAMIQUE DE LA REQUÊTE
      let query = `SELECT 
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
      FROM cartes WHERE 1=1`;
      
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      const params = [];
      const countParams = [];
      let paramCount = 0;

      // 🔤 NOM (recherche partielle optimisée)
      if (nom && nom.trim() !== '' && nom.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND nom ILIKE $${paramCount}`;
        countQuery += ` AND nom ILIKE $${paramCount}`;
        params.push(`%${nom.trim()}%`);
        countParams.push(`%${nom.trim()}%`);
      }

      // 🔤 PRÉNOM (recherche partielle)  
      if (prenom && prenom.trim() !== '' && prenom.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND prenoms ILIKE $${paramCount}`;
        countQuery += ` AND prenoms ILIKE $${paramCount}`;
        params.push(`%${prenom.trim()}%`);
        countParams.push(`%${prenom.trim()}%`);
      }

      // 📞 CONTACT (recherche partielle - format téléphone)
      if (contact && contact.trim() !== '') {
        paramCount++;
        const contactClean = contact.trim().replace(/\D/g, '');
        query += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
        countQuery += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
        params.push(`%${contactClean}%`, `%${contact.trim()}%`);
        countParams.push(`%${contactClean}%`, `%${contact.trim()}%`);
        paramCount++;
      }

      // 🏢 SITE DE RETRAIT
      if (siteRetrait && siteRetrait.trim() !== '') {
        paramCount++;
        if (siteRetrait.includes(',')) {
          const sites = siteRetrait.split(',').map(s => s.trim());
          const siteParams = sites.map((_, idx) => `$${paramCount + idx}`).join(', ');
          query += ` AND "SITE DE RETRAIT" IN (${siteParams})`;
          countQuery += ` AND "SITE DE RETRAIT" IN (${siteParams})`;
          sites.forEach(site => {
            params.push(site);
            countParams.push(site);
          });
          paramCount += sites.length - 1;
        } else {
          query += ` AND "SITE DE RETRAIT" = $${paramCount}`;
          countQuery += ` AND "SITE DE RETRAIT" = $${paramCount}`;
          params.push(siteRetrait.trim());
          countParams.push(siteRetrait.trim());
        }
      }

      // 🗺️ LIEU DE NAISSANCE
      if (lieuNaissance && lieuNaissance.trim() !== '' && lieuNaissance.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
        countQuery += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
        params.push(`%${lieuNaissance.trim()}%`);
        countParams.push(`%${lieuNaissance.trim()}%`);
      }

      // 🎂 DATE DE NAISSANCE
      if (dateNaissance && dateNaissance.trim() !== '') {
        paramCount++;
        if (dateNaissance.includes(',')) {
          const [debut, fin] = dateNaissance.split(',').map(d => d.trim());
          query += ` AND "DATE DE NAISSANCE" BETWEEN $${paramCount} AND $${paramCount + 1}`;
          countQuery += ` AND "DATE DE NAISSANCE" BETWEEN $${paramCount} AND $${paramCount + 1}`;
          params.push(debut, fin);
          countParams.push(debut, fin);
          paramCount++;
        } else {
          query += ` AND "DATE DE NAISSANCE" = $${paramCount}`;
          countQuery += ` AND "DATE DE NAISSANCE" = $${paramCount}`;
          params.push(dateNaissance.trim());
          countParams.push(dateNaissance.trim());
        }
      }

      // 📦 RANGEMENT
      if (rangement && rangement.trim() !== '' && rangement.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND rangement ILIKE $${paramCount}`;
        countQuery += ` AND rangement ILIKE $${paramCount}`;
        params.push(`%${rangement.trim()}%`);
        countParams.push(`%${rangement.trim()}%`);
      }

      // ✅ FILTRE DÉLIVRANCE
      if (delivrance && delivrance.trim() !== '') {
        paramCount++;
        const delivValue = delivrance.trim().toUpperCase();
        if (delivValue === 'OUI' || delivValue === 'NON') {
          query += ` AND UPPER(delivrance) = $${paramCount}`;
          countQuery += ` AND UPPER(delivrance) = $${paramCount}`;
          params.push(delivValue);
          countParams.push(delivValue);
        }
      }

      // ✅ APPLIQUER LE FILTRE DE COORDINATION SELON LE RÔLE
      const filtreQuery = ajouterFiltreCoordination(req, query, params);
      const filtreCountQuery = ajouterFiltreCoordination(req, countQuery, countParams);

      // ✅ TRI INTELLIGENT
      filtreQuery.query += ` ORDER BY 
        CASE 
          WHEN "SITE DE RETRAIT" IS NULL THEN 1 
          ELSE 0 
        END,
        "SITE DE RETRAIT",
        nom,
        prenoms
      `;

      // ✅ PAGINATION
      if (export_all !== 'true') {
        filtreQuery.query += ` LIMIT $${filtreQuery.params.length + 1} OFFSET $${filtreQuery.params.length + 2}`;
        filtreQuery.params.push(limitNum, offset);
      }

      console.log('📋 Requête SQL:', filtreQuery.query);
      console.log('🔢 Paramètres:', filtreQuery.params);

      // 🗄️ EXÉCUTION DES REQUÊTES
      const startTime = Date.now();
      
      const result = await db.query(filtreQuery.query, filtreQuery.params);
      const countResult = await db.query(filtreCountQuery.query, filtreCountQuery.params);

      const duration = Date.now() - startTime;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limitNum);

      // 🔒 Masquer les informations sensibles selon le rôle
      const cartesMasquees = masquerInfosSensiblesTableau(req, result.rows);

      console.log(`✅ ${result.rows.length} cartes trouvées sur ${total} total (${duration}ms)`);
      
      // Headers pour export
      if (export_all === 'true') {
        res.setHeader('X-Total-Rows', total);
        res.setHeader('X-Query-Time', `${duration}ms`);
      }
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.json({
        success: true,
        cartes: cartesMasquees,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        performance: {
          queryTime: duration,
          returnedRows: result.rows.length
        },
        criteres: {
          nom: nom || null,
          prenom: prenom || null,
          contact: contact || null,
          siteRetrait: siteRetrait || null,
          lieuNaissance: lieuNaissance || null,
          dateNaissance: dateNaissance || null,
          rangement: rangement || null,
          delivrance: delivrance || null
        },
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur recherche:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la recherche',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  },

  /**
   * 📊 STATISTIQUES D'INVENTAIRE AVEC CACHE ET FILTRAGE PAR COORDINATION
   * GET /api/inventaire/stats
   */
  getStatistiques: async (req, res) => {
    try {
      const { forceRefresh } = req.query;
      
      // Vérifier le cache (5 minutes) - seulement pour Admin
      if (req.user.role === 'Administrateur' && 
          !forceRefresh && 
          CONFIG.statsCache && 
          CONFIG.statsCacheTime && 
          (Date.now() - CONFIG.statsCacheTime) < CONFIG.cacheTimeout * 1000) {
        console.log('📦 Stats servies depuis le cache');
        return res.json({
          success: true,
          ...CONFIG.statsCache,
          cached: true,
          cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime) / 1000) + 's'
        });
      }

      const startTime = Date.now();

      // Pour les gestionnaires, on filtre par coordination
      const role = req.user.role;
      const coordination = req.user.coordination;

      let totalQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let totalParams = [];
      
      let retiresQuery = `
        SELECT COUNT(*) as retires FROM cartes 
        WHERE delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON'
      `;
      let retiresParams = [];

      let sitesQuery = `
        SELECT 
          "SITE DE RETRAIT" as site,
          COUNT(*) as total,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as retires,
          COUNT(CASE WHEN delivrance IS NULL OR delivrance = '' OR UPPER(delivrance) = 'NON' THEN 1 END) as disponibles
        FROM cartes 
        WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      `;
      let sitesParams = [];

      let recentesQuery = `
        SELECT 
          id, 
          nom, 
          prenoms, 
          "SITE DE RETRAIT" as site,
          delivrance,
          coordination,
          TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
        FROM cartes 
        ORDER BY dateimport DESC 
        LIMIT 20
      `;
      let recentesParams = [];

      // Appliquer les filtres selon le rôle
      if (role === 'Gestionnaire' && coordination) {
        totalQuery += ` AND coordination = $1`;
        totalParams = [coordination];
        
        retiresQuery += ` AND coordination = $1`;
        retiresParams = [coordination];
        
        sitesQuery += ` AND coordination = $1`;
        sitesParams = [coordination];
        
        recentesQuery = `
          SELECT 
            id, 
            nom, 
            prenoms, 
            "SITE DE RETRAIT" as site,
            delivrance,
            coordination,
            TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
          FROM cartes 
          WHERE coordination = $1
          ORDER BY dateimport DESC 
          LIMIT 20
        `;
        recentesParams = [coordination];
      }

      // Exécuter les requêtes
      const totalResult = await db.query(totalQuery, totalParams);
      const retiresResult = await db.query(retiresQuery, retiresParams);
      const sitesResult = await db.query(sitesQuery + ' GROUP BY "SITE DE RETRAIT" ORDER BY total DESC', sitesParams);
      const recentesResult = await db.query(recentesQuery, recentesParams);

      // Statistiques temporelles (optionnellement filtrées)
      let temporelQuery = `
        SELECT 
          DATE_TRUNC('month', dateimport) as mois,
          COUNT(*) as total
        FROM cartes
        WHERE dateimport > NOW() - INTERVAL '6 months'
      `;
      let temporelParams = [];
      
      if (role === 'Gestionnaire' && coordination) {
        temporelQuery += ` AND coordination = $1`;
        temporelParams = [coordination];
      }
      
      temporelQuery += ' GROUP BY DATE_TRUNC(\'month\', dateimport) ORDER BY mois DESC';
      
      const temporelResult = await db.query(temporelQuery, temporelParams);

      const total = parseInt(totalResult.rows[0].total);
      const retires = parseInt(retiresResult.rows[0].retires);
      const disponibles = total - retires;
      const tauxRetrait = total > 0 ? Math.round((retires / total) * 100) : 0;

      const statsData = {
        statistiques: {
          global: {
            total,
            retires,
            disponibles,
            tauxRetrait
          },
          parSite: sitesResult.rows.map(site => ({
            ...site,
            tauxRetrait: site.total > 0 ? Math.round((site.retires / site.total) * 100) : 0
          })),
          recentes: masquerInfosSensiblesTableau(req, recentesResult.rows),
          temporel: temporelResult.rows
        },
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes'
        },
        performance: {
          queryTime: Date.now() - startTime
        },
        timestamp: new Date().toISOString()
      };

      // Mettre en cache seulement pour Admin
      if (role === 'Administrateur') {
        CONFIG.statsCache = statsData;
        CONFIG.statsCacheTime = Date.now();
      }

      res.json({
        success: true,
        ...statsData,
        cached: false
      });

    } catch (error) {
      console.error('❌ Erreur statistiques:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du calcul des statistiques',
        details: error.message,
        timestamp: new Date().toISOString()
      });
    }
  },

  /**
   * 🔍 RECHERCHE RAPIDE OPTIMISÉE AVEC FILTRE COORDINATION
   * GET /api/inventaire/recherche-rapide?q=terme
   */
  rechercheRapide: async (req, res) => {
    try {
      const { q, limit = 20 } = req.query;

      if (!q || q.trim() === '') {
        return res.json({
          success: true,
          resultats: [],
          total: 0
        });
      }

      if (q.trim().length < CONFIG.searchMinLength) {
        return res.json({
          success: true,
          resultats: [],
          total: 0,
          message: `Minimum ${CONFIG.searchMinLength} caractères requis`
        });
      }

      const searchTerm = `%${q.trim()}%`;
      const limitNum = Math.min(parseInt(limit), 100);

      const startTime = Date.now();

      // Construire la requête avec filtre de coordination
      let query = `
        SELECT 
          id,
          nom,
          prenoms,
          "SITE DE RETRAIT" as site,
          contact,
          delivrance,
          rangement,
          coordination,
          CASE 
            WHEN nom ILIKE $1 THEN 10
            WHEN prenoms ILIKE $1 THEN 9
            WHEN contact ILIKE $1 THEN 8
            WHEN "SITE DE RETRAIT" ILIKE $1 THEN 7
            WHEN "LIEU NAISSANCE" ILIKE $1 THEN 6
            WHEN rangement ILIKE $1 THEN 5
            ELSE 1
          END as pertinence
        FROM cartes 
        WHERE 
          (nom ILIKE $1 OR
          prenoms ILIKE $1 OR
          contact ILIKE $1 OR
          "SITE DE RETRAIT" ILIKE $1 OR
          "LIEU NAISSANCE" ILIKE $1 OR
          rangement ILIKE $1)
      `;

      const params = [searchTerm];
      
      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');
      
      filtreQuery.query += ' ORDER BY pertinence DESC, nom, prenoms LIMIT $' + (filtreQuery.params.length + 1);
      filtreQuery.params.push(limitNum);

      const result = await db.query(filtreQuery.query, filtreQuery.params);

      const duration = Date.now() - startTime;

      // Masquer les infos sensibles
      const resultatsMasques = masquerInfosSensiblesTableau(req, result.rows);

      res.json({
        success: true,
        resultats: resultatsMasques,
        total: result.rows.length,
        performance: {
          queryTime: duration
        },
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur recherche rapide:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la recherche rapide',
        details: error.message
      });
    }
  },

  /**
   * 📋 LISTE DES SITES AVEC STATISTIQUES (FILTRÉE PAR COORDINATION)
   * GET /api/inventaire/sites
   */
  getSites: async (req, res) => {
    try {
      const startTime = Date.now();

      let query = `
        SELECT 
          "SITE DE RETRAIT" as site,
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees,
          MIN(dateimport) as premier_import,
          MAX(dateimport) as dernier_import
        FROM cartes 
        WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
      `;

      let params = [];
      
      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');
      
      filtreQuery.query += ' GROUP BY "SITE DE RETRAIT" ORDER BY "SITE DE RETRAIT"';

      const result = await db.query(filtreQuery.query, filtreQuery.params);

      const sites = result.rows.map(row => ({
        ...row,
        taux_retrait: row.total_cartes > 0 
          ? Math.round((row.cartes_retirees / row.total_cartes) * 100) 
          : 0
      }));

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        sites,
        total: sites.length,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes'
        },
        performance: {
          queryTime: duration
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur récupération sites:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des sites',
        details: error.message
      });
    }
  },

  /**
   * 🎯 CARTES PAR SITE AVEC PAGINATION (FILTRÉE PAR COORDINATION)
   * GET /api/inventaire/site/:site
   */
  getCartesParSite: async (req, res) => {
    try {
      const { site } = req.params;
      const { page = 1, limit = CONFIG.defaultLimit, delivrance } = req.query;

      if (!site) {
        return res.status(400).json({
          success: false,
          error: 'Le paramètre site est obligatoire'
        });
      }

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(parseInt(limit), CONFIG.maxLimit);
      const offset = (pageNum - 1) * limitNum;

      const decodedSite = decodeURIComponent(site).replace(/\+/g, ' ').trim();

      let query = `
        SELECT 
          id,
          "LIEU D'ENROLEMENT",
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
          TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
        FROM cartes 
        WHERE "SITE DE RETRAIT" = $1
      `;

      const params = [decodedSite];
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE "SITE DE RETRAIT" = $1';
      const countParams = [decodedSite];

      // Filtre délivrance optionnel
      if (delivrance && delivrance.trim() !== '') {
        const delivValue = delivrance.trim().toUpperCase();
        if (delivValue === 'OUI' || delivValue === 'NON') {
          query += ` AND UPPER(delivrance) = $2`;
          countQuery += ` AND UPPER(delivrance) = $2`;
          params.push(delivValue);
          countParams.push(delivValue);
        }
      }

      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');
      const filtreCountQuery = ajouterFiltreCoordination(req, countQuery, countParams, 'coordination');

      // Tri et pagination
      filtreQuery.query += ` ORDER BY nom, prenoms LIMIT $${filtreQuery.params.length + 1} OFFSET $${filtreQuery.params.length + 2}`;
      filtreQuery.params.push(limitNum, offset);

      const startTime = Date.now();

      const result = await db.query(filtreQuery.query, filtreQuery.params);
      const countResult = await db.query(filtreCountQuery.query, filtreCountQuery.params);

      const duration = Date.now() - startTime;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limitNum);

      // Masquer les infos sensibles
      const cartesMasquees = masquerInfosSensiblesTableau(req, result.rows);

      res.json({
        success: true,
        cartes: cartesMasquees,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        site: decodedSite,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
          delivrance: delivrance || null
        },
        performance: {
          queryTime: duration
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur cartes par site:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des cartes par site',
        details: error.message
      });
    }
  },

  /**
   * 📊 STATISTIQUES DÉTAILLÉES PAR SITE (FILTRÉES PAR COORDINATION)
   * GET /api/inventaire/site/:site/stats
   */
  getSiteStats: async (req, res) => {
    try {
      const { site } = req.params;

      if (!site) {
        return res.status(400).json({
          success: false,
          error: 'Le paramètre site est obligatoire'
        });
      }

      const decodedSite = decodeURIComponent(site).replace(/\+/g, ' ').trim();

      let query = `
        SELECT 
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees,
          COUNT(CASE WHEN delivrance IS NULL OR delivrance = '' OR UPPER(delivrance) = 'NON' THEN 1 END) as cartes_disponibles,
          MIN(dateimport) as premier_import,
          MAX(dateimport) as dernier_import,
          COUNT(DISTINCT batch_id) as total_imports,
          COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days' THEN 1 END) as imports_7j
        FROM cartes 
        WHERE "SITE DE RETRAIT" = $1
      `;

      const params = [decodedSite];
      
      // Appliquer filtre de coordination
      const filtreQuery = ajouterFiltreCoordination(req, query, params, 'coordination');

      const result = await db.query(filtreQuery.query, filtreQuery.params);

      const stats = result.rows[0];
      stats.taux_retrait = stats.total_cartes > 0 
        ? Math.round((stats.cartes_retirees / stats.total_cartes) * 100) 
        : 0;

      res.json({
        success: true,
        site: decodedSite,
        statistiques: stats,
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes'
        },
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur stats site:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors de la récupération des statistiques du site',
        details: error.message
      });
    }
  },

  /**
   * 🔄 RAFRAÎCHIR LE CACHE DES STATISTIQUES (Admin uniquement)
   * POST /api/inventaire/cache/refresh
   */
  refreshCache: async (req, res) => {
    try {
      // Vérifier que l'utilisateur est admin (déjà fait par middleware)
      if (req.user.role !== 'Administrateur') {
        return res.status(403).json({
          success: false,
          error: 'Seuls les administrateurs peuvent rafraîchir le cache'
        });
      }

      // Vider le cache
      CONFIG.statsCache = null;
      CONFIG.statsCacheTime = null;
      
      // Recalculer les stats
      const stats = await inventaireController.getStatistiques(
        { query: { forceRefresh: true }, user: req.user }, 
        { json: (data) => data }
      );

      res.json({
        success: true,
        message: 'Cache rafraîchi avec succès',
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      console.error('❌ Erreur refresh cache:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur lors du rafraîchissement du cache',
        details: error.message
      });
    }
  },

  /**
   * 🔍 DIAGNOSTIC INVENTAIRE (Admin uniquement)
   * GET /api/inventaire/diagnostic
   */
  diagnostic: async (req, res) => {
    try {
      // Vérifier que l'utilisateur est admin
      if (req.user.role !== 'Administrateur') {
        return res.status(403).json({
          success: false,
          error: 'Seuls les administrateurs peuvent accéder au diagnostic'
        });
      }

      const startTime = Date.now();

      // Statistiques par coordination
      const coordinationStats = await db.query(`
        SELECT 
          coordination,
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees
        FROM cartes 
        WHERE coordination IS NOT NULL
        GROUP BY coordination
        ORDER BY total_cartes DESC
      `);

      // Compter les enregistrements
      const countResult = await db.query('SELECT COUNT(*) as total FROM cartes');
      const total = parseInt(countResult.rows[0].total);

      // Vérifier les index
      const indexResult = await db.query(`
        SELECT 
          indexname,
          indexdef
        FROM pg_indexes
        WHERE tablename = 'cartes'
      `);

      // Derniers imports
      const lastImport = await db.query(`
        SELECT 
          MAX(dateimport) as dernier_import,
          COUNT(DISTINCT batch_id) as total_batches
        FROM cartes
      `);

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'inventaire',
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination
        },
        database: {
          total_cartes: total,
          dernier_import: lastImport.rows[0].dernier_import,
          total_batches: parseInt(lastImport.rows[0].total_batches || 0)
        },
        coordination_stats: coordinationStats.rows,
        indexes: indexResult.rows.map(idx => ({
          name: idx.indexname,
          definition: idx.indexdef
        })),
        config: {
          defaultLimit: CONFIG.defaultLimit,
          maxLimit: CONFIG.maxLimit,
          searchMinLength: CONFIG.searchMinLength,
          cacheTimeout: CONFIG.cacheTimeout
        },
        performance: {
          queryTime: Date.now() - startTime
        },
        endpoints: [
          '/api/inventaire/recherche',
          '/api/inventaire/stats',
          '/api/inventaire/recherche-rapide',
          '/api/inventaire/sites',
          '/api/inventaire/site/:site',
          '/api/inventaire/site/:site/stats',
          '/api/inventaire/cache/refresh',
          '/api/inventaire/diagnostic'
        ]
      });

    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }
};

module.exports = inventaireController;