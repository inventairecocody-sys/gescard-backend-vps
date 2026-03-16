const { google } = require('googleapis');
const { Client } = require('pg');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execPromise = util.promisify(exec);
const zlib = require('zlib');
const { pipeline } = require('stream');
const pump = util.promisify(pipeline);

class PostgreSQLRestorer {
  constructor() {
    this.drive = null;
    this.auth = null;
    this.backupFolderId = null;

    console.log('🔄 Service Restauration PostgreSQL initialisé pour VPS');
  }

  // ============================================
  // 1. AUTHENTIFICATION GOOGLE DRIVE
  // ============================================

  async authenticate() {
    console.log('🔐 Authentification Google Drive...');

    if (
      !process.env.GOOGLE_CLIENT_ID ||
      !process.env.GOOGLE_CLIENT_SECRET ||
      !process.env.GOOGLE_REFRESH_TOKEN
    ) {
      throw new Error('Configuration Google Drive incomplète');
    }

    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI || 'https://developers.google.com/oauthplayground'
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    this.auth = oauth2Client;
    this.drive = google.drive({ version: 'v3', auth: oauth2Client });

    console.log('✅ Authentification Google Drive réussie');
  }

  // ============================================
  // 2. TROUVER LE DOSSIER DE BACKUP
  // ============================================

  async findBackupFolder() {
    console.log('📁 Recherche du dossier backup...');

    try {
      // Si ID fixe fourni
      if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
        try {
          const folder = await this.drive.files.get({
            fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
            fields: 'id, name',
          });

          this.backupFolderId = folder.data.id;
          console.log(`✅ Dossier trouvé par ID: ${this.backupFolderId}`);
          return this.backupFolderId;
        } catch (error) {
          console.log('⚠️  Dossier ID non trouvé, recherche par nom...');
        }
      }

      // Recherche par nom
      const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups';
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name)',
        orderBy: 'createdTime desc',
      });

      if (response.data.files.length === 0) {
        throw new Error(`❌ Dossier '${folderName}' non trouvé dans Google Drive`);
      }

      this.backupFolderId = response.data.files[0].id;
      console.log(`✅ Dossier trouvé: ${this.backupFolderId}`);
      return this.backupFolderId;
    } catch (error) {
      console.error('❌ Erreur recherche dossier:', error.message);
      throw error;
    }
  }

  // ============================================
  // 3. TROUVER LE DERNIER BACKUP
  // ============================================

  async findLatestBackup() {
    console.log('🔍 Recherche du dernier backup...');

    await this.findBackupFolder();

    const response = await this.drive.files.list({
      q: `'${this.backupFolderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: 1,
      fields: 'files(id, name, createdTime, size, mimeType)',
    });

    if (response.data.files.length === 0) {
      throw new Error('❌ Aucun backup trouvé');
    }

    const latestBackup = response.data.files[0];
    const fileSizeMB = (parseInt(latestBackup.size) / 1024 / 1024).toFixed(2);

    console.log(`✅ Dernier backup trouvé: ${latestBackup.name}`);
    console.log(`📦 Taille: ${fileSizeMB} MB`);
    console.log(`📅 Créé le: ${new Date(latestBackup.createdTime).toLocaleString('fr-FR')}`);

    return latestBackup;
  }

  // ============================================
  // 4. TROUVER UN BACKUP PAR ID
  // ============================================

  async findBackupById(backupId) {
    console.log(`🔍 Recherche backup: ${backupId}`);

    try {
      const file = await this.drive.files.get({
        fileId: backupId,
        fields: 'id, name, createdTime, size, mimeType',
      });

      const fileSizeMB = (parseInt(file.data.size) / 1024 / 1024).toFixed(2);

      console.log(`✅ Backup trouvé: ${file.data.name}`);
      console.log(`📦 Taille: ${fileSizeMB} MB`);

      return file.data;
    } catch (error) {
      console.error('❌ Backup non trouvé:', error.message);
      throw new Error(`Backup avec ID ${backupId} non trouvé`);
    }
  }

  // ============================================
  // 5. LISTER TOUS LES BACKUPS
  // ============================================

  async listAllBackups() {
    console.log('📋 Liste des backups disponibles...');

    await this.findBackupFolder();

    const response = await this.drive.files.list({
      q: `'${this.backupFolderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: 100,
      fields: 'files(id, name, createdTime, size, mimeType)',
    });

    const backups = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      created: new Date(file.createdTime).toLocaleString('fr-FR'),
      sizeMB: (parseInt(file.size) / 1024 / 1024).toFixed(2),
      type: file.name.endsWith('.gz')
        ? 'SQL compressé'
        : file.name.endsWith('.sql')
          ? 'SQL'
          : file.name.endsWith('.json')
            ? 'JSON'
            : 'Inconnu',
    }));

    console.log(`✅ ${backups.length} backup(s) trouvé(s)`);
    return backups;
  }

  // ============================================
  // 6. TÉLÉCHARGER UN BACKUP
  // ============================================

  async downloadBackup(fileId, fileName) {
    console.log(`⬇️  Téléchargement du backup: ${fileName}`);

    const tempPath = path.join('/tmp', `restore-${Date.now()}-${fileName}`);
    const startTime = Date.now();

    const dest = fsSync.createWriteStream(tempPath);
    const response = await this.drive.files.get(
      { fileId: fileId, alt: 'media' },
      { responseType: 'stream' }
    );

    return new Promise((resolve, reject) => {
      let downloadedBytes = 0;

      response.data
        .on('data', (chunk) => {
          downloadedBytes += chunk.length;
          const percent = (
            (downloadedBytes / response.data.headers['content-length']) *
            100
          ).toFixed(1);
          process.stdout.write(`\r⏳ Téléchargement: ${percent}%`);
        })
        .pipe(dest)
        .on('finish', () => {
          const duration = Date.now() - startTime;
          const fileSizeMB = downloadedBytes / 1024 / 1024;
          console.log(
            `\n✅ Téléchargement terminé: ${fileSizeMB.toFixed(2)} MB en ${Math.round(duration / 1000)}s`
          );
          resolve(tempPath);
        })
        .on('error', (error) => {
          console.error('\n❌ Erreur téléchargement:', error.message);
          reject(error);
        });
    });
  }

  // ============================================
  // 7. DÉCOMPRESSER SI NÉCESSAIRE
  // ============================================

  async decompressIfNeeded(filePath) {
    if (filePath.endsWith('.gz')) {
      console.log('🗜️  Décompression du fichier...');
      const decompressedPath = filePath.replace('.gz', '');

      return new Promise((resolve, reject) => {
        const gunzip = zlib.createGunzip();
        const source = fsSync.createReadStream(filePath);
        const destination = fsSync.createWriteStream(decompressedPath);

        pump(source, gunzip, destination)
          .then(() => {
            // Supprimer le fichier compressé
            fs.unlink(filePath).catch(() => {});
            console.log(`✅ Fichier décompressé: ${path.basename(decompressedPath)}`);
            resolve(decompressedPath);
          })
          .catch(reject);
      });
    }

    return filePath;
  }

  // ============================================
  // 8. RESTAURER FICHIER SQL (OPTIMISÉ VPS)
  // ============================================

  async restoreSqlFile(filePath) {
    console.log('🔄 Restauration SQL...');

    // Obtenir les infos de connexion
    let dbHost, dbPort, dbName, dbUser, dbPass;

    if (process.env.DATABASE_URL) {
      const dbUrl = new URL(process.env.DATABASE_URL);
      dbHost = dbUrl.hostname;
      dbPort = dbUrl.port || 5432;
      dbName = dbUrl.pathname.slice(1);
      dbUser = dbUrl.username;
      dbPass = dbUrl.password;
    } else {
      dbHost = process.env.DB_HOST || 'localhost';
      dbPort = process.env.DB_PORT || 5432;
      dbName = process.env.DB_NAME;
      dbUser = process.env.DB_USER;
      dbPass = process.env.DB_PASSWORD;
    }

    // Commande psql optimisée pour VPS
    const command = `psql \
      --host=${dbHost} \
      --port=${dbPort} \
      --username=${dbUser} \
      --dbname=${dbName} \
      --file=${filePath} \
      --set ON_ERROR_STOP=on`;

    const env = { ...process.env, PGPASSWORD: dbPass };

    try {
      console.log('⚡ Exécution de la restauration SQL (cela peut prendre quelques minutes)...');
      const startTime = Date.now();

      const { stderr } = await execPromise(command, {
        env,
        timeout: 600000, // 10 minutes pour VPS
        maxBuffer: 1024 * 1024 * 100, // 100MB buffer
      });

      const duration = Date.now() - startTime;

      if (stderr && !stderr.includes('WARNING:')) {
        console.warn('⚠️  Avertissements:', stderr);
      }

      console.log(`✅ Restauration SQL terminée en ${Math.round(duration / 1000)}s`);
      return true;
    } catch (error) {
      console.error('❌ Erreur restauration SQL:', error.message);

      if (error.message.includes('timeout')) {
        throw new Error('Timeout restauration - fichier trop volumineux');
      }

      console.log('⚠️  Fallback vers restauration JSON...');
      return false;
    }
  }

  // ============================================
  // 9. RESTAURER FICHIER JSON (OPTIMISÉ VPS)
  // ============================================

  async restoreJsonFile(filePath) {
    console.log('🔄 Restauration JSON...');

    // Lire et parser le fichier
    console.log('📖 Lecture du fichier JSON...');
    const fileContent = await fs.readFile(filePath, 'utf8');
    const backupData = JSON.parse(fileContent);

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      statement_timeout: 300000, // 5 minutes par requête
    });

    try {
      await client.connect();
      console.log('✅ Connecté à PostgreSQL');

      // Désactiver les triggers temporairement pour accélérer
      await client.query('SET session_replication_role = replica;');

      // Restaurer les données
      const tables = backupData.data || {};
      const tableNames = Object.keys(tables);

      console.log(`📋 ${tableNames.length} tables à restaurer`);

      let totalRows = 0;
      let successTables = 0;

      for (const [index, tableName] of tableNames.entries()) {
        const rows = tables[tableName];

        if (!Array.isArray(rows) || rows.length === 0) {
          console.log(`⏭️  Table ${tableName} vide, ignorée`);
          continue;
        }

        console.log(
          `📤 [${index + 1}/${tableNames.length}] Restauration ${tableName} (${rows.length} lignes)...`
        );

        try {
          // Vider la table (plus rapide que DELETE)
          await client.query(`TRUNCATE TABLE "${tableName}" CASCADE;`);

          // Restaurer les données
          const restoredCount = await this.restoreTableOptimized(client, tableName, rows);

          totalRows += restoredCount;
          successTables++;
          console.log(`   ✅ ${restoredCount} lignes restaurées dans ${tableName}`);
        } catch (error) {
          console.error(`   ❌ Erreur table ${tableName}:`, error.message);
        }
      }

      // Réactiver les triggers
      await client.query('SET session_replication_role = DEFAULT;');

      console.log(
        `✅ Restauration JSON terminée: ${successTables}/${tableNames.length} tables, ${totalRows} lignes totales`
      );
      return true;
    } catch (error) {
      console.error('❌ Erreur restauration JSON:', error);
      throw error;
    } finally {
      await client.end();
    }
  }

  // ============================================
  // 10. RESTAURATION OPTIMISÉE D'UNE TABLE
  // ============================================

  async restoreTableOptimized(client, tableName, rows) {
    if (rows.length === 0) return 0;

    // Prendre les colonnes du premier objet
    const columns = Object.keys(rows[0]);
    const placeholders = columns.map((_, i) => `$${i + 1}`).join(', ');
    const columnNames = columns.map((col) => `"${col}"`).join(', ');

    const insertSQL = `INSERT INTO "${tableName}" (${columnNames}) VALUES (${placeholders})`;

    let restoredCount = 0;
    const batchSize = 1000; // Lots de 1000 pour VPS

    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize);

      // Utiliser une transaction par batch
      await client.query('BEGIN');

      try {
        for (const row of batch) {
          const values = columns.map((col) => row[col]);
          await client.query(insertSQL, values);
          restoredCount++;
        }
        await client.query('COMMIT');

        if ((i + batchSize) % 10000 === 0) {
          console.log(`   ⏳ ${Math.min(i + batchSize, rows.length)}/${rows.length} lignes...`);
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }

    return restoredCount;
  }

  // ============================================
  // 11. RESTAURATION COMPLÈTE
  // ============================================

  async executeRestoration() {
    console.log('🚀 DÉMARRAGE RESTAURATION COMPLÈTE');
    console.log('==================================');
    const startTime = Date.now();

    try {
      await this.authenticate();

      // 1. Trouver le dernier backup
      const latestBackup = await this.findLatestBackup();

      // 2. Télécharger
      const downloadedPath = await this.downloadBackup(latestBackup.id, latestBackup.name);

      // 3. Décompresser si nécessaire
      const restorePath = await this.decompressIfNeeded(downloadedPath);

      // 4. Restaurer selon le type
      let restored = false;

      if (restorePath.endsWith('.sql')) {
        restored = await this.restoreSqlFile(restorePath);
      }

      if (!restored && restorePath.endsWith('.json')) {
        await this.restoreJsonFile(restorePath);
        restored = true;
      }

      // 5. Nettoyage
      await fs.unlink(restorePath).catch(() => {});

      const totalDuration = Date.now() - startTime;

      console.log('==================================');
      console.log(`🎉 RESTAURATION RÉUSSIE en ${Math.round(totalDuration / 1000)}s`);
      console.log(`📦 Backup: ${latestBackup.name}`);
      console.log(`📅 Date: ${new Date(latestBackup.createdTime).toLocaleString('fr-FR')}`);

      return {
        success: true,
        backupName: latestBackup.name,
        backupDate: latestBackup.createdTime,
        duration: totalDuration,
      };
    } catch (error) {
      console.error('💥 RESTAURATION ÉCHOUÉE:', error.message);
      throw error;
    }
  }

  // ============================================
  // 12. RESTAURATION À PARTIR D'UN ID
  // ============================================

  async restoreFromId(backupId) {
    console.log(`🚀 RESTAURATION BACKUP SPÉCIFIQUE: ${backupId}`);
    console.log('========================================');
    const startTime = Date.now();

    try {
      await this.authenticate();

      // 1. Trouver le backup par ID
      const backup = await this.findBackupById(backupId);

      // 2. Télécharger
      const downloadedPath = await this.downloadBackup(backup.id, backup.name);

      // 3. Décompresser si nécessaire
      const restorePath = await this.decompressIfNeeded(downloadedPath);

      // 4. Restaurer selon le type
      let restored = false;

      if (restorePath.endsWith('.sql')) {
        restored = await this.restoreSqlFile(restorePath);
      }

      if (!restored && restorePath.endsWith('.json')) {
        await this.restoreJsonFile(restorePath);
        restored = true;
      }

      // 5. Nettoyage
      await fs.unlink(restorePath).catch(() => {});

      const totalDuration = Date.now() - startTime;

      console.log('========================================');
      console.log(`🎉 RESTAURATION RÉUSSIE en ${Math.round(totalDuration / 1000)}s`);
      console.log(`📦 Backup: ${backup.name}`);
      console.log(`📅 Date: ${new Date(backup.createdTime).toLocaleString('fr-FR')}`);

      return {
        success: true,
        backupName: backup.name,
        backupDate: backup.createdTime,
        duration: totalDuration,
      };
    } catch (error) {
      console.error('💥 RESTAURATION ÉCHOUÉE:', error.message);
      throw error;
    }
  }

  // ============================================
  // 13. VÉRIFICATION DE L'INTÉGRITÉ
  // ============================================

  async verifyBackupIntegrity(backupId) {
    console.log(`🔍 Vérification intégrité backup: ${backupId}`);

    try {
      await this.authenticate();
      const backup = await this.findBackupById(backupId);

      // Télécharger temporairement
      const downloadedPath = await this.downloadBackup(backup.id, backup.name);
      const restorePath = await this.decompressIfNeeded(downloadedPath);

      let isValid = true;
      let error = null;

      if (restorePath.endsWith('.sql')) {
        // Vérifier que le fichier SQL n'est pas corrompu
        try {
          const content = await fs.readFile(restorePath, 'utf8');
          isValid = content.includes('CREATE TABLE') || content.includes('INSERT INTO');
        } catch (e) {
          isValid = false;
          error = e.message;
        }
      } else if (restorePath.endsWith('.json')) {
        // Vérifier que le JSON est valide
        try {
          const content = await fs.readFile(restorePath, 'utf8');
          JSON.parse(content);
        } catch (e) {
          isValid = false;
          error = e.message;
        }
      }

      // Nettoyer
      await fs.unlink(downloadedPath).catch(() => {});
      if (restorePath !== downloadedPath) {
        await fs.unlink(restorePath).catch(() => {});
      }

      return {
        backupId,
        backupName: backup.name,
        isValid,
        error,
      };
    } catch (error) {
      return {
        backupId,
        isValid: false,
        error: error.message,
      };
    }
  }
}

module.exports = PostgreSQLRestorer;
