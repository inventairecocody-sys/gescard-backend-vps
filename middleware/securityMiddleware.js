// ========== MIDDLEWARE DE SÉCURITÉ RENFORCÉ ==========
// Remplace securityMiddleware dans server.js

const bannedIPs = new Map(); // ip -> { count, bannedUntil, reason }
const suspiciousIPs = new Map(); // ip -> { count, firstSeen }

const BAN_THRESHOLD = 5; // tentatives avant ban
const BAN_DURATION_MS = 60 * 60 * 1000; // 1 heure
const SUSPICIOUS_WINDOW_MS = 10 * 60 * 1000; // fenêtre 10 min

// Patterns malveillants étendus (scanners automatiques courants)
const BLOCKED_PATH_PATTERNS = [
  // PHP exploits
  /phpunit/i,
  /eval-stdin/i,
  /php.*eval/i,
  /php.*shell/i,
  /php.*exec/i,
  /\.(php|php5|php7|phtml|phar)(\?|$|\/)/i,

  // Fichiers sensibles
  /\/\.env(\.|$)/i,
  /\/\.git\//i,
  /\/\.gitignore/i,
  /\/\.htaccess/i,
  /\/\.htpasswd/i,
  /\/\.ssh\//i,
  /\/\.aws\//i,
  /web\.config/i,

  // CMS non utilisés
  /\/wp-admin/i,
  /\/wp-login/i,
  /\/wp-content/i,
  /\/wp-includes/i,
  /\/xmlrpc\.php/i,
  /\/administrator\//i,
  /\/joomla/i,
  /\/drupal/i,

  // Outils d'exploitation
  /\/vendor\/phpunit/i,
  /\/vendor\/.*\/eval/i,
  /alfacgiapi/i,
  /cgi-bin/i,
  /shell\.php/i,
  /c99\.php/i,
  /r57\.php/i,
  /webshell/i,
  /backdoor/i,

  // Traversée de répertoire
  /\.\.\//,
  /%2e%2e%2f/i,
  /%252e%252e/i,
  /\.\.%2f/i,

  // Injection SQL basique dans l'URL
  /union.*select/i,
  /sleep\(\d+\)/i,
  /benchmark\(\d+/i,

  // Fichiers de config
  /\/config\.json/i,
  /\/config\.yml/i,
  /\/database\.yml/i,
  /\/application\.yml/i,
  /\/secrets\./i,

  // Outils de scan
  /\/actuator\//i,
  /\/console\//i,
  /\/manager\/html/i,
  /\/solr\//i,
  /\/hudson/i,
];

// User-agents de scanners connus
const BLOCKED_USER_AGENTS = [
  /sqlmap/i,
  /nikto/i,
  /nessus/i,
  /masscan/i,
  /zgrab/i,
  /go-http-client\/1\.1/i,
  /python-requests\/2\.[0-9]/i,
  /curl\/[0-9]+.*scan/i,
  /libwww-perl/i,
  /dirbuster/i,
  /gobuster/i,
  /wfuzz/i,
  /burpsuite/i,
];

function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.ip ||
    req.connection?.remoteAddress ||
    'unknown'
  );
}

function isBanned(ip) {
  const ban = bannedIPs.get(ip);
  if (!ban) return false;
  if (Date.now() > ban.bannedUntil) {
    bannedIPs.delete(ip);
    return false;
  }
  return true;
}

function recordSuspiciousActivity(ip, reason) {
  const now = Date.now();
  const existing = suspiciousIPs.get(ip) || { count: 0, firstSeen: now, reasons: [] };

  // Réinitialiser si fenêtre expirée
  if (now - existing.firstSeen > SUSPICIOUS_WINDOW_MS) {
    existing.count = 0;
    existing.firstSeen = now;
    existing.reasons = [];
  }

  existing.count += 1;
  existing.reasons.push(reason);
  suspiciousIPs.set(ip, existing);

  if (existing.count >= BAN_THRESHOLD) {
    bannedIPs.set(ip, {
      bannedUntil: now + BAN_DURATION_MS,
      count: existing.count,
      reason: existing.reasons.slice(-3).join(', '),
    });
    suspiciousIPs.delete(ip);
    console.warn(`🔒 IP BANNIE: ${ip} — ${existing.count} violations — Raison: ${reason}`);
    return true; // vient d'être banni
  }

  return false;
}

// Nettoyage périodique des maps (évite memory leak)
setInterval(
  () => {
    const now = Date.now();
    for (const [ip, ban] of bannedIPs.entries()) {
      if (now > ban.bannedUntil) bannedIPs.delete(ip);
    }
    for (const [ip, data] of suspiciousIPs.entries()) {
      if (now - data.firstSeen > SUSPICIOUS_WINDOW_MS * 2) suspiciousIPs.delete(ip);
    }
  },
  5 * 60 * 1000
);

const securityMiddleware = (req, res, next) => {
  const ip = getClientIP(req);
  const url = req.url.toLowerCase();
  const userAgent = req.headers['user-agent'] || '';

  // 1. Vérifier si IP déjà bannie
  if (isBanned(ip)) {
    const ban = bannedIPs.get(ip);
    const minutesLeft = Math.ceil((ban.bannedUntil - Date.now()) / 60000);
    console.warn(`🚫 Requête bloquée (IP bannie): ${ip} — ${url} — encore ${minutesLeft}min`);
    return res.status(403).json({
      success: false,
      message: 'Accès interdit',
      code: 'IP_BANNED',
    });
  }

  // 2. Bloquer les user-agents de scanners connus
  if (BLOCKED_USER_AGENTS.some((pattern) => pattern.test(userAgent))) {
    recordSuspiciousActivity(ip, `scanner UA: ${userAgent.substring(0, 50)}`);
    console.warn(`🔍 Scanner détecté: ${ip} — UA: ${userAgent.substring(0, 80)}`);
    return res.status(403).json({ success: false, message: 'Accès interdit', code: 'FORBIDDEN' });
  }

  // 3. Bloquer les paths malveillants
  const matchedPattern = BLOCKED_PATH_PATTERNS.find((pattern) => pattern.test(url));
  if (matchedPattern) {
    const justBanned = recordSuspiciousActivity(ip, `path: ${url.substring(0, 80)}`);
    console.warn(`🚨 Path malveillant bloqué: ${url} — IP: ${ip}${justBanned ? ' — BANNI' : ''}`);
    return res.status(403).json({
      success: false,
      message: 'Accès interdit',
      code: 'FORBIDDEN_PATH',
    });
  }

  // 4. Détecter les traversées de répertoire dans les paramètres
  const fullQuery = req.url.includes('?') ? req.url.split('?')[1] : '';
  if (fullQuery && (fullQuery.includes('../') || fullQuery.includes('%2e%2e'))) {
    recordSuspiciousActivity(ip, `path traversal: ${fullQuery.substring(0, 50)}`);
    return res
      .status(400)
      .json({ success: false, message: 'Requête invalide', code: 'INVALID_REQUEST' });
  }

  next();
};

// Middleware de ban manuel (pour usage dans les routes d'auth)
const banIP = (ip, reason = 'manual') => {
  bannedIPs.set(ip, {
    bannedUntil: Date.now() + BAN_DURATION_MS,
    count: BAN_THRESHOLD,
    reason,
  });
  console.warn(`🔒 IP bannie manuellement: ${ip} — ${reason}`);
};

// Utilitaire pour les routes d'auth (brute-force login)
const recordAuthFailure = (ip) => {
  recordSuspiciousActivity(ip, 'auth failure');
};

// Stats pour le monitoring (route /api/health peut l'inclure)
const getSecurityStats = () => ({
  banned_ips: bannedIPs.size,
  suspicious_ips: suspiciousIPs.size,
  banned_list: Array.from(bannedIPs.entries()).map(([ip, data]) => ({
    ip,
    until: new Date(data.bannedUntil).toISOString(),
    reason: data.reason,
  })),
});

module.exports = { securityMiddleware, banIP, recordAuthFailure, getSecurityStats };
