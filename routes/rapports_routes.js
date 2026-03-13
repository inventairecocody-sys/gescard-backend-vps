// routes/rapports.js
const express = require('express');
const router = express.Router();
const { verifierToken } = require('../middleware/auth');
const permission = require('../middleware/permission');
const ctrl = require('../Controllers/RapportController');

router.use(verifierToken);

router.use((req, res, next) => {
  console.log(
    `📋 [Rapport] ${req.method} ${req.path} - ${req.user?.nomUtilisateur} (${req.user?.role})`
  );
  next();
});

/**
 * GET /api/rapports/excel
 * Télécharge le rapport Excel complet
 */
router.get('/excel', permission.peutVoirStatistiques, ctrl.genererExcel);

/**
 * GET /api/rapports/word
 * Télécharge le rapport Word complet
 */
router.get('/word', permission.peutVoirStatistiques, ctrl.genererWord);

router.get('/', (req, res) => {
  res.json({
    name: 'API Rapports GESCARD',
    version: '1.0.0',
    endpoints: [
      { method: 'GET', path: '/api/rapports/excel', description: 'Rapport Excel (5 onglets)' },
      { method: 'GET', path: '/api/rapports/word', description: 'Rapport Word (analyse complète)' },
    ],
  });
});

module.exports = router;
