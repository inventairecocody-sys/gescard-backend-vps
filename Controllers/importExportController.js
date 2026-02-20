const db = require('../db/db');
const ExcelJS = require('exceljs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const { Parser } = require('json2csv');
const journalController = require('./journalController');
const annulationService = require('../Services/annulationService');
const stream = require('stream');
const util = require('util');
const pipeline = util.promisify(stream.pipeline);

// ============================================
// CONFIGURATION GLOBALE OPTIMISÉE POUR LWS
// ============================================
const CONFIG = {
  // Formats supportés
  supportedFormats: ['.csv', '.xlsx', '.xls'],
  csvDelimiter: ';', // Point-virgule pour Excel français
  
  // Colonnes standard
  csvHeaders: [
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
    "DATE DE DELIVRANCE",
    "COORDINATION" // ✅ NOUVELLE COLONNE COORDINATION
  ],
  
  // Contrôles
  requiredHeaders: ['NOM', 'PRENOMS'],
  isLWS: true, // Indicateur pour LWS
  
  // ✅ CONFIGURATION EXPORT COMPLET POUR LWS
  maxExportRows: 1000000, // 1 million de lignes max
  maxExportRowsRecommended: 500000, // Recommandé pour performance
  exportTimeout: 600000, // 10 minutes pour les exports complets
  importTimeout: 300000, // 5 minutes pour l'import
  chunkSize: 10000, // Taille des chunks pour le streaming (augmenté pour LWS)
  memoryLimitMB: 512, // Limite mémoire LWS
  batchSize: 2000, // Taille des lots pour traitement DB
  maxConcurrent: 3, // Exports concurrents max
  compressionLevel: 6 // Niveau compression GZIP
};

// ============================================
// CONTROLEUR PRINCIPAL OPTIMISÉ POUR LWS
// ============================================
class OptimizedImportExportController {
  constructor() {
    this.activeExports = new Map();
    this.activeImports = new Map();
    this.exportQueue = [];
    this.processingQueue = false;
    
    console.log('🚀 Contrôleur Import/Export optimisé pour LWS');
    console.log(`📊 Configuration LWS:`);
    console.log(`   - Max lignes export: ${CONFIG.maxExportRows.toLocaleString()}`);
    console.log(`   - Taille chunk: ${CONFIG.chunkSize.toLocaleString()}`);
    console.log(`   - Timeout export: ${CONFIG.exportTimeout/1000}s`);
    console.log(`   - Mémoire max: ${CONFIG.memoryLimitMB}MB`);
  }
  
  // ============================================
  // GESTION DE LA FILE D'ATTENTE
  // ============================================
  
  async processExportQueue() {
    if (this.processingQueue) return;
    this.processingQueue = true;
    
    while (this.exportQueue.length > 0 && this.activeExports.size < CONFIG.maxConcurrent) {
      const nextExport = this.exportQueue.shift();
      try {
        await nextExport();
      } catch (error) {
        console.error('❌ Erreur dans la file d\'attente:', error);
      }
    }
    
    this.processingQueue = false;
  }
  
  queueExport(exportFn) {
    return new Promise((resolve, reject) => {
      this.exportQueue.push(async () => {
        try {
          const result = await exportFn();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
      
      this.processExportQueue();
    });
  }
  
  // ============================================
  // FONCTIONS DE VÉRIFICATION DES DROITS
  // ============================================
  
  /**
   * Vérifie si l'utilisateur peut importer/exporter
   */
  verifierDroitsImportExport(req) {
    const role = req.user?.role;
    
    // Admin et Gestionnaire peuvent importer/exporter
    if (role === 'Administrateur' || role === 'Gestionnaire') {
      return { autorise: true };
    }
    
    return { 
      autorise: false, 
      message: "Seuls les administrateurs et gestionnaires peuvent importer/exporter" 
    };
  }
  
  /**
   * Ajoute le filtre de coordination à une requête SQL
   */
  ajouterFiltreCoordination(req, query, params, colonne = 'coordination') {
    const role = req.user?.role;
    const coordination = req.user?.coordination;
    
    if (role === 'Gestionnaire' && coordination) {
      // Gestionnaire: ne voit que sa coordination
      return {
        query: query + ` AND ${colonne} = $${params.length + 1}`,
        params: [...params, coordination]
      };
    }
    
    if (role === "Chef d'équipe" && coordination) {
      // Chef d'équipe: ne voit que sa coordination
      return {
        query: query + ` AND ${colonne} = $${params.length + 1}`,
        params: [...params, coordination]
      };
    }
    
    // Admin: voit tout
    return { query, params };
  }
  
  // ============================================
  // EXPORT EXCEL OPTIMISÉ (EXPORT LIMITÉ)
  // ============================================
  async exportExcel(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    const exportId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    console.log(`📤 Export Excel limité demandé (ID: ${exportId}) par ${req.user.nomUtilisateur} (${req.user.role})`);
    
    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;
    
    let client;
    
    try {
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_EXPORT_EXCEL_LIMITE',
        tableName: 'Cartes',
        details: `Export Excel limité (max ${limit}) démarré`
      });
      
      client = await db.getClient();
      
      // Compter avec filtre de coordination
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];
      
      // Appliquer filtre de coordination
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      
      console.log(`📊 ${totalRows} cartes accessibles, export limité à ${limit}`);
      
      // Récupérer les données avec filtre
      let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
      let dataParams = [];
      
      // Appliquer filtre de coordination
      const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);
      
      // Ajouter limit et order
      const finalQuery = filtreData.query + ' ORDER BY id LIMIT $' + (filtreData.params.length + 1);
      const finalParams = [...filtreData.params, limit];
      
      const result = await client.query(finalQuery, finalParams);
      
      const rows = result.rows;
      
      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter'
        });
      }
      
      // Créer le workbook avec options optimisées
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GESCARD Cocody';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.lastPrinted = new Date();
      
      // Utiliser le style optimisé
      workbook.views = [
        {
          x: 0, y: 0,
          width: 10000,
          height: 20000,
          firstSheet: 0,
          activeTab: 0,
          visibility: 'visible'
        }
      ];
      
      const worksheet = workbook.addWorksheet('Cartes', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
        pageSetup: { paperSize: 9, orientation: 'landscape' },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
      });
      
      // Ajouter les en-têtes avec style optimisé
      worksheet.columns = CONFIG.csvHeaders.map(header => ({
        header,
        key: header.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, ''),
        width: 25,
        style: { 
          font: { bold: true, size: 12 },
          alignment: { vertical: 'middle', horizontal: 'center' }
        }
      }));
      
      // Style de la ligne d'en-tête
      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = { 
          bold: true, 
          color: { argb: 'FFFFFFFF' },
          size: 12,
          name: 'Calibri'
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' }
        };
        cell.alignment = { 
          vertical: 'middle', 
          horizontal: 'center',
          wrapText: true
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      // Ajouter les données avec formatage conditionnel
      rows.forEach((row, index) => {
        const excelRow = worksheet.addRow(row);
        
        // Alterner les couleurs de lignes
        if (index % 2 === 0) {
          excelRow.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' }
            };
          });
        }
        
        // Formatage spécial pour DELIVRANCE = "OUI"
        if (row.delivrance && row.delivrance.toUpperCase() === 'OUI') {
          const delivranceCell = excelRow.getCell('delivrance');
          delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
        }
      });
      
      // Ajouter auto-filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: CONFIG.csvHeaders.length }
      };
      
      // Configurer la réponse
      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.xlsx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Total-Rows', rows.length);
      res.setHeader('X-Export-Type', 'limited');
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }
      
      // Écrire le fichier avec compression
      await workbook.xlsx.write(res);
      
      const duration = Date.now() - startTime;
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'FIN_EXPORT_EXCEL_LIMITE',
        tableName: 'Cartes',
        details: `Export Excel limité terminé: ${rows.length} lignes en ${duration}ms`
      });
      
      console.log(`✅ Export Excel limité réussi: ${rows.length} lignes en ${duration}ms`);
      
    } catch (error) {
      console.error(`❌ Erreur export Excel:`, error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur lors de l\'export Excel',
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId
        });
      }
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'ERREUR_EXPORT_EXCEL',
        tableName: 'Cartes',
        details: `Erreur export Excel: ${error.message}`
      });
      
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }
  
  // ============================================
  // EXPORT CSV OPTIMISÉ (EXPORT LIMITÉ)
  // ============================================
  async exportCSV(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    const exportId = `csv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    console.log(`📤 Export CSV limité demandé (ID: ${exportId}) par ${req.user.nomUtilisateur} (${req.user.role})`);
    
    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;
    
    let client;
    
    try {
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_EXPORT_CSV_LIMITE',
        tableName: 'Cartes',
        details: `Export CSV limité (max ${limit}) démarré`
      });
      
      client = await db.getClient();
      
      // Compter avec filtre de coordination
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];
      
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      
      console.log(`📊 ${totalRows} cartes accessibles, export CSV limité à ${limit}`);
      
      // Configurer la réponse avec BOM pour UTF-8
      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.csv`;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Export-Type', 'limited');
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }
      
      // Écrire BOM pour UTF-8
      res.write('\uFEFF');
      
      // Écrire les en-têtes avec guillemets
      const headers = CONFIG.csvHeaders.map(h => `"${h}"`).join(CONFIG.csvDelimiter) + '\n';
      res.write(headers);
      
      // Utiliser un curseur pour le streaming optimisé avec filtre
      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      let batchCount = 0;
      
      while (offset < limit) {
        batchCount++;
        const currentLimit = Math.min(chunkSize, limit - offset);
        
        // Construire la requête avec filtre
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];
        
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);
        
        const finalQuery = filtreData.query + 
          ' ORDER BY id LIMIT $' + (filtreData.params.length + 1) + 
          ' OFFSET $' + (filtreData.params.length + 2);
        
        const finalParams = [...filtreData.params, currentLimit, offset];
        
        const result = await client.query(finalQuery, finalParams);
        
        const rows = result.rows;
        if (rows.length === 0) break;
        
        // Préparer le lot CSV en mémoire
        let batchCSV = '';
        for (const row of rows) {
          const csvRow = CONFIG.csvHeaders.map(header => {
            let value = row[header] || '';
            
            // Échapper les caractères spéciaux CSV
            if (typeof value === 'string') {
              // Remplacer les guillemets par des guillemets doubles
              value = value.replace(/"/g, '""');
              
              // Mettre entre guillemets si nécessaire
              if (value.includes(CONFIG.csvDelimiter) || value.includes('"') || value.includes('\n') || value.includes('\r')) {
                value = `"${value}"`;
              }
            } else if (value instanceof Date) {
              value = value.toISOString().split('T')[0];
            }
            
            return value;
          }).join(CONFIG.csvDelimiter);
          
          batchCSV += csvRow + '\n';
          totalWritten++;
        }
        
        // Écrire le lot
        res.write(batchCSV);
        offset += rows.length;
        
        // Log de progression
        if (batchCount % 5 === 0) {
          console.log(`📝 CSV limité: ${totalWritten}/${limit} lignes écrites`);
        }
      }
      
      res.end();
      
      const duration = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (duration / 1000)) : 0;
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'FIN_EXPORT_CSV_LIMITE',
        tableName: 'Cartes',
        details: `Export CSV limité terminé: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`
      });
      
      console.log(`✅ Export CSV limité réussi: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`);
      
    } catch (error) {
      console.error(`❌ Erreur export CSV:`, error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur lors de l\'export CSV',
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId
        });
      } else {
        try { res.end(); } catch (e) {}
      }
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'ERREUR_EXPORT_CSV',
        tableName: 'Cartes',
        details: `Erreur export CSV: ${error.message}`
      });
      
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }
  
  // ============================================
  // EXPORT EXCEL COMPLET (TOUTES LES DONNÉES)
  // ============================================
  async exportCompleteExcel(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    const exportId = `excel_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    console.log(`🚀 EXPORT EXCEL COMPLET demandé par ${req.user.nomUtilisateur} (${req.user.role}) (ID: ${exportId})`);
    
    // Vérifier les exports concurrents
    if (this.activeExports.size >= CONFIG.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: 'Trop d\'exports en cours',
        message: `Maximum ${CONFIG.maxConcurrent} exports simultanés`,
        queueLength: this.exportQueue.length
      });
    }
    
    this.activeExports.set(exportId, { startTime, type: 'excel_complete' });
    
    let client;
    
    try {
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_EXPORT_EXCEL_COMPLET',
        tableName: 'Cartes',
        details: `Export Excel COMPLET démarré`
      });
      
      client = await db.getClient();
      
      // Compter toutes les données accessibles
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];
      
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      
      console.log(`📊 TOTAL DES DONNÉES ACCESSIBLES: ${totalRows} cartes`);
      
      if (totalRows === 0) {
        this.activeExports.delete(exportId);
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter'
        });
      }
      
      // Vérifier les limites
      if (totalRows > CONFIG.maxExportRows) {
        console.warn(`⚠️ Export très volumineux: ${totalRows} lignes (max: ${CONFIG.maxExportRows})`);
        
        await journalController.logAction({
          utilisateurId: req.user.id,
          actionType: 'AVERTISSEMENT_EXPORT',
          tableName: 'Cartes',
          details: `Export très volumineux: ${totalRows} lignes, peut être lent`
        });
      }
      
      // Récupérer les colonnes dynamiquement
      const sampleResult = await client.query('SELECT * FROM cartes LIMIT 1');
      const firstRow = sampleResult.rows[0] || {};
      
      // Exclure les colonnes techniques
      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at', 'id'];
      const headers = Object.keys(firstRow).filter(key => 
        !excludedColumns.includes(key.toLowerCase())
      );
      
      console.log(`📋 ${headers.length} colonnes détectées`);
      
      // Configurer la réponse
      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.xlsx`;
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }
      
      // Créer le workbook avec options optimisées pour gros fichiers
      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GESCARD Cocody';
      workbook.created = new Date();
      workbook.modified = new Date();
      
      // Optimisation mémoire pour Excel
      workbook.calcProperties.fullCalcOnLoad = false;
      
      const worksheet = workbook.addWorksheet('Cartes', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
        pageSetup: { paperSize: 9, orientation: 'landscape' },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }]
      });
      
      // Ajouter les en-têtes avec style optimisé
      worksheet.columns = headers.map(header => ({
        header: header.replace(/_/g, ' ').toUpperCase(),
        key: header,
        width: 25
      }));
      
      // Style de la ligne d'en-tête
      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = { 
          bold: true, 
          color: { argb: 'FFFFFFFF' },
          size: 12,
          name: 'Calibri'
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' }
        };
        cell.alignment = { 
          vertical: 'middle', 
          horizontal: 'center',
          wrapText: true
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' }
        };
      });
      
      // Récupérer et écrire les données par lots optimisés avec filtre
      console.log(`⏳ Récupération et écriture des données...`);
      
      let offset = 0;
      const chunkSize = 2000; // Plus petit pour Excel (mémoire)
      let totalWritten = 0;
      let batchCount = 0;
      let lastProgressLog = Date.now();
      
      while (true) {
        batchCount++;
        
        // Construire la requête avec filtre
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];
        
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);
        
        const finalQuery = filtreData.query + 
          ' ORDER BY id LIMIT $' + (filtreData.params.length + 1) + 
          ' OFFSET $' + (filtreData.params.length + 2);
        
        const finalParams = [...filtreData.params, chunkSize, offset];
        
        const result = await client.query(finalQuery, finalParams);
        
        const rows = result.rows;
        if (rows.length === 0) break;
        
        // Ajouter chaque ligne au Excel avec formatage conditionnel
        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowData = {};
          
          headers.forEach(header => {
            let value = row[header];
            
            // Formater les dates
            if (value instanceof Date) {
              value = value.toLocaleDateString('fr-FR');
            }
            
            rowData[header] = value || '';
          });
          
          const excelRow = worksheet.addRow(rowData);
          
          // Alterner les couleurs de lignes
          if ((totalWritten + i) % 2 === 0) {
            excelRow.eachCell((cell) => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF2F2F2' }
              };
            });
          }
          
          // Formatage spécial pour DELIVRANCE
          if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
            const delivranceCell = excelRow.getCell('delivrance');
            delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
          }
        }
        
        totalWritten += rows.length;
        offset += rows.length;
        
        // Log de progression (max toutes les 5 secondes)
        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const progress = Math.round((totalWritten / totalRows) * 100);
          const elapsed = (now - startTime) / 1000;
          const speed = Math.round(totalWritten / elapsed);
          
          console.log(`📊 Progression Excel: ${totalWritten}/${totalRows} lignes (${progress}%) - ${speed} lignes/sec`);
          lastProgressLog = now;
        }
        
        // Petite pause pour éviter le blocage
        if (batchCount % 10 === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        
        if (rows.length < chunkSize) break;
      }
      
      // Ajouter auto-filter
      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length }
      };
      
      // Ajuster automatiquement la largeur des colonnes
      worksheet.columns.forEach(column => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 0;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(50, maxLength + 2);
      });
      
      // Écrire le fichier Excel
      console.log(`⏳ Génération finale du fichier Excel...`);
      const writeStartTime = Date.now();
      
      await workbook.xlsx.write(res);
      
      const writeTime = Date.now() - writeStartTime;
      const totalTime = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (totalTime / 1000)) : 0;
      const memoryUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'FIN_EXPORT_EXCEL_COMPLET',
        tableName: 'Cartes',
        details: `Export Excel COMPLET terminé: ${totalWritten} lignes en ${totalTime}ms (${speed} lignes/sec)`
      });
      
      console.log(`🎉 Export Excel COMPLET réussi !`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Lignes exportées: ${totalWritten.toLocaleString()}`);
      console.log(`   - Colonnes: ${headers.length}`);
      console.log(`   - Temps total: ${(totalTime/1000).toFixed(1)}s`);
      console.log(`   - Vitesse: ${speed} lignes/sec`);
      console.log(`   - Mémoire max: ${memoryUsed}MB`);
      
    } catch (error) {
      console.error(`❌ ERREUR export Excel complet (ID: ${exportId}):`, error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur lors de l\'export Excel complet',
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
          advice: [
            'Le fichier peut être trop volumineux pour Excel',
            'Essayez d\'exporter en CSV pour les très gros fichiers',
            'Divisez vos données en plusieurs exports si nécessaire'
          ]
        });
      }
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'ERREUR_EXPORT_EXCEL_COMPLET',
        tableName: 'Cartes',
        details: `Erreur export Excel complet: ${error.message}`
      });
      
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }
  
  // ============================================
  // EXPORT CSV COMPLET (TOUTES LES DONNÉES)
  // ============================================
  async exportCompleteCSV(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    const exportId = `csv_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    
    console.log(`🚀 EXPORT CSV COMPLET demandé par ${req.user.nomUtilisateur} (${req.user.role}) (ID: ${exportId})`);
    
    // Vérifier les exports concurrents
    if (this.activeExports.size >= CONFIG.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: 'Trop d\'exports en cours',
        message: `Maximum ${CONFIG.maxConcurrent} exports simultanés`
      });
    }
    
    this.activeExports.set(exportId, { startTime, type: 'csv_complete' });
    
    let client;
    
    try {
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_EXPORT_CSV_COMPLET',
        tableName: 'Cartes',
        details: `Export CSV COMPLET démarré`
      });
      
      client = await db.getClient();
      
      // Compter toutes les données accessibles
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];
      
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      
      console.log(`📊 TOTAL DES DONNÉES ACCESSIBLES: ${totalRows} cartes`);
      
      if (totalRows === 0) {
        this.activeExports.delete(exportId);
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter'
        });
      }
      
      // Configurer la réponse avec BOM UTF-8
      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.csv`;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }
      
      // Écrire BOM pour UTF-8
      res.write('\uFEFF');
      
      // Récupérer les colonnes dynamiquement
      const sampleResult = await client.query('SELECT * FROM cartes LIMIT 1');
      const firstRow = sampleResult.rows[0] || {};
      
      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at'];
      const headers = Object.keys(firstRow).filter(key => 
        !excludedColumns.includes(key.toLowerCase())
      );
      
      // Écrire les en-têtes CSV
      const csvHeaders = headers.map(header => 
        `"${header.replace(/"/g, '""').replace(/_/g, ' ').toUpperCase()}"`
      ).join(CONFIG.csvDelimiter);
      
      res.write(csvHeaders + '\n');
      
      // Export par lots avec streaming optimisé et filtre
      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      let batchCount = 0;
      let lastProgressLog = Date.now();
      
      console.log(`⏳ Début de l'export streaming CSV...`);
      
      while (true) {
        batchCount++;
        
        // Construire la requête avec filtre
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];
        
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);
        
        const finalQuery = filtreData.query + 
          ' ORDER BY id LIMIT $' + (filtreData.params.length + 1) + 
          ' OFFSET $' + (filtreData.params.length + 2);
        
        const finalParams = [...filtreData.params, chunkSize, offset];
        
        const result = await client.query(finalQuery, finalParams);
        
        const rows = result.rows;
        if (rows.length === 0) break;
        
        // Préparer le lot CSV
        let batchCSV = '';
        for (const row of rows) {
          const csvRow = headers.map(header => {
            let value = row[header];
            
            // Gérer les valeurs null/undefined
            if (value === null || value === undefined) {
              return '';
            }
            
            // Convertir en string avec formatage
            let stringValue;
            if (value instanceof Date) {
              stringValue = value.toLocaleDateString('fr-FR');
            } else {
              stringValue = String(value);
            }
            
            // Échapper les caractères spéciaux CSV
            if (stringValue.includes(CONFIG.csvDelimiter) || 
                stringValue.includes('"') || 
                stringValue.includes('\n') || 
                stringValue.includes('\r')) {
              stringValue = `"${stringValue.replace(/"/g, '""')}"`;
            }
            
            return stringValue;
          }).join(CONFIG.csvDelimiter);
          
          batchCSV += csvRow + '\n';
          totalWritten++;
        }
        
        // Écrire le lot
        res.write(batchCSV);
        offset += rows.length;
        
        // Log de progression
        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const progress = Math.round((totalWritten / totalRows) * 100);
          const elapsed = (now - startTime) / 1000;
          const speed = Math.round(totalWritten / elapsed);
          
          console.log(`📊 Progression CSV: ${totalWritten}/${totalRows} lignes (${progress}%) - ${speed} lignes/sec`);
          lastProgressLog = now;
          
          // Flush si possible
          if (res.flush) res.flush();
        }
        
        // Vérifier la mémoire
        const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memUsage > CONFIG.memoryLimitMB * 0.8) {
          console.warn(`⚠️ Mémoire élevée: ${Math.round(memUsage)}MB, pause de 100ms`);
          await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        if (rows.length < chunkSize) break;
      }
      
      res.end();
      
      const duration = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (duration / 1000)) : 0;
      const memoryUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'FIN_EXPORT_CSV_COMPLET',
        tableName: 'Cartes',
        details: `Export CSV COMPLET terminé: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`
      });
      
      console.log(`🎉 Export CSV COMPLET réussi !`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Lignes exportées: ${totalWritten.toLocaleString()}`);
      console.log(`   - Colonnes: ${headers.length}`);
      console.log(`   - Temps total: ${(duration/1000).toFixed(1)}s`);
      console.log(`   - Vitesse: ${speed} lignes/sec`);
      console.log(`   - Mémoire max: ${memoryUsed}MB`);
      
    } catch (error) {
      console.error(`❌ ERREUR export CSV complet (ID: ${exportId}):`, error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur lors de l\'export CSV complet',
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId
        });
      } else {
        try { res.end(); } catch (e) {}
      }
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'ERREUR_EXPORT_CSV_COMPLET',
        tableName: 'Cartes',
        details: `Erreur export CSV complet: ${error.message}`
      });
      
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }
  
  // ============================================
  // EXPORT TOUT EN UN CLIC (CHOIX AUTOMATIQUE)
  // ============================================
  async exportAllData(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    const exportId = `all_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    console.log(`🚀 Export "TOUT EN UN" demandé par ${req.user.nomUtilisateur} (${req.user.role}) (ID: ${exportId})`);
    
    let client;
    
    try {
      client = await db.getClient();
      
      // Compter toutes les données accessibles
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];
      
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      
      console.log(`📊 TOTAL ACCESSIBLE: ${totalRows} cartes`);
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_EXPORT_TOUT_EN_UN',
        tableName: 'Cartes',
        details: `Export "TOUT EN UN" démarré: ${totalRows} cartes`
      });
      
      // ✅ CHOIX INTELLIGENT DU FORMAT POUR LWS
      let chosenFormat;
      let reason;
      
      if (totalRows > CONFIG.maxExportRowsRecommended) {
        // Très gros fichier = CSV
        chosenFormat = 'csv';
        reason = `${totalRows.toLocaleString()} lignes > ${CONFIG.maxExportRowsRecommended.toLocaleString()} = CSV recommandé`;
      } else {
        // Fichier moyen = Excel
        chosenFormat = 'excel';
        reason = `${totalRows.toLocaleString()} lignes < ${CONFIG.maxExportRowsRecommended.toLocaleString()} = Excel (format standard)`;
      }
      
      console.log(`🤔 Format choisi: ${chosenFormat.toUpperCase()} - ${reason}`);
      
      // Rediriger vers la méthode appropriée avec le même exportId
      req.exportId = exportId;
      
      if (chosenFormat === 'excel') {
        await this.exportCompleteExcel(req, res);
      } else {
        await this.exportCompleteCSV(req, res);
      }
      
    } catch (error) {
      console.error('❌ Erreur export tout en un:', error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur lors du choix de la méthode d\'export',
          message: error.message,
          advice: [
            'Essayez d\'utiliser directement /export/complete pour Excel',
            'Ou /export/complete/csv pour CSV',
            'Vérifiez que la base de données est accessible'
          ]
        });
      }
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'ERREUR_EXPORT_TOUT_EN_UN',
        tableName: 'Cartes',
        details: `Erreur export tout en un: ${error.message}`
      });
      
    } finally {
      if (client?.release) client.release();
    }
  }
  
  // ============================================
  // EXPORT CSV PAR SITE (OPTIMISÉ)
  // ============================================
  async exportCSVBySite(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    const { siteRetrait } = req.query;
    
    if (!siteRetrait) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre siteRetrait requis'
      });
    }
    
    const decodedSite = decodeURIComponent(siteRetrait)
      .replace(/\+/g, ' ')
      .trim();
    
    console.log(`📤 Export CSV pour site: ${decodedSite} par ${req.user.nomUtilisateur} (${req.user.role})`);
    
    let client;
    
    try {
      client = await db.getClient();
      
      // Vérifier existence et compter avec filtre de coordination
      let countQuery = 'SELECT COUNT(*) as count FROM cartes WHERE "SITE DE RETRAIT" = $1';
      let countParams = [decodedSite];
      
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams, 'coordination');
      
      const siteCheck = await client.query(filtreCount.query, filtreCount.params);
      const count = parseInt(siteCheck.rows[0].count);
      
      if (count === 0) {
        return res.status(404).json({
          success: false,
          error: `Aucune donnée pour le site: ${decodedSite}`
        });
      }
      
      // Configurer réponse
      const safeSiteName = decodedSite.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `export-${safeSiteName}-${timestamp}.csv`;
      
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Site', decodedSite);
      res.setHeader('X-Total-Rows', count);
      res.setHeader('X-User-Role', req.user.role);
      if (req.user.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }
      
      // BOM UTF-8
      res.write('\uFEFF');
      
      // Écrire les en-têtes
      const headers = CONFIG.csvHeaders.map(h => `"${h}"`).join(CONFIG.csvDelimiter) + '\n';
      res.write(headers);
      
      // Streaming par lots avec filtre
      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      
      while (true) {
        let dataQuery = 'SELECT * FROM cartes WHERE "SITE DE RETRAIT" = $1';
        let dataParams = [decodedSite];
        
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams, 'coordination');
        
        const finalQuery = filtreData.query + 
          ' ORDER BY id LIMIT $' + (filtreData.params.length + 1) + 
          ' OFFSET $' + (filtreData.params.length + 2);
        
        const finalParams = [...filtreData.params, chunkSize, offset];
        
        const result = await client.query(finalQuery, finalParams);
        
        const rows = result.rows;
        if (rows.length === 0) break;
        
        // Préparer le lot CSV
        let batchCSV = '';
        for (const row of rows) {
          const csvRow = CONFIG.csvHeaders.map(header => {
            let value = row[header] || '';
            
            if (typeof value === 'string') {
              value = value.replace(/"/g, '""');
              if (value.includes(CONFIG.csvDelimiter) || value.includes('"') || value.includes('\n')) {
                value = `"${value}"`;
              }
            } else if (value instanceof Date) {
              value = value.toLocaleDateString('fr-FR');
            }
            
            return value;
          }).join(CONFIG.csvDelimiter);
          
          batchCSV += csvRow + '\n';
          totalWritten++;
        }
        
        res.write(batchCSV);
        offset += rows.length;
        
        console.log(`📝 Site ${decodedSite}: ${totalWritten}/${count} lignes`);
      }
      
      res.end();
      
      console.log(`✅ Export CSV site terminé: ${decodedSite} - ${totalWritten} lignes`);
      
    } catch (error) {
      console.error('❌ Erreur export CSV site:', error);
      
      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: 'Erreur export CSV site: ' + error.message
        });
      }
    } finally {
      if (client?.release) client.release();
    }
  }
  
  // ============================================
  // IMPORT CSV OPTIMISÉ
  // ============================================
  async importCSV(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      // Nettoyer le fichier si uploadé
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier uploadé'
      });
    }
    
    const importId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();
    
    console.log(`📥 Import CSV: ${req.file.originalname} (ID: ${importId}) par ${req.user.nomUtilisateur} (${req.user.role})`);
    
    // Vérifier les imports concurrents
    if (this.activeImports.size >= 2) {
      fs.unlinkSync(req.file.path);
      return res.status(429).json({
        success: false,
        error: 'Trop d\'imports en cours',
        message: 'Maximum 2 imports simultanés'
      });
    }
    
    this.activeImports.set(importId, { startTime, file: req.file.originalname });
    
    const client = await db.getClient();
    
    try {
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_IMPORT_CSV',
        tableName: 'Cartes',
        importBatchID: importBatchId,
        details: `Import CSV: ${req.file.originalname}`
      });
      
      await client.query('BEGIN');
      
      // Vérifier la taille du fichier
      const stats = fs.statSync(req.file.path);
      const fileSizeMB = stats.size / (1024 * 1024);
      
      if (fileSizeMB > 100) {
        throw new Error(`Fichier trop volumineux: ${Math.round(fileSizeMB)}MB (max 100MB)`);
      }
      
      console.log(`📊 Taille fichier: ${Math.round(fileSizeMB)}MB`);
      
      // Parser CSV avec gestion des erreurs
      const csvData = await this.parseCSVStream(req.file.path);
      
      console.log(`📋 ${csvData.length} lignes à traiter`);
      
      if (csvData.length === 0) {
        throw new Error('Le fichier CSV est vide');
      }
      
      // Vérifier les en-têtes
      const firstRow = csvData[0];
      const missingHeaders = CONFIG.requiredHeaders.filter(h => 
        !Object.keys(firstRow).some(key => key.toUpperCase() === h)
      );
      
      if (missingHeaders.length > 0) {
        throw new Error(`En-têtes requis manquants: ${missingHeaders.join(', ')}`);
      }
      
      // Traiter par lots optimisés
      const batchSize = CONFIG.batchSize;
      let imported = 0;
      let updated = 0;
      let errors = 0;
      const errorDetails = [];
      let processedRows = 0;
      
      for (let i = 0; i < csvData.length; i += batchSize) {
        const batch = csvData.slice(i, i + batchSize);
        const batchResult = await this.processCSVBatchOptimized(
          client, 
          batch, 
          i + 1, 
          importBatchId,
          req.user.id,
          req.user.role,
          req.user.coordination
        );
        
        imported += batchResult.imported;
        updated += batchResult.updated;
        errors += batchResult.errors;
        processedRows += batch.length;
        
        // Log de progression
        const progress = Math.round((processedRows / csvData.length) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(processedRows / elapsed);
        
        console.log(`📈 Progression: ${progress}% (${processedRows}/${csvData.length}) - ${speed} lignes/sec`);
        
        if (batchResult.errors > 0) {
          errorDetails.push(...batchResult.errorDetails.slice(0, 5));
        }
        
        // Petite pause pour éviter la surcharge
        if (i % (batchSize * 5) === 0) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      
      await client.query('COMMIT');
      
      const duration = Date.now() - startTime;
      const speed = csvData.length > 0 ? Math.round(csvData.length / (duration / 1000)) : 0;
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'FIN_IMPORT_CSV',
        tableName: 'Cartes',
        importBatchID: importBatchId,
        details: `Import CSV terminé: ${imported} importées, ${updated} mises à jour, ${errors} erreurs en ${duration}ms`
      });
      
      console.log(`✅ Import CSV terminé en ${duration}ms (${speed} lignes/sec)`);
      console.log(`📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${errors} erreurs`);
      
      res.json({
        success: true,
        message: 'Import CSV terminé',
        stats: {
          totalRows: csvData.length,
          imported,
          updated,
          errors,
          importBatchID: importBatchId
        },
        performance: {
          duration_ms: duration,
          lines_per_second: speed,
          file_size_mb: Math.round(fileSizeMB * 10) / 10
        },
        errors: errorDetails.slice(0, 10)
      });
      
    } catch (error) {
      console.error('❌ Erreur import CSV:', error);
      
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.warn('⚠️ Erreur rollback:', rollbackError.message);
      }
      
      res.status(500).json({
        success: false,
        error: 'Erreur import CSV',
        message: error.message,
        importId
      });
      
    } finally {
      // Nettoyer le fichier temporaire
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.warn('⚠️ Impossible supprimer fichier:', e.message);
        }
      }
      
      if (client?.release) client.release();
      this.activeImports.delete(importId);
    }
  }
  
  // ============================================
  // IMPORT SMART SYNC (FUSION INTELLIGENTE)
  // ============================================
  async importSmartSync(req, res) {
    // ✅ VÉRIFICATION DES DROITS
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      // Nettoyer le fichier si uploadé
      if (req.file?.path) {
        try { fs.unlinkSync(req.file.path); } catch (e) {}
      }
      return res.status(403).json({
        success: false,
        error: droits.message
      });
    }
    
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier uploadé'
      });
    }
    
    const importId = `smart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();
    
    console.log(`🧠 Import Smart Sync: ${req.file.originalname} (ID: ${importId}) par ${req.user.nomUtilisateur} (${req.user.role})`);
    
    const client = await db.getClient();
    
    try {
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'DEBUT_IMPORT_SMART',
        tableName: 'Cartes',
        importBatchID: importBatchId,
        details: `Import Smart Sync: ${req.file.originalname}`
      });
      
      await client.query('BEGIN');
      
      // Parser CSV
      const csvData = await this.parseCSVStream(req.file.path);
      
      console.log(`📋 ${csvData.length} lignes à traiter avec fusion intelligente`);
      
      // Traiter avec fusion intelligente
      let imported = 0;
      let updated = 0;
      let duplicates = 0;
      let errors = 0;
      const errorDetails = [];
      
      for (let i = 0; i < csvData.length; i++) {
        try {
          const item = csvData[i];
          
          // Ajouter la coordination par défaut si non présente et si utilisateur a une coordination
          if (!item.COORDINATION && req.user.coordination && req.user.role === 'Gestionnaire') {
            item.COORDINATION = req.user.coordination;
          }
          
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Ligne ${i+2}: NOM et PRENOMS obligatoires`);
            continue;
          }
          
          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item["SITE DE RETRAIT"]?.toString().trim() || '';
          
          // Vérifier si la carte existe
          const existingCarte = await client.query(
            `SELECT * FROM cartes WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
            [nom, prenoms, siteRetrait]
          );
          
          if (existingCarte.rows.length > 0) {
            // Mise à jour intelligente
            const carteExistante = existingCarte.rows[0];
            const updated_ = await this.smartUpdateCarte(client, carteExistante, item);
            
            if (updated_) {
              updated++;
              
              // 📝 ENREGISTRER DANS LE JOURNAL POUR LA MISE À JOUR
              await annulationService.enregistrerAction(
                req.user.id,
                req.user.nomUtilisateur,
                req.user.nomComplet || req.user.nomUtilisateur,
                req.user.role,
                req.user.agence || '',
                `Mise à jour via import smart sync (batch ${importBatchId})`,
                'UPDATE',
                'cartes',
                carteExistante.id,
                carteExistante,
                item,
                req.ip,
                importBatchId,
                carteExistante.coordination || req.user.coordination
              );
            } else {
              duplicates++;
            }
          } else {
            // Nouvelle insertion
            const newId = await this.smartInsertCarte(client, item, importBatchId, req.user.id, req.user.coordination);
            imported++;
            
            // 📝 ENREGISTRER DANS LE JOURNAL POUR L'INSERTION
            await annulationService.enregistrerAction(
              req.user.id,
              req.user.nomUtilisateur,
              req.user.nomComplet || req.user.nomUtilisateur,
              req.user.role,
              req.user.agence || '',
              `Insertion via import smart sync (batch ${importBatchId})`,
              'INSERT',
              'cartes',
              newId,
              null,
              item,
              req.ip,
              importBatchId,
              item.COORDINATION || req.user.coordination
            );
          }
          
        } catch (error) {
          errors++;
          errorDetails.push(`Ligne ${i+2}: ${error.message}`);
        }
        
        // Log de progression
        if ((i + 1) % 1000 === 0) {
          const progress = Math.round(((i + 1) / csvData.length) * 100);
          console.log(`📊 Progression smart: ${progress}% (${i+1}/${csvData.length})`);
        }
      }
      
      await client.query('COMMIT');
      
      const duration = Date.now() - startTime;
      
      await journalController.logAction({
        utilisateurId: req.user.id,
        actionType: 'FIN_IMPORT_SMART',
        tableName: 'Cartes',
        importBatchID: importBatchId,
        details: `Import Smart Sync terminé: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`
      });
      
      console.log(`✅ Import Smart Sync terminé en ${duration}ms`);
      console.log(`📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`);
      
      res.json({
        success: true,
        message: 'Import Smart Sync terminé',
        stats: {
          totalRows: csvData.length,
          imported,
          updated,
          duplicates,
          errors,
          importBatchID: importBatchId
        },
        performance: {
          duration_ms: duration,
          lines_per_second: Math.round(csvData.length / (duration / 1000))
        },
        errors: errorDetails.slice(0, 10)
      });
      
    } catch (error) {
      console.error('❌ Erreur import smart sync:', error);
      
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.warn('⚠️ Erreur rollback:', rollbackError.message);
      }
      
      res.status(500).json({
        success: false,
        error: 'Erreur import smart sync',
        message: error.message
      });
      
    } finally {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          console.warn('⚠️ Impossible supprimer fichier:', e.message);
        }
      }
      
      if (client?.release) client.release();
    }
  }
  
  // ============================================
  // MÉTHODES UTILITAIRES OPTIMISÉES
  // ============================================
  
  /**
   * Parse un fichier CSV en streaming
   */
  parseCSVStream(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      let rowCount = 0;
      
      fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(csv({
          separator: CONFIG.csvDelimiter,
          mapHeaders: ({ header }) => {
            // Nettoyer et normaliser les en-têtes
            return header
              .trim()
              .toUpperCase()
              .replace(/[^\w\s]/g, '')
              .replace(/\s+/g, ' ');
          },
          mapValues: ({ value }) => {
            if (!value) return '';
            return value.toString().trim();
          },
          skipLines: 0
        }))
        .on('data', (data) => {
          results.push(data);
          rowCount++;
          
          // Log pour les gros fichiers
          if (rowCount % 10000 === 0) {
            console.log(`📖 CSV parsing: ${rowCount} lignes lues`);
          }
        })
        .on('end', () => {
          console.log(`✅ CSV parsing terminé: ${rowCount} lignes`);
          resolve(results);
        })
        .on('error', (error) => {
          reject(new Error(`Erreur parsing CSV: ${error.message}`));
        });
    });
  }
  
  /**
   * Traite un lot de données CSV optimisé
   */
  async processCSVBatchOptimized(client, batch, startLine, importBatchID, userId, userRole, userCoordination) {
    const result = {
      imported: 0,
      updated: 0,
      errors: 0,
      errorDetails: []
    };
    
    for (let i = 0; i < batch.length; i++) {
      const data = batch[i];
      const lineNum = startLine + i;
      
      try {
        // Ajouter la coordination si non présente
        if (!data.COORDINATION && userCoordination && userRole === 'Gestionnaire') {
          data.COORDINATION = userCoordination;
        }
        
        // Validation
        if (!data.NOM || !data.PRENOMS) {
          result.errors++;
          result.errorDetails.push(`Ligne ${lineNum}: NOM et PRENOMS obligatoires`);
          continue;
        }
        
        const nom = data.NOM.toString().trim();
        const prenoms = data.PRENOMS.toString().trim();
        const siteRetrait = data["SITE DE RETRAIT"]?.toString().trim() || '';
        
        // Vérifier si la carte existe
        const existing = await client.query(
          `SELECT id, coordination FROM cartes WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
          [nom, prenoms, siteRetrait]
        );
        
        const insertData = {
          "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
          "SITE DE RETRAIT": siteRetrait,
          "RANGEMENT": this.sanitizeString(data["RANGEMENT"]),
          "NOM": nom,
          "PRENOMS": prenoms,
          "DATE DE NAISSANCE": this.formatDate(data["DATE DE NAISSANCE"]),
          "LIEU NAISSANCE": this.sanitizeString(data["LIEU NAISSANCE"]),
          "CONTACT": this.formatPhone(data["CONTACT"]),
          "DELIVRANCE": this.formatDelivrance(data["DELIVRANCE"]),
          "CONTACT DE RETRAIT": this.formatPhone(data["CONTACT DE RETRAIT"]),
          "DATE DE DELIVRANCE": this.formatDate(data["DATE DE DELIVRANCE"]),
          "COORDINATION": data.COORDINATION || userCoordination
        };
        
        if (existing.rows.length > 0) {
          // Vérifier la coordination pour les gestionnaires
          if (userRole === 'Gestionnaire' && 
              existing.rows[0].coordination && 
              existing.rows[0].coordination !== userCoordination) {
            result.errors++;
            result.errorDetails.push(`Ligne ${lineNum}: Carte existante dans une autre coordination (${existing.rows[0].coordination})`);
            continue;
          }
          
          // Mise à jour
          await client.query(`
            UPDATE cartes SET
              "LIEU D'ENROLEMENT" = $1,
              "RANGEMENT" = $2,
              "DATE DE NAISSANCE" = $3,
              "LIEU NAISSANCE" = $4,
              "CONTACT" = $5,
              "DELIVRANCE" = $6,
              "CONTACT DE RETRAIT" = $7,
              "DATE DE DELIVRANCE" = $8,
              coordination = $9,
              dateimport = NOW(),
              importbatchid = $10
            WHERE id = $11
          `, [
            insertData["LIEU D'ENROLEMENT"],
            insertData["RANGEMENT"],
            insertData["DATE DE NAISSANCE"],
            insertData["LIEU NAISSANCE"],
            insertData["CONTACT"],
            insertData["DELIVRANCE"],
            insertData["CONTACT DE RETRAIT"],
            insertData["DATE DE DELIVRANCE"],
            insertData["COORDINATION"],
            importBatchID,
            existing.rows[0].id
          ]);
          
          result.updated++;
        } else {
          // Insertion
          const insertResult = await client.query(`
            INSERT INTO cartes (
              "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
              "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
              "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, importbatchid, sourceimport
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
            RETURNING id
          `, [
            insertData["LIEU D'ENROLEMENT"],
            insertData["SITE DE RETRAIT"],
            insertData["RANGEMENT"],
            insertData["NOM"],
            insertData["PRENOMS"],
            insertData["DATE DE NAISSANCE"],
            insertData["LIEU NAISSANCE"],
            insertData["CONTACT"],
            insertData["DELIVRANCE"],
            insertData["CONTACT DE RETRAIT"],
            insertData["DATE DE DELIVRANCE"],
            insertData["COORDINATION"],
            importBatchID,
            'csv_import'
          ]);
          
          result.imported++;
        }
        
      } catch (error) {
        result.errors++;
        result.errorDetails.push(`Ligne ${lineNum}: ${error.message}`);
      }
    }
    
    return result;
  }
  
  /**
   * Mise à jour intelligente d'une carte
   */
  async smartUpdateCarte(client, existingCarte, newData) {
    let updated = false;
    const updates = [];
    const params = [];
    let paramCount = 0;
    
    // Colonnes à comparer
    const columnsToCheck = [
      "LIEU D'ENROLEMENT",
      "RANGEMENT",
      "LIEU NAISSANCE",
      "CONTACT",
      "DELIVRANCE",
      "CONTACT DE RETRAIT",
      "DATE DE NAISSANCE",
      "DATE DE DELIVRANCE",
      "COORDINATION"
    ];
    
    for (const col of columnsToCheck) {
      const oldVal = existingCarte[col] || '';
      const newVal = newData[col] || '';
      
      if (newVal && newVal !== oldVal) {
        // Règles de priorité
        let shouldUpdate = true;
        
        // Pour les contacts, garder le plus complet
        if (col === 'CONTACT' || col === 'CONTACT DE RETRAIT') {
          if (oldVal.length > newVal.length) shouldUpdate = false;
        }
        
        // Pour DELIVRANCE, ne pas remplacer "OUI" par autre chose
        if (col === 'DELIVRANCE' && oldVal.toUpperCase() === 'OUI' && newVal.toUpperCase() !== 'OUI') {
          shouldUpdate = false;
        }
        
        if (shouldUpdate) {
          paramCount++;
          updates.push(`"${col}" = $${paramCount}`);
          params.push(this.formatValue(col, newVal));
          updated = true;
        }
      }
    }
    
    if (updated) {
      paramCount++;
      updates.push(`dateimport = NOW()`);
      params.push(existingCarte.id);
      
      await client.query(`
        UPDATE cartes 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
      `, params);
    }
    
    return updated;
  }
  
  /**
   * Insertion intelligente d'une carte
   */
  async smartInsertCarte(client, data, importBatchID, userId, userCoordination) {
    const insertData = {
      "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
      "SITE DE RETRAIT": this.sanitizeString(data["SITE DE RETRAIT"]),
      "RANGEMENT": this.sanitizeString(data["RANGEMENT"]),
      "NOM": this.sanitizeString(data["NOM"]),
      "PRENOMS": this.sanitizeString(data["PRENOMS"]),
      "DATE DE NAISSANCE": this.formatDate(data["DATE DE NAISSANCE"]),
      "LIEU NAISSANCE": this.sanitizeString(data["LIEU NAISSANCE"]),
      "CONTACT": this.formatPhone(data["CONTACT"]),
      "DELIVRANCE": this.formatDelivrance(data["DELIVRANCE"]),
      "CONTACT DE RETRAIT": this.formatPhone(data["CONTACT DE RETRAIT"]),
      "DATE DE DELIVRANCE": this.formatDate(data["DATE DE DELIVRANCE"]),
      "COORDINATION": data.COORDINATION || userCoordination
    };
    
    const result = await client.query(`
      INSERT INTO cartes (
        "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, importbatchid, sourceimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
    `, [
      insertData["LIEU D'ENROLEMENT"],
      insertData["SITE DE RETRAIT"],
      insertData["RANGEMENT"],
      insertData["NOM"],
      insertData["PRENOMS"],
      insertData["DATE DE NAISSANCE"],
      insertData["LIEU NAISSANCE"],
      insertData["CONTACT"],
      insertData["DELIVRANCE"],
      insertData["CONTACT DE RETRAIT"],
      insertData["DATE DE DELIVRANCE"],
      insertData["COORDINATION"],
      importBatchID,
      'smart_import'
    ]);
    
    return result.rows[0].id;
  }
  
  /**
   * Nettoie une chaîne de caractères
   */
  sanitizeString(value) {
    if (!value) return '';
    return value.toString().trim().replace(/\s+/g, ' ');
  }
  
  /**
   * Formate une date
   */
  formatDate(value) {
    if (!value) return null;
    
    try {
      // Essayer différents formats
      let date;
      
      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'string') {
        // Format JJ/MM/AAAA
        if (value.includes('/')) {
          const parts = value.split('/');
          if (parts.length === 3) {
            date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          }
        } 
        // Format AAAA-MM-JJ
        else if (value.includes('-')) {
          date = new Date(value);
        }
        // Timestamp
        else if (!isNaN(parseInt(value))) {
          date = new Date(parseInt(value));
        } else {
          date = new Date(value);
        }
      } else {
        date = new Date(value);
      }
      
      if (isNaN(date.getTime())) return null;
      
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }
  
  /**
   * Formate un numéro de téléphone
   */
  formatPhone(value) {
    if (!value) return '';
    
    // Garder uniquement les chiffres
    const digits = value.toString().replace(/\D/g, '');
    
    // Format ivoirien: commencer par 0 ou 07/05
    if (digits.length === 10 && digits.startsWith('0')) {
      return digits;
    } else if (digits.length === 8) {
      return '0' + digits;
    } else if (digits.length === 12 && digits.startsWith('225')) {
      return '0' + digits.substring(3);
    }
    
    // Retourner les 8 premiers chiffres si trop long
    return digits.substring(0, 8);
  }
  
  /**
   * Formate DELIVRANCE
   */
  formatDelivrance(value) {
    if (!value) return '';
    const upper = value.toString().trim().toUpperCase();
    if (upper === 'OUI' || upper === 'NON') {
      return upper;
    }
    return value.toString().trim();
  }
  
  /**
   * Formate une valeur selon la colonne
   */
  formatValue(column, value) {
    if (!value) return '';
    
    if (column.includes('DATE')) {
      return this.formatDate(value);
    } else if (column.includes('CONTACT')) {
      return this.formatPhone(value);
    } else if (column === 'DELIVRANCE') {
      return this.formatDelivrance(value);
    } else {
      return this.sanitizeString(value);
    }
  }
  
  // ============================================
  // ROUTES UTILITAIRES
  // ============================================
  
  /**
   * Récupère la liste des sites
   */
  async getSitesList(req, res) {
    try {
      let query = 'SELECT DISTINCT "SITE DE RETRAIT" as site FROM cartes WHERE "SITE DE RETRAIT" IS NOT NULL';
      let params = [];
      
      // Appliquer filtre de coordination
      const filtre = this.ajouterFiltreCoordination(req, query, params);
      
      const result = await db.query(filtre.query + ' ORDER BY site', filtre.params);
      
      const sites = result.rows
        .map(row => row.site)
        .filter(site => site && site.trim() !== '');
      
      res.json({
        success: true,
        sites,
        count: sites.length,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('❌ Erreur récupération sites:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur récupération sites: ' + error.message
      });
    }
  }
  
  /**
   * Télécharge le template d'import
   */
  async downloadTemplate(req, res) {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Template', {
        properties: { tabColor: { argb: 'FF2E75B5' } }
      });
      
      // Ajouter les en-têtes avec style
      worksheet.columns = CONFIG.csvHeaders.map(header => ({
        header,
        key: header.replace(/\s+/g, '_'),
        width: 25
      }));
      
      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' }
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      
      // Ajouter une ligne d'exemple
      const exampleData = {
        "LIEU D'ENROLEMENT": "Abidjan Plateau",
        "SITE DE RETRAIT": "Yopougon",
        "RANGEMENT": "A1-001",
        "NOM": "KOUAME",
        "PRENOMS": "Jean",
        "DATE DE NAISSANCE": "15/05/1990",
        "LIEU NAISSANCE": "Abidjan",
        "CONTACT": "01234567",
        "DELIVRANCE": "OUI",
        "CONTACT DE RETRAIT": "07654321",
        "DATE DE DELIVRANCE": "20/11/2024",
        "COORDINATION": req.user.coordination || "Exemple"
      };
      
      const exampleRow = worksheet.addRow(exampleData);
      exampleRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' }
        };
      });
      
      // Ajouter des instructions
      worksheet.addRow([]);
      const instructions = worksheet.addRow(['INSTRUCTIONS IMPORTANTES:']);
      instructions.getCell(1).font = { bold: true };
      
      worksheet.addRow(['- NOM et PRENOMS sont obligatoires']);
      worksheet.addRow(['- Formats date: JJ/MM/AAAA ou AAAA-MM-JJ']);
      worksheet.addRow(['- Téléphone: 8 chiffres (sera formaté automatiquement)']);
      worksheet.addRow(['- DELIVRANCE: OUI ou NON (vide si non délivrée)']);
      worksheet.addRow(['- COORDINATION: (optionnel) sera automatiquement attribuée si vide']);
      
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', 'attachment; filename="template-import-cartes.xlsx"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-User-Role', req.user.role);
      
      await workbook.xlsx.write(res);
      
    } catch (error) {
      console.error('❌ Erreur génération template:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur génération template: ' + error.message
      });
    }
  }
  
  /**
   * Diagnostic complet
   */
  async diagnostic(req, res) {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      
      // Statistiques DB avec filtre de coordination
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];
      
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await db.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      
      const sitesResult = await db.query('SELECT COUNT(DISTINCT "SITE DE RETRAIT") as sites FROM cartes');
      const sitesCount = parseInt(sitesResult.rows[0].sites);
      
      const recentResult = await db.query(`
        SELECT COUNT(*) as recent 
        FROM cartes 
        WHERE dateimport > NOW() - INTERVAL '24 hours'
      `);
      const recentImports = parseInt(recentResult.rows[0].recent);
      
      // Statistiques par coordination
      const coordinationStats = await db.query(`
        SELECT coordination, COUNT(*) as total 
        FROM cartes 
        WHERE coordination IS NOT NULL 
        GROUP BY coordination 
        ORDER BY total DESC
      `);
      
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'import-export-lws',
        environment: 'lws-optimized',
        version: '4.0.0-lws',
        user: {
          role: req.user.role,
          coordination: req.user.coordination,
          nom: req.user.nomUtilisateur
        },
        data: {
          total_cartes_accessibles: totalRows,
          sites_actifs: sitesCount,
          imports_24h: recentImports,
          exports_en_cours: this.activeExports.size,
          imports_en_cours: this.activeImports.size,
          file_d_attente: this.exportQueue.length
        },
        coordination_stats: coordinationStats.rows,
        config: {
          maxExportRows: CONFIG.maxExportRows,
          maxExportRowsRecommended: CONFIG.maxExportRowsRecommended,
          exportTimeout: CONFIG.exportTimeout,
          importTimeout: CONFIG.importTimeout,
          chunkSize: CONFIG.chunkSize,
          batchSize: CONFIG.batchSize,
          memoryLimitMB: CONFIG.memoryLimitMB,
          maxConcurrent: CONFIG.maxConcurrent
        },
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
          external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB'
        },
        uptime: `${hours}h ${minutes}m`,
        endpoints: {
          export_complet_excel: '/api/import-export/export/complete',
          export_complet_csv: '/api/import-export/export/complete/csv',
          export_tout_en_un: '/api/import-export/export/all',
          export_limite_excel: '/api/import-export/export',
          export_limite_csv: '/api/import-export/export/csv',
          export_par_site: '/api/import-export/export/site?siteRetrait=...',
          import_csv: '/api/import-export/import/csv',
          import_smart: '/api/import-export/import/smart-sync',
          template: '/api/import-export/template',
          sites: '/api/import-export/sites',
          diagnostic: '/api/import-export/diagnostic'
        },
        recommendations: [
          totalRows > CONFIG.maxExportRowsRecommended ? 
            `⚠️ Base volumineuse (${totalRows.toLocaleString()} lignes accessibles) - Utilisez CSV pour les exports` :
            `✅ Base optimale (${totalRows.toLocaleString()} lignes accessibles) - Excel ou CSV disponibles`,
          `📊 Export recommandé: ${totalRows > CONFIG.maxExportRowsRecommended ? 'CSV' : 'Excel'}`,
          `⚡ Vitesse max théorique: ${Math.round(CONFIG.chunkSize / 10)}K lignes/sec`,
          `💾 Mémoire disponible: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB/${CONFIG.memoryLimitMB}MB`
        ]
      });
      
    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur diagnostic: ' + error.message
      });
    }
  }
  
  /**
   * Statut des exports en cours
   */
  async getExportStatus(req, res) {
    res.json({
      success: true,
      activeExports: Array.from(this.activeExports.entries()).map(([id, data]) => ({
        id,
        type: data.type,
        startedAt: new Date(data.startTime).toISOString(),
        elapsed: Date.now() - data.startTime
      })),
      activeImports: Array.from(this.activeImports.entries()).map(([id, data]) => ({
        id,
        file: data.file,
        startedAt: new Date(data.startTime).toISOString(),
        elapsed: Date.now() - data.startTime
      })),
      queueLength: this.exportQueue.length
    });
  }
}

// ============================================
// EXPORT OPTIMISÉ POUR LWS
// ============================================
const controller = new OptimizedImportExportController();

module.exports = {
  // Imports
  importCSV: controller.importCSV.bind(controller),
  importExcel: controller.importCSV.bind(controller), // Alias
  importSmartSync: controller.importSmartSync.bind(controller),
  
  // Export standard (limité)
  exportExcel: controller.exportExcel.bind(controller),
  exportCSV: controller.exportCSV.bind(controller),
  
  // Export COMPLET (nouvelles méthodes optimisées)
  exportCompleteExcel: controller.exportCompleteExcel.bind(controller),
  exportCompleteCSV: controller.exportCompleteCSV.bind(controller),
  exportAllData: controller.exportAllData.bind(controller),
  
  // Export par site
  exportCSVBySite: controller.exportCSVBySite.bind(controller),
  exportFiltered: controller.exportCSVBySite.bind(controller), // Alias
  exportResultats: controller.exportCSVBySite.bind(controller), // Alias
  
  // Streaming
  exportStream: controller.exportCompleteCSV.bind(controller), // Redirige vers complet
  exportOptimized: controller.exportCompleteCSV.bind(controller), // Redirige vers complet
  
  // Utilitaires
  getSitesList: controller.getSitesList.bind(controller),
  downloadTemplate: controller.downloadTemplate.bind(controller),
  diagnostic: controller.diagnostic.bind(controller),
  getExportStatus: controller.getExportStatus.bind(controller),
  
  // Configuration
  CONFIG,
  
  // Accès au contrôleur pour debug
  _controller: controller
};