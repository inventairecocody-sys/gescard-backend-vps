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
        delivrance,           // Ajout du filtre délivrance
        page = 1,
        limit = CONFIG.defaultLimit,
        export_all = 'false'  // Pour les exports complets
      } = req.query;

      console.log('📦 Critères reçus:', req.query);

      // ✅ PAGINATION ADAPTATIVE
      const pageNum = Math.max(1, parseInt(page));
      // Pour LWS, on permet des limites plus grandes si export
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
        // Nettoyer le contact pour la recherche
        const contactClean = contact.trim().replace(/\D/g, '');
        query += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
        countQuery += ` AND (contact ILIKE $${paramCount} OR contact ILIKE $${paramCount + 1})`;
        params.push(`%${contactClean}%`, `%${contact.trim()}%`);
        countParams.push(`%${contactClean}%`, `%${contact.trim()}%`);
        paramCount++; // On a utilisé deux paramètres
      }

      // 🏢 SITE DE RETRAIT (recherche exacte ou partielle)
      if (siteRetrait && siteRetrait.trim() !== '') {
        paramCount++;
        // Si c'est un site exact (dans la liste des sites connus)
        if (siteRetrait.includes(',')) {
          // Plusieurs sites
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
          // Site unique
          query += ` AND "SITE DE RETRAIT" = $${paramCount}`;
          countQuery += ` AND "SITE DE RETRAIT" = $${paramCount}`;
          params.push(siteRetrait.trim());
          countParams.push(siteRetrait.trim());
        }
      }

      // 🗺️ LIEU DE NAISSANCE (recherche partielle)
      if (lieuNaissance && lieuNaissance.trim() !== '' && lieuNaissance.length >= CONFIG.searchMinLength) {
        paramCount++;
        query += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
        countQuery += ` AND "LIEU NAISSANCE" ILIKE $${paramCount}`;
        params.push(`%${lieuNaissance.trim()}%`);
        countParams.push(`%${lieuNaissance.trim()}%`);
      }

      // 🎂 DATE DE NAISSANCE (plage ou exacte)
      if (dateNaissance && dateNaissance.trim() !== '') {
        paramCount++;
        if (dateNaissance.includes(',')) {
          // Plage de dates
          const [debut, fin] = dateNaissance.split(',').map(d => d.trim());
          query += ` AND "DATE DE NAISSANCE" BETWEEN $${paramCount} AND $${paramCount + 1}`;
          countQuery += ` AND "DATE DE NAISSANCE" BETWEEN $${paramCount} AND $${paramCount + 1}`;
          params.push(debut, fin);
          countParams.push(debut, fin);
          paramCount++; // On a utilisé deux paramètres
        } else {
          // Date exacte
          query += ` AND "DATE DE NAISSANCE" = $${paramCount}`;
          countQuery += ` AND "DATE DE NAISSANCE" = $${paramCount}`;
          params.push(dateNaissance.trim());
          countParams.push(dateNaissance.trim());
        }
      }

      // 📦 RANGEMENT (recherche partielle)
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

      // ✅ TRI INTELLIGENT
      query += ` ORDER BY 
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
        query += ` LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
        params.push(limitNum, offset);
      }

      console.log('📋 Requête SQL:', query);
      console.log('🔢 Paramètres:', params);

      // 🗄️ EXÉCUTION DES REQUÊTES
      const startTime = Date.now();
      
      // Requête pour les données
      const result = await db.query(query, params);

      // Requête pour le total (sans pagination)
      const countResult = await db.query(countQuery, countParams);

      const duration = Date.now() - startTime;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limitNum);

      console.log(`✅ ${result.rows.length} cartes trouvées sur ${total} total (${duration}ms)`);
      
      // Debug IDs
      if (result.rows.length > 0) {
        console.log(`🔍 IDs: ${result.rows[0].id} ... ${result.rows[result.rows.length - 1].id}`);
      }

      // Headers pour export
      if (export_all === 'true') {
        res.setHeader('X-Total-Rows', total);
        res.setHeader('X-Query-Time', `${duration}ms`);
      }

      res.json({
        success: true,
        cartes: result.rows,
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
   * 📊 STATISTIQUES D'INVENTAIRE AVEC CACHE
   * GET /api/inventaire/stats
   */
  getStatistiques: async (req, res) => {
    try {
      const { forceRefresh } = req.query;
      
      // Vérifier le cache (5 minutes)
      if (!forceRefresh && 
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

      // Total des cartes
      const totalResult = await db.query('SELECT COUNT(*) as total FROM cartes');
      
      // Cartes retirées
      const retiresResult = await db.query(`
        SELECT COUNT(*) as retires FROM cartes 
        WHERE delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON'
      `);
      
      // Statistiques par site avec plus de détails
      const sitesResult = await db.query(`
        SELECT 
          "SITE DE RETRAIT" as site,
          COUNT(*) as total,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as retires,
          COUNT(CASE WHEN delivrance IS NULL OR delivrance = '' OR UPPER(delivrance) = 'NON' THEN 1 END) as disponibles,
          MIN(dateimport) as premier_import,
          MAX(dateimport) as dernier_import
        FROM cartes 
        WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
        GROUP BY "SITE DE RETRAIT"
        ORDER BY total DESC
      `);
      
      // Dernières cartes ajoutées
      const recentesResult = await db.query(`
        SELECT 
          id, 
          nom, 
          prenoms, 
          "SITE DE RETRAIT" as site,
          delivrance,
          TO_CHAR(dateimport, 'YYYY-MM-DD HH24:MI') as dateimport
        FROM cartes 
        ORDER BY dateimport DESC 
        LIMIT 20
      `);

      // Statistiques temporelles
      const temporelResult = await db.query(`
        SELECT 
          DATE_TRUNC('month', dateimport) as mois,
          COUNT(*) as total
        FROM cartes
        WHERE dateimport > NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', dateimport)
        ORDER BY mois DESC
      `);

      const total = parseInt(totalResult.rows[0].total);
      const retires = parseInt(retiresResult.rows[0].retires);
      const disponibles = total - retires;
      const tauxRetrait = total > 0 ? Math.round((retires / total) * 100) : 0;

      // Statistiques globales
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
          recentes: recentesResult.rows,
          temporel: temporelResult.rows
        },
        performance: {
          queryTime: Date.now() - startTime
        },
        timestamp: new Date().toISOString()
      };

      // Mettre en cache
      CONFIG.statsCache = statsData;
      CONFIG.statsCacheTime = Date.now();

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
   * 🔍 RECHERCHE RAPIDE OPTIMISÉE
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

      const result = await db.query(`
        SELECT 
          id,
          nom,
          prenoms,
          "SITE DE RETRAIT" as site,
          contact,
          delivrance,
          rangement,
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
          nom ILIKE $1 OR
          prenoms ILIKE $1 OR
          contact ILIKE $1 OR
          "SITE DE RETRAIT" ILIKE $1 OR
          "LIEU NAISSANCE" ILIKE $1 OR
          rangement ILIKE $1
        ORDER BY pertinence DESC, nom, prenoms
        LIMIT $2
      `, [searchTerm, limitNum]);

      const duration = Date.now() - startTime;

      res.json({
        success: true,
        resultats: result.rows,
        total: result.rows.length,
        performance: {
          queryTime: duration
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
   * 📋 LISTE DES SITES AVEC STATISTIQUES
   * GET /api/inventaire/sites
   */
  getSites: async (req, res) => {
    try {
      const startTime = Date.now();

      const result = await db.query(`
        SELECT 
          "SITE DE RETRAIT" as site,
          COUNT(*) as total_cartes,
          COUNT(CASE WHEN delivrance IS NOT NULL AND delivrance != '' AND UPPER(delivrance) != 'NON' THEN 1 END) as cartes_retirees,
          MIN(dateimport) as premier_import,
          MAX(dateimport) as dernier_import
        FROM cartes 
        WHERE "SITE DE RETRAIT" IS NOT NULL AND "SITE DE RETRAIT" != ''
        GROUP BY "SITE DE RETRAIT"
        ORDER BY "SITE DE RETRAIT"
      `);

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
   * 🎯 CARTES PAR SITE AVEC PAGINATION
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

      // Décoder le site
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

      // Tri et pagination
      query += ` ORDER BY nom, prenoms LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
      params.push(limitNum, offset);

      const startTime = Date.now();

      // Requête des données
      const result = await db.query(query, params);

      // Requête du total
      const countResult = await db.query(countQuery, countParams);

      const duration = Date.now() - startTime;
      const total = parseInt(countResult.rows[0].total);
      const totalPages = Math.ceil(total / limitNum);

      res.json({
        success: true,
        cartes: result.rows,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: total,
          totalPages: totalPages,
          hasNext: pageNum < totalPages,
          hasPrev: pageNum > 1
        },
        site: decodedSite,
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
   * 📊 STATISTIQUES DÉTAILLÉES PAR SITE
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

      const result = await db.query(`
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
      `, [decodedSite]);

      const stats = result.rows[0];
      stats.taux_retrait = stats.total_cartes > 0 
        ? Math.round((stats.cartes_retirees / stats.total_cartes) * 100) 
        : 0;

      res.json({
        success: true,
        site: decodedSite,
        statistiques: stats,
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
   * 🔄 RAFRAÎCHIR LE CACHE DES STATISTIQUES
   * POST /api/inventaire/cache/refresh
   */
  refreshCache: async (req, res) => {
    try {
      // Vider le cache
      CONFIG.statsCache = null;
      CONFIG.statsCacheTime = null;
      
      // Recalculer les stats
      const stats = await inventaireController.getStatistiques(
        { query: { forceRefresh: true } }, 
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
   * 🔍 DIAGNOSTIC INVENTAIRE
   * GET /api/inventaire/diagnostic
   */
  diagnostic: async (req, res) => {
    try {
      const startTime = Date.now();

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
        database: {
          total_cartes: total,
          dernier_import: lastImport.rows[0].dernier_import,
          total_batches: parseInt(lastImport.rows[0].total_batches || 0)
        },
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