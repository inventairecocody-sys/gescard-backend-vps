// routes/coordinations.js

const express = require('express');
const router = express.Router();
const { verifierToken } = require('../middleware/auth');
const ctrl = require('../Controllers/coordinationsController');

// Logging
router.use((req, res, next) => {
  console.log(`🗂️ [Coordinations] ${req.method} ${req.path} - ip=${req.ip}`);
  next();
});

// Toutes les routes nécessitent un token valide
router.use(verifierToken);

/**
 * GET /api/coordinations
 * Liste toutes les coordinations avec stats (nb sites, nb utilisateurs)
 * Accès : tous les rôles authentifiés (lecture)
 */
router.get('/', ctrl.listerCoordinations);

/**
 * GET /api/coordinations/:id
 * Détail d'une coordination
 */
router.get('/:id', ctrl.getCoordination);

/**
 * POST /api/coordinations
 * Créer une nouvelle coordination
 * Accès : Administrateur uniquement
 */
router.post('/', ctrl.creerCoordination);

/**
 * PUT /api/coordinations/:id
 * Modifier une coordination
 * Accès : Administrateur uniquement
 */
router.put('/:id', ctrl.modifierCoordination);

/**
 * DELETE /api/coordinations/:id
 * Supprimer une coordination (bloqué si sites/utilisateurs actifs)
 * Accès : Administrateur uniquement
 */
router.delete('/:id', ctrl.supprimerCoordination);

/**
 * GET /api/coordinations (doc)
 */
router.get('/', (req, res) => {
  res.json({
    name: 'API Coordinations GESCARD',
    endpoints: {
      'GET    /api/coordinations': 'Liste toutes les coordinations',
      'GET    /api/coordinations/:id': "Détail d'une coordination",
      'POST   /api/coordinations': 'Créer une coordination (Admin)',
      'PUT    /api/coordinations/:id': 'Modifier une coordination (Admin)',
      'DELETE /api/coordinations/:id': 'Supprimer une coordination (Admin)',
    },
  });
});

module.exports = router;
