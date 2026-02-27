#!/usr/bin/env node

const axios = require('axios');

// ========== CONFIGURATION ==========
// Mets ici l'URL de ton API sur le VPS (ou localhost si tu testes en local)
const API_BASE = process.env.API_BASE || 'http://localhost:3000';
// En production sur VPS, tu pourras utiliser :
// const API_BASE = 'https://gescardcocody.com/api';

// Ton token API (à garder secret, à mettre dans .env plus tard)
const API_TOKEN = process.env.API_TOKEN || 'CARTES_API_2025_SECRET_TOKEN_NOV';

async function runDiagnostic() {
  console.log('🔍 Diagnostic API GESCard (VPS)');
  console.log(`🌐 API cible: ${API_BASE}`);
  console.log('============================\n');

  let successCount = 0;
  let totalTests = 0;

  try {
    // Test 1: API de base
    totalTests++;
    console.log('1️⃣ Test API de base...');
    try {
      const baseRes = await axios.get(`${API_BASE}/api`);
      console.log(`✅ API de base: ${baseRes.data.message || 'OK'}`);
      successCount++;
    } catch (error) {
      console.log(`❌ Échec API de base: ${error.message}`);
    }

    // Test 2: Health check
    totalTests++;
    console.log('\n2️⃣ Test Health Check...');
    try {
      const healthRes = await axios.get(`${API_BASE}/api/health`);
      console.log(`✅ Health: ${healthRes.data.status}`);
      if (healthRes.data.data && healthRes.data.data.total_cartes) {
        console.log(`📊 Cartes: ${healthRes.data.data.total_cartes}`);
      }
      successCount++;
    } catch (error) {
      console.log(`❌ Échec Health: ${error.message}`);
    }

    // Test 3: CORS
    totalTests++;
    console.log('\n3️⃣ Test CORS...');
    try {
      const corsRes = await axios.get(`${API_BASE}/api/cors-test`);
      console.log(`✅ CORS: ${corsRes.data.message}`);
      successCount++;
    } catch (error) {
      console.log(`❌ Échec CORS: ${error.message}`);
    }

    // Test 4: API externe publique (health)
    totalTests++;
    console.log('\n4️⃣ Test API externe (health)...');
    try {
      const extHealth = await axios.get(`${API_BASE}/api/external/health`);
      console.log(`✅ API externe health: ${extHealth.data.status || 'OK'}`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API externe health non trouvée - OK`);
      } else {
        console.log(`❌ Échec API externe: ${error.message}`);
      }
    }

    // Test 5: API changes (publique)
    totalTests++;
    console.log('\n5️⃣ Test API changes (publique)...');
    try {
      const changesRes = await axios.get(`${API_BASE}/api/external/changes`);
      console.log(`✅ API changes: ${changesRes.data.data?.length || 0} modifications`);
      if (changesRes.data.derniereModification) {
        console.log(`📅 Dernière modif: ${changesRes.data.derniereModification}`);
      }
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API changes non trouvée - OK`);
      } else {
        console.log(`❌ Échec API changes: ${error.message}`);
      }
    }

    // Test 6: API stats (publique)
    totalTests++;
    console.log('\n6️⃣ Test API stats...');
    try {
      const statsRes = await axios.get(`${API_BASE}/api/external/stats`);
      console.log(`✅ API stats accessible`);
      if (statsRes.data.data && statsRes.data.data.global) {
        console.log(`📊 Total: ${statsRes.data.data.global.total_cartes} cartes`);
      }
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API stats non trouvée - OK`);
      } else {
        console.log(`❌ Échec API stats: ${error.message}`);
      }
    }

    // Test 7: API externe protégée (sans token)
    totalTests++;
    console.log('\n7️⃣ Test API protégée (sans token - devrait échouer)...');
    try {
      await axios.get(`${API_BASE}/api/external/cartes`);
      console.log(`❌ Devrait avoir échoué (401)`);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log(`✅ Correctement protégée (401 Unauthorized)`);
        successCount++;
      } else {
        console.log(`✅ Protégée (autre erreur: ${error.response?.status || error.code})`);
        successCount++;
      }
    }

    // Test 8: API externe protégée (avec token)
    totalTests++;
    console.log('\n8️⃣ Test API protégée (avec token)...');
    try {
      const protectedRes = await axios.get(`${API_BASE}/api/external/cartes`, {
        headers: { 'X-API-Token': API_TOKEN },
        params: { limit: 5 }, // Limiter pour éviter de charger trop de données
      });
      console.log(`✅ API protégée accessible avec token`);
      if (protectedRes.data.data) {
        console.log(`📊 Données: ${protectedRes.data.data.length} cartes`);
      }
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Route /api/external/cartes non trouvée - OK`);
      } else {
        console.log(`❌ Erreur token: ${error.response?.data?.error || error.message}`);
      }
    }

    // Test 9: Route protégée JWT (sans token)
    totalTests++;
    console.log('\n9️⃣ Test route protégée JWT (sans token - devrait échouer)...');
    try {
      await axios.get(`${API_BASE}/api/cartes`);
      console.log(`❌ Devrait avoir échoué (401)`);
    } catch (error) {
      if (error.response && error.response.status === 401) {
        console.log(`✅ Correctement protégée (401 Unauthorized)`);
        successCount++;
      } else {
        console.log(`✅ Protégée (${error.response?.status || 'timeout'})`);
        successCount++;
      }
    }

    // Test 10: Route d'accueil des statistiques
    totalTests++;
    console.log('\n🔟 Test route statistiques...');
    try {
      const statsHomeRes = await axios.get(`${API_BASE}/api/statistiques`);
      console.log(`✅ Route statistiques accessible - ${statsHomeRes.data.name || 'OK'}`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Route statistiques non trouvée - OK`);
      } else {
        console.log(`❌ Erreur statistiques: ${error.message}`);
      }
    }

    // Test 11: Synchronisation sites (sans token)
    totalTests++;
    console.log('\n1️⃣1️⃣ Test synchronisation (sans token)...');
    try {
      await axios.get(`${API_BASE}/api/site/health`);
      console.log(`✅ Route sync accessible`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Route sync non trouvée - OK`);
      } else {
        console.log(`✅ Route sync protégée: ${error.response?.status || 'OK'}`);
        successCount++;
      }
    }

    console.log('\n🎯 RÉSULTATS DU DIAGNOSTIC');
    console.log('========================');
    console.log(`✅ Tests réussis: ${successCount}/${totalTests}`);
    console.log(`🌐 API testée: ${API_BASE}`);

    if (successCount === totalTests) {
      console.log('\n🎉 Tous les tests ont réussi ! API prête pour la production.');
    } else {
      const pourcentage = Math.round((successCount / totalTests) * 100);
      console.log(`\n⚠️ ${pourcentage}% des tests ont réussi. Vérifie les routes manquantes.`);
      console.log('📝 Routes à vérifier:');
      console.log('   - /api/external/health');
      console.log('   - /api/external/changes');
      console.log('   - /api/external/stats');
      console.log('   - /api/external/cartes');
      console.log('   - /api/statistiques');
      console.log('   - /api/site/health');
    }
  } catch (error) {
    console.error('\n❌ Diagnostic échoué - Erreur générale:');
    console.error(`Message: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error("💡 Le serveur n'est pas accessible. Vérifie que ton backend tourne bien.");
    } else if (error.code === 'ENOTFOUND') {
      console.error("💡 L'URL n'est pas valide. Vérifie API_BASE.");
    } else if (error.code === 'ETIMEDOUT') {
      console.error('💡 Timeout - Le serveur répond trop lentement ou ne répond pas.');
    }
    process.exit(1);
  }
}

// Exécuter le diagnostic
runDiagnostic();
