const { Pool } = require('pg');
require('dotenv').config();

// Détecter l'environnement
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development';

// Configuration optimisée pour VPS 8 Go RAM
const getPoolConfig = () => {
  const baseConfig = {
    connectionString: process.env.DATABASE_URL,
    ssl: isProduction ? { rejectUnauthorized: false } : false,

    // Configuration optimisée pour performances
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000,
    keepAlive: true,
    keepAliveInitialDelayMillis: 10000,
  };

  if (isProduction) {
    // Configuration PRODUCTION (VPS 8 Go RAM)
    console.log('⚙️ Configuration DB optimisée pour VPS 8 Go RAM');
    return {
      ...baseConfig,
      max: 50, // Pool de connexions confortable
      min: 5, // Garder des connexions chaudes
      allowExitOnIdle: false, // Ne pas fermer les connexions inactives trop vite
    };
  } else if (isDevelopment) {
    // Développement local
    return {
      ...baseConfig,
      max: 10,
      min: 0,
    };
  } else {
    // Default
    return {
      ...baseConfig,
      max: 20,
      min: 2,
    };
  }
};

// Créer le pool avec la configuration adaptée
const pool = new Pool(getPoolConfig());

// Gestion des exports streams
let activeExportStreams = new Set();

const registerExportStream = (streamId) => {
  activeExportStreams.add(streamId);
  console.log(`📤 Export stream actif: ${streamId} (total: ${activeExportStreams.size})`);
};

const unregisterExportStream = (streamId) => {
  activeExportStreams.delete(streamId);
  console.log(`📥 Export stream terminé: ${streamId} (reste: ${activeExportStreams.size})`);

  // Forcer le garbage collection si beaucoup de streams terminés
  if (activeExportStreams.size === 0 && global.gc) {
    console.log('🧹 Nettoyage mémoire forcé');
    global.gc();
  }
};

// Événements du pool
pool.on('connect', (client) => {
  console.log('✅ Nouvelle connexion PostgreSQL établie');
});

pool.on('acquire', (client) => {
  const stats = getPoolStats();
  console.log(`🔗 Client acquis (actifs: ${stats.total - stats.idle}/${stats.total})`);
});

pool.on('remove', (client) => {
  console.log('🗑️ Client retiré du pool');
});

pool.on('error', (err, client) => {
  console.error('❌ Erreur PostgreSQL pool:', err.message);
});

// Requêtes standard avec timing
const query = async (text, params, options = {}) => {
  const start = Date.now();
  const isExportQuery =
    text.includes('cartes') && (text.includes('SELECT') || text.includes('select'));

  try {
    const result = await pool.query(text, params);
    const duration = Date.now() - start;

    // Log pour les requêtes lentes
    if (duration > 500 || isExportQuery) {
      console.log(`📊 ${isExportQuery ? '📤 EXPORT' : 'Query'} (${duration}ms):`, {
        query: text.substring(0, 150).replace(/\s+/g, ' ') + '...',
        rows: result.rowCount,
        params: params ? `[${params.length} params]` : 'none',
      });
    }

    return result;
  } catch (error) {
    const duration = Date.now() - start;
    console.error(`❌ Erreur query (${duration}ms):`, {
      query: text.substring(0, 100),
      error: error.message,
      code: error.code,
    });

    throw error;
  }
};

// Version streaming pour les gros exports
const queryStream = async (text, params, batchSize = 2000) => {
  const client = await pool.connect();
  console.log('🌊 Début query streaming avec batch:', batchSize);

  let offset = 0;
  let hasMore = true;
  const streamId = `stream_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  registerExportStream(streamId);

  const streamIterator = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (!hasMore) {
            unregisterExportStream(streamId);
            client.release();
            return { done: true };
          }

          try {
            const batchQuery = `${text} LIMIT ${batchSize} OFFSET ${offset}`;
            const result = await client.query(batchQuery, params);

            if (result.rows.length === 0) {
              hasMore = false;
              unregisterExportStream(streamId);
              client.release();
              return { done: true };
            }

            offset += batchSize;

            return {
              done: false,
              value: result.rows,
            };
          } catch (error) {
            unregisterExportStream(streamId);
            client.release();
            throw error;
          }
        },
      };
    },
  };

  return streamIterator;
};

// Version streaming optimisée pour gros volumes
const queryStreamOptimized = async (text, params, batchSize = 1000) => {
  console.log('🚀 Début queryStreamOptimized');

  const client = await pool.connect();
  const optimizedBatchSize = batchSize;

  let offset = 0;
  let hasMore = true;
  let batchCount = 0;
  const streamId = `stream_opt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  registerExportStream(streamId);

  const streamIterator = {
    [Symbol.asyncIterator]() {
      return {
        async next() {
          if (!hasMore) {
            unregisterExportStream(streamId);
            client.release();

            return { done: true };
          }

          try {
            batchCount++;

            // Construction de la requête
            let batchQuery = text;
            if (!text.includes('LIMIT') && !text.includes('limit')) {
              batchQuery += ` LIMIT ${optimizedBatchSize} OFFSET ${offset}`;
            } else {
              batchQuery = batchQuery.replace(/LIMIT \d+/i, `LIMIT ${optimizedBatchSize}`);
              if (!batchQuery.includes('OFFSET')) {
                batchQuery += ` OFFSET ${offset}`;
              } else {
                batchQuery = batchQuery.replace(/OFFSET \d+/i, `OFFSET ${offset}`);
              }
            }

            const result = await client.query(batchQuery, params);

            if (result.rows.length === 0) {
              hasMore = false;
              unregisterExportStream(streamId);
              client.release();
              return { done: true };
            }

            offset += optimizedBatchSize;

            // Log de progression
            if (batchCount % 5 === 0) {
              const memory = process.memoryUsage();
              console.log(
                `📦 Stream batch ${batchCount}: ${result.rows.length} lignes, offset: ${offset}, mémoire: ${Math.round(memory.heapUsed / 1024 / 1024)}MB`
              );
            }

            return {
              done: false,
              value: result.rows,
            };
          } catch (error) {
            unregisterExportStream(streamId);
            client.release();

            console.error(`❌ Erreur queryStreamOptimized batch ${batchCount}:`, error.message);
            throw error;
          }
        },
      };
    },
  };

  return streamIterator;
};

// Obtenir un client avec timeout de sécurité
const getClient = async () => {
  try {
    const client = await pool.connect();
    const timeout = 60000; // 60 secondes

    const originalRelease = client.release;
    let released = false;

    client.release = () => {
      if (!released) {
        released = true;
        originalRelease.apply(client);
      }
    };

    setTimeout(() => {
      if (!released) {
        console.error(`⏰ Timeout sécurité: client bloqué depuis ${timeout / 1000}s`);
        try {
          client.release();
        } catch (e) {
          // Ignorer
        }
      }
    }, timeout);

    return client;
  } catch (error) {
    console.error('❌ Erreur getClient:', error.message);
    throw error;
  }
};

// Statistiques du pool
const getPoolStats = () => {
  return {
    total: pool.totalCount || 0,
    idle: pool.idleCount || 0,
    waiting: pool.waitingCount || 0,
    environment: isProduction ? 'Production (VPS)' : isDevelopment ? 'Développement' : 'Inconnu',
  };
};

// Nettoyage périodique
setInterval(() => {
  const stats = getPoolStats();

  if (stats.idle > 10) {
    console.log('📊 Stats pool:', JSON.stringify(stats));
  }
}, 120000); // Toutes les 2 minutes

// ========== NOUVELLE FONCTION D'ATTENTE ROBUSTE ==========

/**
 * Attend que PostgreSQL soit prêt avec plus de tentatives
 * et sans marquer d'échec définitif
 */
const waitForPostgres = async (maxAttempts = 15, delay = 2000) => {
  console.log('⏳ Attente de PostgreSQL...');

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      // Requête simple pour tester la connexion
      const result = await pool.query('SELECT 1 as connection_test');
      console.log(`✅ PostgreSQL connecté (tentative ${attempt}/${maxAttempts})`);

      // Récupérer quelques infos utiles
      try {
        const versionResult = await pool.query('SELECT version()');
        const countResult = await pool.query('SELECT COUNT(*) FROM cartes');
        console.log(`📊 Version: ${versionResult.rows[0].version.split(' ')[0]}`);
        console.log(`📊 Cartes dans la base: ${countResult.rows[0].count}`);
      } catch (e) {
        // Ignorer les erreurs de ces requêtes supplémentaires
      }

      return true;
    } catch (error) {
      if (attempt === maxAttempts) {
        console.warn(
          `⚠️ PostgreSQL inaccessible après ${maxAttempts} tentatives, mais le serveur continue`
        );
        console.warn('⚠️ Les routes qui nécessitent la BDD retourneront des erreurs 503');
        return false;
      }
      console.log(
        `⏳ Tentative ${attempt}/${maxAttempts} échouée (${error.message}), nouvelle tentative dans ${delay / 1000}s...`
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  return false;
};

// ========== REMPLACEMENT DE L'ANCIEN TEST ==========

// Remplacer l'ancien appel par celui-ci
setTimeout(async () => {
  const connected = await waitForPostgres(15, 2000);
  if (connected) {
    console.log('✅ Base de données prête - Toutes les routes fonctionneront normalement');
  } else {
    console.log('⚠️ Le serveur a démarré sans PostgreSQL - Mode dégradé');
  }
}, 1000);

module.exports = {
  query,
  queryStream,
  queryStreamOptimized,
  getClient,
  getPoolStats,
  registerExportStream,
  unregisterExportStream,
  pool,
};
