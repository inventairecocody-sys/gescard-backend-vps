const db = require('../db/db');
const ExcelJS = require('exceljs');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const annulationService = require('../Services/annulationService');

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
    'SITE DE RETRAIT',
    'RANGEMENT',
    'NOM',
    'PRENOMS',
    'DATE DE NAISSANCE',
    'LIEU NAISSANCE',
    'CONTACT',
    'DELIVRANCE',
    'CONTACT DE RETRAIT',
    'DATE DE DELIVRANCE',
    'COORDINATION',
  ],

  // Contrôles
  requiredHeaders: ['NOM', 'PRENOMS'],
  isLWS: true,

  // Configuration export
  maxExportRows: 1000000,
  maxExportRowsRecommended: 500000,
  exportTimeout: 600000,
  importTimeout: 300000,
  chunkSize: 10000,
  memoryLimitMB: 512,
  batchSize: 2000,
  maxConcurrent: 3,
  compressionLevel: 6,
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
    console.log(`   - Timeout export: ${CONFIG.exportTimeout / 1000}s`);
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
        console.error("❌ Erreur dans la file d'attente:", error);
      }
    }

    this.processingQueue = false;
  }

  // ============================================
  // FONCTIONS DE VÉRIFICATION DES DROITS
  // ============================================

  verifierDroitsImportExport(req) {
    const role = req.user?.role;

    if (role === 'Administrateur' || role === 'Gestionnaire') {
      return { autorise: true };
    }

    return {
      autorise: false,
      message: 'Seuls les administrateurs et gestionnaires peuvent importer/exporter',
    };
  }

  ajouterFiltreCoordination(req, query, params, colonne = 'coordination') {
    const role = req.user?.role;
    const coordination = req.user?.coordination;
    const newParams = [...params];

    if ((role === 'Gestionnaire' || role === "Chef d'équipe") && coordination) {
      return {
        query: query + ` AND ${colonne} = $${params.length + 1}`,
        params: [...params, coordination],
      };
    }

    return { query, params: newParams };
  }

  // ============================================
  // EXPORT EXCEL LIMITÉ
  // ============================================
  async exportExcel(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `excel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `📤 Export Excel limité demandé (ID: ${exportId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export Excel limité (max ${limit}) démarré`,
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'excel_limited', limit },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 ${totalRows} cartes accessibles, export limité à ${limit}`);

      let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
      let dataParams = [];

      const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

      const finalQuery = filtreData.query + ' ORDER BY id LIMIT $' + (filtreData.params.length + 1);
      const finalParams = [...filtreData.params, limit];

      const result = await client.query(finalQuery, finalParams);

      const rows = result.rows;

      if (rows.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Aucune donnée à exporter',
        });
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GESCARD Cocody';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.lastPrinted = new Date();

      workbook.views = [
        {
          x: 0,
          y: 0,
          width: 10000,
          height: 20000,
          firstSheet: 0,
          activeTab: 0,
          visibility: 'visible',
        },
      ];

      const worksheet = workbook.addWorksheet('Cartes', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
        pageSetup: { paperSize: 9, orientation: 'landscape' },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
      });

      worksheet.columns = CONFIG.csvHeaders.map((header) => ({
        header,
        key: header.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_]/g, ''),
        width: 25,
        style: {
          font: { bold: true, size: 12 },
          alignment: { vertical: 'middle', horizontal: 'center' },
        },
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' },
          size: 12,
          name: 'Calibri',
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      rows.forEach((row, index) => {
        const excelRow = worksheet.addRow(row);

        if (index % 2 === 0) {
          excelRow.eachCell((cell) => {
            cell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FFF2F2F2' },
            };
          });
        }

        if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
          const delivranceCell = excelRow.getCell('delivrance');
          if (delivranceCell) {
            delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
          }
        }
      });

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: CONFIG.csvHeaders.length },
      };

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Total-Rows', rows.length);
      res.setHeader('X-Export-Type', 'limited');
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      await workbook.xlsx.write(res);

      const duration = Date.now() - startTime;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export Excel limité terminé: ${rows.length} lignes en ${duration}ms`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'excel_limited', rows: rows.length, duration },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(`✅ Export Excel limité réussi: ${rows.length} lignes en ${duration}ms`);
    } catch (error) {
      console.error(`❌ Erreur export Excel:`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export Excel",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
        });
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export Excel: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT CSV LIMITÉ
  // ============================================
  async exportCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `csv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `📤 Export CSV limité demandé (ID: ${exportId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export CSV limité (max ${limit}) démarré`,
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'csv_limited', limit },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 ${totalRows} cartes accessibles, export CSV limité à ${limit}`);

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Export-Type', 'limited');
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.write('\uFEFF');

      const headers = CONFIG.csvHeaders.map((h) => `"${h}"`).join(CONFIG.csvDelimiter) + '\n';
      res.write(headers);

      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      let iterationCount = 0;

      // Remplacer while (offset < limit) par une boucle avec break condition
      for (let page = 0; page < Math.ceil(limit / chunkSize); page++) {
        iterationCount++;
        const currentLimit = Math.min(chunkSize, limit - offset);

        if (currentLimit <= 0) break;

        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];

        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, currentLimit, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) break;

        let batchCSV = '';
        for (const row of rows) {
          const csvRow = CONFIG.csvHeaders
            .map((header) => {
              let value = row[header] || '';

              if (typeof value === 'string') {
                value = value.replace(/"/g, '""');

                if (
                  value.includes(CONFIG.csvDelimiter) ||
                  value.includes('"') ||
                  value.includes('\n') ||
                  value.includes('\r')
                ) {
                  value = `"${value}"`;
                }
              } else if (value instanceof Date) {
                value = value.toISOString().split('T')[0];
              }

              return value;
            })
            .join(CONFIG.csvDelimiter);

          batchCSV += csvRow + '\n';
          totalWritten++;
        }

        res.write(batchCSV);
        offset += rows.length;

        if (iterationCount % 5 === 0) {
          console.log(`📝 CSV limité: ${totalWritten}/${limit} lignes écrites`);
        }

        if (rows.length < currentLimit) break;
      }

      res.end();

      const duration = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (duration / 1000)) : 0;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export CSV limité terminé: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'csv_limited', rows: totalWritten, duration, speed },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(
        `✅ Export CSV limité réussi: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`
      );
    } catch (error) {
      console.error(`❌ Erreur export CSV:`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export CSV",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
        });
      } else {
        try {
          res.end();
        } catch (e) {
          // Ignorer les erreurs de fin de réponse
        }
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export CSV: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT EXCEL COMPLET
  // ============================================
  async exportCompleteExcel(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `excel_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `🚀 EXPORT EXCEL COMPLET demandé par ${req.user?.nomUtilisateur} (${req.user?.role}) (ID: ${exportId})`
    );

    if (this.activeExports.size >= CONFIG.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: "Trop d'exports en cours",
        message: `Maximum ${CONFIG.maxConcurrent} exports simultanés`,
        queueLength: this.exportQueue.length,
      });
    }

    this.activeExports.set(exportId, { startTime, type: 'excel_complete' });

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        'Export Excel COMPLET démarré',
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'excel_complete' },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

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
          error: 'Aucune donnée à exporter',
        });
      }

      if (totalRows > CONFIG.maxExportRows) {
        console.warn(
          `⚠️ Export très volumineux: ${totalRows} lignes (max: ${CONFIG.maxExportRows})`
        );

        await annulationService.enregistrerAction(
          req.user?.id,
          req.user?.nomUtilisateur,
          req.user?.nomComplet || req.user?.nomUtilisateur,
          req.user?.role,
          req.user?.agence || '',
          `Export très volumineux: ${totalRows} lignes, peut être lent`,
          'EXPORT_WARNING',
          'Cartes',
          null,
          null,
          { rows: totalRows, warning: 'large_export' },
          req.ip,
          null,
          req.user?.coordination
        );
      }

      const sampleResult = await client.query('SELECT * FROM cartes LIMIT 1');
      const firstRow = sampleResult.rows[0] || {};

      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at', 'id'];
      const headers = Object.keys(firstRow).filter(
        (key) => !excludedColumns.includes(key.toLowerCase())
      );

      console.log(`📋 ${headers.length} colonnes détectées`);

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      const workbook = new ExcelJS.Workbook();
      workbook.creator = 'GESCARD Cocody';
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.calcProperties.fullCalcOnLoad = false;

      const worksheet = workbook.addWorksheet('Cartes', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
        pageSetup: { paperSize: 9, orientation: 'landscape' },
        views: [{ state: 'frozen', xSplit: 0, ySplit: 1 }],
      });

      worksheet.columns = headers.map((header) => ({
        header: header.replace(/_/g, ' ').toUpperCase(),
        key: header,
        width: 25,
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = {
          bold: true,
          color: { argb: 'FFFFFFFF' },
          size: 12,
          name: 'Calibri',
        };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' },
        };
        cell.alignment = {
          vertical: 'middle',
          horizontal: 'center',
          wrapText: true,
        };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      console.log(`⏳ Récupération et écriture des données...`);

      let offset = 0;
      const chunkSize = 2000;
      let totalWritten = 0;
      let lastProgressLog = Date.now();
      let rowOffset = 0;

      // Remplacer while (true) par une boucle avec break condition
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];

        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, chunkSize, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) {
          hasMoreData = false;
          break;
        }

        for (let i = 0; i < rows.length; i++) {
          const row = rows[i];
          const rowData = {};

          headers.forEach((header) => {
            let value = row[header];

            if (value instanceof Date) {
              value = value.toLocaleDateString('fr-FR');
            }

            rowData[header] = value || '';
          });

          const excelRow = worksheet.addRow(rowData);

          if ((rowOffset + i) % 2 === 0) {
            excelRow.eachCell((cell) => {
              cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFF2F2F2' },
              };
            });
          }

          if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
            const delivranceCell = excelRow.getCell('delivrance');
            if (delivranceCell) {
              delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
            }
          }
        }

        totalWritten += rows.length;
        offset += rows.length;
        rowOffset += rows.length;

        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const progress = Math.round((totalWritten / totalRows) * 100);
          const elapsed = (now - startTime) / 1000;
          const speed = Math.round(totalWritten / elapsed);

          console.log(
            `📊 Progression Excel: ${totalWritten}/${totalRows} lignes (${progress}%) - ${speed} lignes/sec`
          );
          lastProgressLog = now;
        }
      }

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };

      worksheet.columns.forEach((column) => {
        let maxLength = 0;
        column.eachCell({ includeEmpty: true }, (cell) => {
          const columnLength = cell.value ? cell.value.toString().length : 0;
          if (columnLength > maxLength) {
            maxLength = columnLength;
          }
        });
        column.width = Math.min(50, maxLength + 2);
      });

      console.log(`⏳ Génération finale du fichier Excel...`);

      await workbook.xlsx.write(res);

      const totalTime = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (totalTime / 1000)) : 0;
      const memoryUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export Excel COMPLET terminé: ${totalWritten} lignes en ${totalTime}ms (${speed} lignes/sec)`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'excel_complete', rows: totalWritten, duration: totalTime, speed },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(`🎉 Export Excel COMPLET réussi !`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Lignes exportées: ${totalWritten.toLocaleString()}`);
      console.log(`   - Colonnes: ${headers.length}`);
      console.log(`   - Temps total: ${(totalTime / 1000).toFixed(1)}s`);
      console.log(`   - Vitesse: ${speed} lignes/sec`);
      console.log(`   - Mémoire max: ${memoryUsed}MB`);
    } catch (error) {
      console.error(`❌ ERREUR export Excel complet (ID: ${exportId}):`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export Excel complet",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
          advice: [
            'Le fichier peut être trop volumineux pour Excel',
            "Essayez d'exporter en CSV pour les très gros fichiers",
            'Divisez vos données en plusieurs exports si nécessaire',
          ],
        });
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export Excel complet: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT CSV COMPLET
  // ============================================
  async exportCompleteCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `csv_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    console.log(
      `🚀 EXPORT CSV COMPLET demandé par ${req.user?.nomUtilisateur} (${req.user?.role}) (ID: ${exportId})`
    );

    if (this.activeExports.size >= CONFIG.maxConcurrent) {
      return res.status(429).json({
        success: false,
        error: "Trop d'exports en cours",
        message: `Maximum ${CONFIG.maxConcurrent} exports simultanés`,
      });
    }

    this.activeExports.set(exportId, { startTime, type: 'csv_complete' });

    let client;

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        'Export CSV COMPLET démarré',
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'csv_complete' },
        req.ip,
        null,
        req.user?.coordination
      );

      client = await db.getClient();

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
          error: 'Aucune donnée à exporter',
        });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.write('\uFEFF');

      const sampleResult = await client.query('SELECT * FROM cartes LIMIT 1');
      const firstRow = sampleResult.rows[0] || {};

      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at'];
      const headers = Object.keys(firstRow).filter(
        (key) => !excludedColumns.includes(key.toLowerCase())
      );

      const csvHeaders = headers
        .map((header) => `"${header.replace(/"/g, '""').replace(/_/g, ' ').toUpperCase()}"`)
        .join(CONFIG.csvDelimiter);

      res.write(csvHeaders + '\n');

      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;
      let lastProgressLog = Date.now();

      console.log(`⏳ Début de l'export streaming CSV...`);

      // Remplacer while (true) par une boucle avec break condition
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE 1=1';
        let dataParams = [];

        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, dataParams);

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, chunkSize, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) {
          hasMoreData = false;
          break;
        }

        let batchCSV = '';
        for (const row of rows) {
          const csvRow = headers
            .map((header) => {
              let value = row[header];

              if (value === null || value === undefined) {
                return '';
              }

              let stringValue;
              if (value instanceof Date) {
                stringValue = value.toLocaleDateString('fr-FR');
              } else {
                stringValue = String(value);
              }

              if (
                stringValue.includes(CONFIG.csvDelimiter) ||
                stringValue.includes('"') ||
                stringValue.includes('\n') ||
                stringValue.includes('\r')
              ) {
                stringValue = `"${stringValue.replace(/"/g, '""')}"`;
              }

              return stringValue;
            })
            .join(CONFIG.csvDelimiter);

          batchCSV += csvRow + '\n';
          totalWritten++;
        }

        res.write(batchCSV);
        offset += rows.length;

        const now = Date.now();
        if (now - lastProgressLog > 5000) {
          const progress = Math.round((totalWritten / totalRows) * 100);
          const elapsed = (now - startTime) / 1000;
          const speed = Math.round(totalWritten / elapsed);

          console.log(
            `📊 Progression CSV: ${totalWritten}/${totalRows} lignes (${progress}%) - ${speed} lignes/sec`
          );
          lastProgressLog = now;

          if (res.flush) res.flush();
        }

        const memUsage = process.memoryUsage().heapUsed / 1024 / 1024;
        if (memUsage > CONFIG.memoryLimitMB * 0.8) {
          console.warn(`⚠️ Mémoire élevée: ${Math.round(memUsage)}MB, pause de 100ms`);
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      }

      res.end();

      const duration = Date.now() - startTime;
      const speed = totalWritten > 0 ? Math.round(totalWritten / (duration / 1000)) : 0;
      const memoryUsed = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export CSV COMPLET terminé: ${totalWritten} lignes en ${duration}ms (${speed} lignes/sec)`,
        'EXPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { type: 'csv_complete', rows: totalWritten, duration, speed },
        req.ip,
        null,
        req.user?.coordination
      );

      console.log(`🎉 Export CSV COMPLET réussi !`);
      console.log(`📊 Statistiques:`);
      console.log(`   - Lignes exportées: ${totalWritten.toLocaleString()}`);
      console.log(`   - Colonnes: ${headers.length}`);
      console.log(`   - Temps total: ${(duration / 1000).toFixed(1)}s`);
      console.log(`   - Vitesse: ${speed} lignes/sec`);
      console.log(`   - Mémoire max: ${memoryUsed}MB`);
    } catch (error) {
      console.error(`❌ ERREUR export CSV complet (ID: ${exportId}):`, error);

      if (!res.headersSent) {
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export CSV complet",
          message: error.message,
          duration: `${Date.now() - startTime}ms`,
          exportId,
        });
      } else {
        try {
          res.end();
        } catch (e) {
          // Ignorer les erreurs de fin de réponse
        }
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export CSV complet: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  // ============================================
  // EXPORT TOUT EN UN CLIC
  // ============================================
  async exportAllData(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const exportId = `all_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    console.log(
      `🚀 Export "TOUT EN UN" demandé par ${req.user?.nomUtilisateur} (${req.user?.role}) (ID: ${exportId})`
    );

    let client;

    try {
      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      console.log(`📊 TOTAL ACCESSIBLE: ${totalRows} cartes`);

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Export "TOUT EN UN" démarré: ${totalRows} cartes`,
        'EXPORT_START',
        'Cartes',
        null,
        null,
        { type: 'auto_select', rows: totalRows },
        req.ip,
        null,
        req.user?.coordination
      );

      let chosenFormat;

      if (totalRows > CONFIG.maxExportRowsRecommended) {
        chosenFormat = 'csv';
      } else {
        chosenFormat = 'excel';
      }

      console.log(`🤔 Format choisi: ${chosenFormat.toUpperCase()}`);

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
          error: "Erreur lors du choix de la méthode d'export",
          message: error.message,
          advice: [
            "Essayez d'utiliser directement /export/complete pour Excel",
            'Ou /export/complete/csv pour CSV',
            'Vérifiez que la base de données est accessible',
          ],
        });
      }

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Erreur export tout en un: ${error.message}`,
        'EXPORT_ERROR',
        'Cartes',
        null,
        null,
        { error: error.message },
        req.ip,
        null,
        req.user?.coordination
      );
    } finally {
      if (client?.release) client.release();
    }
  }

  // ============================================
  // EXPORT CSV PAR SITE
  // ============================================
  async exportCSVBySite(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    const { siteRetrait } = req.query;

    if (!siteRetrait) {
      return res.status(400).json({
        success: false,
        error: 'Paramètre siteRetrait requis',
      });
    }

    const decodedSite = decodeURIComponent(siteRetrait).replace(/\+/g, ' ').trim();

    console.log(
      `📤 Export CSV pour site: ${decodedSite} par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    let client;

    try {
      client = await db.getClient();

      let countQuery = 'SELECT COUNT(*) as count FROM cartes WHERE "SITE DE RETRAIT" = $1';
      let countParams = [decodedSite];

      const filtreCount = this.ajouterFiltreCoordination(
        req,
        countQuery,
        countParams,
        'coordination'
      );

      const siteCheck = await client.query(filtreCount.query, filtreCount.params);
      const count = parseInt(siteCheck.rows[0].count);

      if (count === 0) {
        return res.status(404).json({
          success: false,
          error: `Aucune donnée pour le site: ${decodedSite}`,
        });
      }

      const safeSiteName = decodedSite.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `export-${safeSiteName}-${timestamp}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Site', decodedSite);
      res.setHeader('X-Total-Rows', count);
      res.setHeader('X-User-Role', req.user?.role || 'unknown');
      if (req.user?.coordination) {
        res.setHeader('X-User-Coordination', req.user.coordination);
      }

      res.write('\uFEFF');

      const headers = CONFIG.csvHeaders.map((h) => `"${h}"`).join(CONFIG.csvDelimiter) + '\n';
      res.write(headers);

      let offset = 0;
      const chunkSize = CONFIG.chunkSize;
      let totalWritten = 0;

      // Remplacer while (true) par une boucle avec break condition
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE "SITE DE RETRAIT" = $1';
        let dataParams = [decodedSite];

        const filtreData = this.ajouterFiltreCoordination(
          req,
          dataQuery,
          dataParams,
          'coordination'
        );

        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);

        const finalParams = [...filtreData.params, chunkSize, offset];

        const result = await client.query(finalQuery, finalParams);

        const rows = result.rows;
        if (rows.length === 0) {
          hasMoreData = false;
          break;
        }

        let batchCSV = '';
        for (const row of rows) {
          const csvRow = CONFIG.csvHeaders
            .map((header) => {
              let value = row[header] || '';

              if (typeof value === 'string') {
                value = value.replace(/"/g, '""');
                if (
                  value.includes(CONFIG.csvDelimiter) ||
                  value.includes('"') ||
                  value.includes('\n')
                ) {
                  value = `"${value}"`;
                }
              } else if (value instanceof Date) {
                value = value.toLocaleDateString('fr-FR');
              }

              return value;
            })
            .join(CONFIG.csvDelimiter);

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
          error: 'Erreur export CSV site: ' + error.message,
        });
      }
    } finally {
      if (client?.release) client.release();
    }
  }

  // ============================================
  // IMPORT CSV
  // ============================================
  async importCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignorer les erreurs de nettoyage
        }
      }
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier uploadé',
      });
    }

    const importId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();

    console.log(
      `📥 Import CSV: ${req.file.originalname} (ID: ${importId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    if (this.activeImports.size >= 2) {
      fs.unlinkSync(req.file.path);
      return res.status(429).json({
        success: false,
        error: "Trop d'imports en cours",
        message: 'Maximum 2 imports simultanés',
      });
    }

    this.activeImports.set(importId, { startTime, file: req.file.originalname });

    const client = await db.getClient();

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import CSV: ${req.file.originalname}`,
        'IMPORT_START',
        'Cartes',
        null,
        null,
        { filename: req.file.originalname },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      await client.query('BEGIN');

      const stats = fs.statSync(req.file.path);
      const fileSizeMB = stats.size / (1024 * 1024);

      if (fileSizeMB > 100) {
        throw new Error(`Fichier trop volumineux: ${Math.round(fileSizeMB)}MB (max 100MB)`);
      }

      console.log(`📊 Taille fichier: ${Math.round(fileSizeMB)}MB`);

      const csvData = await this.parseCSVStream(req.file.path);

      console.log(`📋 ${csvData.length} lignes à traiter`);

      if (csvData.length === 0) {
        throw new Error('Le fichier CSV est vide');
      }

      const firstRow = csvData[0];
      const missingHeaders = CONFIG.requiredHeaders.filter(
        (h) => !Object.keys(firstRow).some((key) => key.toUpperCase() === h)
      );

      if (missingHeaders.length > 0) {
        throw new Error(`En-têtes requis manquants: ${missingHeaders.join(', ')}`);
      }

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
          req.user?.id,
          req.user?.role,
          req.user?.coordination
        );

        imported += batchResult.imported;
        updated += batchResult.updated;
        errors += batchResult.errors;
        processedRows += batch.length;

        const progress = Math.round((processedRows / csvData.length) * 100);
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = Math.round(processedRows / elapsed);

        console.log(
          `📈 Progression: ${progress}% (${processedRows}/${csvData.length}) - ${speed} lignes/sec`
        );

        if (batchResult.errors > 0) {
          errorDetails.push(...batchResult.errorDetails.slice(0, 5));
        }

        if (i % (batchSize * 5) === 0) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }

      await client.query('COMMIT');

      const duration = Date.now() - startTime;
      const speed = csvData.length > 0 ? Math.round(csvData.length / (duration / 1000)) : 0;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import CSV terminé: ${imported} importées, ${updated} mises à jour, ${errors} erreurs en ${duration}ms`,
        'IMPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { imported, updated, errors, duration, speed },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      console.log(`✅ Import CSV terminé en ${duration}ms (${speed} lignes/sec)`);
      console.log(
        `📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${errors} erreurs`
      );

      res.json({
        success: true,
        message: 'Import CSV terminé',
        stats: {
          totalRows: csvData.length,
          imported,
          updated,
          errors,
          importBatchID: importBatchId,
        },
        performance: {
          duration_ms: duration,
          lines_per_second: speed,
          file_size_mb: Math.round(fileSizeMB * 10) / 10,
        },
        errors: errorDetails.slice(0, 10),
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
        importId,
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
      this.activeImports.delete(importId);
    }
  }

  // ============================================
  // IMPORT SMART SYNC
  // ============================================
  async importSmartSync(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          // Ignorer les erreurs de nettoyage
        }
      }
      return res.status(403).json({
        success: false,
        error: droits.message,
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'Aucun fichier uploadé',
      });
    }

    const importId = `smart_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();

    console.log(
      `🧠 Import Smart Sync: ${req.file.originalname} (ID: ${importId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    const client = await db.getClient();

    try {
      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import Smart Sync: ${req.file.originalname}`,
        'IMPORT_START',
        'Cartes',
        null,
        null,
        { type: 'smart', filename: req.file.originalname },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      await client.query('BEGIN');

      const csvData = await this.parseCSVStream(req.file.path);

      console.log(`📋 ${csvData.length} lignes à traiter avec fusion intelligente`);

      let imported = 0;
      let updated = 0;
      let duplicates = 0;
      let errors = 0;
      const errorDetails = [];

      for (let i = 0; i < csvData.length; i++) {
        try {
          const item = csvData[i];

          if (!item.COORDINATION && req.user?.coordination && req.user?.role === 'Gestionnaire') {
            item.COORDINATION = req.user.coordination;
          }

          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Ligne ${i + 2}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const siteRetrait = item['SITE DE RETRAIT']?.toString().trim() || '';

          const existingCarte = await client.query(
            `SELECT * FROM cartes WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
            [nom, prenoms, siteRetrait]
          );

          if (existingCarte.rows.length > 0) {
            const carteExistante = existingCarte.rows[0];
            const updatedRecord = await this.smartUpdateCarte(client, carteExistante, item);

            if (updatedRecord) {
              updated++;

              await annulationService.enregistrerAction(
                req.user?.id,
                req.user?.nomUtilisateur,
                req.user?.nomComplet || req.user?.nomUtilisateur,
                req.user?.role,
                req.user?.agence || '',
                `Mise à jour via import smart sync (batch ${importBatchId})`,
                'UPDATE',
                'cartes',
                carteExistante.id,
                carteExistante,
                item,
                req.ip,
                importBatchId,
                carteExistante.coordination || req.user?.coordination
              );
            } else {
              duplicates++;
            }
          } else {
            const newId = await this.smartInsertCarte(
              client,
              item,
              importBatchId,
              req.user?.id,
              req.user?.coordination
            );
            imported++;

            await annulationService.enregistrerAction(
              req.user?.id,
              req.user?.nomUtilisateur,
              req.user?.nomComplet || req.user?.nomUtilisateur,
              req.user?.role,
              req.user?.agence || '',
              `Insertion via import smart sync (batch ${importBatchId})`,
              'INSERT',
              'cartes',
              newId,
              null,
              item,
              req.ip,
              importBatchId,
              item.COORDINATION || req.user?.coordination
            );
          }
        } catch (error) {
          errors++;
          errorDetails.push(`Ligne ${i + 2}: ${error.message}`);
        }

        if ((i + 1) % 1000 === 0) {
          const progress = Math.round(((i + 1) / csvData.length) * 100);
          console.log(`📊 Progression smart: ${progress}% (${i + 1}/${csvData.length})`);
        }
      }

      await client.query('COMMIT');

      const duration = Date.now() - startTime;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import Smart Sync terminé: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`,
        'IMPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { imported, updated, duplicates, errors, duration },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      console.log(`✅ Import Smart Sync terminé en ${duration}ms`);
      console.log(
        `📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} identiques, ${errors} erreurs`
      );

      res.json({
        success: true,
        message: 'Import Smart Sync terminé',
        stats: {
          totalRows: csvData.length,
          imported,
          updated,
          duplicates,
          errors,
          importBatchID: importBatchId,
        },
        performance: {
          duration_ms: duration,
          lines_per_second: Math.round(csvData.length / (duration / 1000)),
        },
        errors: errorDetails.slice(0, 10),
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
        message: error.message,
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
  // MÉTHODES UTILITAIRES
  // ============================================

  parseCSVStream(filePath) {
    return new Promise((resolve, reject) => {
      const results = [];
      let rowCount = 0;

      fs.createReadStream(filePath, { encoding: 'utf8' })
        .pipe(
          csv({
            separator: CONFIG.csvDelimiter,
            mapHeaders: ({ header }) => {
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
            skipLines: 0,
          })
        )
        .on('data', (data) => {
          results.push(data);
          rowCount++;

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

  async processCSVBatchOptimized(
    client,
    batch,
    startLine,
    importBatchID,
    userId,
    userRole,
    userCoordination
  ) {
    const result = {
      imported: 0,
      updated: 0,
      errors: 0,
      errorDetails: [],
    };

    for (let i = 0; i < batch.length; i++) {
      const data = batch[i];
      const lineNum = startLine + i;

      try {
        if (!data.COORDINATION && userCoordination && userRole === 'Gestionnaire') {
          data.COORDINATION = userCoordination;
        }

        if (!data.NOM || !data.PRENOMS) {
          result.errors++;
          result.errorDetails.push(`Ligne ${lineNum}: NOM et PRENOMS obligatoires`);
          continue;
        }

        const nom = data.NOM.toString().trim();
        const prenoms = data.PRENOMS.toString().trim();
        const siteRetrait = data['SITE DE RETRAIT']?.toString().trim() || '';

        const existing = await client.query(
          `SELECT id, coordination FROM cartes WHERE nom = $1 AND prenoms = $2 AND "SITE DE RETRAIT" = $3`,
          [nom, prenoms, siteRetrait]
        );

        const insertData = {
          "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
          'SITE DE RETRAIT': siteRetrait,
          RANGEMENT: this.sanitizeString(data['RANGEMENT']),
          NOM: nom,
          PRENOMS: prenoms,
          'DATE DE NAISSANCE': this.formatDate(data['DATE DE NAISSANCE']),
          'LIEU NAISSANCE': this.sanitizeString(data['LIEU NAISSANCE']),
          CONTACT: this.formatPhone(data['CONTACT']),
          DELIVRANCE: this.formatDelivrance(data['DELIVRANCE']),
          'CONTACT DE RETRAIT': this.formatPhone(data['CONTACT DE RETRAIT']),
          'DATE DE DELIVRANCE': this.formatDate(data['DATE DE DELIVRANCE']),
          COORDINATION: data.COORDINATION || userCoordination,
        };

        if (existing.rows.length > 0) {
          if (
            userRole === 'Gestionnaire' &&
            existing.rows[0].coordination &&
            existing.rows[0].coordination !== userCoordination
          ) {
            result.errors++;
            result.errorDetails.push(
              `Ligne ${lineNum}: Carte existante dans une autre coordination (${existing.rows[0].coordination})`
            );
            continue;
          }

          await client.query(
            `
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
          `,
            [
              insertData["LIEU D'ENROLEMENT"],
              insertData['RANGEMENT'],
              insertData['DATE DE NAISSANCE'],
              insertData['LIEU NAISSANCE'],
              insertData['CONTACT'],
              insertData['DELIVRANCE'],
              insertData['CONTACT DE RETRAIT'],
              insertData['DATE DE DELIVRANCE'],
              insertData['COORDINATION'],
              importBatchID,
              existing.rows[0].id,
            ]
          );

          result.updated++;
        } else {
          await client.query(
            `
            INSERT INTO cartes (
              "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
              "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
              "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, importbatchid, sourceimport
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
          `,
            [
              insertData["LIEU D'ENROLEMENT"],
              insertData['SITE DE RETRAIT'],
              insertData['RANGEMENT'],
              insertData['NOM'],
              insertData['PRENOMS'],
              insertData['DATE DE NAISSANCE'],
              insertData['LIEU NAISSANCE'],
              insertData['CONTACT'],
              insertData['DELIVRANCE'],
              insertData['CONTACT DE RETRAIT'],
              insertData['DATE DE DELIVRANCE'],
              insertData['COORDINATION'],
              importBatchID,
              'csv_import',
            ]
          );

          result.imported++;
        }
      } catch (error) {
        result.errors++;
        result.errorDetails.push(`Ligne ${lineNum}: ${error.message}`);
      }
    }

    return result;
  }

  async smartUpdateCarte(client, existingCarte, newData) {
    let updated = false;
    const updates = [];
    const params = [];
    let paramCount = 0;

    const columnsToCheck = [
      "LIEU D'ENROLEMENT",
      'RANGEMENT',
      'LIEU NAISSANCE',
      'CONTACT',
      'DELIVRANCE',
      'CONTACT DE RETRAIT',
      'DATE DE NAISSANCE',
      'DATE DE DELIVRANCE',
      'COORDINATION',
    ];

    for (const col of columnsToCheck) {
      const oldVal = existingCarte[col] || '';
      const newVal = newData[col] || '';

      if (newVal && newVal !== oldVal) {
        let shouldUpdate = true;

        if (col === 'CONTACT' || col === 'CONTACT DE RETRAIT') {
          if (oldVal.length > newVal.length) shouldUpdate = false;
        }

        if (
          col === 'DELIVRANCE' &&
          oldVal.toString().toUpperCase() === 'OUI' &&
          newVal.toString().toUpperCase() !== 'OUI'
        ) {
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

      await client.query(
        `
        UPDATE cartes 
        SET ${updates.join(', ')}
        WHERE id = $${paramCount}
      `,
        params
      );
    }

    return updated;
  }

  async smartInsertCarte(client, data, importBatchID, userId, userCoordination) {
    const insertData = {
      "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
      'SITE DE RETRAIT': this.sanitizeString(data['SITE DE RETRAIT']),
      RANGEMENT: this.sanitizeString(data['RANGEMENT']),
      NOM: this.sanitizeString(data['NOM']),
      PRENOMS: this.sanitizeString(data['PRENOMS']),
      'DATE DE NAISSANCE': this.formatDate(data['DATE DE NAISSANCE']),
      'LIEU NAISSANCE': this.sanitizeString(data['LIEU NAISSANCE']),
      CONTACT: this.formatPhone(data['CONTACT']),
      DELIVRANCE: this.formatDelivrance(data['DELIVRANCE']),
      'CONTACT DE RETRAIT': this.formatPhone(data['CONTACT DE RETRAIT']),
      'DATE DE DELIVRANCE': this.formatDate(data['DATE DE DELIVRANCE']),
      COORDINATION: data.COORDINATION || userCoordination,
    };

    const result = await client.query(
      `
      INSERT INTO cartes (
        "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, importbatchid, sourceimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING id
    `,
      [
        insertData["LIEU D'ENROLEMENT"],
        insertData['SITE DE RETRAIT'],
        insertData['RANGEMENT'],
        insertData['NOM'],
        insertData['PRENOMS'],
        insertData['DATE DE NAISSANCE'],
        insertData['LIEU NAISSANCE'],
        insertData['CONTACT'],
        insertData['DELIVRANCE'],
        insertData['CONTACT DE RETRAIT'],
        insertData['DATE DE DELIVRANCE'],
        insertData['COORDINATION'],
        importBatchID,
        'smart_import',
      ]
    );

    return result.rows[0].id;
  }

  sanitizeString(value) {
    if (!value) return '';
    return value.toString().trim().replace(/\s+/g, ' ');
  }

  formatDate(value) {
    if (!value) return null;

    try {
      let date;

      if (value instanceof Date) {
        date = value;
      } else if (typeof value === 'string') {
        if (value.includes('/')) {
          const parts = value.split('/');
          if (parts.length === 3) {
            date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
          }
        } else if (value.includes('-')) {
          date = new Date(value);
        } else if (!isNaN(parseInt(value))) {
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

  formatPhone(value) {
    if (!value) return '';

    const digits = value.toString().replace(/\D/g, '');

    if (digits.length === 10 && digits.startsWith('0')) {
      return digits;
    } else if (digits.length === 8) {
      return '0' + digits;
    } else if (digits.length === 12 && digits.startsWith('225')) {
      return '0' + digits.substring(3);
    }

    return digits.substring(0, 8);
  }

  formatDelivrance(value) {
    if (!value) return '';
    const upper = value.toString().trim().toUpperCase();
    if (upper === 'OUI' || upper === 'NON') {
      return upper;
    }
    return value.toString().trim();
  }

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

  async getSitesList(req, res) {
    try {
      let query =
        'SELECT DISTINCT "SITE DE RETRAIT" as site FROM cartes WHERE "SITE DE RETRAIT" IS NOT NULL';
      let params = [];

      const filtre = this.ajouterFiltreCoordination(req, query, params);

      const result = await db.query(filtre.query + ' ORDER BY site', filtre.params);

      const sites = result.rows.map((row) => row.site).filter((site) => site && site.trim() !== '');

      res.json({
        success: true,
        sites,
        count: sites.length,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      console.error('❌ Erreur récupération sites:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur récupération sites: ' + error.message,
      });
    }
  }

  async downloadTemplate(req, res) {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Template', {
        properties: { tabColor: { argb: 'FF2E75B5' } },
      });

      worksheet.columns = CONFIG.csvHeaders.map((header) => ({
        header,
        key: header.replace(/\s+/g, '_'),
        width: 25,
      }));

      const headerRow = worksheet.getRow(1);
      headerRow.height = 30;
      headerRow.eachCell((cell) => {
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FF2E75B5' },
        };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });

      const exampleData = {
        "LIEU D'ENROLEMENT": 'Abidjan Plateau',
        'SITE DE RETRAIT': 'Yopougon',
        RANGEMENT: 'A1-001',
        NOM: 'KOUAME',
        PRENOMS: 'Jean',
        'DATE DE NAISSANCE': '15/05/1990',
        'LIEU NAISSANCE': 'Abidjan',
        CONTACT: '01234567',
        DELIVRANCE: 'OUI',
        'CONTACT DE RETRAIT': '07654321',
        'DATE DE DELIVRANCE': '20/11/2024',
        COORDINATION: req.user?.coordination || 'Exemple',
      };

      const exampleRow = worksheet.addRow(exampleData);
      exampleRow.eachCell((cell) => {
        cell.fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFF2F2F2' },
        };
      });

      worksheet.addRow([]);
      const instructions = worksheet.addRow(['INSTRUCTIONS IMPORTANTES:']);
      instructions.getCell(1).font = { bold: true };

      worksheet.addRow(['- NOM et PRENOMS sont obligatoires']);
      worksheet.addRow(['- Formats date: JJ/MM/AAAA ou AAAA-MM-JJ']);
      worksheet.addRow(['- Téléphone: 8 chiffres (sera formaté automatiquement)']);
      worksheet.addRow(['- DELIVRANCE: OUI ou NON (vide si non délivrée)']);
      worksheet.addRow(['- COORDINATION: (optionnel) sera automatiquement attribuée si vide']);

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="template-import-cartes.xlsx"');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-User-Role', req.user?.role || 'unknown');

      await workbook.xlsx.write(res);
    } catch (error) {
      console.error('❌ Erreur génération template:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur génération template: ' + error.message,
      });
    }
  }

  async diagnostic(req, res) {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE 1=1';
      let countParams = [];

      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, countParams);
      const countResult = await db.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);

      const sitesResult = await db.query(
        'SELECT COUNT(DISTINCT "SITE DE RETRAIT") as sites FROM cartes'
      );
      const sitesCount = parseInt(sitesResult.rows[0].sites);

      const recentResult = await db.query(`
        SELECT COUNT(*) as recent 
        FROM cartes 
        WHERE dateimport > NOW() - INTERVAL '24 hours'
      `);
      const recentImports = parseInt(recentResult.rows[0].recent);

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
          role: req.user?.role,
          coordination: req.user?.coordination,
          nom: req.user?.nomUtilisateur,
        },
        data: {
          total_cartes_accessibles: totalRows,
          sites_actifs: sitesCount,
          imports_24h: recentImports,
          exports_en_cours: this.activeExports.size,
          imports_en_cours: this.activeImports.size,
          file_d_attente: this.exportQueue.length,
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
          maxConcurrent: CONFIG.maxConcurrent,
        },
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
          rss: Math.round(memoryUsage.rss / 1024 / 1024) + 'MB',
          external: Math.round(memoryUsage.external / 1024 / 1024) + 'MB',
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
          diagnostic: '/api/import-export/diagnostic',
        },
        recommendations: [
          totalRows > CONFIG.maxExportRowsRecommended
            ? `⚠️ Base volumineuse (${totalRows.toLocaleString()} lignes accessibles) - Utilisez CSV pour les exports`
            : `✅ Base optimale (${totalRows.toLocaleString()} lignes accessibles) - Excel ou CSV disponibles`,
          `📊 Export recommandé: ${totalRows > CONFIG.maxExportRowsRecommended ? 'CSV' : 'Excel'}`,
          `⚡ Vitesse max théorique: ${Math.round(CONFIG.chunkSize / 10)}K lignes/sec`,
          `💾 Mémoire disponible: ${Math.round(memoryUsage.heapTotal / 1024 / 1024)}MB/${CONFIG.memoryLimitMB}MB`,
        ],
      });
    } catch (error) {
      console.error('❌ Erreur diagnostic:', error);
      res.status(500).json({
        success: false,
        error: 'Erreur diagnostic: ' + error.message,
      });
    }
  }

  async getExportStatus(req, res) {
    res.json({
      success: true,
      activeExports: Array.from(this.activeExports.entries()).map(([id, data]) => ({
        id,
        type: data.type,
        startedAt: new Date(data.startTime).toISOString(),
        elapsed: Date.now() - data.startTime,
      })),
      activeImports: Array.from(this.activeImports.entries()).map(([id, data]) => ({
        id,
        file: data.file,
        startedAt: new Date(data.startTime).toISOString(),
        elapsed: Date.now() - data.startTime,
      })),
      queueLength: this.exportQueue.length,
    });
  }
}

// ============================================
// EXPORT
// ============================================
const controller = new OptimizedImportExportController();

module.exports = {
  importCSV: controller.importCSV.bind(controller),
  importExcel: controller.importCSV.bind(controller),
  importSmartSync: controller.importSmartSync.bind(controller),
  exportExcel: controller.exportExcel.bind(controller),
  exportCSV: controller.exportCSV.bind(controller),
  exportCompleteExcel: controller.exportCompleteExcel.bind(controller),
  exportCompleteCSV: controller.exportCompleteCSV.bind(controller),
  exportAllData: controller.exportAllData.bind(controller),
  exportCSVBySite: controller.exportCSVBySite.bind(controller),
  exportFiltered: controller.exportCSVBySite.bind(controller),
  exportResultats: controller.exportCSVBySite.bind(controller),
  exportStream: controller.exportCompleteCSV.bind(controller),
  exportOptimized: controller.exportCompleteCSV.bind(controller),
  getSitesList: controller.getSitesList.bind(controller),
  downloadTemplate: controller.downloadTemplate.bind(controller),
  diagnostic: controller.diagnostic.bind(controller),
  getExportStatus: controller.getExportStatus.bind(controller),
  CONFIG,
  _controller: controller,
};
