// Controllers/syncController.js
const syncService = require('../Services/syncService');
const journalService = require('../Services/journalService');

/**
 * Contrôleur de synchronisation pour les sites locaux
 * Gère l'authentification, l'upload, le download et le statut
 */
const syncController = {
  /**
   * Authentification d'un site
   * POST /api/sync/login
   */
  async login(req, res) {
    try {
      const { site_id, api_key } = req.body;

      if (!site_id || !api_key) {
        return res.status(400).json({
          success: false,
          error: 'site_id et api_key requis',
        });
      }

      const site = await syncService.authenticateSite(site_id, api_key);

      if (!site) {
        return res.status(401).json({
          success: false,
          error: 'Identifiants invalides ou site inactif',
        });
      }

      const token = syncService.generateSiteToken(site);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site.id,
        nomComplet: site.nom,
        role: 'SITE',
        agence: null,
        coordination: site.coordination_code,
        action: 'Connexion du site',
        actionType: 'SITE_LOGIN',
        tableName: 'sites',
        recordId: site.id,
        details: `Connexion du site ${site.nom}`,
        ip: req.ip,
      });

      // Récupérer toutes les coordinations pour alimenter le logiciel local
      const coordinations = await syncService.getAllCoordinations();

      res.json({
        success: true,
        token,
        site: {
          id: site.id,
          nom: site.nom,
          coordination: site.coordination_code,
          coordination_id: site.coordination_id,
        },
        coordinations,
      });
    } catch (error) {
      console.error('❌ Erreur login site:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur serveur',
        message: error.message,
      });
    }
  },

  /**
   * Réception des modifications d'un site
   * POST /api/sync/upload
   */
  async upload(req, res) {
    const { modifications, last_sync } = req.body;
    const site = req.site;

    try {
      const result = await syncService.processUpload(site, modifications, last_sync);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site.id,
        nomComplet: site.nom,
        role: 'SITE',
        agence: null,
        coordination: site.coordination_code,
        action: 'Upload de synchronisation',
        actionType: 'SYNC_UPLOAD',
        tableName: 'sync_history',
        recordId: result.historyId.toString(),
        details: `Site ${site.id} a envoyé ${modifications?.length || 0} modifications`,
        ip: req.ip,
      });

      res.json({
        success: true,
        history_id: result.historyId,
        uploaded: result.uploaded,
        download: result.download,
        processed: result.processed,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur upload:', error);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site?.id || 'inconnu',
        nomComplet: site?.nom || 'Inconnu',
        role: 'SITE',
        agence: null,
        coordination: site?.coordination_code || null,
        action: 'Erreur upload synchronisation',
        actionType: 'SYNC_UPLOAD_ERROR',
        tableName: 'sync_history',
        details: `Erreur pour site ${site?.id}: ${error.message}`,
        ip: req.ip,
      });

      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Envoi des mises à jour aux sites
   * GET /api/sync/download?since=ISO&limit=5000&last_id=0
   *
   * ✅ CORRIGÉ : options passé comme OBJET { limit, last_id }
   *    pour compatibilité avec syncService.prepareDownload(site, since, options)
   */
  async download(req, res) {
    const { since, limit = 5000, last_id = 0 } = req.query;
    const site = req.site;

    try {
      // ✅ On passe un objet options, pas un entier
      const result = await syncService.prepareDownload(site, since, {
        limit: parseInt(limit) || 5000,
        last_id: parseInt(last_id) || 0,
      });

      res.json({
        success: true,
        count: result.count,
        has_more: result.has_more,
        next_since: result.next_since,
        next_last_id: result.next_last_id,
        since: result.since,
        until: new Date().toISOString(),
        records: result.records,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur download:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Confirmation de réception
   * POST /api/sync/confirm
   */
  async confirm(req, res) {
    const { history_id, applied_ids, errors } = req.body;
    const site = req.site;

    try {
      await syncService.confirmDownload(site.id, history_id, applied_ids, errors);

      res.json({
        success: true,
        status: 'confirmed',
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur confirmation:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Statut de la synchronisation
   * GET /api/sync/status
   */
  async status(req, res) {
    const site = req.site;

    try {
      const status = await syncService.getSiteStatus(site.id);

      res.json({
        success: true,
        site: {
          id: site.id,
          nom: site.nom,
          coordination: site.coordination_code,
        },
        status,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur status:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },

  /**
   * Récupération des utilisateurs pour un site
   * GET /api/sync/users
   *
   * ✅ CORRIGÉ : passe userRole et userSiteId à getUsersForSite()
   *    pour la gestion des droits par rôle
   */
  async getUsers(req, res) {
    const site = req.site;
    try {
      // ✅ Lire depuis header (Python) OU query param (web/autres clients)
      const userRole = req.headers['x-user-role'] || req.query.user_role || null;
      const userSiteId = req.headers['x-user-site'] || req.query.user_site_id || site.id;

      const users = await syncService.getUsersForSite(site.id, userRole, userSiteId);

      await journalService.logAction({
        utilisateurId: null,
        nomUtilisateur: site.id,
        nomComplet: site.nom,
        role: 'SITE',
        agence: null,
        coordination: site.coordination_code,
        action: 'Sync utilisateurs',
        actionType: 'SYNC_USERS',
        tableName: 'utilisateurs',
        recordId: site.id,
        details: `Site ${site.id} a téléchargé ${users.length} utilisateur(s)`,
        ip: req.ip,
      });

      res.json({
        success: true,
        count: users.length,
        users,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur getUsers:', error);
      res.status(500).json({
        success: false,
        error: error.message,
        timestamp: new Date().toISOString(),
      });
    }
  },
};

module.exports = syncController;
