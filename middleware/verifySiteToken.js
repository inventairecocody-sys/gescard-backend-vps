// middleware/verifySiteToken.js
const jwt = require('jsonwebtoken');
const db = require('../db/db');

/**
 * Middleware pour vérifier le token JWT d'un site
 * À utiliser sur toutes les routes de synchronisation
 */
module.exports = async (req, res, next) => {
  try {
    // Récupérer le token du header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Token manquant ou format invalide',
      });
    }

    const token = authHeader.split(' ')[1];

    // Vérifier le token
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'votre-secret-jwt');

    // Vérifier que le site existe toujours et est actif
    const site = await db.query(
      `
      SELECT 
        s.id,
        s.nom,
        s.coordination_id,
        c.code as coordination_code,
        s.is_active
      FROM sites s
      JOIN coordinations c ON s.coordination_id = c.id
      WHERE s.id = $1 AND s.is_active = true
      `,
      [decoded.site_id]
    );

    if (site.rows.length === 0) {
      return res.status(401).json({
        error: 'Site inactif ou inexistant',
      });
    }

    // Ajouter les infos du site à la requête
    req.site = {
      id: site.rows[0].id,
      nom: site.rows[0].nom,
      coordination_id: site.rows[0].coordination_id,
      coordination_code: site.rows[0].coordination_code,
    };

    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: 'Token expiré',
      });
    }
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        error: 'Token invalide',
      });
    }

    console.error('❌ Erreur auth site:', error);
    return res.status(500).json({
      error: 'Erreur serveur',
    });
  }
};
