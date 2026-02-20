const express = require("express");
const router = express.Router();
const db = require("../db/db");
const { verifierToken } = require("../middleware/auth");
const role = require("../middleware/verificationRole");
const colonnes = require("../middleware/filtreColonnes");
const permission = require("../middleware/permission");
const cartesController = require("../Controllers/cartesController");
const journalController = require("../Controllers/journalController");

// ============================================
// CONFIGURATION OPTIMISÉE POUR LWS
// ============================================
const CARTES_CONFIG = {
  defaultLimit: 100,
  maxLimit: 10000,
  maxBatchSize: 1000,
  
  // Colonnes de la table cartes
  columns: [
    "id",
    "LIEU D'ENROLEMENT",
    "SITE DE RETRAIT",
    "rangement",
    "nom",
    "prenoms",
    "DATE DE NAISSANCE",
    "LIEU NAISSANCE",
    "contact",
    "delivrance",
    "CONTACT DE RETRAIT",
    "DATE DE DELIVRANCE",
    "coordination",
    "dateimport",
    "importbatchid",
    "sourceimport"
  ],
  
  // Mapping des noms de colonnes (PostgreSQL vs API)
  columnMapping: {
    "id": "ID",
    "LIEU D'ENROLEMENT": "LIEU D'ENROLEMENT",
    "SITE DE RETRAIT": "SITE DE RETRAIT",
    "rangement": "RANGEMENT",
    "nom": "NOM",
    "prenoms": "PRENOMS",
    "DATE DE NAISSANCE": "DATE DE NAISSANCE",
    "LIEU NAISSANCE": "LIEU NAISSANCE",
    "contact": "CONTACT",
    "delivrance": "DELIVRANCE",
    "CONTACT DE RETRAIT": "CONTACT DE RETRAIT",
    "DATE DE DELIVRANCE": "DATE DE DELIVRANCE",
    "coordination": "COORDINATION"
  },
  
  // Sites configurés
  sites: [
    "ADJAME",
    "CHU D'ANGRE", 
    "UNIVERSITE DE COCODY",
    "LYCEE HOTELIER",
    "BINGERVILLE",
    "SITE_6",
    "SITE_7",
    "SITE_8", 
    "SITE_9",
    "SITE_10"
  ]
};

// ============================================
// MIDDLEWARE
// ============================================

// Authentification sur toutes les routes
router.use(verifierToken);

// ============================================
// ROUTES API DE SYNCHRONISATION (publiques)
// ============================================

/**
 * Vérification de santé de l'API
 * GET /api/cartes/health
 */
router.get("/health", cartesController.healthCheck);

/**
 * Récupérer les changements depuis une date
 * GET /api/cartes/changes?since=2024-01-01T00:00:00
 */
router.get("/changes", cartesController.getChanges);

/**
 * Synchronisation des données
 * POST /api/cartes/sync
 */
router.post("/sync", cartesController.syncData);

/**
 * Récupérer les sites configurés
 * GET /api/cartes/sites
 */
router.get("/sites", cartesController.getSites);

/**
 * Statistiques détaillées
 * GET /api/cartes/stats
 */
router.get("/stats", cartesController.getStats);

/**
 * Modifications par site
 * GET /api/cartes/modifications
 */
router.get("/modifications", cartesController.getModifications);

/**
 * Récupérer les cartes avec filtres
 * GET /api/cartes
 */
router.get("/", cartesController.getCartes);

// ============================================
// ROUTES CRUD POUR L'APPLICATION WEB
// ============================================

/**
 * Récupérer toutes les cartes (avec pagination) - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/all
 */
router.get(
  "/all", 
  role.peutAccederPage('inventaire'),
  cartesController.getToutesCartes
);

/**
 * Statistiques globales - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/statistiques/total
 */
router.get(
  "/statistiques/total", 
  permission.peutVoirStatistiques,
  cartesController.getStats
);

/**
 * Récupérer une carte par ID - PROTÉGÉ PAR RÔLE
 * GET /api/cartes/:id
 */
router.get(
  "/:id", 
  role.peutAccederPage('inventaire'),
  cartesController.getCarteParId
);

/**
 * Créer une nouvelle carte - PROTÉGÉ PAR RÔLE
 * POST /api/cartes
 */
router.post(
  "/", 
  role.peutModifierCarte,
  colonnes.filtrerColonnes,
  cartesController.createCarte
);

/**
 * Mise à jour batch de cartes - PROTÉGÉ PAR RÔLE
 * PUT /api/cartes/batch
 */
router.put(
  "/batch", 
  role.peutImporterExporter, // Seulement Admin et Gestionnaire
  cartesController.syncData // Réutilise la logique de sync
);

/**
 * Mettre à jour une carte - PROTÉGÉ PAR RÔLE AVEC FILTRAGE
 * PUT /api/cartes/:id
 */
router.put(
  "/:id", 
  role.peutModifierCarte,
  colonnes.filtrerColonnes,
  cartesController.updateCarte
);

/**
 * Supprimer une carte - PROTÉGÉ PAR RÔLE
 * DELETE /api/cartes/:id
 */
router.delete(
  "/:id", 
  role.peutModifierCarte,
  cartesController.deleteCarte
);

/**
 * Test de connexion
 * GET /api/cartes/test/connection
 */
router.get("/test/connection", async (req, res) => {
  try {
    const result = await db.query('SELECT version() as version');
    
    res.json({
      success: true,
      message: "Connexion à la base de données réussie",
      version: result.rows[0].version,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('❌ Erreur test connexion:', error);
    res.status(500).json({
      success: false,
      error: "Erreur de connexion à la base de données",
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;