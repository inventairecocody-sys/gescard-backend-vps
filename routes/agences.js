// routes/agences.js
const express = require('express');
const router = express.Router();
const { verifierToken } = require('../middleware/auth');
const {
  getAllAgences,
  getAgenceById,
  createAgence,
  updateAgence,
  deleteAgence,
  getStatsAgences,
} = require('../Controllers/agencesController');

// Toutes les routes nécessitent un token valide
router.use(verifierToken);

// ── Ordre important : routes fixes AVANT /:id ──
router.get('/stats', getStatsAgences); // GET  /api/agences/stats
router.get('/', getAllAgences); // GET  /api/agences
router.get('/:id', getAgenceById); // GET  /api/agences/:id
router.post('/', createAgence); // POST /api/agences
router.put('/:id', updateAgence); // PUT  /api/agences/:id
router.delete('/:id', deleteAgence); // DELETE /api/agences/:id

module.exports = router;
