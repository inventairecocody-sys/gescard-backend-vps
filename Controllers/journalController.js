const db = require('../db/db');

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
// CONTROLEUR JOURNAL OPTIMISÉ POUR LWS
// ============================================
class JournalController {
    
    /**
     * Récupérer tous les logs avec pagination et filtres - OPTIMISÉ LWS
     * GET /api/journal
     */
    async getJournal(req, res) {
        try {
            const {
                page = 1,
                pageSize = CONFIG.defaultPageSize,
                dateDebut,
                dateFin,
                utilisateur,
                actionType,
                tableName,
                importBatchID,
                export_all = 'false'
            } = req.query;

            // Validation et adaptation des limites
            const actualPage = Math.max(1, parseInt(page));
            const actualPageSize = export_all === 'true' 
                ? CONFIG.maxPageSize 
                : Math.min(parseInt(pageSize), CONFIG.maxPageSize);
            
            const offset = (actualPage - 1) * actualPageSize;

            // Construction de la requête principale
            let query = `
                SELECT 
                    journalid,
                    utilisateurid,
                    nomutilisateur,
                    nomcomplet,
                    role,
                    agence,
                    TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
                    action,
                    tableaffectee,
                    ligneaffectee,
                    iputilisateur,
                    actiontype,
                    tablename,
                    recordid,
                    oldvalue,
                    newvalue,
                    adresseip,
                    userid,
                    importbatchid,
                    detailsaction
                FROM journalactivite 
                WHERE 1=1
            `;
            
            const params = [];
            let paramCount = 0;

            // Filtres avec optimisation
            if (dateDebut) {
                paramCount++;
                query += ` AND dateaction >= $${paramCount}`;
                params.push(new Date(dateDebut));
            }

            if (dateFin) {
                paramCount++;
                query += ` AND dateaction <= $${paramCount}`;
                params.push(new Date(dateFin + ' 23:59:59'));
            }

            if (utilisateur && utilisateur.trim() !== '') {
                paramCount++;
                query += ` AND nomutilisateur ILIKE $${paramCount}`;
                params.push(`%${utilisateur.trim()}%`);
            }

            if (actionType && actionType.trim() !== '') {
                paramCount++;
                query += ` AND actiontype = $${paramCount}`;
                params.push(actionType.trim().toUpperCase());
            }

            if (tableName && tableName.trim() !== '') {
                paramCount++;
                query += ` AND (tablename = $${paramCount} OR tableaffectee = $${paramCount})`;
                params.push(tableName.trim());
            }

            if (importBatchID && importBatchID.trim() !== '') {
                paramCount++;
                query += ` AND importbatchid = $${paramCount}`;
                params.push(importBatchID.trim());
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
                ORDER BY dateaction DESC
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

            // En-têtes pour export
            if (export_all === 'true') {
                res.setHeader('X-Total-Rows', total);
                res.setHeader('X-Query-Time', `${duration}ms`);
            }

            res.json({
                success: true,
                logs: logsResult.rows.map(log => ({
                    ...log,
                    oldvalue: log.oldvalue ? JSON.parse(log.oldvalue) : null,
                    newvalue: log.newvalue ? JSON.parse(log.newvalue) : null
                })),
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
                    importBatchID: importBatchID || null
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
                    COUNT(DISTINCT j.actiontype) as types_actions,
                    COUNT(CASE WHEN j.actiontype = 'IMPORT' THEN 1 END) as imports_count,
                    COUNT(CASE WHEN j.actiontype = 'ANNULATION' THEN 1 END) as annulations_count
                FROM journalactivite j
                LEFT JOIN cartes c ON j.importbatchid = c.importbatchid
                WHERE j.importbatchid IS NOT NULL
                GROUP BY j.importbatchid, j.nomutilisateur, j.nomcomplet, j.agence
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
                    COUNT(CASE WHEN j.actiontype = 'ANNULATION' THEN 1 END) as annulations
                FROM journalactivite j
                LEFT JOIN cartes c ON j.importbatchid = c.importbatchid
                WHERE j.importbatchid = $1
                GROUP BY j.importbatchid
            `, [batchId]);

            // Actions détaillées avec pagination
            const actionsResult = await db.query(`
                SELECT 
                    journalid,
                    TO_CHAR(dateaction, 'YYYY-MM-DD HH24:MI:SS') as dateaction,
                    actiontype,
                    tablename,
                    recordid,
                    detailsaction,
                    nomutilisateur,
                    oldvalue,
                    newvalue
                FROM journalactivite
                WHERE importbatchid = $1
                ORDER BY dateaction DESC
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

            res.json({
                success: true,
                batchId,
                statistiques: statsResult.rows[0] || {
                    cartes_importees: 0,
                    actions_journal: 0
                },
                actions: actionsResult.rows.map(action => ({
                    ...action,
                    oldvalue: action.oldvalue ? JSON.parse(action.oldvalue) : null,
                    newvalue: action.newvalue ? JSON.parse(action.newvalue) : null
                })),
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
     * Annuler une importation - VERSION OPTIMISÉE
     * POST /api/journal/annuler-import
     */
    async annulerImportation(req, res) {
        const client = await db.connect();
        const startTime = Date.now();
        
        try {
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
                    MAX(dateimport) as dernier_import
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

            // 2. Journaliser l'action avant suppression
            await client.query(`
                INSERT INTO journalactivite (
                    utilisateurid, nomutilisateur, nomcomplet, role, agence,
                    dateaction, action, tableaffectee, iputilisateur,
                    actiontype, tablename, importbatchid, detailsaction
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
            `, [
                utilisateur.id, 
                utilisateur.NomUtilisateur, 
                utilisateur.NomComplet || utilisateur.NomUtilisateur, 
                utilisateur.Role,
                utilisateur.Agence || '',
                new Date(), 
                `Annulation importation batch ${importBatchID}`, 
                'Cartes', 
                req.ip,
                'ANNULATION_IMPORT', 
                'Cartes', 
                importBatchID, 
                `Annulation de l'importation - ${count} cartes supprimées`
            ]);

            // 3. Supprimer les cartes de ce batch
            const deleteResult = await client.query(`
                DELETE FROM cartes 
                WHERE importbatchid = $1 
                RETURNING id, nom, prenoms, "SITE DE RETRAIT"
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
     * ✅ Annuler une action (modification/création/suppression)
     * POST /api/journal/undo/:id
     */
    async undoAction(req, res) {
        const { id } = req.params;
        const user = req.user;
        const client = await db.connect();
        const startTime = Date.now();

        try {
            await client.query('BEGIN');
            
            console.log(`🔄 Tentative d'annulation (JournalID: ${id})`);

            // 🔍 Récupérer le log avec détails
            const result = await client.query(
                'SELECT * FROM journalactivite WHERE journalid = $1',
                [id]
            );

            if (result.rows.length === 0) {
                await client.query('ROLLBACK');
                return res.status(404).json({ 
                    success: false,
                    message: 'Entrée de journal non trouvée.' 
                });
            }

            const log = result.rows[0];
            const oldData = log.oldvalue ? JSON.parse(log.oldvalue) : null;
            const newData = log.newvalue ? JSON.parse(log.newvalue) : null;
            const tableName = log.tablename || log.tableaffectee;
            const recordId = log.recordid || log.ligneaffectee;

            if (!oldData && !newData) {
                await client.query('ROLLBACK');
                return res.status(400).json({ 
                    success: false,
                    message: 'Aucune donnée à restaurer.' 
                });
            }

            console.log(`🕓 Action: ${log.actiontype}, Table: ${tableName}, ID: ${recordId}`);

            // 🔄 Exécuter l'annulation selon le type d'action
            switch(log.actiontype) {
                case 'MODIFICATION':
                case 'MODIFICATION_CARTE':
                    await this.executeManualUpdate(client, tableName, recordId, oldData);
                    break;
                    
                case 'CREATION':
                case 'CREATION_CARTE':
                    await client.query(
                        `DELETE FROM ${tableName} WHERE id = $1`,
                        [recordId]
                    );
                    break;
                    
                case 'SUPPRESSION':
                case 'SUPPRESSION_CARTE':
                    await this.executeManualInsert(client, tableName, oldData);
                    break;
                    
                default:
                    await client.query('ROLLBACK');
                    return res.status(400).json({ 
                        success: false,
                        message: `Type d'action non supporté: ${log.actiontype}` 
                    });
            }

            // 🧾 Journaliser cette restauration
            await this.logUndoAction(client, user, req, log, newData, oldData);

            await client.query('COMMIT');

            const duration = Date.now() - startTime;

            console.log('✅ Action annulée avec succès');
            return res.json({ 
                success: true, 
                message: '✅ Action annulée avec succès.',
                performance: {
                    duration_ms: duration
                },
                timestamp: new Date().toISOString()
            });

        } catch (err) {
            await client.query('ROLLBACK');
            console.error('❌ Erreur annulation:', err);
            return res.status(500).json({ 
                success: false,
                message: 'Erreur serveur pendant l\'annulation.',
                details: err.message 
            });
        } finally {
            client.release();
        }
    }

    /**
     * ✅ Mise à jour manuelle avec gestion des colonnes
     */
    async executeManualUpdate(client, tableName, recordId, oldData) {
        const setClauses = [];
        const params = [recordId];
        let paramCount = 1;
        
        // Colonnes à exclure
        const excludedColumns = ['id', 'ID', 'HashDoublon', 'hashdoublon'];
        
        Object.entries(oldData).forEach(([key, value]) => {
            // Exclure les colonnes non modifiables
            if (excludedColumns.includes(key) || excludedColumns.includes(key.toLowerCase())) {
                console.log(`⚠️ Colonne exclue: ${key}`);
                return;
            }
            
            paramCount++;
            setClauses.push(`"${key}" = $${paramCount}`);
            
            // Gestion des types
            if (value === null) {
                params.push(null);
            } else if (key.toLowerCase().includes('date') || key.includes('Date')) {
                params.push(value ? new Date(value) : null);
            } else {
                params.push(value);
            }
        });

        if (setClauses.length === 0) {
            throw new Error('Aucune colonne modifiable à mettre à jour');
        }

        const updateQuery = `UPDATE ${tableName} SET ${setClauses.join(', ')} WHERE id = $1`;
        console.log('🔧 Requête UPDATE:', updateQuery);
        await client.query(updateQuery, params);
    }

    /**
     * ✅ Insertion manuelle avec gestion des colonnes
     */
    async executeManualInsert(client, tableName, oldData) {
        // Filtrer les colonnes - exclure ID pour l'insertion
        const filteredData = { ...oldData };
        delete filteredData.ID;
        delete filteredData.id;
        
        const columns = Object.keys(filteredData).map(k => `"${k}"`).join(', ');
        const placeholders = Object.keys(filteredData).map((_, index) => `$${index + 1}`).join(', ');

        const params = Object.values(filteredData).map(value => {
            if (value === null) return null;
            if (typeof value === 'string' && value.match(/^\d{4}-\d{2}-\d{2}/)) {
                return new Date(value);
            }
            return value;
        });

        const insertQuery = `INSERT INTO ${tableName} (${columns}) VALUES (${placeholders})`;
        console.log('🔧 Requête INSERT:', insertQuery);
        await client.query(insertQuery, params);
    }

    /**
     * ✅ Journaliser l'annulation
     */
    async logUndoAction(client, user, req, log, newData, oldData) {
        const tableName = log.tablename || log.tableaffectee;
        const recordId = log.recordid || log.ligneaffectee;

        await client.query(`
            INSERT INTO journalactivite 
            (utilisateurid, nomutilisateur, nomcomplet, role, agence, dateaction, action, 
             tableaffectee, ligneaffectee, iputilisateur, actiontype, tablename, recordid, 
             oldvalue, newvalue, adresseip, userid, detailsaction)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        `, [
            user.id, 
            user.NomUtilisateur, 
            user.NomComplet || user.NomUtilisateur, 
            user.Role, 
            user.Agence || '', 
            new Date(), 
            `Annulation de ${log.actiontype}`,
            tableName, 
            recordId ? recordId.toString() : '', 
            req.ip || '', 
            'ANNULATION', 
            tableName, 
            recordId ? recordId.toString() : '', 
            JSON.stringify(newData), 
            JSON.stringify(oldData), 
            req.ip || '', 
            user.id, 
            `Annulation de: ${log.actiontype}`
        ]);
    }

    /**
     * Journaliser une action (méthode utilitaire)
     */
    async logAction(logData) {
        try {
            await db.query(`
                INSERT INTO journalactivite (
                    utilisateurid, nomutilisateur, nomcomplet, role, agence,
                    dateaction, action, tableaffectee, ligneaffectee, iputilisateur,
                    actiontype, tablename, recordid, oldvalue, newvalue, adresseip,
                    userid, importbatchid, detailsaction
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
            `, [
                logData.utilisateurId || null,
                logData.nomUtilisateur || 'System',
                logData.nomComplet || 'System', 
                logData.role || 'System',
                logData.agence || null,
                new Date(),
                logData.action || logData.actionType,
                logData.tableName || null,
                logData.recordId ? logData.recordId.toString() : null,
                logData.ip || null,
                logData.actionType,
                logData.tableName || null,
                logData.recordId ? logData.recordId.toString() : null,
                logData.oldValue ? JSON.stringify(logData.oldValue) : null,
                logData.newValue ? JSON.stringify(logData.newValue) : null,
                logData.ip || null,
                logData.utilisateurId || null,
                logData.importBatchID || null,
                logData.details || null
            ]);
        } catch (error) {
            console.error('❌ Erreur journalisation:', error);
        }
    }

    /**
     * Statistiques d'activité avec cache
     * GET /api/journal/stats
     */
    async getStats(req, res) {
        try {
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
                    COUNT(CASE WHEN dateaction > NOW() - INTERVAL '30 days' THEN 1 END) as count_30j
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
                    date_calcul: new Date().toISOString()
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
            await client.query(`
                INSERT INTO journalactivite (
                    utilisateurid, nomutilisateur, nomcomplet, role, agence,
                    dateaction, action, iputilisateur, actiontype, detailsaction
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
            `, [
                utilisateur.id,
                utilisateur.NomUtilisateur,
                utilisateur.NomComplet || utilisateur.NomUtilisateur,
                utilisateur.Role,
                utilisateur.Agence || '',
                new Date(),
                `Nettoyage journal (>${retentionJours} jours)`,
                req.ip,
                'NETTOYAGE_JOURNAL',
                `${countASupprimer} entrées supprimées (conservation ${retentionJours} jours)`
            ]);

            // Supprimer les vieilles entrées
            const deleteResult = await client.query(`
                DELETE FROM journalactivite 
                WHERE dateaction < CURRENT_DATE - INTERVAL '${retentionJours} days'
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
     * Diagnostic du journal
     * GET /api/journal/diagnostic
     */
    async diagnostic(req, res) {
        try {
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
                    pg_database_size(current_database()) as db_size,
                    pg_size_pretty(pg_total_relation_size('journalactivite')) as table_size
                FROM journalactivite
            `);

            // Taille estimée
            const stats = result.rows[0];

            res.json({
                success: true,
                timestamp: new Date().toISOString(),
                service: 'journal',
                statistiques: {
                    total_entrees: parseInt(stats.total_entrees),
                    types_actions: parseInt(stats.types_actions),
                    utilisateurs_actifs: parseInt(stats.utilisateurs_actifs),
                    premiere_entree: stats.premiere_entree,
                    derniere_entree: stats.derniere_entree,
                    entrees_24h: parseInt(stats.entrees_24h),
                    entrees_7j: parseInt(stats.entrees_7j),
                    entrees_30j: parseInt(stats.entrees_30j)
                },
                stockage: {
                    taille_table: stats.table_size,
                    db_size_bytes: parseInt(stats.db_size)
                },
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