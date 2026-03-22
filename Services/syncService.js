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

        // Le siège (SIE-001) peut envoyer des modifications pour toutes les coordinations
        // Les autres sites : vérification coordination obligatoire
        const modCoordId = parseInt(mod.coordination_id, 10);
        if (site.id !== SIEGE_SITE_ID && modCoordId !== site.coordination_id) {
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

    // Préparer un premier batch de download pour confirmer la réception
    const download = await this.prepareDownload(site, lastSync, { limit: 5000 });

    return { historyId, uploaded: stats, download: download.records, processed };
  },

  // ----------------------------------------------------------
  // ✅ Gérer une insertion SANS créer de doublons
  //
  // Logique de détection (3 niveaux) :
  //
  // Niveau 1 — local_id (même poste, même carte)
  //   → Retour immédiat du pg_id existant (idempotence)
  //
  // Niveau 2 — 5 champs identitaires (même coordination)
  //   → ON CONFLICT : mise à jour des champs manquants + rattachement local_id
  //
  // Niveau 3 — 5 champs identitaires (autre coordination)
  //   → BLOQUÉ : retour pg_id sans modification (lecture seule)
  //
  // ✅ CORRECTION : site_proprietaire_id respecté depuis le client
  //   (ANC-001 pour COCODY, ANY-001 pour YOPOUGON, ASU-001 pour SUD)
  //   Le siège (SIE-001) ne doit pas être propriétaire des cartes de terrain
  // ----------------------------------------------------------
  async _handleInsert(client, mod, site) {
    // ── Déterminer le site propriétaire ──────────────────────────────────────
    // Priorité : site_proprietaire_id envoyé par le client (calculé selon coordination)
    // Fallback : site connecté
    const siteProprietaireId = mod.site_proprietaire_id || site.id;

    // ── Niveau 1 : idempotence locale ───────────────────────────────────────
    if (mod.local_id) {
      const byLocalId = await client.query(
        `SELECT id FROM cartes
         WHERE local_id             = $1
           AND site_proprietaire_id = $2`,
        [mod.local_id, siteProprietaireId]
      );
      if (byLocalId.rows.length > 0) {
        console.log(`♻️  INSERT ignoré (local_id déjà connu): local_id=${mod.local_id}`);
        return { pg_id: byLocalId.rows[0].id };
      }
    }

    // ── Niveau 2 : ON CONFLICT sur 5 champs identitaires ────────────────────
    const result = await client.query(
      `INSERT INTO cartes (
        coordination_id,
        site_proprietaire_id,
        coordination,
        "LIEU D'ENROLEMENT",
        "SITE DE RETRAIT",
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 1, NOW(), 'synced', $15)
      ON CONFLICT (nom, prenoms, "DATE DE NAISSANCE", "LIEU NAISSANCE", COALESCE(NULLIF(contact,''),'__VIDE__'))
      WHERE deleted_at IS NULL
      DO UPDATE SET
        local_id             = COALESCE(cartes.local_id, EXCLUDED.local_id),
        site_proprietaire_id = COALESCE(cartes.site_proprietaire_id, EXCLUDED.site_proprietaire_id),
        coordination         = COALESCE(NULLIF(cartes.coordination, ''),         EXCLUDED.coordination),
        "LIEU D'ENROLEMENT"  = COALESCE(NULLIF(cartes."LIEU D'ENROLEMENT", ''), EXCLUDED."LIEU D'ENROLEMENT"),
        "SITE DE RETRAIT"    = COALESCE(NULLIF(cartes."SITE DE RETRAIT", ''),    EXCLUDED."SITE DE RETRAIT"),
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
        mod.coordination_id, // $1
        siteProprietaireId, // $2 ✅ corrigé : site du client, pas SIE-001
        mod.coordination || null, // $3
        mod.lieu_enrollement || null, // $4
        mod.site_retrait || null, // $5
        mod.nom, // $6
        mod.prenoms, // $7
        mod.date_naissance || null, // $8
        mod.lieu_naissance || null, // $9
        mod.rangement || null, // $10
        mod.contact || null, // $11
        mod.delivrance || null, // $12
        mod.contact_retrait || null, // $13
        mod.date_delivrance || null, // $14
        mod.local_id || null, // $15
      ]
    );

    // ── Niveau 3 : doublon d'une AUTRE coordination ──────────────────────────
    if (result.rows.length === 0) {
      const existingOtherCoord = await client.query(
        `SELECT id, coordination_id FROM cartes
         WHERE nom                 = $1
           AND prenoms             = $2
           AND "DATE DE NAISSANCE" = $3
           AND "LIEU NAISSANCE"    = $4
           AND COALESCE(NULLIF(contact,''),'__VIDE__') = COALESCE(NULLIF($5,''),'__VIDE__')
           AND deleted_at IS NULL`,
        [
          mod.nom,
          mod.prenoms,
          mod.date_naissance || null,
          mod.lieu_naissance || null,
          mod.contact || null,
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
      console.log(
        `🆕 Nouvelle carte: "${mod.nom} ${mod.prenoms}" → pg_id=${row.id} | site=${siteProprietaireId}`
      );
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
        params.push(mod[modKey] || null);
      }
    }

    if (updates.length === 0) return { pg_id: mod.pg_id };

    params.push(mod.pg_id);
    await client.query(
      `UPDATE cartes SET ${updates.join(', ')}, sync_timestamp = NOW() WHERE id = $${paramIdx + 1}`,
      params
    );

    return { pg_id: mod.pg_id };
  },

  // ----------------------------------------------------------
  // ✅ Soft delete — CORRECTION : le siège peut supprimer toutes les cartes
  // Les autres sites ne peuvent supprimer que leurs propres cartes
  // ----------------------------------------------------------
  async _handleDelete(client, mod, site) {
    if (site.id === SIEGE_SITE_ID) {
      // Le siège supprime sans filtre site_proprietaire_id
      await client.query(
        `UPDATE cartes
         SET deleted_at  = NOW(),
             sync_status = 'synced'
         WHERE id          = $1
           AND deleted_at IS NULL`,
        [mod.pg_id]
      );
      console.log(`🗑️ Siège: suppression carte pg_id=${mod.pg_id}`);
    } else {
      // Les autres sites : seulement leurs propres cartes
      await client.query(
        `UPDATE cartes
         SET deleted_at  = NOW(),
             sync_status = 'synced'
         WHERE id                   = $1
           AND site_proprietaire_id = $2
           AND deleted_at IS NULL`,
        [mod.pg_id, site.id]
      );
      console.log(`🗑️ Site ${site.id}: suppression carte pg_id=${mod.pg_id}`);
    }
    return { pg_id: mod.pg_id };
  },

  // ----------------------------------------------------------
  // ✅ KEYSET PAGINATION — Download optimisé pour millions de données
  //
  // Paramètres :
  //   site       : objet site authentifié
  //   since      : timestamp ISO depuis lequel charger (null = tout)
  //   options    : { limit, last_id }
  //     limit    : nb max de cartes par batch (défaut 5000)
  //     last_id  : id de la dernière carte du batch précédent (keyset cursor)
  //
  // Réponse :
  //   { records, count, has_more, next_since, next_last_id }
  // ----------------------------------------------------------
  async prepareDownload(site, since, options = {}) {
    try {
      const limit = Math.min(parseInt(options.limit) || 5000, 10000);
      const last_id = Math.max(parseInt(options.last_id) || 0, 0);
      const sinceDate = since
        ? new Date(since).toISOString()
        : new Date('2000-01-01').toISOString();

      const fetchLimit = limit + 1; // +1 pour détecter has_more sans COUNT(*)

      let query, params;

      if (last_id > 0) {
        // ✅ CORRECTION bug 1M données : batch suivant conserve le filtre since
        // AVANT : filtre since disparaissait → téléchargement de TOUTES les cartes
        // APRÈS : double filtre id + since → seulement les cartes modifiées
        query = `
          SELECT * FROM cartes
          WHERE deleted_at IS NULL
            AND id > $1
            AND (sync_timestamp >= $2::TIMESTAMP OR updated_at >= $2::TIMESTAMP)
          ORDER BY id ASC
          LIMIT $3
        `;
        params = [last_id, sinceDate, fetchLimit];
      } else {
        // Premier batch — filtre par timestamp uniquement
        query = `
          SELECT * FROM cartes
          WHERE deleted_at IS NULL
            AND (sync_timestamp >= $1::TIMESTAMP OR updated_at >= $1::TIMESTAMP)
          ORDER BY id ASC
          LIMIT $2
        `;
        params = [sinceDate, fetchLimit];
      }

      console.log(`📥 Download ${site.id}: keyset since=${sinceDate} last_id=${last_id}`);

      const result = await db.query(query, params);
      const allRows = result.rows;

      const hasMore = allRows.length > limit;
      const records = hasMore ? allRows.slice(0, limit) : allRows;
      const count = records.length;

      const lastRecord = count > 0 ? records[count - 1] : null;
      const next_last_id = lastRecord ? lastRecord.id : last_id;
      const next_since = lastRecord
        ? new Date(lastRecord.sync_timestamp || sinceDate).toISOString()
        : sinceDate;

      console.log(
        `📥 Download ${site.id}: ${count} enregistrements` +
          ` | has_more=${hasMore}` +
          ` | next_last_id=${next_last_id}`
      );

      return {
        records,
        count,
        has_more: hasMore,
        next_since: hasMore ? next_since : null,
        next_last_id: hasMore ? next_last_id : null,
        since: sinceDate,
      };
    } catch (error) {
      console.error('❌ Erreur prepareDownload:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // ✅ NOUVEAU : Compter les cartes à télécharger avant le pull
  // Utilisé par le client pour afficher la progression et détecter
  // si une resync complète est nécessaire
  // ----------------------------------------------------------
  async countDownload(site, since) {
    try {
      const sinceDate = since
        ? new Date(since).toISOString()
        : new Date('2000-01-01').toISOString();

      const isFullSync = sinceDate <= new Date('2000-01-02').toISOString();

      const result = await db.query(
        `SELECT COUNT(*) AS total
         FROM cartes
         WHERE deleted_at IS NULL
           AND (sync_timestamp >= $1::TIMESTAMP OR updated_at >= $1::TIMESTAMP)`,
        [sinceDate]
      );

      const total = parseInt(result.rows[0].total) || 0;

      console.log(`📊 countDownload ${site.id}: ${total} cartes depuis ${sinceDate}`);

      return {
        total,
        since: sinceDate,
        is_full_sync: isFullSync,
      };
    } catch (error) {
      console.error('❌ Erreur countDownload:', error);
      throw error;
    }
  },

  // ----------------------------------------------------------
  // ✅ NOUVEAU : Vérification de cohérence finale
  // Le client appelle cet endpoint après chaque sync pour vérifier
  // que son comptage local correspond au comptage serveur.
  // Si écart → le client déclenche une resync complète automatiquement.
  // ----------------------------------------------------------
  async verifySync(site) {
    try {
      // Le siège voit toutes les cartes, les autres sont filtrés par coordination
      const isSiege = site.id === SIEGE_SITE_ID;

      let result, lastModified;

      if (isSiege) {
        // Siège → toutes les cartes
        result = await db.query(`SELECT COUNT(*) AS total FROM cartes WHERE deleted_at IS NULL`);
        lastModified = await db.query(
          `SELECT MAX(GREATEST(sync_timestamp, updated_at)) AS last_ts
           FROM cartes WHERE deleted_at IS NULL`
        );
      } else {
        // Site normal → filtrer par coordination
        result = await db.query(
          `SELECT COUNT(*) AS total
           FROM cartes
           WHERE deleted_at IS NULL
             AND coordination_id = $1`,
          [site.coordination_id]
        );
        lastModified = await db.query(
          `SELECT MAX(GREATEST(sync_timestamp, updated_at)) AS last_ts
           FROM cartes
           WHERE deleted_at IS NULL
             AND coordination_id = $1`,
          [site.coordination_id]
        );
      }

      const totalServeur = parseInt(result.rows[0].total) || 0;
      const lastTs = lastModified.rows[0]?.last_ts || null;

      console.log(
        `🔍 verifySync ${site.id} (${isSiege ? 'siège' : 'site'}): ${totalServeur} cartes | last_ts=${lastTs}`
      );

      return {
        total_serveur: totalServeur,
        coordination_id: site.coordination_id,
        last_modified: lastTs,
        verified_at: new Date().toISOString(),
      };
    } catch (error) {
      console.error('❌ Erreur verifySync:', error);
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

      if (historyId) {
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
      }
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
  // Récupérer les utilisateurs selon le RÔLE de l'utilisateur connecté
  //
  // Opérateur    → comptes du site uniquement
  // Chef         → son compte + opérateurs de ses sites
  // Gestionnaire → son compte + chefs + opérateurs de sa coordination
  // Admin/Siège  → tous les comptes de toutes les coordinations
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

  /**
   * Retourne toutes les coordinations actives.
   * Inclus dans la réponse login pour alimenter la table locale Python.
   */
  async getAllCoordinations() {
    try {
      const result = await db.query('SELECT id, nom, code FROM coordinations ORDER BY nom ASC');
      return result.rows;
    } catch (error) {
      console.error('❌ Erreur getAllCoordinations:', error);
      return [];
    }
  },
};

module.exports = syncService;
