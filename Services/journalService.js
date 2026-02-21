// ============================================
// SERVICE JOURNAL - INDÉPENDANT (PAS DE DÉPENDANCE CIRCULAIRE)
// ============================================

const db = require('../db/db');

class JournalService {
  /**
   * Journaliser une action
   */
  async logAction(data) {
    try {
      const {
        utilisateurId,
        nomUtilisateur,
        nomComplet,
        role,
        agence,
        coordination,
        action,
        actionType,
        tableName,
        recordId,
        oldValue,
        newValue,
        details,
        ip,
        importBatchId = null,
      } = data;

      console.log(`📝 [Journal] ${actionType} - ${action} par ${nomUtilisateur}`);

      // Vérifier si la table existe et a les bonnes colonnes
      const checkQuery = `
        INSERT INTO journalactivite (
          utilisateurid, nomutilisateur, nomcomplet, role, agence,
          coordination, dateaction, action, actiontype,
          tablename, recordid, oldvalue, newvalue,
          detailsaction, iputilisateur, importbatchid
        ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), $7, $8, $9, $10, $11, $12, $13, $14, $15)
      `;

      const params = [
        utilisateurId || null,
        nomUtilisateur || 'systeme',
        nomComplet || 'Système',
        role || 'Systeme',
        agence || null,
        coordination || null,
        action || 'Action',
        actionType || 'SYSTEM',
        tableName || 'systeme',
        recordId ? recordId.toString() : null,
        oldValue ? (typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue)) : null,
        newValue ? (typeof newValue === 'string' ? newValue : JSON.stringify(newValue)) : null,
        details || null,
        ip || null,
        importBatchId,
      ];

      await db.query(checkQuery, params);
      return { success: true, id: null };
    } catch (error) {
      console.error('❌ Erreur journalService.logAction:', error);
      // Ne pas bloquer l'application si la journalisation échoue
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les entrées du journal avec filtres
   */
  async getJournal(filtres = {}) {
    try {
      const {
        page = 1,
        limit = 50,
        utilisateurId,
        actionType,
        tableName,
        dateDebut,
        dateFin,
        coordination,
        annulee,
      } = filtres;

      const offset = (page - 1) * limit;
      const conditions = [];
      const params = [];
      let paramIndex = 1;

      let query = `
        SELECT 
          j.*,
          u.nomutilisateur as utilisateur_nom,
          u2.nomutilisateur as annule_par_nom
        FROM journalactivite j
        LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
        LEFT JOIN utilisateurs u2 ON j.annulee_par = u2.id
        WHERE 1=1
      `;

      if (utilisateurId) {
        conditions.push(`j.utilisateurid = $${paramIndex++}`);
        params.push(utilisateurId);
      }

      if (actionType) {
        conditions.push(`j.actiontype = $${paramIndex++}`);
        params.push(actionType);
      }

      if (tableName) {
        conditions.push(`j.tablename = $${paramIndex++}`);
        params.push(tableName);
      }

      if (dateDebut) {
        conditions.push(`j.dateaction >= $${paramIndex++}`);
        params.push(dateDebut);
      }

      if (dateFin) {
        conditions.push(`j.dateaction <= $${paramIndex++}`);
        params.push(dateFin);
      }

      if (coordination) {
        conditions.push(`j.coordination = $${paramIndex++}`);
        params.push(coordination);
      }

      if (annulee !== undefined) {
        conditions.push(`j.annulee = $${paramIndex++}`);
        params.push(annulee);
      }

      if (conditions.length > 0) {
        query += ' AND ' + conditions.join(' AND ');
      }

      query += ` ORDER BY j.dateaction DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
      params.push(limit, offset);

      const result = await db.query(query, params);

      // Compter le total
      let countQuery = 'SELECT COUNT(*) as total FROM journalactivite j WHERE 1=1';
      if (conditions.length > 0) {
        countQuery += ' AND ' + conditions.join(' AND ');
      }
      const countResult = await db.query(countQuery, params.slice(0, -2));

      return {
        success: true,
        data: result.rows,
        total: parseInt(countResult.rows[0].total),
        page,
        limit,
      };
    } catch (error) {
      console.error('❌ Erreur journalService.getJournal:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Récupérer les actions annulables
   */
  async getActionsAnnulables() {
    try {
      const result = await db.query(`
        SELECT 
          j.*,
          u.nomutilisateur as utilisateur_nom
        FROM journalactivite j
        LEFT JOIN utilisateurs u ON j.utilisateurid = u.id
        WHERE j.annulee = false
          AND j.actiontype IN ('UPDATE', 'MODIFICATION', 'INSERT', 'AJOUT', 'DELETE', 'SUPPRESSION')
        ORDER BY j.dateaction DESC
        LIMIT 500
      `);

      return { success: true, data: result.rows };
    } catch (error) {
      console.error('❌ Erreur journalService.getActionsAnnulables:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Marquer une action comme annulée
   */
  async marquerCommeAnnulee(journalId, adminId) {
    try {
      await db.query(
        `UPDATE journalactivite 
         SET annulee = true, annulee_par = $1, date_annulation = NOW() 
         WHERE journalid = $2`,
        [adminId, journalId]
      );
      return { success: true };
    } catch (error) {
      console.error('❌ Erreur journalService.marquerCommeAnnulee:', error);
      return { success: false, error: error.message };
    }
  }
}

module.exports = new JournalService();
