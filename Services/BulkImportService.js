const { Transform } = require('stream');
const EventEmitter = require('events');
const db = require('../db/db');
const fs = require('fs').promises;
const path = require('path');
const csv = require('csv-parser');
const readline = require('readline');

class BulkImportServiceCSV extends EventEmitter {
  constructor(options = {}) {
    super();
    
    // ============================================
    // CONFIGURATION OPTIMISÉE POUR VPS
    // ============================================
    
    // Configuration optimisée pour VPS 8 Go RAM
    const defaultOptions = {
      // 🚀 OPTIMISATIONS VPS
      batchSize: 5000,                    // Lots plus gros (vs 2000)
      maxConcurrentBatches: 4,             // Plus de parallélisme (vs 2)
      memoryLimitMB: 1024,                  // 1 Go pour les imports (vs 256MB)
      timeoutPerBatch: 60000,               // 60 secondes (vs 30s)
      pauseBetweenBatches: 25,               // Pause plus courte (vs 50ms)
      streamBufferSize: 512 * 1024,          // 512KB buffer (vs 128KB)
      
      // 📊 CONFIGURATION STANDARD
      validateEachRow: true,
      skipDuplicates: true,
      cleanupTempFiles: true,
      enableProgressTracking: true,
      maxRowsPerImport: 1000000,              // 1M lignes max (vs 500k)
      enableBatchRollback: true,
      useTransactionPerBatch: true,
      logBatchFrequency: 20,
      forceGarbageCollection: false,
      
      // 📄 CONFIGURATION CSV
      csvDelimiter: ';',                      // Point-virgule pour Excel français
      csvEncoding: 'utf8'
    };
    
    this.options = { ...defaultOptions, ...options };
    
    // Définition des colonnes CSV
    this.csvHeaders = [
      "LIEU D'ENROLEMENT",
      "SITE DE RETRAIT", 
      "RANGEMENT",
      "NOM",
      "PRENOMS",
      "DATE DE NAISSANCE",
      "LIEU NAISSANCE",
      "CONTACT",
      "DELIVRANCE",
      "CONTACT DE RETRAIT",
      "DATE DE DELIVRANCE"
    ];
    
    this.requiredHeaders = ['NOM', 'PRENOMS'];
    
    // Statistiques de l'import
    this.stats = {
      totalRows: 0,
      processed: 0,
      imported: 0,
      updated: 0,
      duplicates: 0,
      skipped: 0,
      errors: 0,
      startTime: null,
      endTime: null,
      batches: 0,
      memoryPeakMB: 0,
      lastProgressUpdate: 0,
      rowsPerSecond: 0
    };
    
    // État de l'import
    this.isRunning = false;
    this.isCancelled = false;
    this.currentBatch = 0;
    this.lastBatchTime = null;
    
    console.log('🚀 Service BulkImport CSV initialisé pour VPS:', {
      batchSize: this.options.batchSize,
      maxConcurrent: this.options.maxConcurrentBatches,
      maxRows: this.options.maxRowsPerImport,
      memoryLimit: `${this.options.memoryLimitMB}MB`,
      format: 'CSV optimisé',
      performance: 'Mode VPS (performances maximales)'
    });
  }

  // ==================== MÉTHODE PRINCIPALE CSV ====================

  /**
   * Importe un fichier CSV volumineux avec traitement par lots OPTIMISÉ POUR VPS
   */
  async importLargeCSVFile(filePath, userId = null, importBatchId = null) {
    if (this.isRunning) {
      throw new Error('Un import est déjà en cours');
    }

    this.isRunning = true;
    this.isCancelled = false;
    this.stats.startTime = new Date();
    this.currentBatch = 0;
    
    const finalImportBatchId = importBatchId || `csv_bulk_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    this.emit('start', { 
      filePath: path.basename(filePath),
      startTime: this.stats.startTime,
      importBatchId: finalImportBatchId,
      userId,
      environment: 'VPS',
      format: 'CSV'
    });

    try {
      // 1. ANALYSE RAPIDE DU FICHIER
      console.log('📊 Analyse rapide du fichier CSV...');
      await this.analyzeCSVFile(filePath);
      
      // 2. VALIDATION
      await this.validateCSVFile(filePath);
      
      if (this.stats.totalRows > this.options.maxRowsPerImport) {
        throw new Error(`Fichier trop volumineux: ${this.stats.totalRows} lignes (max: ${this.options.maxRowsPerImport})`);
      }

      this.emit('analysis', { 
        totalRows: this.stats.totalRows,
        estimatedBatches: Math.ceil(this.stats.totalRows / this.options.batchSize),
        estimatedTime: this.estimateCSVTotalTime(this.stats.totalRows),
        fileSizeMB: (await fs.stat(filePath)).size / 1024 / 1024,
        recommendations: [
          '✅ VPS: performances maximales',
          `📦 Lots de ${this.options.batchSize} lignes`,
          `⚡ Vitesse estimée: ${Math.round(this.stats.totalRows / 45)} lignes/sec`
        ]
      });

      // 3. TRAITEMENT PAR LOTS AVEC STREAMING
      console.log(`🎯 Début du traitement CSV: ${this.stats.totalRows} lignes...`);
      const importResult = await this.processCSVWithOptimizedStreaming(
        filePath, 
        finalImportBatchId, 
        userId
      );

      // 4. FINALISATION
      this.stats.endTime = new Date();
      const duration = this.stats.endTime - this.stats.startTime;
      
      // Calculer les performances
      const performance = this.calculateCSVPerformance(duration);
      this.stats.rowsPerSecond = performance.rowsPerSecond;
      
      this.emit('complete', {
        stats: { ...this.stats },
        duration,
        performance,
        importBatchId: finalImportBatchId,
        successRate: this.stats.totalRows > 0 ? 
          Math.round(((this.stats.imported + this.stats.updated) / this.stats.totalRows) * 100) : 0,
        environment: 'VPS',
        format: 'CSV'
      });

      console.log(`✅ Import CSV terminé en ${Math.round(duration / 1000)}s:`, {
        importés: this.stats.imported,
        misÀJour: this.stats.updated,
        doublons: this.stats.duplicates,
        erreurs: this.stats.errors,
        vitesse: `${performance.rowsPerSecond} lignes/sec`,
        mémoirePic: `${this.stats.memoryPeakMB}MB`,
        efficacité: performance.efficiency
      });

      return {
        success: true,
        importBatchId: finalImportBatchId,
        stats: { ...this.stats },
        duration,
        performance,
        environment: 'VPS',
        format: 'CSV'
      };

    } catch (error) {
      this.stats.endTime = new Date();
      
      this.emit('error', { 
        error: error.message,
        stats: { ...this.stats },
        importBatchId: finalImportBatchId,
        duration: this.stats.endTime - this.stats.startTime,
        format: 'CSV'
      });
      
      console.error('❌ Erreur import CSV massif:', error.message);
      throw error;
      
    } finally {
      this.isRunning = false;
      
      // NETTOYAGE
      await this.optimizedCleanup(filePath);
    }
  }

  // ==================== ANALYSE CSV OPTIMISÉE ====================

  /**
   * Analyser le fichier CSV en mode streaming
   */
  async analyzeCSVFile(filePath) {
    try {
      let lineCount = 0;
      let detectedHeaders = [];
      let isFirstRow = true;
      
      // Lire les premières lignes pour détecter les en-têtes
      const fileStream = fs.createReadStream(filePath, { 
        encoding: this.options.csvEncoding,
        highWaterMark: this.options.streamBufferSize
      });
      
      const rl = readline.createInterface({
        input: fileStream,
        crlfDelay: Infinity
      });
      
      for await (const line of rl) {
        if (isFirstRow) {
          // Détecter les en-têtes
          detectedHeaders = line.split(this.options.csvDelimiter)
            .map(h => h.trim().replace(/"/g, '').toUpperCase());
          isFirstRow = false;
          
          // Valider les en-têtes
          this.validateCSVHeaders(detectedHeaders);
          
          // Créer le mapping
          this.createHeaderMapping(detectedHeaders);
        } else {
          lineCount++;
          
          // Estimation pour les très gros fichiers
          if (lineCount > 5000) {
            // Estimer basé sur la taille du fichier
            const stats = await fs.stat(filePath);
            const bytesPerLine = stats.size / (lineCount + 1);
            lineCount = Math.floor(stats.size / bytesPerLine) - 1;
            break;
          }
        }
      }
      
      rl.close();
      
      this.stats.totalRows = lineCount;
      
      console.log(`📊 Fichier CSV analysé: ${this.stats.totalRows} lignes, ${detectedHeaders.length} colonnes`);
      
    } catch (error) {
      console.error('❌ Erreur analyse CSV:', error);
      throw new Error(`Impossible d'analyser le fichier CSV: ${error.message}`);
    }
  }

  /**
   * Créer le mapping des en-têtes
   */
  createHeaderMapping(detectedHeaders) {
    const mapping = {};
    
    this.csvHeaders.forEach(standardHeader => {
      const normalizedStandard = standardHeader.replace(/\s+/g, '').toUpperCase();
      
      const foundIndex = detectedHeaders.findIndex(h => 
        h.replace(/\s+/g, '').toUpperCase() === normalizedStandard
      );
      
      if (foundIndex !== -1) {
        mapping[standardHeader] = foundIndex;
      }
    });
    
    this.headerMapping = mapping;
  }

  /**
   * Valider les en-têtes CSV
   */
  validateCSVHeaders(headers) {
    const upperHeaders = headers.map(h => h.toUpperCase());
    const missingHeaders = this.requiredHeaders.filter(h => 
      !upperHeaders.some(uh => uh.includes(h.toUpperCase()))
    );
    
    if (missingHeaders.length > 0) {
      throw new Error(`En-têtes requis manquants: ${missingHeaders.join(', ')}`);
    }
    
    console.log('✅ En-têtes CSV validés');
  }

  /**
   * Valider le fichier CSV pour VPS
   */
  async validateCSVFile(filePath) {
    const stats = await fs.stat(filePath);
    const fileSizeMB = stats.size / 1024 / 1024;
    
    console.log(`📁 Taille du fichier: ${fileSizeMB.toFixed(2)}MB`);
    
    if (fileSizeMB > 500) {
      console.warn(`⚠️ Fichier très volumineux: ${fileSizeMB.toFixed(2)}MB`);
      this.emit('warning', {
        type: 'large_file',
        sizeMB: fileSizeMB,
        advice: 'Le traitement peut prendre plusieurs minutes'
      });
    }
  }

  // ==================== TRAITEMENT STREAMING CSV ====================

  /**
   * Traitement CSV avec streaming optimisé
   */
  async processCSVWithOptimizedStreaming(filePath, importBatchId, userId) {
    return new Promise((resolve, reject) => {
      let currentBatch = [];
      let rowNumber = 0;
      let batchIndex = 0;
      let processing = false;
      
      const stream = fs.createReadStream(filePath, {
        encoding: this.options.csvEncoding,
        highWaterMark: this.options.streamBufferSize
      });
      
      const parser = csv({
        separator: this.options.csvDelimiter,
        mapHeaders: ({ header }) => header.trim().toUpperCase(),
        mapValues: ({ value }) => value ? value.toString().trim() : '',
        skipLines: 0
      });
      
      stream
        .pipe(parser)
        .on('data', async (data) => {
          if (this.isCancelled) {
            stream.destroy();
            reject(new Error('Import CSV annulé'));
            return;
          }
          
          rowNumber++;
          
          // Ignorer la ligne d'en-tête
          if (rowNumber === 1) return;
          
          // Ajouter au lot courant
          currentBatch.push({
            rowNumber,
            data: this.mapCSVData(data)
          });
          
          // Si le lot est complet, le traiter
          if (currentBatch.length >= this.options.batchSize && !processing) {
            processing = true;
            
            // Pause le stream
            stream.pause();
            
            try {
              await this.processCSVBatchWithTimeout(
                [...currentBatch], 
                batchIndex, 
                importBatchId, 
                userId
              );
              
              currentBatch = [];
              batchIndex++;
              this.currentBatch = batchIndex;
              
              // Mise à jour de la progression
              this.updateProgress(rowNumber - 1);
              
            } catch (error) {
              stream.destroy();
              reject(error);
              return;
            } finally {
              processing = false;
              stream.resume();
            }
          }
        })
        .on('end', async () => {
          try {
            // Traiter le dernier lot
            if (currentBatch.length > 0 && !this.isCancelled) {
              await this.processCSVBatchWithTimeout(
                currentBatch, 
                batchIndex, 
                importBatchId, 
                userId
              );
              this.currentBatch = batchIndex + 1;
            }
            
            resolve({ batches: this.currentBatch });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          console.error('❌ Erreur streaming CSV:', error);
          reject(new Error(`Erreur lecture CSV: ${error.message}`));
        });
    });
  }

  /**
   * Mapper les données CSV vers notre structure
   */
  mapCSVData(csvRow) {
    const mappedData = {};
    
    Object.keys(this.headerMapping).forEach(standardHeader => {
      const index = this.headerMapping[standardHeader];
      const values = Object.values(csvRow);
      
      if (index !== undefined && index < values.length) {
        mappedData[standardHeader] = values[index] || '';
      } else {
        mappedData[standardHeader] = '';
      }
    });
    
    return mappedData;
  }

  // ==================== TRAITEMENT DES LOTS ====================

  /**
   * Traiter un batch CSV avec timeout
   */
  async processCSVBatchWithTimeout(batch, batchIndex, importBatchId, userId) {
    if (this.isCancelled || batch.length === 0) return;
    
    const batchStartTime = Date.now();
    this.lastBatchTime = batchStartTime;
    
    this.stats.batches++;
    
    this.emit('batchStart', {
      batchIndex,
      size: batch.length,
      startTime: new Date(),
      memoryBefore: this.getMemoryUsage()
    });
    
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`Timeout batch ${batchIndex} après ${this.options.timeoutPerBatch}ms`));
      }, this.options.timeoutPerBatch);
    });
    
    try {
      const batchResults = await Promise.race([
        this.processCSVBatch(batch, batchIndex, importBatchId, userId),
        timeoutPromise
      ]);
      
      const batchDuration = Date.now() - batchStartTime;
      const batchRowsPerSecond = batch.length > 0 ? Math.round(batch.length / (batchDuration / 1000)) : 0;
      
      this.emit('batchComplete', {
        batchIndex,
        results: batchResults,
        duration: batchDuration,
        memory: this.getMemoryUsage(),
        rowsPerSecond: batchRowsPerSecond
      });
      
      // Pause entre les lots
      if (this.options.pauseBetweenBatches > 0) {
        await this.sleep(this.options.pauseBetweenBatches);
      }
      
      return batchResults;
      
    } catch (error) {
      this.emit('batchError', {
        batchIndex,
        error: error.message,
        size: batch.length,
        duration: Date.now() - batchStartTime
      });
      
      if (this.options.enableBatchRollback) {
        console.warn(`⚠️ Rollback batch ${batchIndex} après erreur: ${error.message}`);
      }
      
      throw error;
    }
  }

  /**
   * Traitement optimisé d'un batch CSV
   */
  async processCSVBatch(batch, batchIndex, importBatchId, userId) {
    const client = await db.getClient();
    const batchResults = {
      imported: 0,
      updated: 0,
      duplicates: 0,
      errors: 0,
      skipped: 0
    };
    
    try {
      if (this.options.useTransactionPerBatch) {
        await client.query('BEGIN');
      }
      
      // Préparer les requêtes batch
      const insertValues = [];
      const insertParams = [];
      let paramIndex = 1;
      
      for (const item of batch) {
        try {
          const { rowNumber, data } = item;
          
          // Validation des champs requis
          if (!this.validateCSVRequiredFields(data)) {
            batchResults.errors++;
            this.stats.errors++;
            continue;
          }
          
          // Nettoyer et parser les données
          const cleanedData = this.cleanCSVRowData(data);
          
          // Vérification doublon
          if (this.options.skipDuplicates) {
            const isDuplicate = await this.checkCSVDuplicateOptimized(client, cleanedData);
            if (isDuplicate) {
              batchResults.duplicates++;
              this.stats.duplicates++;
              continue;
            }
          }
          
          // Préparer l'insertion
          insertValues.push(`(
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++},
            $${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++}
          )`);
          
          insertParams.push(
            cleanedData["LIEU D'ENROLEMENT"] || '',
            cleanedData["SITE DE RETRAIT"] || '',
            cleanedData["RANGEMENT"] || '',
            cleanedData["NOM"] || '',
            cleanedData["PRENOMS"] || '',
            this.parseCSVDateForDB(cleanedData["DATE DE NAISSANCE"]),
            cleanedData["LIEU NAISSANCE"] || '',
            this.formatPhoneNumber(cleanedData["CONTACT"] || ''),
            cleanedData["DELIVRANCE"] || '',
            this.formatPhoneNumber(cleanedData["CONTACT DE RETRAIT"] || ''),
            this.parseCSVDateForDB(cleanedData["DATE DE DELIVRANCE"]),
            new Date(),
            importBatchId
          );
          
          batchResults.imported++;
          this.stats.imported++;
          this.stats.processed++;
          
        } catch (error) {
          batchResults.errors++;
          this.stats.errors++;
          console.warn(`⚠️ Erreur ligne ${item.rowNumber}:`, error.message);
        }
      }
      
      // Insertion batch
      if (insertValues.length > 0) {
        const query = `
          INSERT INTO cartes (
            "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
            "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
            "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", dateimport, importbatchid
          ) VALUES ${insertValues.join(', ')}
          ON CONFLICT (nom, prenoms, "DATE DE NAISSANCE") 
          DO UPDATE SET 
            delivrance = EXCLUDED.delivrance,
            "CONTACT DE RETRAIT" = EXCLUDED."CONTACT DE RETRAIT",
            "DATE DE DELIVRANCE" = EXCLUDED."DATE DE DELIVRANCE",
            dateimport = NOW()
          RETURNING id
        `;
        
        const result = await client.query(query, insertParams);
        batchResults.updated = result.rowCount - insertValues.length;
        this.stats.updated += batchResults.updated;
      }
      
      // Journalisation
      await this.logCSVBatchOptimized(client, userId, importBatchId, batchIndex, batchResults);
      
      if (this.options.useTransactionPerBatch) {
        await client.query('COMMIT');
      }
      
      return batchResults;
      
    } catch (error) {
      if (this.options.useTransactionPerBatch) {
        await client.query('ROLLBACK');
      }
      throw error;
    } finally {
      client.release();
    }
  }

  // ==================== UTILITAIRES ====================

  /**
   * Validation des champs requis
   */
  validateCSVRequiredFields(data) {
    return data.NOM && data.NOM.trim() !== '' && 
           data.PRENOMS && data.PRENOMS.trim() !== '';
  }

  /**
   * Nettoyer les données d'une ligne
   */
  cleanCSVRowData(data) {
    const cleaned = {};
    
    for (const key of this.csvHeaders) {
      let value = data[key] || '';
      
      if (typeof value === 'string') {
        value = value.trim();
        
        if (key.includes('DATE')) {
          value = this.parseCSVDate(value);
        } else if (key.includes('CONTACT')) {
          value = this.formatPhoneNumber(value);
        }
      }
      
      cleaned[key] = value;
    }
    
    return cleaned;
  }

  /**
   * Parser de date CSV robuste
   */
  parseCSVDate(dateStr) {
    if (!dateStr || dateStr.trim() === '') return '';
    
    const str = dateStr.trim();
    
    // Format Excel (nombre)
    const num = parseFloat(str);
    if (!isNaN(num) && num > 1000) {
      const excelEpoch = new Date(1899, 11, 30);
      const date = new Date(excelEpoch.getTime() + (num - 1) * 86400000);
      if (!isNaN(date.getTime())) {
        return date.toISOString().split('T')[0];
      }
    }
    
    // Formats de date standards
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2})$/,          // YYYY-MM-DD
      /^(\d{2})\/(\d{2})\/(\d{4})$/,        // DD/MM/YYYY
      /^(\d{2})-(\d{2})-(\d{4})$/,          // DD-MM-YYYY
      /^(\d{4})\/(\d{2})\/(\d{2})$/         // YYYY/MM/DD
    ];
    
    for (const regex of formats) {
      const match = str.match(regex);
      if (match) {
        let year, month, day;
        
        if (regex.source.includes('^\\d{4}')) {
          year = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          day = parseInt(match[3], 10);
        } else {
          day = parseInt(match[1], 10);
          month = parseInt(match[2], 10) - 1;
          year = parseInt(match[3], 10);
          if (year < 100) year += 2000;
        }
        
        const date = new Date(year, month, day);
        if (!isNaN(date.getTime())) {
          return date.toISOString().split('T')[0];
        }
      }
    }
    
    // Dernier essai avec Date.parse
    const parsed = Date.parse(str);
    if (!isNaN(parsed)) {
      const date = new Date(parsed);
      return date.toISOString().split('T')[0];
    }
    
    return '';
  }

  /**
   * Formater une date pour la base de données
   */
  parseCSVDateForDB(dateStr) {
    const parsed = this.parseCSVDate(dateStr);
    return parsed || null;
  }

  /**
   * Vérification doublon optimisée
   */
  async checkCSVDuplicateOptimized(client, data) {
    try {
      const result = await client.query(
        `SELECT 1 FROM cartes 
         WHERE LOWER(TRIM(nom)) = LOWER(TRIM($1)) 
         AND LOWER(TRIM(prenoms)) = LOWER(TRIM($2))
         AND "DATE DE NAISSANCE" = $3
         LIMIT 1`,
        [
          data.NOM || '',
          data.PRENOMS || '',
          this.parseCSVDateForDB(data["DATE DE NAISSANCE"])
        ]
      );
      
      return result.rows.length > 0;
    } catch (error) {
      console.warn('⚠️ Erreur vérification doublon:', error.message);
      return false;
    }
  }

  /**
   * Formater un numéro de téléphone
   */
  formatPhoneNumber(phone) {
    if (!phone) return '';
    
    let cleaned = phone.toString().replace(/\D/g, '');
    
    if (cleaned.startsWith('225')) {
      cleaned = cleaned.substring(3);
    } else if (cleaned.startsWith('00225')) {
      cleaned = cleaned.substring(5);
    }
    
    if (cleaned.length > 0 && cleaned.length < 8) {
      cleaned = cleaned.padStart(8, '0');
    }
    
    return cleaned.substring(0, 8);
  }

  /**
   * Journalisation batch optimisée
   */
  async logCSVBatchOptimized(client, userId, importBatchId, batchIndex, results) {
    if (batchIndex % this.options.logBatchFrequency !== 0) {
      return;
    }
    
    try {
      await client.query(`
        INSERT INTO journalactivite (
          utilisateurid, nomutilisateur, dateaction, action, 
          actiontype, tablename, importbatchid, detailsaction
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        userId || null,
        userId ? 'import_csv' : 'system',
        new Date(),
        `Batch CSV ${batchIndex}`,
        'BULK_IMPORT_CSV_BATCH',
        'cartes',
        importBatchId,
        `Importés: ${results.imported}, Doublons: ${results.duplicates}`
      ]);
    } catch (error) {
      // Ignorer les erreurs de journalisation
    }
  }

  // ==================== PERFORMANCE ET MÉMOIRE ====================

  /**
   * Mettre à jour la progression
   */
  updateProgress(currentRow) {
    const now = Date.now();
    
    if (now - this.stats.lastProgressUpdate < 1000 && currentRow < this.stats.totalRows) {
      return;
    }
    
    const progress = Math.round((currentRow / this.stats.totalRows) * 100);
    const memory = this.getMemoryUsage();
    
    this.emit('progress', {
      processed: currentRow,
      total: this.stats.totalRows,
      percentage: progress,
      currentBatch: this.currentBatch,
      memory,
      rowsPerSecond: this.calculateCurrentSpeed(currentRow)
    });
    
    this.stats.lastProgressUpdate = now;
  }

  /**
   * Calculer la vitesse actuelle
   */
  calculateCurrentSpeed(currentRow) {
    const duration = Date.now() - this.stats.startTime.getTime();
    return duration > 0 ? Math.round(currentRow / (duration / 1000)) : 0;
  }

  /**
   * Calculer les performances
   */
  calculateCSVPerformance(duration) {
    const rowsPerSecond = this.stats.processed > 0 ? 
      Math.round(this.stats.processed / (duration / 1000)) : 0;
    
    const avgBatchTime = this.stats.batches > 0 ? 
      Math.round(duration / this.stats.batches) : 0;
    
    let efficiency = 'moyenne';
    if (rowsPerSecond > 800) efficiency = 'excellente';
    else if (rowsPerSecond > 500) efficiency = 'bonne';
    else if (rowsPerSecond > 200) efficiency = 'satisfaisante';
    
    return {
      rowsPerSecond,
      avgBatchTime,
      efficiency,
      memoryPeak: `${this.stats.memoryPeakMB}MB`
    };
  }

  /**
   * Estimer le temps total
   */
  estimateCSVTotalTime(totalRows) {
    const rowsPerSecond = 800; // Estimation VPS
    const seconds = Math.ceil(totalRows / rowsPerSecond);
    
    if (seconds < 60) return `${seconds} secondes`;
    if (seconds < 3600) return `${Math.ceil(seconds / 60)} minutes`;
    return `${Math.ceil(seconds / 3600)} heures`;
  }

  /**
   * Obtenir l'utilisation mémoire
   */
  getMemoryUsage() {
    const memory = process.memoryUsage();
    const usedMB = Math.round(memory.heapUsed / 1024 / 1024);
    
    if (usedMB > this.stats.memoryPeakMB) {
      this.stats.memoryPeakMB = usedMB;
    }
    
    return {
      usedMB,
      totalMB: Math.round(memory.heapTotal / 1024 / 1024),
      isCritical: usedMB > this.options.memoryLimitMB * 0.9
    };
  }

  /**
   * Nettoyage optimisé
   */
  async optimizedCleanup(filePath) {
    try {
      if (this.options.cleanupTempFiles && filePath) {
        await this.cleanupFile(filePath);
      }
      
      this.headers = null;
      this.headerMapping = null;
      this.currentBatch = 0;
      
      console.log('🧹 Nettoyage CSV terminé');
    } catch (error) {
      console.warn('⚠️ Erreur nettoyage:', error.message);
    }
  }

  /**
   * Nettoyer un fichier
   */
  async cleanupFile(filePath) {
    try {
      if (filePath && await fs.access(filePath).then(() => true).catch(() => false)) {
        await fs.unlink(filePath);
        console.log(`🗑️ Fichier supprimé: ${path.basename(filePath)}`);
      }
    } catch (error) {
      // Ignorer les erreurs
    }
  }

  /**
   * Pause
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Annuler l'import
   */
  cancel() {
    this.isCancelled = true;
    this.emit('cancelled', {
      stats: { ...this.stats },
      timestamp: new Date(),
      currentBatch: this.currentBatch,
      format: 'CSV'
    });
    
    console.log('🛑 Import CSV annulé');
  }

  /**
   * Obtenir le statut
   */
  getStatus() {
    const duration = this.stats.startTime ? Date.now() - this.stats.startTime.getTime() : 0;
    const memory = this.getMemoryUsage();
    
    return {
      isRunning: this.isRunning,
      isCancelled: this.isCancelled,
      stats: { ...this.stats },
      memory,
      progress: this.stats.totalRows > 0 ? 
        Math.round((this.stats.processed / this.stats.totalRows) * 100) : 0,
      currentBatch: this.currentBatch,
      environment: 'VPS',
      format: 'CSV',
      currentSpeed: duration > 0 ? Math.round(this.stats.processed / (duration / 1000)) : 0,
      estimatedRemaining: this.estimateRemainingTime()
    };
  }

  /**
   * Estimer le temps restant
   */
  estimateRemainingTime() {
    if (!this.stats.startTime || this.stats.processed === 0) return null;
    
    const elapsed = Date.now() - this.stats.startTime.getTime();
    const remainingRows = this.stats.totalRows - this.stats.processed;
    const rowsPerSecond = this.stats.processed / (elapsed / 1000);
    
    if (rowsPerSecond <= 0) return null;
    
    const secondsRemaining = Math.ceil(remainingRows / rowsPerSecond);
    
    if (secondsRemaining < 60) return `${secondsRemaining}s`;
    if (secondsRemaining < 3600) return `${Math.ceil(secondsRemaining / 60)}min`;
    return `${Math.ceil(secondsRemaining / 3600)}h`;
  }
}

module.exports = BulkImportServiceCSV;