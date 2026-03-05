// Controllers/statistiquesController.js

const db = require('../db/db');

// ============================================
// CONFIGURATION DU CACHE
// ============================================
const CACHE = {
  globales: { data: null, timestamp: null, key: null },
  sites: { data: null, timestamp: null, key: null },
  detail: { data: null, timestamp: null, key: null },
  TIMEOUT: 5 * 60 * 1000, // 5 minutes
};

// ============================================
// FONCTIONS UTILITAIRES PRIVÉES
// ============================================

/**
 * Vérifie si le cache est encore valide pour une clé donnée
 */
const isCacheValid = (cacheKey, key) => {
  const c = CACHE[cacheKey];
  if (!c || !c.timestamp) return false;
  if (c.key !== key) return false;
  return Date.now() - c.timestamp < CACHE.TIMEOUT;
};

/**
 * Génère la clé de cache selon le rôle et la coordination de l'utilisateur
 */
const getCacheKey = (user) => {
  if (user.role === 'Administrateur') return 'all';
  if (user.role === 'Gestionnaire') return `coord_${user.coordination_id}`;
  if (user.role === "Chef d'équipe") return `coord_${user.coordination_id}`;
  return `site_${user.agence}`;
};

/**
 * Construit le filtre WHERE selon le rôle de l'utilisateur
 *
 * Administrateur  → voit tout
 * Gestionnaire     → voit sa coordination uniquement
 * Chef d'équipe   → voit sa coordination uniquement
 * Opérateur       → voit son site uniquement
 */
const buildFiltreWhere = (user, params = [], baseWhere = 'WHERE 1=1') => {
  const role = user.role;

  if (role === 'Administrateur') {
    return { where: baseWhere, params };
  }

  if (role === 'Gestionnaire' || role === "Chef d'équipe") {
    if (user.coordination) {
      params = [...params, user.coordination];
      return {
        where: baseWhere + ` AND coordination = $${params.length}`,
        params,
      };
    }
  }

  if (role === 'Opérateur') {
    if (user.agence) {
      params = [...params, user.agence];
      return {
        where: baseWhere + ` AND "SITE DE RETRAIT" = $${params.length}`,
        params,
      };
    }
  }

  // Par défaut : aucune donnée si rôle non reconnu
  return { where: baseWhere + ` AND 1=0`, params };
};

/**
 * Formate une ligne de statistiques globales
 */
const formatGlobales = (row) => {
  const total = parseInt(row.total) || 0;
  const retires = parseInt(row.retires) || 0;
  return {
    total,
    retires,
    restants: total - retires,
    tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
  };
};

/**
 * Formate un tableau de lignes statistiques par site
 */
const formatSites = (rows) =>
  rows.map((row) => {
    const total = parseInt(row.total) || 0;
    const retires = parseInt(row.retires) || 0;
    return {
      site: row.site,
      total,
      retires,
      restants: total - retires,
      tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
    };
  });

/**
 * Calcule les totaux à partir d'un tableau de sites
 */
const calculerTotaux = (sites) => {
  const totals = sites.reduce(
    (acc, s) => ({
      total: acc.total + s.total,
      retires: acc.retires + s.retires,
      restants: acc.restants + s.restants,
    }),
    { total: 0, retires: 0, restants: 0 }
  );
  return {
    ...totals,
    tauxRetraitGlobal: totals.total > 0 ? Math.round((totals.retires / totals.total) * 100) : 0,
  };
};

// Condition SQL pour les cartes retirées
const CONDITION_RETIRES = `
  delivrance IS NOT NULL
  AND TRIM(COALESCE(delivrance, '')) != ''
  AND UPPER(delivrance) != 'NON'
`;

// ============================================
// CONTRÔLEUR
// ============================================
const statistiquesController = {
  /**
   * GET /api/statistiques/globales
   * Statistiques globales : total, retirés, restants, taux
   */
  async globales(req, res) {
    try {
      const { forceRefresh } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user);

      // Servir depuis le cache si valide
      if (!forceRefresh && isCacheValid('globales', cacheKey)) {
        return res.json({
          ...CACHE.globales.data,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.globales.timestamp) / 1000) + 's',
        });
      }

      const { where, params } = buildFiltreWhere(req.user, [], 'WHERE deleted_at IS NULL');

      const result = await db.query(
        `
        SELECT
          COUNT(*)                                           AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires,
          MIN(dateimport)                                    AS premiere_importation,
          MAX(dateimport)                                    AS derniere_importation,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_actifs,
          COUNT(DISTINCT nom)                                AS beneficiaires_uniques
        FROM cartes
        ${where}
      `,
        params
      );

      const stats = formatGlobales(result.rows[0]);
      const response = {
        ...stats,
        metadata: {
          premiere_importation: result.rows[0].premiere_importation,
          derniere_importation: result.rows[0].derniere_importation,
          sites_actifs: parseInt(result.rows[0].sites_actifs) || 0,
          beneficiaires_uniques: parseInt(result.rows[0].beneficiaires_uniques) || 0,
        },
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
      };

      // Mettre en cache
      CACHE.globales = { data: response, timestamp: Date.now(), key: cacheKey };

      res.json({
        ...response,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques globales:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/sites
   * Statistiques détaillées par site
   */
  async parSite(req, res) {
    try {
      const { forceRefresh, limit = 50 } = req.query;
      const startTime = Date.now();
      const actualLimit = Math.min(parseInt(limit), 200);
      const cacheKey = getCacheKey(req.user);

      // Servir depuis le cache si valide
      if (!forceRefresh && isCacheValid('sites', cacheKey)) {
        const cachedStats = CACHE.sites.data;
        return res.json({
          sites: cachedStats,
          totals: calculerTotaux(cachedStats),
          count: cachedStats.length,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.sites.timestamp) / 1000) + 's',
          filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        });
      }

      const { where, params } = buildFiltreWhere(
        req.user,
        [],
        `WHERE "SITE DE RETRAIT" IS NOT NULL
         AND TRIM(COALESCE("SITE DE RETRAIT", '')) != ''
         AND deleted_at IS NULL`
      );

      params.push(actualLimit);
      const result = await db.query(
        `
        SELECT
          "SITE DE RETRAIT"                                  AS site,
          COUNT(*)                                           AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires,
          MIN(dateimport)                                    AS premier_import,
          MAX(dateimport)                                    AS dernier_import,
          COUNT(DISTINCT nom)                                AS beneficiaires_uniques
        FROM cartes
        ${where}
        GROUP BY "SITE DE RETRAIT"
        ORDER BY total DESC
        LIMIT $${params.length}
      `,
        params
      );

      const stats = formatSites(result.rows);

      // Mettre en cache
      CACHE.sites = { data: stats, timestamp: Date.now(), key: cacheKey };

      res.json({
        sites: stats,
        totals: calculerTotaux(stats),
        count: stats.length,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques sites:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/detail
   * Statistiques complètes : globales + sites + évolution 30j
   */
  async detail(req, res) {
    try {
      const { forceRefresh } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user);

      if (!forceRefresh && isCacheValid('detail', cacheKey)) {
        return res.json({
          ...CACHE.detail.data,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.detail.timestamp) / 1000) + 's',
        });
      }

      const { where: whereGlobales, params: paramsGlobales } = buildFiltreWhere(
        req.user,
        [],
        'WHERE deleted_at IS NULL'
      );
      const { where: whereSites, params: paramsSites } = buildFiltreWhere(
        req.user,
        [],
        `WHERE "SITE DE RETRAIT" IS NOT NULL
         AND TRIM(COALESCE("SITE DE RETRAIT", '')) != ''
         AND deleted_at IS NULL`
      );
      const { where: whereEvol, params: paramsEvol } = buildFiltreWhere(
        req.user,
        [],
        `WHERE dateimport > NOW() - INTERVAL '30 days'
         AND deleted_at IS NULL`
      );

      const [globalesResult, sitesResult, evolutionResult] = await Promise.all([
        db.query(
          `
          SELECT
            COUNT(*)                                           AS total,
            COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires,
            MIN(dateimport)                                    AS premiere_importation,
            MAX(dateimport)                                    AS derniere_importation,
            COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_actifs,
            COUNT(DISTINCT nom)                                AS beneficiaires_uniques
          FROM cartes ${whereGlobales}
        `,
          paramsGlobales
        ),

        db.query(
          `
          SELECT
            "SITE DE RETRAIT"                                  AS site,
            COUNT(*)                                           AS total,
            COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)  AS retires
          FROM cartes
          ${whereSites}
          GROUP BY "SITE DE RETRAIT"
          ORDER BY total DESC
        `,
          paramsSites
        ),

        db.query(
          `
          SELECT
            DATE_TRUNC('day', dateimport)      AS jour,
            COUNT(*)                           AS imports,
            COUNT(DISTINCT "SITE DE RETRAIT")  AS sites_concernes
          FROM cartes
          ${whereEvol}
          GROUP BY DATE_TRUNC('day', dateimport)
          ORDER BY jour DESC
        `,
          paramsEvol
        ),
      ]);

      const globales = formatGlobales(globalesResult.rows[0]);
      const sites = formatSites(sitesResult.rows);

      const totalImports30j = evolutionResult.rows.reduce((acc, r) => acc + parseInt(r.imports), 0);

      const response = {
        globales: {
          ...globales,
          metadata: {
            premiere_importation: globalesResult.rows[0].premiere_importation,
            derniere_importation: globalesResult.rows[0].derniere_importation,
            sites_actifs: parseInt(globalesResult.rows[0].sites_actifs) || 0,
            beneficiaires_uniques: parseInt(globalesResult.rows[0].beneficiaires_uniques) || 0,
          },
        },
        sites,
        totaux_sites: calculerTotaux(sites),
        evolution: evolutionResult.rows.map((r) => ({
          jour: r.jour,
          imports: parseInt(r.imports),
          sites_concernes: parseInt(r.sites_concernes),
        })),
        resume: {
          total_sites: sites.length,
          total_imports_30j: totalImports30j,
          moyenne_quotidienne:
            evolutionResult.rows.length > 0
              ? Math.round(totalImports30j / evolutionResult.rows.length)
              : 0,
        },
        filtres: {
          role: req.user.role,
          coordination: req.user.coordination || 'toutes',
        },
      };

      CACHE.detail = { data: response, timestamp: Date.now(), key: cacheKey };

      res.json({
        ...response,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques détail:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/quick
   * Stats rapides pour tableaux de bord
   */
  async quick(req, res) {
    try {
      const { where, params } = buildFiltreWhere(req.user, [], 'WHERE deleted_at IS NULL');

      const result = await db.query(
        `
        SELECT
          COUNT(*)                                            AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)   AS retires,
          COUNT(CASE WHEN dateimport > NOW() - INTERVAL '24 hours' THEN 1 END) AS imports_24h,
          COUNT(CASE WHEN dateimport > NOW() - INTERVAL '7 days'   THEN 1 END) AS imports_7j,
          COUNT(CASE WHEN sync_status = 'pending'             THEN 1 END) AS en_attente_sync
        FROM cartes
        ${where}
      `,
        params
      );

      const s = result.rows[0];
      const total = parseInt(s.total) || 0;
      const retires = parseInt(s.retires) || 0;

      res.json({
        success: true,
        stats: {
          total,
          retires,
          restants: total - retires,
          tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
          imports_24h: parseInt(s.imports_24h) || 0,
          imports_7j: parseInt(s.imports_7j) || 0,
          en_attente_sync: parseInt(s.en_attente_sync) || 0,
        },
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats rapides:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/evolution
   * Évolution temporelle des imports
   */
  async evolution(req, res) {
    try {
      const { periode = 30, interval = 'day' } = req.query;
      const jours = Math.min(parseInt(periode), 365);

      const intervalSql = ['hour', 'week', 'month'].includes(interval) ? interval : 'day';

      const { where, params } = buildFiltreWhere(
        req.user,
        [intervalSql],
        `WHERE dateimport > NOW() - INTERVAL '${jours} days'
         AND deleted_at IS NULL`
      );

      const result = await db.query(
        `
        SELECT
          DATE_TRUNC($1, dateimport)         AS periode,
          COUNT(*)                           AS total_imports,
          COUNT(DISTINCT "SITE DE RETRAIT")  AS sites_actifs,
          COUNT(DISTINCT importbatchid)      AS batches
        FROM cartes
        ${where}
        GROUP BY DATE_TRUNC($1, dateimport)
        ORDER BY periode DESC
      `,
        params
      );

      res.json({
        success: true,
        evolution: result.rows.map((r) => ({
          periode: r.periode,
          imports: parseInt(r.total_imports),
          sites_actifs: parseInt(r.sites_actifs),
          batches: parseInt(r.batches),
        })),
        parametres: {
          periode_jours: jours,
          intervalle: interval,
          points: result.rows.length,
          filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur évolution:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/imports
   * Statistiques par lot d'import
   */
  async parImport(req, res) {
    try {
      const { limit = 10 } = req.query;
      const actualLimit = Math.min(parseInt(limit), 50);

      const { where, params } = buildFiltreWhere(
        req.user,
        [],
        'WHERE importbatchid IS NOT NULL AND deleted_at IS NULL'
      );

      params.push(actualLimit);
      const result = await db.query(
        `
        SELECT
          importbatchid,
          COUNT(*)                                            AS total_cartes,
          MIN(dateimport)                                     AS date_debut,
          MAX(dateimport)                                     AS date_fin,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)   AS cartes_retirees,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_concernes,
          MIN(coordination)                                   AS coordination
        FROM cartes
        ${where}
        GROUP BY importbatchid
        ORDER BY date_debut DESC
        LIMIT $${params.length}
      `,
        params
      );

      res.json({
        success: true,
        imports: result.rows.map((r) => {
          const total = parseInt(r.total_cartes);
          const retires = parseInt(r.cartes_retirees);
          return {
            batch_id: r.importbatchid,
            total_cartes: total,
            cartes_retirees: retires,
            taux_retrait: total > 0 ? Math.round((retires / total) * 100) : 0,
            date_debut: r.date_debut,
            date_fin: r.date_fin,
            sites_concernes: parseInt(r.sites_concernes),
            coordination: r.coordination,
            duree_minutes:
              r.date_debut && r.date_fin
                ? Math.round((new Date(r.date_fin) - new Date(r.date_debut)) / 60000)
                : 0,
          };
        }),
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats imports:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/coordinations
   * Statistiques par coordination (Administrateur uniquement)
   */
  async parCoordination(req, res) {
    try {
      if (req.user.role !== 'Administrateur') {
        return res.status(403).json({
          success: false,
          error: 'Accès réservé aux Administrateurs',
        });
      }

      const result = await db.query(`
        SELECT
          coordination,
          COUNT(*)                                            AS total,
          COUNT(CASE WHEN ${CONDITION_RETIRES} THEN 1 END)   AS retires,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS nb_sites,
          COUNT(DISTINCT nom)                                AS beneficiaires_uniques
        FROM cartes
        WHERE deleted_at IS NULL
        AND coordination IS NOT NULL
        GROUP BY coordination
        ORDER BY total DESC
      `);

      const coordinations = result.rows.map((r) => {
        const total = parseInt(r.total) || 0;
        const retires = parseInt(r.retires) || 0;
        return {
          coordination: r.coordination,
          total,
          retires,
          restants: total - retires,
          tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
          nb_sites: parseInt(r.nb_sites) || 0,
          beneficiaires_uniques: parseInt(r.beneficiaires_uniques) || 0,
        };
      });

      res.json({
        success: true,
        coordinations,
        total_global: calculerTotaux(coordinations),
        count: coordinations.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats coordinations:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * POST /api/statistiques/refresh
   * Vider le cache manuellement
   */
  async refresh(req, res) {
    try {
      CACHE.globales = { data: null, timestamp: null, key: null };
      CACHE.sites = { data: null, timestamp: null, key: null };
      CACHE.detail = { data: null, timestamp: null, key: null };

      console.log('🔄 Cache statistiques vidé par:', req.user?.nomUtilisateur);

      res.json({
        success: true,
        message: 'Cache vidé avec succès',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur refresh:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  /**
   * GET /api/statistiques/diagnostic
   * Diagnostic complet du module (Administrateur uniquement)
   */
  async diagnostic(req, res) {
    try {
      const startTime = Date.now();

      const result = await db.query(`
        SELECT
          COUNT(*)                           AS total_cartes,
          COUNT(DISTINCT "SITE DE RETRAIT")  AS sites_distincts,
          COUNT(DISTINCT importbatchid)      AS batches_distincts,
          COUNT(DISTINCT coordination)       AS coordinations_distinctes,
          COUNT(CASE WHEN deleted_at IS NOT NULL THEN 1 END) AS cartes_supprimees,
          COUNT(CASE WHEN sync_status = 'pending' THEN 1 END) AS cartes_pending,
          MIN(dateimport)                    AS premiere_carte,
          MAX(dateimport)                    AS derniere_carte,
          MAX(sync_timestamp)                AS derniere_sync,
          pg_size_pretty(pg_total_relation_size('cartes')) AS table_size_pretty,
          pg_total_relation_size('cartes')   AS table_size
        FROM cartes
      `);

      const s = result.rows[0];

      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'statistiques',
        utilisateur: {
          role: req.user.role,
          coordination: req.user.coordination,
        },
        statistiques: {
          total_cartes: parseInt(s.total_cartes),
          cartes_supprimees: parseInt(s.cartes_supprimees),
          cartes_en_attente_sync: parseInt(s.cartes_pending),
          sites_distincts: parseInt(s.sites_distincts),
          batches_distincts: parseInt(s.batches_distincts),
          coordinations_distinctes: parseInt(s.coordinations_distinctes),
          premiere_carte: s.premiere_carte,
          derniere_carte: s.derniere_carte,
          derniere_sync: s.derniere_sync,
        },
        stockage: {
          taille_table: s.table_size_pretty,
          taille_bytes: parseInt(s.table_size),
        },
        cache: {
          globales: CACHE.globales.timestamp ? 'actif' : 'inactif',
          sites: CACHE.sites.timestamp ? 'actif' : 'inactif',
          detail: CACHE.detail.timestamp ? 'actif' : 'inactif',
          timeout: '5 minutes',
        },
        performance: { queryTime: Date.now() - startTime },
      });
    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
};

module.exports = statistiquesController;
