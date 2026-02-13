// ============================================
// MIDDLEWARE ADMIN - OPTIMISÉ POUR LWS
// ============================================

/**
 * Middleware de vérification des droits administrateur
 * Vérifie que l'utilisateur connecté a le rôle admin
 */

const adminOnly = (req, res, next) => {
    // Récupérer l'utilisateur de la requête (mis par le middleware d'auth)
    const user = req.user;
    
    // Vérifier si l'utilisateur est connecté
    if (!user) {
        console.warn('⚠️ [ADMIN] Tentative d\'accès sans authentification');
        return res.status(401).json({ 
            success: false,
            error: 'Non authentifié',
            message: 'Vous devez être connecté pour accéder à cette ressource.',
            code: 'UNAUTHORIZED'
        });
    }

    // Normaliser le rôle pour la comparaison (insensible à la casse)
    const userRole = (user.role || '').toLowerCase().trim();
    const adminRoles = ['administrateur', 'admin', 'superadmin'];
    
    // Vérifier si l'utilisateur a un rôle admin
    const isAdmin = adminRoles.includes(userRole);

    if (!isAdmin) {
        // Journaliser les tentatives d'accès non autorisées
        console.log('❌ [ADMIN] Accès refusé - Rôle admin requis. Détails:', {
            userId: user.id,
            nomUtilisateur: user.NomUtilisateur || user.nomUtilisateur,
            role: user.role,
            path: req.originalUrl,
            method: req.method,
            ip: req.ip || req.connection.remoteAddress,
            timestamp: new Date().toISOString()
        });
        
        return res.status(403).json({ 
            success: false,
            error: 'Accès réservé aux administrateurs',
            message: 'Vous n\'avez pas les permissions nécessaires pour accéder à cette ressource.',
            code: 'FORBIDDEN_ADMIN_ONLY',
            requiredRole: 'Administrateur',
            yourRole: user.role || 'Non défini'
        });
    }

    // Ajouter un indicateur admin pour les contrôleurs
    req.isAdmin = true;
    
    // Ajouter des métadonnées pour le logging
    req.adminInfo = {
        accessedAt: new Date().toISOString(),
        adminId: user.id,
        adminName: user.NomUtilisateur || user.nomUtilisateur
    };

    // Tout est bon, passer au prochain middleware/controller
    next();
};

/**
 * Variante plus permissive pour les superviseurs
 * Vérifie que l'utilisateur a le rôle admin OU superviseur
 */
const adminOrSupervisor = (req, res, next) => {
    const user = req.user;
    
    if (!user) {
        return res.status(401).json({ 
            success: false,
            error: 'Non authentifié',
            message: 'Vous devez être connecté.'
        });
    }

    const userRole = (user.role || '').toLowerCase().trim();
    const allowedRoles = ['administrateur', 'admin', 'superadmin', 'superviseur'];
    
    const isAllowed = allowedRoles.includes(userRole);

    if (!isAllowed) {
        return res.status(403).json({ 
            success: false,
            error: 'Accès réservé aux administrateurs et superviseurs',
            message: 'Permissions insuffisantes.',
            requiredRoles: ['Administrateur', 'Superviseur'],
            yourRole: user.role
        });
    }

    next();
};

/**
 * Middleware pour vérifier un rôle spécifique
 * @param {string|string[]} allowedRoles - Rôle(s) autorisé(s)
 */
const hasRole = (allowedRoles) => {
    return (req, res, next) => {
        const user = req.user;
        
        if (!user) {
            return res.status(401).json({ 
                success: false,
                error: 'Non authentifié'
            });
        }

        const userRole = (user.role || '').toLowerCase().trim();
        const allowed = Array.isArray(allowedRoles) 
            ? allowedRoles.map(r => r.toLowerCase().trim())
            : [allowedRoles.toLowerCase().trim()];
        
        const isAllowed = allowed.includes(userRole);

        if (!isAllowed) {
            return res.status(403).json({ 
                success: false,
                error: 'Accès refusé',
                message: `Rôle requis: ${allowed.join(' ou ')}`,
                yourRole: user.role
            });
        }

        next();
    };
};

// Exporter les différentes versions
module.exports = adminOnly;
module.exports.adminOnly = adminOnly;
module.exports.adminOrSupervisor = adminOrSupervisor;
module.exports.hasRole = hasRole;