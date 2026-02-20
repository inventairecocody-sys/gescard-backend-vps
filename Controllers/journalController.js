const db = require('../db/db');
const annulationService = require('../Services/annulationService');

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  defaultPageSize: 50,
  maxPageSize: 1000,           // Pour les exports
  maxRetentionDays: 365,       // Conservation max 1 an
  defaultRetentionDays: 90,    // Conservation par défaut 90 jours
  cacheTimeout: 300,           // Cache stats 5 minutes
  statsCache: null,
  statsCacheTime: null,
  
  // Types d'actions standardisés
  actionTypes: [
    'CREATION',
    'MODIFICATION', 
    'SUPPRESSION',
    'IMPORT',
    'EXPORT',
    'CONNEXION',
    'DECONNEXION',
    'ANNULATION',
    'BACKUP',
    'RESTAURATION'
  ]
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
  
  // Gestionnaire et Chef d'équipe n'ont pas accès au journal (déjà filtré par middleware)
  // Mais si on arrive ici, on filtre par coordination par sécurité
  if ((role === 'Gestionnaire' || role === "Chef d'équipe") && coordination) {
    return {
      query: query + ` AND ${colonne} = $${params.length + 1}`,
      params: [...params, coordination]
    };
  }
  
  return { query, params };
};

/**
 * Masque les informations sensibles selon le rôle
 */
const masquerInfosSensibles = (req, log) => {
  if (!log) return log;
  
  const role = req.user?.role;
  const optionsMasquage = req.optionsMasquage || { ip: true, anciennesValeurs: true };
  
  // Créer une copie pour ne pas modifier l'original
  const logMasque = { ...log };
  
  // Masquer l'IP si nécessaire
  if (optionsMasquage.ip && logMasque.iputilisateur) {
    logMasque.iputilisateur = '***.***.***.***';
    logMasque.adresseip = '***.***.***.***';
  }
  
  // Masquer les anciennes valeurs si nécessaire
  if (optionsMasquage.anciennesValeurs) {
    if (logMasque.oldvalue) {
      try {
        const oldValue = typeof logMasque.oldvalue === 'string' 
          ? JSON.parse(logMasque.oldvalue) 
          : logMasque.oldvalue;
        logMasque.oldvalue = JSON.stringify('[MASQUÉ]');
        logMasque.anciennes_valeurs = '[MASQUÉ]';
      } catch (e) {
        logMasque.oldvalue = '[MASQUÉ]';
      }
    }
    
    if (logMasque.newvalue) {
      try {
        const newValue = typeof logMasque.newvalue === 'string' 
          ? JSON.parse(logMasque.newvalue) 
          : logMasque.newvalue;
        logMasque.newvalue = JSON.stringify('[MASQUÉ]');
        logMasque.nouvelles_valeurs = '[MASQUÉ]';
      } catch (e) {
        logMasque.newvalue = '[MASQUÉ]';
      }
    }
  }
  
  // Gestionnaire: peut voir les valeurs mais pas les IPs
  if (role === 'Gestionnaire') {
    // Déjà géré par optionsMasquage
  }
  
  // Chef d'équipe et Opérateur: tout est masqué (déjà filtré par middleware d'accès)
  
  return logMasque;
};

/**
 * Masque les informations sensibles sur un tableau de logs
 */
const masquerInfosSensiblesTableau = (req, logs) => {
  if (!Array.isArray(logs)) return logs;
  return logs.map(log => masquerInfosSensibles(req, log));
};

// ============================================
// CONTROLEUR JOURNAL OPTIMISÉ POUR LWS
// ============================================
class JournalController {
    
    /**
     * Récupérer tous les logs avec pagination et filtres - OPTIMISÉ LWS
     * GET /api/journal
     */
    async getJournal(req, res) {
        try {
            // Vérifier que l'utilisateur a accès au journal (admin seulement)
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent consulter le journal'
                });
            }

            const {
                page = 1,
                pageSize = CONFIG.defaultPageSize,
                dateDebut,
                dateFin,
                utilisateur,
                actionType,
                tableName,
                importBatchID,
                coordination, // Nouveau filtre par coordination
                annulee, // Nouveau filtre pour actions annulées
                export_all = 'false'
            } = req.query;

            // Validation et adaptation des limites
            const actualPage = Math.max(1, parseInt(page));
            const actualPageSize = export_all === 'true' 
                ? CONFIG.maxPageSize 
                : Math.min(parseInt(pageSize), CONFIG.maxPageSize);
            
            const offset = (actualPage - 1) * actualPageSize;

            // Construction de la requête principale avec les nouvelles colonnes
            let query = `
                SELECT 
                    j.journalid,
                    j.utilisateurid,
                    j.nomutilisateur,
                    j.nomcomplet,
                    j.role,
                    j.agence,
                    j.coordination,
                    TO_CHAR(j.dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
                    j.action,
                    j.tableaffectee,
                    j.ligneaffectee,
                    j.iputilisateur,
                    j.actiontype,
                    j.tablename,
                    j.recordid,
                    j.oldvalue,
                    j.newvalue,
                    j.adresseip,
                    j.userid,
                    j.importbatchid,
                    j.detailsaction,
                    j.anciennes_valeurs,
                    j.nouvelles_valeurs,
                    j.annulee,
                    u.nomutilisateur as annule_par_nom,
                    TO_CHAR(j.date_annulation, 'YYYY-MM-DD HH24:MI:SS') as date_annulation
                FROM journalactivite j
                LEFT JOIN utilisateurs u ON j.annulee_par = u.id
                WHERE 1=1
            `;
            
            const params = [];
            let paramCount = 0;

            // Filtres avec optimisation
            if (dateDebut) {
                paramCount++;
                query += ` AND j.dateaction >= $${paramCount}`;
                params.push(new Date(dateDebut));
            }

            if (dateFin) {
                paramCount++;
                query += ` AND j.dateaction <= $${paramCount}`;
                params.push(new Date(dateFin + ' 23:59:59'));
            }

            if (utilisateur && utilisateur.trim() !== '') {
                paramCount++;
                query += ` AND j.nomutilisateur ILIKE $${paramCount}`;
                params.push(`%${utilisateur.trim()}%`);
            }

            if (actionType && actionType.trim() !== '') {
                paramCount++;
                query += ` AND j.actiontype = $${paramCount}`;
                params.push(actionType.trim().toUpperCase());
            }

            if (tableName && tableName.trim() !== '') {
                paramCount++;
                query += ` AND (j.tablename = $${paramCount} OR j.tableaffectee = $${paramCount})`;
                params.push(tableName.trim());
            }

            if (importBatchID && importBatchID.trim() !== '') {
                paramCount++;
                query += ` AND j.importbatchid = $${paramCount}`;
                params.push(importBatchID.trim());
            }

            // Nouveau filtre par coordination
            if (coordination && coordination.trim() !== '') {
                paramCount++;
                query += ` AND j.coordination = $${paramCount}`;
                params.push(coordination.trim());
            }

            // Nouveau filtre pour actions annulées
            if (annulee !== undefined && annulee !== '') {
                paramCount++;
                query += ` AND j.annulee = $${paramCount}`;
                params.push(annulee === 'true' || annulee === '1');
            }

            // Construction de la requête COUNT (similaire sans pagination)
            let countQuery = query.replace(
                /SELECT[\s\S]*?FROM/,
                'SELECT COUNT(*) as total FROM'
            );
            // Supprimer ORDER BY et LIMIT/OFFSET de la requête COUNT
            countQuery = countQuery.split('ORDER BY')[0];

            // Ajout du tri et pagination
            query += `
                ORDER BY j.dateaction DESC
                LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
            `;
            params.push(actualPageSize, offset);

            const startTime = Date.now();

            // Exécution parallèle des requêtes
            const [logsResult, totalResult] = await Promise.all([
                db.query(query, params),
                db.query(countQuery, params.slice(0, paramCount))
            ]);

            const duration = Date.now() - startTime;
            const total = parseInt(totalResult.rows[0].total);
            const totalPages = Math.ceil(total / actualPageSize);

            // Traiter et masquer les données sensibles
            const logsTraites = logsResult.rows.map(log => {
                try {
                    // Parser les JSON si nécessaire
                    const logTraite = { ...log };
                    
                    if (logTraite.oldvalue && typeof logTraite.oldvalue === 'string') {
                        try {
                            logTraite.oldvalue_parse = JSON.parse(logTraite.oldvalue);
                        } catch (e) {
                            logTraite.oldvalue_parse = logTraite.oldvalue;
                        }
                    }
                    
                    if (logTraite.newvalue && typeof logTraite.newvalue === 'string') {
                        try {
                            logTraite.newvalue_parse = JSON.parse(logTraite.newvalue);
                        } catch (e) {
                            logTraite.newvalue_parse = logTraite.newvalue;
                        }
                    }
                    
                    if (logTraite.anciennes_valeurs && typeof logTraite.anciennes_valeurs === 'string') {
                        try {
                            logTraite.anciennes_valeurs_parse = JSON.parse(logTraite.anciennes_valeurs);
                        } catch (e) {
                            logTraite.anciennes_valeurs_parse = logTraite.anciennes_valeurs;
                        }
                    }
                    
                    if (logTraite.nouvelles_valeurs && typeof logTraite.nouvelles_valeurs === 'string') {
                        try {
                            logTraite.nouvelles_valeurs_parse = JSON.parse(logTraite.nouvelles_valeurs);
                        } catch (e) {
                            logTraite.nouvelles_valeurs_parse = logTraite.nouvelles_valeurs;
                        }
                    }
                    
                    return logTraite;
                } catch (e) {
                    return log;
                }
            });

            // Masquer les informations sensibles
            const logsMasques = masquerInfosSensiblesTableau(req, logsTraites);

            // En-têtes pour export
            if (export_all === 'true') {
                res.setHeader('X-Total-Rows', total);
                res.setHeader('X-Query-Time', `${duration}ms`);
            }
            res.setHeader('X-User-Role', req.user.role);

            res.json({
                success: true,
                logs: logsMasques,
                pagination: {
                    page: actualPage,
                    pageSize: actualPageSize,
                    total: total,
                    totalPages: totalPages,
                    hasNext: actualPage < totalPages,
                    hasPrev: actualPage > 1
                },
                performance: {
                    queryTime: duration,
                    returnedRows: logsResult.rows.length
                },
                filtres: {
                    dateDebut: dateDebut || null,
                    dateFin: dateFin || null,
                    utilisateur: utilisateur || null,
                    actionType: actionType || null,
                    tableName: tableName || null,
                    importBatchID: importBatchID || null,
                    coordination: coordination || null,
                    annulee: annulee || null
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erreur journal:', error);
            res.status(500).json({ 
                success: false,
                error: 'Erreur lors de la récupération du journal',
                details: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Récupérer les imports groupés pour l'annulation
     * GET /api/journal/imports
     */
    async getImports(req, res) {
        try {
            // Vérifier que l'utilisateur a accès au journal (admin seulement)
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent consulter les imports'
                });
            }

            const { limit = 100 } = req.query;
            const actualLimit = Math.min(parseInt(limit), 500);

            const startTime = Date.now();

            const result = await db.query(`
                SELECT 
                    j.importbatchid,
                    COUNT(c.id) as nombrecartes,
                    MIN(j.dateaction) as dateimport,
                    MAX(j.dateaction) as derniereaction,
                    j.nomutilisateur,
                    j.nomcomplet,
                    j.agence,
                    j.coordination,
                    COUNT(DISTINCT j.actiontype) as types_actions,
                    COUNT(CASE WHEN j.actiontype = 'IMPORT' THEN 1 END) as imports_count,
                    COUNT(CASE WHEN j.actiontype = 'ANNULATION' THEN 1 END) as annulations_count,
                    COUNT(CASE WHEN j.annulee = true THEN 1 END) as actions_annulees
                FROM journalactivite j
                LEFT JOIN cartes c ON j.importbatchid = c.importbatchid
                WHERE j.importbatchid IS NOT NULL
                GROUP BY j.importbatchid, j.nomutilisateur, j.nomcomplet, j.agence, j.coordination
                ORDER BY dateimport DESC
                LIMIT $1
            `, [actualLimit]);

            const duration = Date.now() - startTime;

            res.json({
                success: true,
                imports: result.rows,
                total: result.rows.length,
                performance: {
                    queryTime: duration
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erreur récupération imports:', error);
            res.status(500).json({ 
                success: false,
                error: 'Erreur lors de la récupération des imports',
                details: error.message
            });
        }
    }

    /**
     * Récupérer les détails d'un import spécifique
     * GET /api/journal/imports/:batchId
     */
    async getImportDetails(req, res) {
        try {
            // Vérifier que l'utilisateur a accès au journal (admin seulement)
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent consulter les détails d\'import'
                });
            }

            const { batchId } = req.params;
            const { page = 1, pageSize = 50 } = req.query;

            const actualPage = Math.max(1, parseInt(page));
            const actualPageSize = Math.min(parseInt(pageSize), 500);
            const offset = (actualPage - 1) * actualPageSize;

            // Statistiques de l'import
            const statsResult = await db.query(`
                SELECT 
                    COUNT(DISTINCT c.id) as cartes_importees,
                    COUNT(DISTINCT j.journalid) as actions_journal,
                    MIN(j.dateaction) as debut_import,
                    MAX(j.dateaction) as fin_import,
                    COUNT(CASE WHEN j.actiontype = 'CREATION' THEN 1 END) as creations,
                    COUNT(CASE WHEN j.actiontype = 'MODIFICATION' THEN 1 END) as modifications,
                    COUNT(CASE WHEN j.actiontype = 'ANNULATION' THEN 1 END) as annulations,
                    COUNT(CASE WHEN j.annulee = true THEN 1 END) as actions_annulees,
                    MIN(j.coordination) as coordination
                FROM journalactivite j
                LEFT JOIN cartes c ON j.importbatchid = c.importbatchid
                WHERE j.importbatchid = $1
                GROUP BY j.importbatchid
            `, [batchId]);

            // Actions détaillées avec pagination
            const actionsResult = await db.query(`
                SELECT 
                    j.journalid,
                    TO_CHAR(j.dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
                    j.actiontype,
                    j.tablename,
                    j.recordid,
                    j.detailsaction,
                    j.nomutilisateur,
                    j.oldvalue,
                    j.newvalue,
                    j.anciennes_valeurs,
                    j.nouvelles_valeurs,
                    j.annulee,
                    j.date_annulation,
                    j.annulee_par,
                    u.nomutilisateur as annule_par_nom
                FROM journalactivite j
                LEFT JOIN utilisateurs u ON j.annulee_par = u.id
                WHERE j.importbatchid = $1
                ORDER BY j.dateaction DESC
                LIMIT $2 OFFSET $3
            `, [batchId, actualPageSize, offset]);

            // Compter le total des actions
            const countResult = await db.query(`
                SELECT COUNT(*) as total
                FROM journalactivite
                WHERE importbatchid = $1
            `, [batchId]);

            const total = parseInt(countResult.rows[0].total);
            const totalPages = Math.ceil(total / actualPageSize);

            // Traiter les actions
            const actionsTraitees = actionsResult.rows.map(action => {
                try {
                    return {
                        ...action,
                        oldvalue: action.oldvalue ? JSON.parse(action.oldvalue) : null,
                        newvalue: action.newvalue ? JSON.parse(action.newvalue) : null,
                        anciennes_valeurs: action.anciennes_valeurs ? JSON.parse(action.anciennes_valeurs) : null,
                        nouvelles_valeurs: action.nouvelles_valeurs ? JSON.parse(action.nouvelles_valeurs) : null
                    };
                } catch (e) {
                    return action;
                }
            });

            res.json({
                success: true,
                batchId,
                statistiques: statsResult.rows[0] || {
                    cartes_importees: 0,
                    actions_journal: 0
                },
                actions: actionsTraitees,
                pagination: {
                    page: actualPage,
                    pageSize: actualPageSize,
                    total,
                    totalPages,
                    hasNext: actualPage < totalPages,
                    hasPrev: actualPage > 1
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erreur détails import:', error);
            res.status(500).json({ 
                success: false,
                error: 'Erreur lors de la récupération des détails',
                details: error.message
            });
        }
    }

    /**
     * Annuler une action (Admin uniquement) - Utilise le service d'annulation
     * POST /api/journal/:id/annuler
     */
    async annulerAction(req, res) {
        try {
            const { id } = req.params;
            
            // Vérifier que l'utilisateur est admin (déjà fait par middleware)
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent annuler des actions'
                });
            }

            // Vérifier que l'action existe et n'est pas déjà annulée
            const verification = await annulationService.peutEtreAnnulee(id);
            
            if (!verification.peutAnnuler) {
                return res.status(400).json({
                    success: false,
                    error: 'Action non annulable',
                    message: verification.raison,
                    details: verification
                });
            }

            // Procéder à l'annulation
            await annulationService.annulerAction(
                id,
                req.user.id,
                req.user.nomUtilisateur,
                req.ip
            );

            res.json({
                success: true,
                message: 'Action annulée avec succès',
                actionId: id,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erreur annulation action:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur lors de l\'annulation',
                message: error.message,
                timestamp: new Date().toISOString()
            });
        }
    }

    /**
     * Lister les actions annulables (Admin uniquement)
     * GET /api/journal/actions/annulables
     */
    async listerActionsAnnulables(req, res) {
        try {
            // Vérifier que l'utilisateur est admin (déjà fait par middleware)
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent lister les actions annulables'
                });
            }

            const { limit = 100, table, utilisateurId, coordination } = req.query;

            const filtres = {};
            if (table) filtres.table = table;
            if (utilisateurId) filtres.utilisateurId = parseInt(utilisateurId);
            if (coordination) filtres.coordination = coordination;

            const actions = await annulationService.listerActionsAnnulables(filtres, parseInt(limit));

            // Masquer les infos sensibles si nécessaire
            const actionsMasquees = masquerInfosSensiblesTableau(req, actions);

            res.json({
                success: true,
                actions: actionsMasquees,
                total: actionsMasquees.length,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erreur lister actions annulables:', error);
            res.status(500).json({
                success: false,
                error: 'Erreur lors de la récupération des actions annulables',
                message: error.message
            });
        }
    }

    /**
     * ✅ Annuler une action (méthode legacy) - À DEPRECIER
     * POST /api/journal/undo/:id
     */
    async undoAction(req, res) {
        try {
            // Rediriger vers la nouvelle méthode
            req.params.id = req.params.id;
            return this.annulerAction(req, res);
        } catch (error) {
            console.error('❌ Erreur undoAction:', error);
            res.status(500).json({
                success: false,
                error: error.message
            });
        }
    }

    /**
     * Annuler une importation - VERSION OPTIMISÉE
     * POST /api/journal/annuler-import
     */
    async annulerImportation(req, res) {
        const client = await db.connect();
        const startTime = Date.now();
        
        try {
            // Vérifier que l'utilisateur est admin
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent annuler des importations'
                });
            }

            await client.query('BEGIN');
            
            const { importBatchID } = req.body;
            const utilisateur = req.user;

            if (!importBatchID) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false,
                    error: 'importBatchID requis' 
                });
            }

            // 1. Vérifier si l'import existe et compter les cartes
            const countResult = await client.query(`
                SELECT 
                    COUNT(*) as count,
                    MIN(dateimport) as date_import,
                    MAX(dateimport) as dernier_import,
                    MIN(coordination) as coordination
                FROM cartes 
                WHERE importbatchid = $1
            `, [importBatchID]);

            const count = parseInt(countResult.rows[0].count);

            if (count === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ 
                    success: false,
                    error: 'Aucune carte trouvée pour ce batch d\'importation' 
                });
            }

            // 2. Récupérer les cartes avant suppression pour le journal
            const cartesResult = await client.query(`
                SELECT * FROM cartes WHERE importbatchid = $1
            `, [importBatchID]);

            // 3. Journaliser l'action avant suppression avec anciennes valeurs
            await annulationService.enregistrerAction(
                utilisateur.id,
                utilisateur.nomUtilisateur,
                utilisateur.nomComplet || utilisateur.nomUtilisateur,
                utilisateur.role,
                utilisateur.agence || '',
                `Annulation importation batch ${importBatchID}`,
                'ANNULATION_IMPORT',
                'cartes',
                null,
                { cartes: cartesResult.rows }, // Anciennes valeurs
                null,
                req.ip,
                importBatchID,
                countResult.rows[0].coordination
            );

            // 4. Supprimer les cartes de ce batch
            const deleteResult = await client.query(`
                DELETE FROM cartes 
                WHERE importbatchid = $1 
                RETURNING id, nom, prenoms, "SITE DE RETRAIT", coordination
            `, [importBatchID]);

            await client.query('COMMIT');

            const duration = Date.now() - startTime;

            res.json({
                success: true,
                message: `Importation annulée avec succès - ${deleteResult.rows.length} cartes supprimées`,
                stats: {
                    count: deleteResult.rows.length,
                    date_import: countResult.rows[0].date_import,
                    dernier_import: countResult.rows[0].dernier_import
                },
                performance: {
                    duration_ms: duration
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Erreur annulation import:', error);
            res.status(500).json({ 
                success: false,
                error: 'Erreur lors de l\'annulation de l\'importation',
                details: error.message 
            });
        } finally {
            client.release();
        }
    }

    /**
     * Journaliser une action (méthode utilitaire)
     */
    async logAction(logData) {
        try {
            // Utiliser le service d'annulation pour la cohérence
            await annulationService.enregistrerAction(
                logData.utilisateurId || null,
                logData.nomUtilisateur || 'System',
                logData.nomComplet || 'System',
                logData.role || 'System',
                logData.agence || null,
                logData.action || logData.actionType,
                logData.actionType,
                logData.tableName || null,
                logData.recordId || null,
                logData.oldValue || null,
                logData.newValue || null,
                logData.ip || null,
                logData.importBatchID || null,
                logData.coordination || null
            );
        } catch (error) {
            console.error('❌ Erreur journalisation:', error);
        }
    }

    /**
     * Statistiques d'activité avec cache (Admin uniquement)
     * GET /api/journal/stats
     */
    async getStats(req, res) {
        try {
            // Vérifier que l'utilisateur est admin
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent consulter les statistiques du journal'
                });
            }

            const { forceRefresh, periode = 30 } = req.query;
            
            // Vérifier le cache
            if (!forceRefresh && 
                CONFIG.statsCache && 
                CONFIG.statsCacheTime && 
                (Date.now() - CONFIG.statsCacheTime) < CONFIG.cacheTimeout * 1000) {
                return res.json({
                    success: true,
                    ...CONFIG.statsCache,
                    cached: true,
                    cacheAge: Math.round((Date.now() - CONFIG.statsCacheTime) / 1000) + 's'
                });
            }

            const jours = Math.min(parseInt(periode), 365);
            
            const startTime = Date.now();

            const result = await db.query(`
                SELECT 
                    actiontype,
                    COUNT(*) as count,
                    MAX(dateaction) as derniereaction,
                    COUNT(DISTINCT nomutilisateur) as utilisateurs_distincts,
                    COUNT(DISTINCT tablename) as tables_concernees,
                    COUNT(CASE WHEN dateaction > NOW() - INTERVAL '7 days' THEN 1 END) as count_7j,
                    COUNT(CASE WHEN dateaction > NOW() - INTERVAL '30 days' THEN 1 END) as count_30j,
                    COUNT(CASE WHEN annulee = true THEN 1 END) as count_annulees,
                    COUNT(DISTINCT coordination) as coordinations_distinctes
                FROM journalactivite 
                WHERE dateaction >= CURRENT_DATE - INTERVAL '${jours} days'
                GROUP BY actiontype
                ORDER BY count DESC
            `);

            const totalActions = result.rows.reduce((acc, row) => acc + parseInt(row.count), 0);

            const statsData = {
                statistiques: result.rows.map(row => ({
                    ...row,
                    count: parseInt(row.count),
                    pourcentage: totalActions > 0 ? Math.round((row.count / totalActions) * 100) : 0
                })),
                resume: {
                    total_actions: totalActions,
                    types_distincts: result.rows.length,
                    periode_jours: jours,
                    date_calcul: new Date().toISOString(),
                    total_annulees: result.rows.reduce((acc, row) => acc + parseInt(row.count_annulees || 0), 0)
                },
                performance: {
                    queryTime: Date.now() - startTime
                }
            };

            // Mettre en cache
            CONFIG.statsCache = statsData;
            CONFIG.statsCacheTime = Date.now();

            res.json({
                success: true,
                ...statsData,
                cached: false,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Erreur stats:', error);
            res.status(500).json({ 
                success: false,
                error: 'Erreur lors de la récupération des statistiques',
                details: error.message 
            });
        }
    }

    /**
     * Nettoyer le journal (admin seulement)
     * DELETE /api/journal/nettoyer
     */
    async nettoyerJournal(req, res) {
        const client = await db.connect();
        
        try {
            // Vérifier que l'utilisateur est admin
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent nettoyer le journal'
                });
            }

            await client.query('BEGIN');
            
            const { jours = CONFIG.defaultRetentionDays } = req.body;
            const utilisateur = req.user;

            // Valider la période
            const retentionJours = Math.min(parseInt(jours), CONFIG.maxRetentionDays);

            if (retentionJours < 30) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    error: 'La période minimum est de 30 jours'
                });
            }

            // Compter les entrées à supprimer
            const countResult = await client.query(`
                SELECT COUNT(*) as count
                FROM journalactivite 
                WHERE dateaction < CURRENT_DATE - INTERVAL '${retentionJours} days'
                AND annulee = false -- Ne pas supprimer les actions annulées récentes
            `);

            const countASupprimer = parseInt(countResult.rows[0].count);

            if (countASupprimer === 0) {
                await client.query('ROLLBACK');
                return res.json({
                    success: true,
                    message: 'Aucune entrée à nettoyer',
                    deletedCount: 0
                });
            }

            // Journaliser le nettoyage
            await annulationService.enregistrerAction(
                utilisateur.id,
                utilisateur.nomUtilisateur,
                utilisateur.nomComplet || utilisateur.nomUtilisateur,
                utilisateur.role,
                utilisateur.agence || '',
                `Nettoyage journal (>${retentionJours} jours)`,
                'NETTOYAGE_JOURNAL',
                'journalactivite',
                null,
                null,
                { count: countASupprimer, retentionJours },
                req.ip,
                null,
                null
            );

            // Supprimer les vieilles entrées
            const deleteResult = await client.query(`
                DELETE FROM journalactivite 
                WHERE dateaction < CURRENT_DATE - INTERVAL '${retentionJours} days'
                AND annulee = false
                RETURNING journalid
            `);
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: `Journal nettoyé avec succès - ${deleteResult.rows.length} entrées supprimées`,
                stats: {
                    deletedCount: deleteResult.rows.length,
                    retentionJours,
                    dateLimite: new Date(Date.now() - retentionJours * 24 * 60 * 60 * 1000).toISOString()
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            console.error('❌ Erreur nettoyage journal:', error);
            res.status(500).json({ 
                success: false,
                error: 'Erreur lors du nettoyage du journal',
                details: error.message 
            });
        } finally {
            client.release();
        }
    }

    /**
     * Diagnostic du journal (Admin seulement)
     * GET /api/journal/diagnostic
     */
    async diagnostic(req, res) {
        try {
            // Vérifier que l'utilisateur est admin
            if (req.user.role !== 'Administrateur') {
                return res.status(403).json({
                    success: false,
                    error: 'Accès refusé',
                    message: 'Seuls les administrateurs peuvent accéder au diagnostic'
                });
            }

            const startTime = Date.now();

            const result = await db.query(`
                SELECT 
                    COUNT(*) as total_entrees,
                    COUNT(DISTINCT actiontype) as types_actions,
                    COUNT(DISTINCT nomutilisateur) as utilisateurs_actifs,
                    MIN(dateaction) as premiere_entree,
                    MAX(dateaction) as derniere_entree,
                    COUNT(CASE WHEN dateaction > NOW() - INTERVAL '24 hours' THEN 1 END) as entrees_24h,
                    COUNT(CASE WHEN dateaction > NOW() - INTERVAL '7 days' THEN 1 END) as entrees_7j,
                    COUNT(CASE WHEN dateaction > NOW() - INTERVAL '30 days' THEN 1 END) as entrees_30j,
                    COUNT(CASE WHEN annulee = true THEN 1 END) as actions_annulees,
                    COUNT(DISTINCT coordination) as coordinations_distinctes,
                    pg_database_size(current_database()) as db_size,
                    pg_size_pretty(pg_total_relation_size('journalactivite')) as table_size
                FROM journalactivite
            `);

            // Statistiques par coordination
            const coordinationStats = await db.query(`
                SELECT 
                    coordination,
                    COUNT(*) as total_entrees,
                    COUNT(CASE WHEN annulee = true THEN 1 END) as actions_annulees
                FROM journalactivite
                WHERE coordination IS NOT NULL
                GROUP BY coordination
                ORDER BY total_entrees DESC
                LIMIT 10
            `);

            const stats = result.rows[0];

            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                service: 'journal',
                utilisateur: {
                    role: req.user.role,
                    coordination: req.user.coordination
                },
                statistiques: {
                    total_entrees: parseInt(stats.total_entrees),
                    types_actions: parseInt(stats.types_actions),
                    utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
                    premiere_entree: stats.premiere_entree,
                    derniere_entree: stats.derniere_entree,
                    entrees_24h: parseInt(stats.entrees_24h),
                    entrees_7j: parseInt(stats.entrees_7j),
                    entrees_30j: parseInt(stats.entrees_30j),
                    actions_annulees: parseInt(stats.actions_annulees),
                    coordinations_distinctes: parseInt(stats.coordinations_distinctes)
                },
                stockage: {
                    taille_table: stats.table_size,
                    db_size_bytes: parseInt(stats.db_size)
                },
                coordination_stats: coordinationStats.rows,
                config: {
                    defaultPageSize: CONFIG.defaultPageSize,
                    maxPageSize: CONFIG.maxPageSize,
                    maxRetentionDays: CONFIG.maxRetentionDays,
                    defaultRetentionDays: CONFIG.defaultRetentionDays,
                    cacheTimeout: CONFIG.cacheTimeout
                },
                performance: {
                    queryTime: Date.now() - startTime
                },
                endpoints: [
                    '/api/journal',
                    '/api/journal/imports',
                    '/api/journal/imports/:batchId',
                    '/api/journal/:id/annuler',
                    '/api/journal/actions/annulables',
                    '/api/journal/annuler-import',
                    '/api/journal/undo/:id',
                    '/api/journal/stats',
                    '/api/journal/nettoyer',
                    '/api/journal/diagnostic'
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
}

module.exports = new JournalController();