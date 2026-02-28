// Services/syncService.js
const db = require('../db/db');
const jwt = require('jsonwebtoken');

/**
 * Service de synchronisation
 * Contient toute la logique métier
 */
const syncService = {
  /**
   * Authentifier un site avec sa clé API
   */
  async authenticateSite(siteId, apiKey) {
    try {
      const result = await db.query(
        `
        SELECT 
          s.id,
          s.nom,
          s.coordination_id,
          c.code as coordination_code,
          c.nom as coordination_nom,
          s.is_active
        FROM sites s
        JOIN coordinations c ON s.coordination_id = c.id
        WHERE s.id = $1 
          AND s.api_key = $2 
          AND s.is_active = true
      `,
        [siteId, apiKey]
      );

      return result.rows[0] || null;
    } catch (error) {
      console.error('❌ Erreur authenticateSite:', error);
      throw error;
    }
  },

  /**
   * Générer un token JWT pour le site
   */
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

  /**
   * Traiter les modifications reçues d'un site
   */
  async processUpload(site, modifications, lastSync) {
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Créer l'entrée dans l'historique
      const historyResult = await client.query(
        `
        INSERT INTO sync_history (
          site_id, sync_start, status
        ) VALUES ($1, NOW(), 'in_progress')
        RETURNING id
      `,
        [site.id]
      );

      const historyId = historyResult.rows[0].id;

      // 2. Traiter chaque modification
      const uploaded = {
        inserts: 0,
        updates: 0,
        deletes: 0,
        conflicts: 0,
        errors: 0,
      };

      const processed = [];

      for (const mod of modifications || []) {
        try {
          // 🔐 VALIDATION CRITIQUE : la coordination doit correspondre
          if (mod.coordination_id !== site.coordination_id) {
            throw new Error(
              `Coordination invalide: attendu ${site.coordination_id}, reçu ${mod.coordination_id}`
            );
          }

          let result;

          if (mod.operation === 'INSERT') {
            result = await this._handleInsert(client, mod, site);
            uploaded.inserts++;
          } else if (mod.operation === 'UPDATE') {
            result = await this._handleUpdate(client, mod, site, historyId);
            if (result.conflict) {
              uploaded.conflicts++;
            } else {
              uploaded.updates++;
            }
          } else if (mod.operation === 'DELETE') {
            result = await this._handleDelete(client, mod, site);
            uploaded.deletes++;
          } else {
            throw new Error(`Opération inconnue: ${mod.operation}`);
          }

          processed.push({
            local_id: mod.local_id,
            pg_id: result?.pg_id || mod.pg_id,
            status: result?.conflict ? 'conflict' : 'success',
          });
        } catch (error) {
          uploaded.errors++;
          processed.push({
            local_id: mod.local_id,
            error: error.message,
            status: 'error',
          });
        }
      }

      // 3. Mettre à jour l'historique
      await client.query(
        `
        UPDATE sync_history SET
          sync_end = NOW(),
          uploaded_inserts = $1,
          uploaded_updates = $2,
          uploaded_deletes = $3,
          uploaded_conflicts = $4,
          status = $5
        WHERE id = $6
      `,
        [
          uploaded.inserts,
          uploaded.updates,
          uploaded.deletes,
          uploaded.conflicts,
          uploaded.errors > 0 ? 'partial' : 'success',
          historyId,
        ]
      );

      // 4. Mettre à jour les stats du site
      await client.query(
        `
        UPDATE sites SET
          last_sync_at = NOW(),
          last_sync_status = $2
        WHERE id = $1
      `,
        [site.id, uploaded.errors > 0 ? 'partial' : 'success']
      );

      await client.query('COMMIT');

      // 5. Préparer les données à renvoyer
      const download = await this.prepareDownload(site, lastSync, 1000);

      return {
        historyId,
        uploaded,
        download,
        processed,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  /**
   * Gérer une insertion
   */
  async _handleInsert(client, mod, site) {
    const result = await client.query(
      `
      INSERT INTO cartes (
        coordination_id,
        site_proprietaire_id,
        nom,
        prenoms,
        "DATE DE NAISSANCE",
        "LIEU NAISSANCE",
        contact,
        delivrance,
        "CONTACT DE RETRAIT",
        "DATE DE DELIVRANCE",
        version,
        sync_timestamp,
        local_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1, NOW(), $11)
      RETURNING id
    `,
      [
        mod.coordination_id,
        site.id,
        mod.nom,
        mod.prenoms,
        mod.date_naissance,
        mod.lieu_naissance,
        mod.contacts,
        mod.delivrance,
        mod.contact_retrait,
        mod.date_delivrance,
        mod.local_id,
      ]
    );

    return { pg_id: result.rows[0].id };
  },

  /**
   * Gérer une mise à jour
   */
  async _handleUpdate(client, mod, site, historyId) {
    // Vérifier la version
    const checkVersion = await client.query(
      `
      SELECT version FROM cartes 
      WHERE id = $1 AND site_proprietaire_id = $2
    `,
      [mod.pg_id, site.id]
    );

    if (checkVersion.rows.length === 0) {
      throw new Error(`Carte ${mod.pg_id} introuvable ou non propriétaire`);
    }

    const serverVersion = checkVersion.rows[0].version;

    if (mod.version < serverVersion) {
      // Conflit détecté
      await client.query(
        `
        INSERT INTO sync_conflicts (
          site_id, sync_history_id, carte_id,
          coordination_id, conflict_type,
          client_value, server_value
        ) VALUES ($1, $2, $3, $4, 'version_mismatch', $5, $6)
      `,
        [
          site.id,
          historyId,
          mod.pg_id,
          site.coordination_id,
          JSON.stringify(mod),
          JSON.stringify(checkVersion.rows[0]),
        ]
      );

      return { conflict: true };
    }

    // Mise à jour normale
    const updates = [];
    const params = [];
    let paramCount = 0;

    // Champs modifiables
    if (mod.delivrance !== undefined) {
      paramCount++;
      updates.push(`"delivrance" = $${paramCount}`);
      params.push(mod.delivrance);
    }
    if (mod.contact_retrait !== undefined) {
      paramCount++;
      updates.push(`"CONTACT DE RETRAIT" = $${paramCount}`);
      params.push(mod.contact_retrait);
    }
    if (mod.date_delivrance !== undefined) {
      paramCount++;
      updates.push(`"DATE DE DELIVRANCE" = $${paramCount}`);
      params.push(mod.date_delivrance);
    }
    if (mod.contacts !== undefined) {
      paramCount++;
      updates.push(`"contact" = $${paramCount}`);
      params.push(mod.contacts);
    }

    // Toujours mettre à jour version et timestamp
    paramCount++;
    updates.push(`version = version + 1`);
    paramCount++;
    updates.push(`sync_timestamp = NOW()`);

    params.push(mod.pg_id, site.id);

    await client.query(
      `
      UPDATE cartes 
      SET ${updates.join(', ')}
      WHERE id = $${paramCount + 1} AND site_proprietaire_id = $${paramCount + 2}
    `,
      params
    );

    return { pg_id: mod.pg_id };
  },

  /**
   * Gérer une suppression
   */
  async _handleDelete(client, mod, site) {
    await client.query(
      `
      DELETE FROM cartes 
      WHERE id = $1 AND site_proprietaire_id = $2
    `,
      [mod.pg_id, site.id]
    );

    return { pg_id: mod.pg_id };
  },

  /**
   * Préparer les données à envoyer à un site
   */
  async prepareDownload(site, since, limit = 1000) {
    try {
      const result = await db.query(
        `
        SELECT 
          c.id as pg_id,
          c.coordination_id,
          coord.code as coordination_code,
          coord.nom as coordination_nom,
          c.site_proprietaire_id,
          sites.nom as site_nom,
          c.nom,
          c.prenoms,
          to_char(c."DATE DE NAISSANCE", 'DD/MM/YYYY') as date_naissance,
          c."LIEU NAISSANCE",
          c.contact,
          c.delivrance,
          c."CONTACT DE RETRAIT",
          to_char(c."DATE DE DELIVRANCE", 'DD/MM/YYYY') as date_delivrance,
          c.version,
          c.sync_timestamp
        FROM cartes c
        JOIN coordinations coord ON c.coordination_id = coord.id
        JOIN sites ON c.site_proprietaire_id = sites.id
        WHERE c.coordination_id != $1
          AND c.site_proprietaire_id != $2
          AND c.sync_timestamp > COALESCE($3::timestamp, '2000-01-01')
        ORDER BY c.sync_timestamp DESC
        LIMIT $4
      `,
        [site.coordination_id, site.id, since, limit]
      );

      return result.rows;
    } catch (error) {
      console.error('❌ Erreur prepareDownload:', error);
      throw error;
    }
  },

  /**
   * Confirmer le téléchargement
   */
  async confirmDownload(siteId, historyId, appliedIds, errors) {
    try {
      await db.query(
        `
        UPDATE sync_history 
        SET downloaded_count = $1,
            downloaded_inserts = $2,
            downloaded_updates = $3,
            error_message = $4
        WHERE id = $5 AND site_id = $6
      `,
        [
          appliedIds?.length || 0,
          appliedIds?.filter((id) => id.includes('new')).length || 0,
          appliedIds?.filter((id) => !id.includes('new')).length || 0,
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

  /**
   * Obtenir le statut d'un site
   */
  async getSiteStatus(siteId) {
    try {
      const result = await db.query(
        `
        SELECT 
          total_cards,
          pending_cards,
          synced_cards,
          last_sync_at,
          last_sync_status,
          last_sync_error
        FROM sites
        WHERE id = $1
      `,
        [siteId]
      );

      if (result.rows.length === 0) {
        return null;
      }

      const site = result.rows[0];

      // Ajouter des informations dérivées
      return {
        ...site,
        sync_status:
          site.last_sync_at && new Date() - new Date(site.last_sync_at) < 24 * 60 * 60 * 1000
            ? 'OK'
            : site.last_sync_at
              ? 'EN_RETARD'
              : 'JAMAIS_SYNC',
      };
    } catch (error) {
      console.error('❌ Erreur getSiteStatus:', error);
      throw error;
    }
  },
};

module.exports = syncService;
