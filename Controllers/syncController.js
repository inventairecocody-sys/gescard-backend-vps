// Controllers/syncController.js
const syncService = require('../Services/syncService');
const journalService = require('../Services/journalService');

/**
 * Contrôleur de synchronisation pour les sites locaux
 * Gère l'authentification, l'upload et le download des données
 */
const syncController = {
  /**
   * Authentification d'un site
   * POST /api/sync/login
   */
  async login(req, res) {
    try {
      const { site_id, api_key } = req.body;

      // Validation basique
      if (!site_id || !api_key) {
        return res.status(400).json({
          success: false,
          error: 'site_id et api_key requis',
        });
      }

      // Authentifier le site
      const site = await syncService.authenticateSite(site_id, api_key);

      if (!site) {
        return res.status(401).json({
          success: false,
          error: 'Identifiants invalides ou site inactif',
        });
      }

      // Générer le token JWT
      const token = syncService.generateSiteToken(site);

      // Journaliser la connexion
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

      res.json({
        success: true,
        token,
        site: {
          id: site.id,
          nom: site.nom,
          coordination: site.coordination_code,
          coordination_id: site.coordination_id,
        },
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
    const site = req.site; // Rempli par le middleware

    try {
      // Démarrer la synchronisation
      const result = await syncService.processUpload(site, modifications, last_sync);

      // Journaliser
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

      // Journaliser l'erreur
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
   * GET /api/sync/download
   */
  async download(req, res) {
    const { since, limit = 1000 } = req.query;
    const site = req.site;

    try {
      const records = await syncService.prepareDownload(site, since, parseInt(limit));

      res.json({
        success: true,
        count: records.length,
        since: since || '2000-01-01',
        until: new Date().toISOString(),
        records,
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
};

module.exports = syncController;
