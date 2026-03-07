// Services/syncService.js
const db = require('../db/db');
const jwt = require('jsonwebtoken');

// ID du site siège — reçoit toutes les cartes sans filtre coordination
const SIEGE_SITE_ID = 'SIE-001';

const syncService = {
  // ----------------------------------------------------------
  // Authentifier un site avec sa clé API
  // ----------------------------------------------------------
  async authenticateSite(siteId, apiKey) {
    try {
      const result = await db.query(
        `SELECT
          s.id,
          s.nom,
          s.coordination_id,
          c.code  AS coordination_code,
          c.nom   AS coordination_nom,
          s.is_active
        FROM sites s
        JOIN coordinations c ON s.coordination_id = c.id
        WHERE s.id       = $1
          AND s.api_key  = $2
          AND s.is_active = true`,
        [siteId, apiKey]
      );
      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Erreur authenticateSite:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Générer un token JWT 24h pour le site
  // ----------------------------------------------------------
  generateSiteToken(site) {
    return jwt.sign(
      {
        site_id: site.id,
        site_nom: site.nom,
        coordination_id: site.coordination_id,
        coordination_code: site.coordination_code,
        type: 'site',
      },
      process.env.JWT_SECRET || 'votre-secret-jwt-site',
      { expiresIn: '24h' }
    );
  },

  // ----------------------------------------------------------
  // Traiter les modifications reçues d'un site (UPLOAD)
  // ----------------------------------------------------------
  async processUpload(site, modifications, lastSync) {
    let historyId;

    const histClient = await db.pool.connect();
    try {
      await histClient.query('BEGIN');
      const histResult = await histClient.query(
        `INSERT INTO sync_history (site_id, sync_start, status)
         VALUES ($1, NOW(), 'in_progress')
         RETURNING id`,
        [site.id]
      );
      historyId = histResult.rows[0].id;
      await histClient.query('COMMIT');
    } catch (err) {
      await histClient.query('ROLLBACK');
      throw err;
    } finally {
      histClient.release();
    }

    const stats = { inserts: 0, updates: 0, deletes: 0, conflicts: 0, errors: 0 };
    const processed = [];

    for (const mod of modifications || []) {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');

        // ✅ Le siège (SIE-001) n'envoie pas de modifications — lecture seule
        // Les autres sites : vérification coordination obligatoire
        if (site.id !== SIEGE_SITE_ID && mod.coordination_id !== site.coordination_id) {
          throw new Error(
            `Coordination invalide: attendu ${site.coordination_id}, reçu ${mod.coordination_id}`
          );
        }

        let result;

        if (mod.operation === 'INSERT') {
          result = await this._handleInsert(client, mod, site);
          result.was_duplicate ? stats.updates++ : stats.inserts++;
        } else if (mod.operation === 'UPDATE') {
          result = await this._handleUpdate(client, mod, site, historyId);
          result.conflict ? stats.conflicts++ : stats.updates++;
        } else if (mod.operation === 'DELETE') {
          result = await this._handleDelete(client, mod, site);
          stats.deletes++;
        } else {
          throw new Error(`Opération inconnue: ${mod.operation}`);
        }

        await client.query('COMMIT');

        processed.push({
          local_id: mod.local_id,
          pg_id: result?.pg_id || mod.pg_id,
          status: result?.conflict ? 'conflict' : 'success',
          was_duplicate: result?.was_duplicate || false,
        });
      } catch (err) {
        await client.query('ROLLBACK');
        stats.errors++;
        processed.push({ local_id: mod.local_id, error: err.message, status: 'error' });
      } finally {
        client.release();
      }
    }

    if (processed.length > 0) {
      const successIds = processed
        .filter((p) => p.status === 'success' && p.pg_id)
        .map((p) => p.pg_id);

      if (successIds.length > 0) {
        await db.query(
          `UPDATE cartes
           SET sync_status = 'synced', last_sync_attempt = NOW()
           WHERE id = ANY($1)`,
          [successIds]
        );
      }
    }

    const updClient = await db.pool.connect();
    try {
      await updClient.query('BEGIN');
      await updClient.query(
        `UPDATE sync_history
         SET sync_end           = NOW(),
             uploaded_inserts   = $1,
             uploaded_updates   = $2,
             uploaded_deletes   = $3,
             uploaded_conflicts = $4,
             status             = $5
         WHERE id = $6`,
        [
          stats.inserts,
          stats.updates,
          stats.deletes,
          stats.conflicts,
          stats.errors > 0 ? 'partial' : 'success',
          historyId,
        ]
      );

      await updClient.query(
        `UPDATE sites
         SET last_sync_at    = NOW(),
             last_sync_error = $2
         WHERE id = $1`,
        [site.id, stats.errors > 0 ? `${stats.errors} erreur(s)` : null]
      );

      await updClient.query('COMMIT');
    } catch (err) {
      await updClient.query('ROLLBACK');
      throw err;
    } finally {
      updClient.release();
    }

    await db.query(`SELECT refresh_site_sync_stats($1)`, [site.id]);

    const download = await this.prepareDownload(site, lastSync, 5000);

    return { historyId, uploaded: stats, download, processed };
  },

  // ----------------------------------------------------------
  // ✅ CORRIGÉ — Gérer une insertion SANS créer de doublons
  // ----------------------------------------------------------
  async _handleInsert(client, mod, site) {
    if (mod.local_id) {
      const byLocalId = await client.query(
        `SELECT id FROM cartes
         WHERE local_id             = $1
           AND site_proprietaire_id = $2`,
        [mod.local_id, site.id]
      );
      if (byLocalId.rows.length > 0) {
        console.log(`♻️  INSERT ignoré (local_id déjà connu): local_id=${mod.local_id}`);
        return { pg_id: byLocalId.rows[0].id };
      }
    }

    const result = await client.query(
      `INSERT INTO cartes (
        coordination_id,
        site_proprietaire_id,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        rangement,
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        version,
        sync_timestamp,
        sync_status,
        local_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 1, NOW(), 'synced', $12)
      ON CONFLICT (nom, prenoms, "DATE DE NAISSANCE", "LIEU NAISSANCE", rangement)
      WHERE deleted_at IS NULL
      DO UPDATE SET
        local_id             = COALESCE(cartes.local_id, EXCLUDED.local_id),
        site_proprietaire_id = COALESCE(cartes.site_proprietaire_id, EXCLUDED.site_proprietaire_id),
        contact              = COALESCE(NULLIF(cartes.contact, ''),              EXCLUDED.contact),
        delivrance           = COALESCE(NULLIF(cartes.delivrance, ''),           EXCLUDED.delivrance),
        "CONTACT DE RETRAIT" = COALESCE(NULLIF(cartes."CONTACT DE RETRAIT", ''), EXCLUDED."CONTACT DE RETRAIT"),
        "DATE DE DELIVRANCE" = COALESCE(cartes."DATE DE DELIVRANCE",             EXCLUDED."DATE DE DELIVRANCE"),
        sync_status          = 'synced',
        sync_timestamp       = NOW()
      WHERE
        cartes.coordination_id = EXCLUDED.coordination_id
      RETURNING id, (xmax <> 0) AS was_existing`,
      [
        mod.coordination_id,
        site.id,
        mod.nom,
        mod.prenoms,
        mod.date_naissance || null,
        mod.lieu_naissance || null,
        mod.rangement || null,
        mod.contact || null,
        mod.delivrance || null,
        mod.contact_retrait || null,
        mod.date_delivrance || null,
        mod.local_id || null,
      ]
    );

    if (result.rows.length === 0) {
      const existingOtherCoord = await client.query(
        `SELECT id, coordination_id FROM cartes
         WHERE nom                 = $1
           AND prenoms             = $2
           AND "DATE DE NAISSANCE" = $3
           AND "LIEU NAISSANCE"    = $4
           AND rangement           = $5
           AND deleted_at IS NULL`,
        [
          mod.nom,
          mod.prenoms,
          mod.date_naissance || null,
          mod.lieu_naissance || null,
          mod.rangement || null,
        ]
      );

      if (existingOtherCoord.rows.length > 0) {
        const other = existingOtherCoord.rows[0];
        console.warn(
          `⚠️  Doublon inter-coordination: "${mod.nom} ${mod.prenoms}" → pg_id=${other.id}`
        );
        return { pg_id: other.id, was_duplicate: true, cross_coordination: true };
      }

      throw new Error(`INSERT impossible pour "${mod.nom} ${mod.prenoms}" — conflit non résolu`);
    }

    const row = result.rows[0];
    const wasDuplicate = row.was_existing === true;

    if (wasDuplicate) {
      console.log(`🔗 Doublon rattaché: "${mod.nom} ${mod.prenoms}" → pg_id=${row.id}`);
    } else {
      console.log(`🆕 Nouvelle carte: "${mod.nom} ${mod.prenoms}" → pg_id=${row.id}`);
    }

    return { pg_id: row.id, was_duplicate: wasDuplicate };
  },

  // ----------------------------------------------------------
  // Last-Write-Wins via sync_timestamp
  // ----------------------------------------------------------
  async _handleUpdate(client, mod, site, historyId) {
    const serverRow = await client.query(
      `SELECT id, version, sync_timestamp, delivrance,
              "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", contact
       FROM cartes WHERE id = $1`,
      [mod.pg_id]
    );

    if (serverRow.rows.length === 0) {
      throw new Error(`Carte ${mod.pg_id} introuvable`);
    }

    const server = serverRow.rows[0];
    const serverTime = new Date(server.sync_timestamp);
    const clientTime = mod.sync_timestamp ? new Date(mod.sync_timestamp) : new Date(0);

    if (clientTime <= serverTime) {
      await client.query(
        `INSERT INTO sync_conflicts (
          site_id, sync_history_id, carte_id, coordination_id,
          conflict_type, conflict_field,
          client_value, server_value,
          resolution_status, resolution_method
        ) VALUES ($1, $2, $3, $4, 'timestamp_conflict', 'sync_timestamp',
                  $5, $6, 'resolved', 'last_write_wins')`,
        [
          site.id,
          historyId,
          mod.pg_id,
          site.coordination_id,
          JSON.stringify(mod),
          JSON.stringify(server),
        ]
      );
      return { conflict: true, pg_id: mod.pg_id, winner: 'server' };
    }

    const updates = [];
    const params = [];
    let paramIdx = 0;

    const fieldsMap = {
      delivrance: '"delivrance"',
      contact_retrait: '"CONTACT DE RETRAIT"',
      date_delivrance: '"DATE DE DELIVRANCE"',
      contact: '"contact"',
      nom: '"nom"',
      prenoms: '"prenoms"',
      lieu_naissance: '"LIEU NAISSANCE"',
      rangement: '"rangement"',
    };

    for (const [modKey, sqlCol] of Object.entries(fieldsMap)) {
      if (mod[modKey] !== undefined) {
        paramIdx++;
        updates.push(`${sqlCol} = $${paramIdx}`);
        params.push(mod[modKey]);
      }
    }

    if (updates.length === 0) return { pg_id: mod.pg_id };

    params.push(mod.pg_id);
    await client.query(
      `UPDATE cartes SET ${updates.join(', ')} WHERE id = $${paramIdx + 1}`,
      params
    );

    return { pg_id: mod.pg_id };
  },

  // ----------------------------------------------------------
  // Soft delete
  // ----------------------------------------------------------
  async _handleDelete(client, mod, site) {
    await client.query(
      `UPDATE cartes
       SET deleted_at  = NOW(),
           sync_status = 'synced'
       WHERE id                   = $1
         AND site_proprietaire_id = $2
         AND deleted_at IS NULL`,
      [mod.pg_id, site.id]
    );
    return { pg_id: mod.pg_id };
  },

  // ----------------------------------------------------------
  // Download différentiel
  // Tout le monde reçoit toutes les cartes
  // ----------------------------------------------------------
  async prepareDownload(site, since, limit = 5000) {
    try {
      const sinceDate = since
        ? new Date(since).toISOString()
        : new Date('2000-01-01').toISOString();

      let result;

      if (site.id === SIEGE_SITE_ID) {
        console.log(`🏛️  Download SIEGE (${site.id}): toutes coordinations confondues`);
        result = await db.query(
          `SELECT * FROM cartes
           WHERE deleted_at IS NULL
             AND (sync_timestamp > $1::TIMESTAMP OR updated_at > $1::TIMESTAMP)
           ORDER BY sync_timestamp DESC
           LIMIT $2`,
          [sinceDate, limit]
        );
      } else {
        // Tous les sites reçoivent toutes les cartes via get_changes_since
        result = await db.query(`SELECT * FROM get_changes_since($1, $2::TIMESTAMP, $3)`, [
          site.id,
          sinceDate,
          limit,
        ]);
      }

      console.log(
        `📥 Download pour ${site.id}: ${result.rows.length} enregistrements depuis ${sinceDate}`
      );
      return result.rows;
    } catch (error) {
      console.error('❌ Erreur prepareDownload:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Confirmer la réception du download
  // ----------------------------------------------------------
  async confirmDownload(siteId, historyId, appliedIds, errors) {
    try {
      if (appliedIds && appliedIds.length > 0) {
        const numericIds = appliedIds.map((id) => parseInt(id)).filter((id) => !isNaN(id));
        if (numericIds.length > 0) {
          await db.query(`SELECT mark_as_synced($1, $2)`, [siteId, numericIds]);
        }
      }

      await db.query(
        `UPDATE sync_history
         SET downloaded_count   = $1,
             downloaded_inserts = $2,
             downloaded_updates = $3,
             error_message      = $4
         WHERE id = $5 AND site_id = $6`,
        [
          appliedIds?.length || 0,
          appliedIds?.filter((id) => String(id).includes('new')).length || 0,
          appliedIds?.filter((id) => !String(id).includes('new')).length || 0,
          errors ? JSON.stringify(errors) : null,
          historyId,
          siteId,
        ]
      );
    } catch (error) {
      console.error('❌ Erreur confirmDownload:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Statut détaillé d'un site
  // ----------------------------------------------------------
  async getSiteStatus(siteId) {
    try {
      const result = await db.query(`SELECT * FROM v_sync_status WHERE site_id = $1`, [siteId]);

      if (result.rows.length === 0) return null;

      const s = result.rows[0];
      return {
        total_cards: s.total_cards,
        pending_cards: s.pending_cards,
        synced_cards: s.synced_cards,
        conflict_cards: s.conflict_cards,
        taux_sync_pct: s.taux_sync_pct,
        last_sync_at: s.last_sync_at,
        last_successful_sync: s.last_successful_sync,
        conflicts_pending: s.conflicts_pending,
        sync_health: s.sync_health,
        last_error: s.last_sync_error,
      };
    } catch (error) {
      console.error('❌ Erreur getSiteStatus:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // Tableau de bord global (admin)
  // ----------------------------------------------------------
  async getGlobalDashboard() {
    try {
      const [dashboard, sites, conflicts] = await Promise.all([
        db.query(`SELECT * FROM v_sync_dashboard`),
        db.query(`SELECT * FROM v_sync_status`),
        db.query(`SELECT * FROM v_conflicts_pending LIMIT 50`),
      ]);

      return {
        global: dashboard.rows[0],
        sites: sites.rows,
        conflicts: conflicts.rows,
      };
    } catch (error) {
      console.error('❌ Erreur getGlobalDashboard:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // ✅ Récupérer les utilisateurs selon le RÔLE de l'utilisateur connecté
  //
  // Appelé depuis la route GET /api/sync/users
  // Le logiciel Python envoie le rôle via le header : X-User-Role
  // Le logiciel Python envoie son site via le header : X-User-Site
  //
  // Opérateur    → comptes du site uniquement (role = Opérateur)
  // Chef         → son compte + opérateurs de ses sites
  // Gestionnaire → son compte + chefs + opérateurs de sa coordination
  // Admin/Siège  → tous les comptes de toutes les coordinations
  //
  // SÉCURITÉ HORS-LIGNE :
  // Le SQLite local ne contiendra QUE les comptes autorisés.
  // Lors de la déconnexion, les comptes étrangers au site sont nettoyés.
  // ----------------------------------------------------------
  async getUsersForSite(siteId, userRole, userSiteId) {
    const client = await db.pool.connect();
    try {
      const siteResult = await client.query(`SELECT coordination_id FROM sites WHERE id = $1`, [
        siteId,
      ]);

      if (siteResult.rows.length === 0) {
        console.warn(`⚠️ Site introuvable: ${siteId}`);
        return [];
      }

      const coordinationId = siteResult.rows[0].coordination_id;
      const role = (userRole || 'Opérateur').toLowerCase().trim();
      const effectiveSiteId = userSiteId || siteId;

      console.log(`👥 getUsersForSite: site=${siteId} rôle="${role}" userSite=${effectiveSiteId}`);

      // Colonnes SELECT communes
      const SELECT_COLS = `
        u.id, u.nomutilisateur, u.nomcomplet, u.email, u.motdepasse,
        u.role, u.agence, u.coordination, u.coordination_id,
        u.actif, u.niveau_acces, u.peut_voir_stats, u.updated_at,
        us_main.site_id AS site_id,
        s.api_key       AS site_api_key
      `;
      const FROM_JOINS = `
        FROM utilisateurs u
        LEFT JOIN utilisateur_sites us_main
          ON us_main.utilisateur_id = u.id AND us_main.est_site_principal = true
        LEFT JOIN sites s ON s.id = us_main.site_id
      `;

      let result;

      // ── Administrateur ou Siège → tous les comptes ──────────────────────
      if (role === 'admin' || role === 'administrateur' || siteId === SIEGE_SITE_ID) {
        console.log(`🏛️  Admin/Siège: tous les utilisateurs`);
        result = await client.query(
          `SELECT ${SELECT_COLS} ${FROM_JOINS}
           WHERE u.actif = true
           ORDER BY u.coordination_id ASC, u.nomcomplet ASC`
        );
      }

      // ── Gestionnaire → son compte + chefs + opérateurs de sa coordination
      else if (role === 'manager' || role === 'gestionnaire') {
        console.log(`📋 Gestionnaire: coordination ${coordinationId}`);
        result = await client.query(
          `SELECT ${SELECT_COLS} ${FROM_JOINS}
           WHERE u.actif = true
             AND u.coordination_id = $1
           ORDER BY u.role ASC, u.nomcomplet ASC`,
          [coordinationId]
        );
      }

      // ── Chef d'équipe → son compte + opérateurs de ses sites ────────────
      else if (role === 'chef' || role === "chef d'équipe") {
        // Récupérer tous les sites assignés au chef connecté
        const sitesDuChef = await client.query(
          `SELECT DISTINCT us.site_id
           FROM utilisateur_sites us
           JOIN utilisateurs u ON u.id = us.utilisateur_id
           WHERE u.actif = true
             AND us.site_id = $1`,
          [effectiveSiteId]
        );

        const siteIds =
          sitesDuChef.rows.length > 0 ? sitesDuChef.rows.map((r) => r.site_id) : [effectiveSiteId];

        console.log(`👨‍💼 Chef: sites [${siteIds.join(', ')}]`);

        const placeholders = siteIds.map((_, i) => `$${i + 1}`).join(', ');
        result = await client.query(
          `SELECT DISTINCT ${SELECT_COLS} ${FROM_JOINS}
           WHERE u.actif = true
             AND us_main.site_id IN (${placeholders})
             AND u.role IN ('Opérateur', 'Chef d''équipe')
           ORDER BY u.nomcomplet ASC`,
          siteIds
        );
      }

      // ── Opérateur → comptes du site uniquement ───────────────────────────
      else {
        console.log(`👤 Opérateur: site ${effectiveSiteId}`);
        result = await client.query(
          `SELECT ${SELECT_COLS} ${FROM_JOINS}
           WHERE u.actif = true
             AND us_main.site_id = $1
             AND u.role = 'Opérateur'
           ORDER BY u.nomcomplet ASC`,
          [effectiveSiteId]
        );
      }

      console.log(`👥 Résultat: ${result.rows.length} utilisateur(s) (rôle: ${role})`);
      return result.rows;
    } catch (error) {
      console.error('❌ Erreur getUsersForSite:', error);
      throw error;
    } finally {
      client.release();
    }
  },
};

module.exports = syncService;
