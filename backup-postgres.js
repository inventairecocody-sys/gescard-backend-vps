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

class PostgreSQLBackup {
  constructor() {
    this.auth = null;
    this.drive = null;
    this.backupFolderId = null;
    this.stats = {
      totalBackups: 0,
      lastBackup: null,
      totalSize: 0,
    };

    console.log('🚀 Service Backup PostgreSQL initialisé pour VPS');
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

    oauth2Client.on('tokens', (tokens) => {
      if (tokens.refresh_token) {
        console.log('🔄 Nouveau refresh token reçu');
      }
    });

    this.auth = oauth2Client;
    this.drive = google.drive({ version: 'v3', auth: oauth2Client });

    console.log('✅ Authentification Google Drive réussie');
  }

  // ============================================
  // 2. GESTION DU DOSSIER BACKUP
  // ============================================

  async getOrCreateBackupFolder() {
    console.log('📁 Recherche du dossier backup...');

    try {
      // D'abord, chercher avec l'ID fixe si fourni
      if (process.env.GOOGLE_DRIVE_FOLDER_ID) {
        try {
          const folder = await this.drive.files.get({
            fileId: process.env.GOOGLE_DRIVE_FOLDER_ID,
            fields: 'id, name',
          });

          this.backupFolderId = folder.data.id;
          console.log(`✅ Dossier trouvé par ID: ${this.backupFolderId} (${folder.data.name})`);
          return this.backupFolderId;
        } catch (error) {
          console.log('⚠️  Dossier ID non trouvé, recherche par nom...');
        }
      }

      // Chercher par nom
      const folderName = process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups';
      const response = await this.drive.files.list({
        q: `name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
        fields: 'files(id, name, createdTime)',
        orderBy: 'createdTime desc',
      });

      if (response.data.files.length > 0) {
        this.backupFolderId = response.data.files[0].id;
        console.log(`✅ Dossier trouvé: ${this.backupFolderId} (${folderName})`);
        return this.backupFolderId;
      }

      // Créer le dossier
      console.log(`📁 Création du dossier ${folderName}...`);
      const folderMetadata = {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        description: 'Backups automatiques Gescard',
      };

      const folder = await this.drive.files.create({
        resource: folderMetadata,
        fields: 'id, name',
      });

      this.backupFolderId = folder.data.id;
      console.log(`✅ Dossier créé: ${this.backupFolderId}`);
      return this.backupFolderId;
    } catch (error) {
      console.error('❌ Erreur dossier:', error.message);
      throw error;
    }
  }

  // ============================================
  // 3. EXPORT AVEC PG_DUMP (optimisé VPS)
  // ============================================

  async exportWithPgDump() {
    console.log('💾 Export PostgreSQL avec pg_dump...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `backup-gescard-${timestamp}.sql.gz`;
    const filePath = path.join('/tmp', fileName);

    try {
      // Vérifier que pg_dump est disponible
      await execPromise('which pg_dump');

      // Extraire les infos de connexion (soit DATABASE_URL soit variables individuelles)
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

      // Options optimisées pour pg_dump
      const command = `pg_dump \
        --host=${dbHost} \
        --port=${dbPort} \
        --username=${dbUser} \
        --dbname=${dbName} \
        --format=plain \
        --no-owner \
        --no-privileges \
        --compress=9 \
        --file=${filePath}`;

      const env = { ...process.env, PGPASSWORD: dbPass };

      console.log(`📁 Création backup compressé: ${fileName}`);
      const startTime = Date.now();

      await execPromise(command, { env, timeout: 600000 }); // 10 minutes max (VPS)

      const stats = await fs.stat(filePath);
      const duration = Date.now() - startTime;

      console.log(
        `✅ Backup créé: ${(stats.size / 1024 / 1024).toFixed(2)} MB en ${Math.round(duration / 1000)}s`
      );

      return { filePath, fileName, size: stats.size, duration, method: 'pg_dump' };
    } catch (error) {
      console.error('❌ Erreur pg_dump:', error.message);

      if (error.message.includes('timeout')) {
        throw new Error('Timeout pg_dump - fichier trop volumineux');
      }

      console.log('⚠️  Fallback vers export JSON...');
      const result = await this.exportManualBackup();
      result.method = 'manual_json';
      return result;
    }
  }

  // ============================================
  // 4. EXPORT MANUEL JSON COMPRESSÉ
  // ============================================

  async exportManualBackup() {
    console.log('🔄 Export manuel JSON...');

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const fileName = `backup-gescard-${timestamp}.json.gz`;
    const filePath = path.join('/tmp', fileName);
    const tempJsonPath = path.join('/tmp', `temp-${Date.now()}.json`);

    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
      statement_timeout: 300000, // 5 minutes par requête (VPS)
    });

    try {
      await client.connect();
      console.log('✅ Connecté à PostgreSQL');

      // Récupérer toutes les tables
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_type = 'BASE TABLE'
        AND table_name NOT IN ('spatial_ref_sys')
        ORDER BY table_name;
      `;

      const tablesResult = await client.query(tablesQuery);
      const tables = tablesResult.rows.map((row) => row.table_name);

      console.log(`📋 ${tables.length} tables à exporter`);

      const backupData = {
        metadata: {
          database: 'Gescard PostgreSQL',
          version: '1.0.0',
          exportDate: new Date().toISOString(),
          tableCount: tables.length,
          tables: [],
        },
        data: {},
      };

      // Exporter chaque table
      for (const [index, tableName] of tables.entries()) {
        console.log(`📤 [${index + 1}/${tables.length}] Export table: ${tableName}`);

        const countQuery = `SELECT COUNT(*) as count FROM "${tableName}"`;
        const countResult = await client.query(countQuery);
        const rowCount = parseInt(countResult.rows[0].count);

        if (rowCount === 0) {
          console.log(`   ⏭️  Table vide ignorée`);
          continue;
        }

        // Export par lots pour les grandes tables
        if (rowCount > 20000) {
          console.log(`   📦 Grande table (${rowCount} lignes) - export par lots...`);
          backupData.data[tableName] = await this.exportLargeTable(client, tableName, rowCount);
        } else {
          const dataQuery = `SELECT * FROM "${tableName}"`;
          const dataResult = await client.query(dataQuery);
          backupData.data[tableName] = dataResult.rows;
        }

        backupData.metadata.tables.push({
          name: tableName,
          rows: rowCount,
        });

        console.log(`   ✅ ${rowCount} lignes exportées`);
      }

      // Sauvegarder temporairement
      await fs.writeFile(tempJsonPath, JSON.stringify(backupData, null, 0));
      const jsonStats = await fs.stat(tempJsonPath);
      console.log(`📄 JSON temporaire: ${(jsonStats.size / 1024 / 1024).toFixed(2)} MB`);

      // Compresser avec gzip
      console.log('🗜️  Compression du fichier...');
      const startTime = Date.now();

      await this.compressFile(tempJsonPath, filePath);

      const stats = await fs.stat(filePath);
      const duration = Date.now() - startTime;

      console.log(
        `✅ Backup compressé: ${(stats.size / 1024 / 1024).toFixed(2)} MB (ratio: ${Math.round((stats.size / jsonStats.size) * 100)}%)`
      );

      // Nettoyer
      await fs.unlink(tempJsonPath).catch(() => {});

      return { filePath, fileName, size: stats.size, duration, method: 'manual_json' };
    } catch (error) {
      console.error('❌ Erreur export manuel:', error);
      throw error;
    } finally {
      await client.end().catch(() => {});
    }
  }

  // Export d'une grande table par lots
  async exportLargeTable(client, tableName, totalRows) {
    const rows = [];
    const batchSize = 10000; // Plus gros sur VPS
    let offset = 0;

    while (offset < totalRows) {
      const query = `SELECT * FROM "${tableName}" ORDER BY id LIMIT ${batchSize} OFFSET ${offset}`;
      const result = await client.query(query);
      rows.push(...result.rows);

      offset += batchSize;
      if (offset % 100000 === 0) {
        console.log(`   ⏳ ${Math.round((offset / totalRows) * 100)}% exporté...`);
      }
    }

    return rows;
  }

  // Compression gzip
  async compressFile(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
      const gzip = zlib.createGzip({ level: 9 });
      const source = fsSync.createReadStream(inputPath);
      const destination = fsSync.createWriteStream(outputPath);

      pump(source, gzip, destination).then(resolve).catch(reject);
    });
  }

  // ============================================
  // 5. UPLOAD VERS GOOGLE DRIVE
  // ============================================

  async uploadToDrive(filePath, fileName) {
    console.log(`☁️  Upload vers Google Drive: ${fileName}`);

    const fileMetadata = {
      name: fileName,
      parents: [this.backupFolderId],
      description: `Backup Gescard - ${new Date().toLocaleString('fr-FR')}`,
      properties: {
        type: 'postgresql_backup',
        created: new Date().toISOString(),
        size: (await fs.stat(filePath)).size.toString(),
      },
    };

    const media = {
      mimeType: 'application/gzip',
      body: fsSync.createReadStream(filePath),
    };

    try {
      const startTime = Date.now();

      const file = await this.drive.files.create({
        resource: fileMetadata,
        media: media,
        fields: 'id, name, webViewLink, size, createdTime',
      });

      const duration = Date.now() - startTime;
      const sizeMB = parseInt(file.data.size) / 1024 / 1024;

      console.log(
        `✅ Upload réussi: ${file.data.name} (${sizeMB.toFixed(2)} MB en ${Math.round(duration / 1000)}s)`
      );
      console.log(`🔗 Lien: ${file.data.webViewLink}`);

      return file.data;
    } catch (error) {
      console.error('❌ Erreur upload:', error.message);
      throw error;
    }
  }

  // ============================================
  // 6. BACKUP COMPLET
  // ============================================

  async executeBackup() {
    console.log('🚀 Démarrage backup Gescard...');
    const startTime = Date.now();

    try {
      await this.authenticate();
      await this.getOrCreateBackupFolder();

      // Essayer pg_dump d'abord
      let backupFile;
      try {
        backupFile = await this.exportWithPgDump();
      } catch (error) {
        console.log('⚠️  pg_dump échoué, fallback JSON');
        backupFile = await this.exportManualBackup();
      }

      // Upload
      const uploadedFile = await this.uploadToDrive(backupFile.filePath, backupFile.fileName);

      // Nettoyage
      await fs.unlink(backupFile.filePath).catch(() => {});

      const totalDuration = Date.now() - startTime;

      console.log(`🎉 BACKUP RÉUSSI en ${Math.round(totalDuration / 1000)}s`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Fichier: ${uploadedFile.name}`);
      console.log(`   - Taille: ${(uploadedFile.size / 1024 / 1024).toFixed(2)} MB`);
      console.log(`   - ID: ${uploadedFile.id}`);
      console.log(`   - Méthode: ${backupFile.method || 'pg_dump'}`);

      return {
        ...uploadedFile,
        duration: totalDuration,
        method: backupFile.method || 'pg_dump',
      };
    } catch (error) {
      console.error('💥 BACKUP ÉCHOUÉ:', error.message);
      throw error;
    }
  }

  // ============================================
  // 7. LISTER LES BACKUPS
  // ============================================

  async listBackups(options = {}) {
    const { limit = 50 } = options; // includeSizes supprimé car non utilisé

    await this.authenticate();
    await this.getOrCreateBackupFolder();

    const response = await this.drive.files.list({
      q: `'${this.backupFolderId}' in parents and trashed=false`,
      orderBy: 'createdTime desc',
      pageSize: limit,
      fields: 'files(id, name, createdTime, size, mimeType, webViewLink, description, properties)',
    });

    const files = response.data.files.map((file) => ({
      id: file.id,
      name: file.name,
      created: new Date(file.createdTime).toLocaleString('fr-FR'),
      createdISO: file.createdTime,
      size: file.size ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'N/A',
      sizeBytes: parseInt(file.size) || 0,
      type: file.mimeType === 'application/gzip' ? 'SQL' : 'JSON',
      link: file.webViewLink,
      downloadLink: `https://drive.google.com/uc?export=download&id=${file.id}`,
    }));

    // Mettre à jour les stats
    this.stats.totalBackups = files.length;
    this.stats.totalSize = files.reduce((acc, f) => acc + (f.sizeBytes || 0), 0);
    this.stats.lastBackup = files.length > 0 ? files[0].createdISO : null;

    return files;
  }

  // ============================================
  // 8. SUPPRIMER UN BACKUP
  // ============================================

  async deleteBackup(backupId) {
    console.log(`🗑️  Suppression backup: ${backupId}`);

    await this.authenticate();

    try {
      await this.drive.files.delete({
        fileId: backupId,
      });

      console.log('✅ Backup supprimé');
      return true;
    } catch (error) {
      console.error('❌ Erreur suppression:', error.message);
      throw error;
    }
  }

  // ============================================
  // 9. NETTOYER LES VIEUX BACKUPS
  // ============================================

  async cleanupOldBackups(olderThanDays = 90) {
    console.log(`🧹 Nettoyage backups > ${olderThanDays} jours`);

    const backups = await this.listBackups({ limit: 1000 });
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const oldBackups = backups.filter((b) => new Date(b.createdISO) < cutoffDate);

    if (oldBackups.length === 0) {
      console.log('✅ Aucun backup à nettoyer');
      return 0;
    }

    console.log(`🗑️  ${oldBackups.length} backups à supprimer`);

    for (const backup of oldBackups) {
      await this.deleteBackup(backup.id);
    }

    console.log(`✅ Nettoyage terminé: ${oldBackups.length} backups supprimés`);
    return oldBackups.length;
  }

  // ============================================
  // 10. STATISTIQUES
  // ============================================

  async getStats() {
    await this.listBackups({ limit: 1000 });

    return {
      totalBackups: this.stats.totalBackups,
      totalSizeMB: Math.round(this.stats.totalSize / 1024 / 1024),
      lastBackup: this.stats.lastBackup,
      averageSizeMB:
        this.stats.totalBackups > 0
          ? Math.round(this.stats.totalSize / this.stats.totalBackups / 1024 / 1024)
          : 0,
      googleDrive: {
        folderId: this.backupFolderId,
        folderName: process.env.GOOGLE_DRIVE_FOLDER_NAME || 'gescard_backups',
      },
    };
  }

  // ============================================
  // 11. VÉRIFIER L'ÉTAT
  // ============================================

  async healthCheck() {
    try {
      const startTime = Date.now();

      await this.authenticate();
      await this.getOrCreateBackupFolder();

      // Tester l'upload en créant un petit fichier test
      const testFile = path.join('/tmp', 'health-test.txt');
      await fs.writeFile(testFile, 'OK');

      const testUpload = await this.drive.files.create({
        resource: {
          name: 'health-check.txt',
          parents: [this.backupFolderId],
        },
        media: {
          mimeType: 'text/plain',
          body: fsSync.createReadStream(testFile),
        },
        fields: 'id',
      });

      // Nettoyer
      await this.drive.files.delete({ fileId: testUpload.data.id });
      await fs.unlink(testFile);

      const duration = Date.now() - startTime;

      return {
        status: 'healthy',
        duration: `${duration}ms`,
        authenticated: true,
        folderId: this.backupFolderId,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        authenticated: false,
      };
    }
  }

  // ============================================
  // 12. VÉRIFIER S'IL Y A DES BACKUPS
  // ============================================

  async hasBackups() {
    try {
      const backups = await this.listBackups({ limit: 1 });
      return backups.length > 0;
    } catch (error) {
      console.warn('⚠️ Erreur vérification backups:', error.message);
      return false;
    }
  }
}

module.exports = PostgreSQLBackup;
