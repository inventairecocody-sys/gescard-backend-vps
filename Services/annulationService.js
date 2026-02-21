// ============================================
// services/annulationService.js
// ============================================
// Service d'annulation des actions avec traçabilité complète
// Gère l'enregistrement des actions et leur annulation par les administrateurs
// ============================================

const db = require('../db/db');

class ServiceAnnulation {
  /**
   * Enregistrer une action dans le journal avec les valeurs JSON pour annulation
   * @param {number} utilisateurId - ID de l'utilisateur
   * @param {string} nomUtilisateur - Nom d'utilisateur
   * @param {string} nomComplet - Nom complet
   * @param {string} role - Rôle de l'utilisateur
   * @param {string} agence - Agence de l'utilisateur
   * @param {string} action - Action effectuée (texte lisible)
   * @param {string} actionType - Type d'action (INSERT, UPDATE, DELETE, etc.)
   * @param {string} table - Table concernée
   * @param {number|string} recordId - ID de l'enregistrement
   * @param {Object} anciennesValeurs - Valeurs avant modification
   * @param {Object} nouvellesValeurs - Valeurs après modification
   * @param {string} ip - Adresse IP
   * @param {string|null} importBatchId - ID de lot d'import (optionnel)
   * @param {string} coordination - Coordination de l'utilisateur
   * @returns {Promise<number>} - ID du journal créé
   */
  async enregistrerAction(
    utilisateurId,
    nomUtilisateur,
    nomComplet,
    role,
    agence,
    action,
    actionType,
    table,
    recordId,
    anciennesValeurs,
    nouvellesValeurs,
    ip,
    importBatchId = null,
    coordination = null
  ) {
    // Validation des paramètres requis
    if (!utilisateurId || !nomUtilisateur || !actionType || !table) {
      throw new Error('Paramètres manquants pour enregistrerAction');
    }

    // Sérialisation sécurisée des JSON
    const anciennesValeursJSON = anciennesValeurs
      ? typeof anciennesValeurs === 'string'
        ? anciennesValeurs
        : JSON.stringify(anciennesValeurs)
      : null;

    const nouvellesValeursJSON = nouvellesValeurs
      ? typeof nouvellesValeurs === 'string'
        ? nouvellesValeurs
        : JSON.stringify(nouvellesValeurs)
      : null;

    // Construire le message d'action par défaut si non fourni
    const actionMessage = action || `Action ${actionType} sur ${table} #${recordId || '?'}`;

    const requete = `
      INSERT INTO journalactivite (
        utilisateurid, 
        nomutilisateur, 
        nomcomplet, 
        role, 
        agence,
        dateaction, 
        action, 
        actiontype, 
        tableaffectee, 
        tablename,
        ligneaffectee, 
        recordid, 
        oldvalue, 
        newvalue,
        iputilisateur, 
        adresseip, 
        importbatchid, 
        detailsaction,
        anciennes_valeurs, 
        nouvelles_valeurs, 
        annulee,
        coordination
      ) VALUES (
        $1, $2, $3, $4, $5, 
        NOW(), $6, $7, $8, $9, 
        $10, $11, $12, $13, 
        $14, $15, $16, $17, 
        $18::jsonb, $19::jsonb, false,
        $20
      )
      RETURNING journalid
    `;

    const resultat = await db.requete(requete, [
      utilisateurId,
      nomUtilisateur,
      nomComplet || nomUtilisateur,
      role,
      agence || '',
      actionMessage,
      actionType.toUpperCase(),
      table,
      table, // tableaffectee = tablename
      recordId, // ligneaffectee
      recordId, // recordid
      anciennesValeursJSON, // oldvalue (JSON text)
      nouvellesValeursJSON, // newvalue (JSON text)
      ip,
      ip,
      importBatchId,
      actionMessage, // detailsaction
      anciennesValeursJSON, // anciennes_valeurs (JSONB)
      nouvellesValeursJSON, // nouvelles_valeurs (JSONB)
      coordination, // Nouvelle colonne coordination
    ]);

    if (!resultat.lignes || resultat.lignes.length === 0) {
      throw new Error("Échec de l'enregistrement dans le journal");
    }

    return resultat.lignes[0].journalid;
  }

  /**
   * Annuler une action (Admin uniquement)
   * @param {number} idJournal - ID de l'entrée journal à annuler
   * @param {number} adminId - ID de l'administrateur
   * @param {string} adminNom - Nom de l'administrateur
   * @param {string} ip - Adresse IP de l'admin (pour traçabilité)
   * @returns {Promise<boolean>} - Succès de l'annulation
   */
  async annulerAction(idJournal, adminId, adminNom, ip) {
    // Validation
    if (!idJournal || !adminId) {
      throw new Error('Paramètres manquants pour annulerAction');
    }

    // Récupérer l'action originale avec verrouillage pour éviter les doubles annulations
    const action = await db.requete(
      `SELECT * FROM journalactivite 
       WHERE journalid = $1 AND annulee = false 
       FOR UPDATE`, // Verrouillage ligne
      [idJournal]
    );

    if (action.lignes.length === 0) {
      throw new Error('Action non trouvée ou déjà annulée');
    }

    const entree = action.lignes[0];

    // Récupérer les anciennes valeurs depuis le JSON
    let anciennesValeurs = {};
    try {
      if (entree.anciennes_valeurs) {
        anciennesValeurs =
          typeof entree.anciennes_valeurs === 'string'
            ? JSON.parse(entree.anciennes_valeurs)
            : entree.anciennes_valeurs;
      } else if (entree.oldvalue) {
        anciennesValeurs =
          typeof entree.oldvalue === 'string' ? JSON.parse(entree.oldvalue) : entree.oldvalue;
      }
    } catch (e) {
      console.warn(`Erreur parsing anciennes valeurs pour journal ${idJournal}:`, e);
      anciennesValeurs = {};
    }

    const table = entree.tableaffectee || entree.tablename;
    const idEnregistrement = entree.recordid || entree.ligneaffectee;

    if (!table || !idEnregistrement) {
      throw new Error('Informations de restauration incomplètes');
    }

    // Exécuter la restauration dans une transaction
    const client = await db.pool.connect();

    try {
      await client.query('BEGIN');

      // Restaurer les anciennes valeurs selon le type d'action
      const actionType = (entree.actiontype || entree.action || '').toUpperCase();

      switch (actionType) {
        case 'AJOUT':
        case 'INSERT':
        case 'CREATE':
          // Pour un ajout, on supprime l'enregistrement
          await client.query(`DELETE FROM ${table} WHERE id = $1`, [idEnregistrement]);
          break;

        case 'MODIFICATION':
        case 'UPDATE':
        case 'EDIT':
          // Pour une modification, on remet les anciennes valeurs
          if (Object.keys(anciennesValeurs).length > 0) {
            const champs = [];
            const valeurs = [];
            let index = 1;

            for (const [champ, valeur] of Object.entries(anciennesValeurs)) {
              champs.push(`"${champ}" = $${index}`);
              valeurs.push(valeur);
              index++;
            }

            valeurs.push(idEnregistrement);

            await client.query(
              `UPDATE ${table} SET ${champs.join(', ')} WHERE id = $${index}`,
              valeurs
            );
          }
          break;

        case 'SUPPRESSION':
        case 'DELETE':
        case 'REMOVE':
          // Pour une suppression, on réinsère les anciennes valeurs
          if (Object.keys(anciennesValeurs).length > 0) {
            const colonnes = Object.keys(anciennesValeurs)
              .map((c) => `"${c}"`)
              .join(', ');
            const placeholders = Object.keys(anciennesValeurs)
              .map((_, i) => `$${i + 1}`)
              .join(', ');
            const valeursInsert = Object.values(anciennesValeurs);

            await client.query(
              `INSERT INTO ${table} (${colonnes}) VALUES (${placeholders})`,
              valeursInsert
            );
          }
          break;

        default:
          throw new Error(`Type d'action non supporté pour l'annulation: ${actionType}`);
      }

      // Marquer l'action comme annulée
      await client.query(
        `UPDATE journalactivite 
         SET annulee = true, annulee_par = $1, date_annulation = NOW() 
         WHERE journalid = $2`,
        [adminId, idJournal]
      );

      // Enregistrer l'annulation comme nouvelle entrée (sans récursion)
      const actionAnnulation = `Annulation de l'action #${idJournal} (${entree.action})`;

      await client.query(
        `INSERT INTO journalactivite (
          utilisateurid, nomutilisateur, nomcomplet, role, agence,
          dateaction, action, actiontype, tableaffectee, tablename,
          ligneaffectee, recordid, oldvalue, newvalue,
          iputilisateur, adresseip, detailsaction,
          anciennes_valeurs, nouvelles_valeurs, annulee,
          coordination, annulee_par, date_annulation
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6, 'ANNULATION', $7, $8,
                  $9, $10, $11, $12, $13, $14, $15,
                  $16::jsonb, $17::jsonb, false,
                  $18, NULL, NULL)`,
        [
          adminId,
          adminNom,
          adminNom,
          'Administrateur',
          entree.agence || '',
          actionAnnulation,
          'journalactivite',
          'journalactivite',
          idJournal,
          idJournal,
          JSON.stringify({ action_annulee_id: idJournal }),
          JSON.stringify({ action_annulee: entree.action, restauration: 'succès' }),
          ip,
          ip,
          actionAnnulation,
          JSON.stringify({ action_originale_id: idJournal }),
          JSON.stringify({ statut: 'annulation_réussie' }),
          entree.coordination,
        ]
      );

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      console.error("Erreur lors de l'annulation:", error);
      throw new Error(`Échec de l'annulation: ${error.message}`);
    } finally {
      client.release();
    }

    return true;
  }

  /**
   * Lister les actions annulables (Admin)
   * @param {Object} filtres - Filtres optionnels
   * @param {number} limite - Nombre maximum de résultats
   * @returns {Promise<Array>} - Liste des actions annulables
   */
  async listerActionsAnnulables(filtres = {}, limite = 500) {
    let requete = `
      SELECT 
        j.journalid,
        j.utilisateurid,
        j.nomutilisateur,
        j.nomcomplet,
        j.role,
        j.agence,
        j.coordination,
        j.dateaction,
        j.action,
        j.actiontype,
        j.tableaffectee,
        j.tablename,
        j.ligneaffectee,
        j.recordid,
        j.oldvalue,
        j.newvalue,
        j.detailsaction,
        j.anciennes_valeurs,
        j.nouvelles_valeurs,
        u.nomutilisateur as annule_par_nom,
        j.date_annulation
      FROM journalactivite j
      LEFT JOIN utilisateurs u ON j.annulee_par = u.id
      WHERE j.annulee = false
        AND j.actiontype IN ('UPDATE', 'MODIFICATION', 'INSERT', 'AJOUT', 'DELETE', 'SUPPRESSION')
    `;

    const valeurs = [];
    let index = 1;

    // Ajouter les filtres
    if (filtres.table) {
      requete += ` AND (j.tableaffectee = $${index} OR j.tablename = $${index})`;
      valeurs.push(filtres.table);
      index++;
    }

    if (filtres.utilisateurId) {
      requete += ` AND j.utilisateurid = $${index}`;
      valeurs.push(filtres.utilisateurId);
      index++;
    }

    if (filtres.dateDebut) {
      requete += ` AND j.dateaction >= $${index}`;
      valeurs.push(filtres.dateDebut);
      index++;
    }

    if (filtres.dateFin) {
      requete += ` AND j.dateaction <= $${index}`;
      valeurs.push(filtres.dateFin);
      index++;
    }

    if (filtres.coordination) {
      requete += ` AND j.coordination = $${index}`;
      valeurs.push(filtres.coordination);
      index++;
    }

    requete += ` ORDER BY j.dateaction DESC LIMIT $${index}`;
    valeurs.push(limite);

    const resultat = await db.requete(requete, valeurs);

    return resultat.lignes;
  }

  /**
   * Vérifier si une action peut être annulée
   * @param {number} idJournal - ID de l'action
   * @returns {Promise<Object>} - Statut de l'action
   */
  async peutEtreAnnulee(idJournal) {
    const resultat = await db.requete(
      `SELECT 
        annulee,
        dateaction,
        EXTRACT(EPOCH FROM (NOW() - dateaction))/3600 as heures_ecoulees,
        actiontype
       FROM journalactivite 
       WHERE journalid = $1`,
      [idJournal]
    );

    if (resultat.lignes.length === 0) {
      return { peutAnnuler: false, raison: 'Action non trouvée' };
    }

    const action = resultat.lignes[0];

    if (action.annulee) {
      return { peutAnnuler: false, raison: 'Action déjà annulée' };
    }

    // Vérifier le type d'action
    const typesAnnulables = ['UPDATE', 'MODIFICATION', 'INSERT', 'AJOUT', 'DELETE', 'SUPPRESSION'];
    if (!typesAnnulables.includes(action.actiontype)) {
      return { peutAnnuler: false, raison: "Ce type d'action ne peut pas être annulé" };
    }

    // Optionnel: limite de temps pour l'annulation (ex: 30 jours)
    const limiteHeures = 30 * 24; // 30 jours
    if (action.heures_ecoulees > limiteHeures) {
      return {
        peutAnnuler: false,
        raison: `Délai d'annulation dépassé (plus de 30 jours)`,
        heures_ecoulees: Math.round(action.heures_ecoulees),
      };
    }

    return {
      peutAnnuler: true,
      heures_ecoulees: Math.round(action.heures_ecoulees),
    };
  }
}

module.exports = new ServiceAnnulation();
