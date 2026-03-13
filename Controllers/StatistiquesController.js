// Controllers/statistiquesController.js

const db = require('../db/db');

// ============================================
// CONFIGURATION DU CACHE
// ============================================
const CACHE = {
  globales: { data: null, timestamp: null, key: null },
  sites: { data: null, timestamp: null, key: null },
  detail: { data: null, timestamp: null, key: null },
  agences: { data: null, timestamp: null, key: null },
  coordinations: { data: null, timestamp: null, key: null },
  temporel: { data: null, timestamp: null, key: null },
  TIMEOUT: 5 * 60 * 1000, // 5 minutes
};

// ============================================
// FONCTIONS UTILITAIRES PRIVÉES
// ============================================

const isCacheValid = (cacheKey, key) => {
  const c = CACHE[cacheKey];
  if (!c || !c.timestamp) return false;
  if (c.key !== key) return false;
  return Date.now() - c.timestamp < CACHE.TIMEOUT;
};

const getCacheKey = (user) => {
  if (user.role === 'Administrateur') return 'all';
  if (user.role === 'Gestionnaire') return `coord_${user.coordination_id}`;
  if (user.role === "Chef d'équipe") return `agence_${user.agence_id}`;
  return `site_${user.agence}`;
};

/**
 * Construit le filtre WHERE selon le rôle
 * Administrateur → tout
 * Gestionnaire / Chef d'équipe → sa coordination
 * Opérateur → son site
 */
const buildFiltreWhere = (user, params = [], baseWhere = 'WHERE 1=1') => {
  const role = user.role;

  if (role === 'Administrateur') return { where: baseWhere, params };

  if (role === 'Gestionnaire' || role === "Chef d'équipe") {
    if (user.coordination) {
      params = [...params, user.coordination];
      return { where: baseWhere + ` AND coordination = $${params.length}`, params };
    }
  }

  if (role === 'Opérateur') {
    if (user.agence) {
      params = [...params, user.agence];
      return { where: baseWhere + ` AND "SITE DE RETRAIT" = $${params.length}`, params };
    }
  }

  return { where: baseWhere + ` AND 1=0`, params };
};

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

const formatSites = (rows) =>
  rows.map((row) => {
    const total = parseInt(row.total) || 0;
    const retires = parseInt(row.retires) || 0;
    return {
      site: row.site,
      coordination: row.coordination || null,
      total,
      retires,
      restants: total - retires,
      tauxRetrait: total > 0 ? Math.round((retires / total) * 100) : 0,
    };
  });

const calculerTotaux = (items, keyTotal = 'total', keyRetires = 'retires') => {
  const t = items.reduce(
    (acc, s) => ({
      total: acc.total + (parseInt(s[keyTotal]) || 0),
      retires: acc.retires + (parseInt(s[keyRetires]) || 0),
      restants: acc.restants + (parseInt(s.restants) || 0),
    }),
    { total: 0, retires: 0, restants: 0 }
  );
  return { ...t, tauxRetrait: t.total > 0 ? Math.round((t.retires / t.total) * 100) : 0 };
};

// Condition SQL : carte retirée = delivrance renseigné et différent de NON
const CONDITION_RETIRES = `
  delivrance IS NOT NULL
  AND TRIM(COALESCE(delivrance, '')) != ''
  AND UPPER(TRIM(delivrance)) != 'NON'
`;

// Condition SQL : carte retirée avec date valide
const CONDITION_RETIRES_AVEC_DATE = `
  delivrance IS NOT NULL
  AND TRIM(COALESCE(delivrance, '')) != ''
  AND UPPER(TRIM(delivrance)) != 'NON'
  AND "DATE DE DELIVRANCE" IS NOT NULL
`;

// ============================================
// CONTRÔLEUR
// ============================================
const statistiquesController = {
  // ─────────────────────────────────────────
  // GET /api/statistiques/globales
  // ─────────────────────────────────────────
  async globales(req, res) {
    try {
      const { forceRefresh } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user);

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
          COUNT(*)                                                      AS total,
          COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})                  AS retires,
          COUNT(DISTINCT "SITE DE RETRAIT")                             AS sites_actifs,
          COUNT(DISTINCT coordination)                                  AS nb_coordinations,
          MIN("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS premier_retrait,
          MAX("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS dernier_retrait,
          MIN(dateimport)                                               AS premiere_importation,
          MAX(dateimport)                                               AS derniere_importation
        FROM cartes
        ${where}
      `,
        params
      );

      const row = result.rows[0];
      const stats = formatGlobales(row);

      const response = {
        ...stats,
        metadata: {
          sites_actifs: parseInt(row.sites_actifs) || 0,
          nb_coordinations: parseInt(row.nb_coordinations) || 0,
          premier_retrait: row.premier_retrait,
          dernier_retrait: row.dernier_retrait,
          premiere_importation: row.premiere_importation,
          derniere_importation: row.derniere_importation,
        },
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
      };

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

  // ─────────────────────────────────────────
  // GET /api/statistiques/sites
  // ─────────────────────────────────────────
  async parSite(req, res) {
    try {
      const { forceRefresh, limit = 200 } = req.query;
      const startTime = Date.now();
      const actualLimit = Math.min(parseInt(limit), 500);
      const cacheKey = getCacheKey(req.user);

      if (!forceRefresh && isCacheValid('sites', cacheKey)) {
        const cached = CACHE.sites.data;
        return res.json({
          sites: cached,
          totals: calculerTotaux(cached),
          count: cached.length,
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
          "SITE DE RETRAIT"                                             AS site,
          coordination,
          COUNT(*)                                                      AS total,
          COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})                  AS retires,
          MIN("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS premier_retrait,
          MAX("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS dernier_retrait
        FROM cartes
        ${where}
        GROUP BY "SITE DE RETRAIT", coordination
        ORDER BY total DESC
        LIMIT $${params.length}
      `,
        params
      );

      const stats = formatSites(result.rows);
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

  // ─────────────────────────────────────────
  // GET /api/statistiques/coordinations
  // Statistiques par coordination + classement
  // ─────────────────────────────────────────
  async parCoordination(req, res) {
    try {
      const { forceRefresh } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user);

      if (!forceRefresh && isCacheValid('coordinations', cacheKey)) {
        return res.json({
          ...CACHE.coordinations.data,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.coordinations.timestamp) / 1000) + 's',
        });
      }

      // Filtre rôle : admin → tout, gestionnaire → sa coordination
      let whereCoord = `WHERE c.deleted_at IS NULL`;
      const params = [];

      if (req.user.role === 'Gestionnaire' && req.user.coordination_id) {
        params.push(req.user.coordination_id);
        whereCoord += ` AND c.id = $${params.length}`;
      } else if (req.user.role !== 'Administrateur') {
        return res.status(403).json({ success: false, error: 'Accès non autorisé' });
      }

      const result = await db.query(
        `
        SELECT
          c.id                                                          AS coordination_id,
          c.nom                                                         AS coordination_nom,
          COUNT(DISTINCT k."SITE DE RETRAIT")                           AS nb_sites,
          COUNT(k.id)                                                   AS total_cartes,
          COUNT(k.id) FILTER (WHERE ${CONDITION_RETIRES.replace(/\n/g, ' ')}) AS cartes_retirees,
          MIN(k."DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE.replace(/\n/g, ' ')}) AS premier_retrait,
          MAX(k."DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE.replace(/\n/g, ' ')}) AS dernier_retrait
        FROM coordinations c
        LEFT JOIN cartes k
          ON LOWER(TRIM(k.coordination)) = LOWER(TRIM(c.nom))
         AND k.deleted_at IS NULL
        ${whereCoord}
        GROUP BY c.id, c.nom
        ORDER BY total_cartes DESC
      `,
        params
      );

      const coordinations = result.rows.map((r, i) => {
        const total = parseInt(r.total_cartes) || 0;
        const retires = parseInt(r.cartes_retirees) || 0;
        return {
          coordination_id: r.coordination_id,
          coordination_nom: r.coordination_nom,
          nb_sites: parseInt(r.nb_sites) || 0,
          total_cartes: total,
          cartes_retirees: retires,
          cartes_restantes: total - retires,
          taux_retrait: total > 0 ? Math.round((retires / total) * 100) : 0,
          premier_retrait: r.premier_retrait,
          dernier_retrait: r.dernier_retrait,
          rang: i + 1,
        };
      });

      // Classement par taux de retrait
      const classement = [...coordinations]
        .sort((a, b) => b.taux_retrait - a.taux_retrait)
        .map((c, i) => ({ ...c, rang_taux: i + 1 }));

      const totaux = coordinations.reduce(
        (acc, c) => ({
          total_cartes: acc.total_cartes + c.total_cartes,
          cartes_retirees: acc.cartes_retirees + c.cartes_retirees,
          cartes_restantes: acc.cartes_restantes + c.cartes_restantes,
        }),
        { total_cartes: 0, cartes_retirees: 0, cartes_restantes: 0 }
      );

      totaux.taux_retrait =
        totaux.total_cartes > 0
          ? Math.round((totaux.cartes_retirees / totaux.total_cartes) * 100)
          : 0;

      const response = {
        success: true,
        coordinations,
        classement,
        totaux,
        count: coordinations.length,
        filtres: { role: req.user.role },
      };

      CACHE.coordinations = { data: response, timestamp: Date.now(), key: cacheKey };
      res.json({
        ...response,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur stats coordinations:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─────────────────────────────────────────
  // GET /api/statistiques/agences
  // Statistiques par agence
  // ─────────────────────────────────────────
  async parAgence(req, res) {
    try {
      const { forceRefresh, coordination_id } = req.query;
      const startTime = Date.now();
      const cacheKey = getCacheKey(req.user) + (coordination_id ? `_c${coordination_id}` : '');

      if (!forceRefresh && isCacheValid('agences', cacheKey)) {
        return res.json({
          ...CACHE.agences.data,
          cached: true,
          cacheAge: Math.round((Date.now() - CACHE.agences.timestamp) / 1000) + 's',
        });
      }

      const { role, coordination_id: userCoordId, agence_id } = req.user;

      let whereAgence = 'WHERE a.is_active = true';
      const params = [];

      // Filtre par coordination passé en query (drill-down depuis niveau global)
      if (coordination_id) {
        params.push(parseInt(coordination_id));
        whereAgence += ` AND a.coordination_id = $${params.length}`;
      } else if (role === 'Gestionnaire' && userCoordId) {
        params.push(userCoordId);
        whereAgence += ` AND a.coordination_id = $${params.length}`;
      } else if (role === "Chef d'équipe" && agence_id) {
        params.push(agence_id);
        whereAgence += ` AND a.id = $${params.length}`;
      }

      const result = await db.query(
        `
        SELECT
          a.id                                                           AS agence_id,
          a.nom                                                          AS agence_nom,
          c.id                                                           AS coordination_id,
          c.nom                                                          AS coordination_nom,
          COUNT(DISTINCT s.id)                                           AS nombre_sites,
          COUNT(DISTINCT s.id) FILTER (WHERE s.is_active = true)         AS sites_actifs,
          COALESCE(SUM(stats.total_cartes),     0)                        AS total_cartes,
          COALESCE(SUM(stats.cartes_retirees),  0)                        AS cartes_retirees,
          COALESCE(SUM(stats.cartes_restantes), 0)                        AS cartes_restantes,
          ROUND(
            CASE WHEN COALESCE(SUM(stats.total_cartes), 0) > 0
            THEN SUM(stats.cartes_retirees)::numeric / SUM(stats.total_cartes)::numeric * 100
            ELSE 0 END, 1
          )                                                              AS taux_retrait,
          COUNT(DISTINCT u.id) FILTER (WHERE u.actif = true)             AS nombre_agents
        FROM agences a
        LEFT JOIN coordinations c   ON c.id = a.coordination_id
        LEFT JOIN sites s           ON s.agence_id = a.id
        LEFT JOIN (
          SELECT
            s2.id                                                        AS site_id,
            COUNT(*)                                                      AS total_cartes,
            COUNT(*) FILTER (WHERE ${CONDITION_RETIRES.replace(/\n/g, ' ')}) AS cartes_retirees,
            COUNT(*) FILTER (WHERE NOT (${CONDITION_RETIRES.replace(/\n/g, ' ')})) AS cartes_restantes
          FROM sites s2
          JOIN cartes k ON LOWER(TRIM(k."SITE DE RETRAIT")) = LOWER(TRIM(s2.nom))
          WHERE k.deleted_at IS NULL
          GROUP BY s2.id
        ) stats ON stats.site_id = s.id
        LEFT JOIN utilisateurs u ON u.agence_id = a.id
        ${whereAgence}
        GROUP BY a.id, a.nom, c.id, c.nom
        ORDER BY c.nom NULLS LAST, total_cartes DESC
      `,
        params
      );

      const agences = result.rows.map((r, i) => {
        const total = parseInt(r.total_cartes) || 0;
        const retires = parseInt(r.cartes_retirees) || 0;
        return {
          agence_id: parseInt(r.agence_id),
          agence_nom: r.agence_nom,
          coordination_id: r.coordination_id,
          coordination_nom: r.coordination_nom || 'Non définie',
          nombre_sites: parseInt(r.nombre_sites) || 0,
          sites_actifs: parseInt(r.sites_actifs) || 0,
          nombre_agents: parseInt(r.nombre_agents) || 0,
          total_cartes: total,
          cartes_retirees: retires,
          cartes_restantes: total - retires,
          taux_retrait: parseFloat(r.taux_retrait) || 0,
          rang: i + 1,
        };
      });

      // Classement par taux de retrait
      const classement = [...agences]
        .sort((a, b) => b.taux_retrait - a.taux_retrait)
        .map((a, i) => ({ ...a, rang_taux: i + 1 }));

      const totaux = agences.reduce(
        (acc, a) => ({
          total_cartes: acc.total_cartes + a.total_cartes,
          cartes_retirees: acc.cartes_retirees + a.cartes_retirees,
          cartes_restantes: acc.cartes_restantes + a.cartes_restantes,
          nombre_sites: acc.nombre_sites + a.nombre_sites,
          nombre_agents: acc.nombre_agents + a.nombre_agents,
        }),
        {
          total_cartes: 0,
          cartes_retirees: 0,
          cartes_restantes: 0,
          nombre_sites: 0,
          nombre_agents: 0,
        }
      );

      totaux.taux_retrait =
        totaux.total_cartes > 0
          ? Math.round((totaux.cartes_retirees / totaux.total_cartes) * 100)
          : 0;

      const response = {
        success: true,
        agences,
        classement,
        totaux,
        count: agences.length,
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
      };

      CACHE.agences = { data: response, timestamp: Date.now(), key: cacheKey };
      res.json({
        ...response,
        cached: false,
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur statistiques agences:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─────────────────────────────────────────
  // GET /api/statistiques/temporel
  // Évolution des retraits par jour / semaine / mois
  // Basé sur "DATE DE DELIVRANCE" (date réelle du retrait)
  //
  // Query params :
  //   granularite  = jour | semaine | mois (défaut: mois)
  //   niveau       = global | coordination | agence | site (défaut: global)
  //   id           = valeur du filtre (coordination_id, agence_id, nom du site)
  //   periodes     = nombre de périodes à retourner (défaut: 12)
  // ─────────────────────────────────────────
  async temporel(req, res) {
    try {
      const { granularite = 'mois', niveau = 'global', id, periodes = 12 } = req.query;

      const startTime = Date.now();
      const nbPeriodes = Math.min(parseInt(periodes) || 12, 60);

      // Mapping granularité → SQL DATE_TRUNC
      const granulariteMap = { jour: 'day', semaine: 'week', mois: 'month' };
      const truncSql = granulariteMap[granularite] || 'month';

      // Intervalle de données à récupérer
      const intervalleMap = { jour: '90 days', semaine: '52 weeks', mois: '36 months' };
      const intervalleSql = intervalleMap[granularite] || '36 months';

      // Construction du WHERE
      let whereParts = [
        `deleted_at IS NULL`,
        `${CONDITION_RETIRES_AVEC_DATE}`,
        `"DATE DE DELIVRANCE" >= NOW() - INTERVAL '${intervalleSql}'`,
      ];
      const params = [];

      // Filtre selon le rôle utilisateur (sécurité)
      const { role, coordination, agence } = req.user;

      if (role === 'Gestionnaire' || role === "Chef d'équipe") {
        if (coordination) {
          params.push(coordination);
          whereParts.push(`coordination = $${params.length}`);
        }
      } else if (role === 'Opérateur') {
        if (agence) {
          params.push(agence);
          whereParts.push(`"SITE DE RETRAIT" = $${params.length}`);
        }
      }

      // Filtre selon le niveau demandé (drill-down)
      if (niveau === 'coordination' && id) {
        // id = coordination_id → on joint avec la table coordinations pour avoir le nom
        params.push(parseInt(id));
        whereParts.push(`coordination_id = $${params.length}`);
      } else if (niveau === 'agence' && id) {
        // id = agence_id → on passe par les sites de l'agence
        params.push(parseInt(id));
        whereParts.push(`
          "SITE DE RETRAIT" IN (
            SELECT nom FROM sites WHERE agence_id = $${params.length} AND deleted_at IS NULL
          )
        `);
      } else if (niveau === 'site' && id) {
        params.push(id);
        whereParts.push(`"SITE DE RETRAIT" = $${params.length}`);
      }

      const whereClause = 'WHERE ' + whereParts.join(' AND ');

      params.push(nbPeriodes);
      const result = await db.query(
        `
        SELECT
          DATE_TRUNC('${truncSql}', "DATE DE DELIVRANCE")   AS periode,
          COUNT(*)                                           AS nb_retraits,
          COUNT(DISTINCT "SITE DE RETRAIT")                  AS sites_actifs,
          COUNT(DISTINCT coordination)                       AS coordinations_actives
        FROM cartes
        ${whereClause}
        GROUP BY DATE_TRUNC('${truncSql}', "DATE DE DELIVRANCE")
        ORDER BY periode DESC
        LIMIT $${params.length}
      `,
        params
      );

      // Remettre dans l'ordre chronologique + calculer cumul
      const rows = result.rows.reverse();
      let cumul = 0;
      const evolution = rows.map((r) => {
        const nb = parseInt(r.nb_retraits) || 0;
        cumul += nb;
        return {
          periode: r.periode,
          nb_retraits: nb,
          sites_actifs: parseInt(r.sites_actifs) || 0,
          coordinations_actives: parseInt(r.coordinations_actives) || 0,
          cumul_retraits: cumul,
        };
      });

      // Calcul de la tendance (variation dernière période vs avant-dernière)
      let tendance = null;
      if (evolution.length >= 2) {
        const last = evolution[evolution.length - 1].nb_retraits;
        const previous = evolution[evolution.length - 2].nb_retraits;
        tendance = {
          valeur: last - previous,
          pourcentage: previous > 0 ? Math.round(((last - previous) / previous) * 100) : null,
          direction: last > previous ? 'hausse' : last < previous ? 'baisse' : 'stable',
        };
      }

      res.json({
        success: true,
        evolution,
        tendance,
        parametres: { granularite, niveau, id: id || null, periodes: nbPeriodes },
        performance: { queryTime: Date.now() - startTime },
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur temporel:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },

  // ─────────────────────────────────────────
  // GET /api/statistiques/quick
  // ─────────────────────────────────────────
  async quick(req, res) {
    try {
      const { where, params } = buildFiltreWhere(req.user, [], 'WHERE deleted_at IS NULL');

      const result = await db.query(
        `
        SELECT
          COUNT(*)                                                                AS total,
          COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})                            AS retires,
          COUNT(*) FILTER (WHERE "DATE DE DELIVRANCE" >= CURRENT_DATE - 1)        AS retraits_24h,
          COUNT(*) FILTER (WHERE "DATE DE DELIVRANCE" >= CURRENT_DATE - 7)        AS retraits_7j,
          COUNT(*) FILTER (WHERE DATE_TRUNC('month',"DATE DE DELIVRANCE") = DATE_TRUNC('month',CURRENT_DATE)) AS retraits_ce_mois,
          COUNT(*) FILTER (WHERE sync_status = 'pending')                         AS en_attente_sync
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
          retraits_24h: parseInt(s.retraits_24h) || 0,
          retraits_7j: parseInt(s.retraits_7j) || 0,
          retraits_ce_mois: parseInt(s.retraits_ce_mois) || 0,
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

  // ─────────────────────────────────────────
  // GET /api/statistiques/detail
  // ─────────────────────────────────────────
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

      const { where: wGlob, params: pGlob } = buildFiltreWhere(
        req.user,
        [],
        'WHERE deleted_at IS NULL'
      );
      const { where: wSite, params: pSite } = buildFiltreWhere(
        req.user,
        [],
        `WHERE "SITE DE RETRAIT" IS NOT NULL AND TRIM(COALESCE("SITE DE RETRAIT",''))!='' AND deleted_at IS NULL`
      );

      const [globRes, siteRes] = await Promise.all([
        db.query(
          `
          SELECT
            COUNT(*)                                                          AS total,
            COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})                      AS retires,
            COUNT(DISTINCT "SITE DE RETRAIT")                                 AS sites_actifs,
            MIN("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS premier_retrait,
            MAX("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS dernier_retrait
          FROM cartes ${wGlob}
        `,
          pGlob
        ),
        db.query(
          `
          SELECT
            "SITE DE RETRAIT"                                                 AS site,
            coordination,
            COUNT(*)                                                          AS total,
            COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})                      AS retires
          FROM cartes ${wSite}
          GROUP BY "SITE DE RETRAIT", coordination
          ORDER BY total DESC
        `,
          pSite
        ),
      ]);

      const globales = formatGlobales(globRes.rows[0]);
      const sites = formatSites(siteRes.rows);

      const response = {
        globales: {
          ...globales,
          metadata: {
            sites_actifs: parseInt(globRes.rows[0].sites_actifs) || 0,
            premier_retrait: globRes.rows[0].premier_retrait,
            dernier_retrait: globRes.rows[0].dernier_retrait,
          },
        },
        sites,
        totaux_sites: calculerTotaux(sites),
        filtres: { role: req.user.role, coordination: req.user.coordination || 'toutes' },
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

  // ─────────────────────────────────────────
  // GET /api/statistiques/imports
  // ─────────────────────────────────────────
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
          COUNT(*)                                               AS total_cartes,
          MIN(dateimport)                                        AS date_debut,
          MAX(dateimport)                                        AS date_fin,
          COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})           AS cartes_retirees,
          COUNT(DISTINCT "SITE DE RETRAIT")                     AS sites_concernes,
          MIN(coordination)                                      AS coordination
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

  // ─────────────────────────────────────────
  // POST /api/statistiques/refresh
  // ─────────────────────────────────────────
  async refresh(req, res) {
    try {
      CACHE.globales = { data: null, timestamp: null, key: null };
      CACHE.sites = { data: null, timestamp: null, key: null };
      CACHE.detail = { data: null, timestamp: null, key: null };
      CACHE.agences = { data: null, timestamp: null, key: null };
      CACHE.coordinations = { data: null, timestamp: null, key: null };
      CACHE.temporel = { data: null, timestamp: null, key: null };

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

  // ─────────────────────────────────────────
  // GET /api/statistiques/diagnostic
  // ─────────────────────────────────────────
  async diagnostic(req, res) {
    try {
      const startTime = Date.now();
      const result = await db.query(`
        SELECT
          COUNT(*)                                                      AS total_cartes,
          COUNT(*) FILTER (WHERE ${CONDITION_RETIRES})                  AS cartes_retirees,
          COUNT(*) FILTER (WHERE deleted_at IS NOT NULL)                AS cartes_supprimees,
          COUNT(*) FILTER (WHERE sync_status = 'pending')               AS cartes_pending,
          COUNT(DISTINCT "SITE DE RETRAIT")                             AS sites_distincts,
          COUNT(DISTINCT importbatchid)                                 AS batches_distincts,
          COUNT(DISTINCT coordination)                                  AS coordinations_distinctes,
          MIN("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS premier_retrait,
          MAX("DATE DE DELIVRANCE") FILTER (WHERE ${CONDITION_RETIRES_AVEC_DATE}) AS dernier_retrait,
          pg_size_pretty(pg_total_relation_size('cartes'))              AS table_size_pretty
        FROM cartes
      `);

      const s = result.rows[0];
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        utilisateur: { role: req.user.role, coordination: req.user.coordination },
        statistiques: {
          total_cartes: parseInt(s.total_cartes) || 0,
          cartes_retirees: parseInt(s.cartes_retirees) || 0,
          cartes_supprimees: parseInt(s.cartes_supprimees) || 0,
          cartes_en_attente_sync: parseInt(s.cartes_pending) || 0,
          sites_distincts: parseInt(s.sites_distincts) || 0,
          batches_distincts: parseInt(s.batches_distincts) || 0,
          coordinations_distinctes: parseInt(s.coordinations_distinctes) || 0,
          premier_retrait: s.premier_retrait,
          dernier_retrait: s.dernier_retrait,
        },
        stockage: { taille_table: s.table_size_pretty },
        cache: {
          globales: CACHE.globales.timestamp ? 'actif' : 'inactif',
          sites: CACHE.sites.timestamp ? 'actif' : 'inactif',
          detail: CACHE.detail.timestamp ? 'actif' : 'inactif',
          agences: CACHE.agences.timestamp ? 'actif' : 'inactif',
          coordinations: CACHE.coordinations.timestamp ? 'actif' : 'inactif',
          temporel: CACHE.temporel.timestamp ? 'actif' : 'inactif',
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
