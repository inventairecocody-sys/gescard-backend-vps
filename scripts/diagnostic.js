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
      console.log(`✅ API de base: ${baseRes.data.message}`);
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

    // Test 4: API externe publique (si elle existe encore)
    totalTests++;
    console.log('\n4️⃣ Test API externe (publique)...');
    try {
      const extHealth = await axios.get(`${API_BASE}/api/external/health`);
      console.log(`✅ API externe health: ${extHealth.data.status}`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ API externe non trouvée (peut-être désactivée) - OK`);
      } else {
        console.log(`❌ Échec API externe: ${error.message}`);
      }
    }

    // Test 5: API changes (publique)
    totalTests++;
    console.log('\n5️⃣ Test API changes (publique)...');
    try {
      const changesRes = await axios.get(`${API_BASE}/api/external/changes`);
      console.log(`✅ API changes: ${changesRes.data.total || 0} modifications`);
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

    // Test 6: Debug external (si elle existe)
    totalTests++;
    console.log('\n6️⃣ Test debug external...');
    try {
      const debugRes = await axios.get(`${API_BASE}/api/debug/external`);
      console.log(`✅ Debug external: ${debugRes.data.status || 'OK'}`);
      successCount++;
    } catch (error) {
      if (error.response && error.response.status === 404) {
        console.log(`ℹ️ Debug external non trouvé - OK`);
      } else {
        console.log(`❌ Échec debug: ${error.message}`);
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

    // Test 9: Connexion directe à la BDD (optionnel)
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

    console.log('\n🎯 RÉSULTATS DU DIAGNOSTIC');
    console.log('========================');
    console.log(`✅ Tests réussis: ${successCount}/${totalTests}`);
    console.log(`🌐 API testée: ${API_BASE}`);

    if (successCount === totalTests) {
      console.log('\n🎉 Tous les tests ont réussi ! API prête pour la production.');
    } else {
      console.log('\n⚠️ Certains tests ont échoué. Vérifie les routes manquantes.');
    }
  } catch (error) {
    console.error('\n❌ Diagnostic échoué - Erreur générale:');
    console.error(`Message: ${error.message}`);
    if (error.code === 'ECONNREFUSED') {
      console.error("💡 Le serveur n'est pas accessible. Vérifie que ton backend tourne bien.");
    } else if (error.code === 'ENOTFOUND') {
      console.error("💡 L'URL n'est pas valide. Vérifie API_BASE.");
    }
    process.exit(1);
  }
}

// Exécuter le diagnostic
runDiagnostic();
