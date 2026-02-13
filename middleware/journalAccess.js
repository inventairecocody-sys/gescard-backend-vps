// ============================================
// MIDDLEWARE D'ACCÈS AU JOURNAL - OPTIMISÉ POUR LWS
// ============================================

const ACCESS_CONFIG = {
  // Rôles autorisés à accéder au journal
  allowedRoles: ['Administrateur', 'Superviseur'],
  
  // Rôles avec accès limité (consultation seulement)
  readOnlyRoles: ['Chef d\'équipe'],
  
  // Niveaux d'accès
  accessLevels: {
    'Administrateur': {
      level: 100,
      canView: true,
      canExport: true,
      canDelete: true,
      canViewDetails: true,
      canViewIP: true,
      maxHistoryDays: 365
    },
    'Superviseur': {
      level: 80,
      canView: true,
      canExport: true,
      canDelete: false,
      canViewDetails: true,
      canViewIP: true,
      maxHistoryDays: 90
    },
    'Chef d\'équipe': {
      level: 60,
      canView: true,
      canExport: false,
      canDelete: false,
      canViewDetails: false,
      canViewIP: false,
      maxHistoryDays: 30
    }
  },
  
  // Filtres par défaut selon le rôle
  defaultFilters: {
    'Chef d\'équipe': {
      excludeColumns: ['iputilisateur', 'oldvalue', 'newvalue']
    }
  }
};

/**
 * Normalise le rôle (gère les variations)
 */
function normalizeRole(role) {
  if (!role) return null;
  
  const roleLower = role.toLowerCase().trim();
  
  if (roleLower.includes('admin')) return 'Administrateur';
  if (roleLower.includes('superviseur') || roleLower.includes('supervisor')) return 'Superviseur';
  if (roleLower.includes('chef') || roleLower.includes('equipe') || roleLower.includes('équipe')) return 'Chef d\'équipe';
  if (roleLower.includes('operateur') || roleLower.includes('opérateur')) return 'Opérateur';
  if (roleLower.includes('consultant')) return 'Consultant';
  
  return role; // Retourner le rôle original si non reconnu
}

/**
 * Middleware principal d'accès au journal
 */
const journalAccess = (req, res, next) => {
  const requestId = req.requestId || Date.now().toString(36);
  
  // Vérifier que l'utilisateur est authentifié
  if (!req.user) {
    console.log(`❌ [${requestId}] Accès journal - Utilisateur non authentifié`);
    return res.status(401).json({
      success: false,
      error: 'Authentification requise',
      message: 'Vous devez être connecté pour accéder au journal.',
      code: 'UNAUTHENTICATED',
      requestId
    });
  }

  // Récupérer le rôle (gestion de la casse)
  const rawRole = req.user?.Role || req.user?.role;
  const role = normalizeRole(rawRole);

  console.log(`🔍 [${requestId}] Vérification accès journal:`, {
    user: req.user?.NomUtilisateur || req.user?.nomUtilisateur,
    rawRole: rawRole,
    normalizedRole: role,
    path: req.path,
    method: req.method,
    ip: req.ip
  });

  // Vérifier si le rôle a accès au journal
  const accessLevel = ACCESS_CONFIG.accessLevels[role];
  
  if (!accessLevel || !accessLevel.canView) {
    console.log(`❌ [${requestId}] Accès journal refusé pour rôle: ${role}`);
    
    return res.status(403).json({
      success: false,
      error: 'Accès restreint',
      message: role ? 
        `Votre rôle (${role}) n'a pas accès au journal d'activité.` :
        'Rôle non défini. Contactez un administrateur.',
      requiredRoles: ACCESS_CONFIG.allowedRoles,
      yourRole: role || rawRole || 'Non défini',
      code: 'JOURNAL_ACCESS_DENIED',
      requestId
    });
  }

  // Vérifier les permissions spécifiques selon la méthode HTTP
  const method = req.method.toUpperCase();
  
  // DELETE - Seulement pour les admins
  if (method === 'DELETE' && !accessLevel.canDelete) {
    console.log(`❌ [${requestId}] Suppression journal refusée pour ${role}`);
    
    return res.status(403).json({
      success: false,
      error: 'Permission refusée',
      message: 'La suppression des entrées du journal est réservée aux administrateurs.',
      code: 'DELETE_FORBIDDEN',
      requestId
    });
  }
  
  // POST/PUT pour export - Vérifier les droits d'export
  if ((method === 'POST' || method === 'PUT') && req.path.includes('export') && !accessLevel.canExport) {
    console.log(`❌ [${requestId}] Export journal refusé pour ${role}`);
    
    return res.status(403).json({
      success: false,
      error: 'Export non autorisé',
      message: 'L\'export du journal est réservé aux administrateurs et superviseurs.',
      code: 'EXPORT_FORBIDDEN',
      requestId
    });
  }

  // Appliquer des filtres selon le rôle
  const filters = ACCESS_CONFIG.defaultFilters[role] || {};
  
  // Si c'est une requête GET avec des données sensibles, filtrer selon le rôle
  if (method === 'GET' && !accessLevel.canViewDetails) {
    // Marquer la requête pour que le contrôleur filtre les données sensibles
    req.filterJournal = {
      excludeColumns: filters.excludeColumns || ['iputilisateur', 'oldvalue', 'newvalue'],
      maskIP: !accessLevel.canViewIP
    };
    
    console.log(`🔒 [${requestId}] Filtres appliqués pour ${role}:`, req.filterJournal);
  }

  // Limiter la période d'historique selon le rôle
  if (req.query.days) {
    const requestedDays = parseInt(req.query.days);
    if (requestedDays > accessLevel.maxHistoryDays) {
      req.query.days = accessLevel.maxHistoryDays;
      console.log(`⚠️ [${requestId}] Période limitée à ${accessLevel.maxHistoryDays} jours pour ${role}`);
    }
  }

  // Ajouter des métadonnées à la requête
  req.journalAccess = {
    granted: true,
    role: role,
    accessLevel: accessLevel.level,
    permissions: {
      canExport: accessLevel.canExport,
      canDelete: accessLevel.canDelete,
      canViewDetails: accessLevel.canViewDetails,
      canViewIP: accessLevel.canViewIP,
      maxHistoryDays: accessLevel.maxHistoryDays
    },
    filters: req.filterJournal || null,
    requestId
  };

  console.log(`✅ [${requestId}] Accès journal autorisé pour ${role}`);
  next();
};

/**
 * Middleware pour l'accès en lecture seule (Chef d'équipe)
 */
const journalReadOnly = (req, res, next) => {
  const role = normalizeRole(req.user?.Role || req.user?.role);
  
  if (ACCESS_CONFIG.readOnlyRoles.includes(role)) {
    // Bloquer les opérations d'écriture
    if (req.method !== 'GET') {
      return res.status(403).json({
        success: false,
        error: 'Mode lecture seule',
        message: 'Votre rôle vous limite à la consultation du journal.',
        code: 'READ_ONLY_MODE',
        allowedMethods: ['GET']
      });
    }
  }
  
  next();
};

/**
 * Middleware pour l'accès aux détails sensibles
 */
const journalDetailsAccess = (req, res, next) => {
  const role = normalizeRole(req.user?.Role || req.user?.role);
  const accessLevel = ACCESS_CONFIG.accessLevels[role];
  
  if (!accessLevel || !accessLevel.canViewDetails) {
    // Rediriger vers une version filtrée
    req.query.redacted = 'true';
    console.log(`🔒 Détails masqués pour ${role}`);
  }
  
  next();
};

/**
 * Middleware pour journaliser les accès au journal (meta-logging)
 */
const logJournalAccess = (req, res, next) => {
  // Ne journaliser que les accès significatifs
  const shouldLog = req.method !== 'GET' || 
                    req.path.includes('export') ||
                    req.path.includes('delete') ||
                    req.query.days > 30;

  if (shouldLog) {
    console.log('📋 Accès journal significatif:', {
      user: req.user?.NomUtilisateur || req.user?.nomUtilisateur,
      role: normalizeRole(req.user?.Role || req.user?.role),
      action: `${req.method} ${req.path}`,
      params: req.query,
      ip: req.ip,
      timestamp: new Date().toISOString()
    });
  }

  next();
};

/**
 * Obtenir les permissions d'accès pour un rôle
 */
const getAccessPermissions = (role) => {
  const normalizedRole = normalizeRole(role);
  return ACCESS_CONFIG.accessLevels[normalizedRole] || null;
};

// Exporter les différentes versions
module.exports = journalAccess;
module.exports.journalAccess = journalAccess;
module.exports.journalReadOnly = journalReadOnly;
module.exports.journalDetailsAccess = journalDetailsAccess;
module.exports.logJournalAccess = logJournalAccess;
module.exports.getAccessPermissions = getAccessPermissions;
module.exports.ACCESS_CONFIG = ACCESS_CONFIG;