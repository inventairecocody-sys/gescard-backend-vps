const db = require('../db/db');
const ExcelJS = require('exceljs');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const csv = require('csv-parser');
const annulationService = require('../Services/annulationService'); // ✅ CORRIGÉ: était '../db/db'

const CONFIG = {
  supportedFormats: ['.csv', '.xlsx', '.xls'],
  csvDelimiter: ';',
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
  requiredHeaders: ['NOM', 'PRENOMS'],
  isLWS: true,
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

  verifierDroitsImportExport(req) {
    const role = req.user?.role;
    if (role === 'Administrateur' || role === 'Gestionnaire') return { autorise: true };
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
    if (!droits.autorise) return res.status(403).json({ success: false, error: droits.message });

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

      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, []);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      console.log(`📊 ${totalRows} cartes accessibles, export limité à ${limit}`);

      let dataQuery = 'SELECT * FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreData = this.ajouterFiltreCoordination(req, dataQuery, []);
      const finalQuery = filtreData.query + ' ORDER BY id LIMIT $' + (filtreData.params.length + 1);
      const result = await client.query(finalQuery, [...filtreData.params, limit]);
      const rows = result.rows;

      if (rows.length === 0)
        return res.status(404).json({ success: false, error: 'Aucune donnée à exporter' });

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
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12, name: 'Calibri' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B5' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
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
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
          });
        }
        if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
          const delivranceCell = excelRow.getCell('delivrance');
          if (delivranceCell) delivranceCell.font = { bold: true, color: { argb: 'FF00B050' } };
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
      res.setHeader('X-Export-Limit', limit.toString());
      res.setHeader('X-Total-Rows', rows.length);
      res.setHeader('X-Export-ID', exportId);
      if (req.user?.coordination) res.setHeader('X-User-Coordination', req.user.coordination);

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
      if (!res.headersSent)
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export Excel",
          message: error.message,
          exportId,
        });
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
    if (!droits.autorise) return res.status(403).json({ success: false, error: droits.message });

    const exportId = `csv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    const isTest = req.query.test === 'true' || req.query.limit === '5';
    const limit = isTest ? 5 : 5000;
    let client;

    try {
      client = await db.getClient();
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, []);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      console.log(`📊 ${totalRows} cartes accessibles, export CSV limité à ${limit}`);

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-cartes-limite-${timestamp}-${time}.csv`;

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Export-ID', exportId);
      if (req.user?.coordination) res.setHeader('X-User-Coordination', req.user.coordination);
      res.write('\uFEFF');
      res.write(CONFIG.csvHeaders.map((h) => `"${h}"`).join(CONFIG.csvDelimiter) + '\n');

      let offset = 0;
      let totalWritten = 0;
      for (let page = 0; page < Math.ceil(limit / CONFIG.chunkSize); page++) {
        const currentLimit = Math.min(CONFIG.chunkSize, limit - offset);
        if (currentLimit <= 0) break;
        let dataQuery = 'SELECT * FROM cartes WHERE deleted_at IS NULL AND 1=1';
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, []);
        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);
        const result = await client.query(finalQuery, [...filtreData.params, currentLimit, offset]);
        if (result.rows.length === 0) break;
        let batchCSV = '';
        for (const row of result.rows) {
          const csvRow = CONFIG.csvHeaders
            .map((header) => {
              let value = row[header] || '';
              if (typeof value === 'string') {
                value = value.replace(/"/g, '""');
                if (
                  value.includes(CONFIG.csvDelimiter) ||
                  value.includes('"') ||
                  value.includes('\n')
                )
                  value = `"${value}"`;
              } else if (value instanceof Date) value = value.toISOString().split('T')[0];
              return value;
            })
            .join(CONFIG.csvDelimiter);
          batchCSV += csvRow + '\n';
          totalWritten++;
        }
        res.write(batchCSV);
        offset += result.rows.length;
        if (result.rows.length < currentLimit) break;
      }
      res.end();
      console.log(
        `✅ Export CSV limité réussi: ${totalWritten} lignes en ${Date.now() - startTime}ms`
      );
    } catch (error) {
      console.error(`❌ Erreur export CSV:`, error);
      if (!res.headersSent)
        res
          .status(500)
          .json({ success: false, error: "Erreur lors de l'export CSV", message: error.message });
      else {
        try {
          res.end();
        } catch (e) {
          /* ignorer */
        }
      }
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
    if (!droits.autorise) return res.status(403).json({ success: false, error: droits.message });

    const exportId = `excel_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    if (this.activeExports.size >= CONFIG.maxConcurrent)
      return res.status(429).json({ success: false, error: "Trop d'exports en cours" });
    this.activeExports.set(exportId, { startTime, type: 'excel_complete' });
    let client;

    try {
      client = await db.getClient();
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, []);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      console.log(`📊 TOTAL DES DONNÉES ACCESSIBLES: ${totalRows} cartes`);
      if (totalRows === 0) {
        this.activeExports.delete(exportId);
        return res.status(404).json({ success: false, error: 'Aucune donnée à exporter' });
      }

      const sampleResult = await client.query(
        'SELECT * FROM cartes WHERE deleted_at IS NULL LIMIT 1'
      );
      const firstRow = sampleResult.rows[0] || {};
      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at', 'id'];
      const headers = Object.keys(firstRow).filter(
        (key) => !excludedColumns.includes(key.toLowerCase())
      );

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.xlsx`;

      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.setHeader('X-Export-ID', exportId);

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
        cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12, name: 'Calibri' };
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B5' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        cell.border = {
          top: { style: 'thin' },
          left: { style: 'thin' },
          bottom: { style: 'thin' },
          right: { style: 'thin' },
        };
      });

      let offset = 0,
        totalWritten = 0,
        rowOffset = 0,
        lastProgressLog = Date.now();
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE deleted_at IS NULL AND 1=1';
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, []);
        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);
        const result = await client.query(finalQuery, [...filtreData.params, 2000, offset]);
        if (result.rows.length === 0) {
          hasMoreData = false;
          break;
        }
        for (let i = 0; i < result.rows.length; i++) {
          const row = result.rows[i];
          const rowData = {};
          headers.forEach((header) => {
            let value = row[header];
            if (value instanceof Date) value = value.toLocaleDateString('fr-FR');
            rowData[header] = value || '';
          });
          const excelRow = worksheet.addRow(rowData);
          if ((rowOffset + i) % 2 === 0) {
            excelRow.eachCell((cell) => {
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
            });
          }
          if (row.delivrance && row.delivrance.toString().toUpperCase() === 'OUI') {
            const c = excelRow.getCell('delivrance');
            if (c) c.font = { bold: true, color: { argb: 'FF00B050' } };
          }
        }
        totalWritten += result.rows.length;
        offset += result.rows.length;
        rowOffset += result.rows.length;
        if (Date.now() - lastProgressLog > 5000) {
          console.log(`📊 Excel: ${totalWritten}/${totalRows} lignes`);
          lastProgressLog = Date.now();
        }
      }

      worksheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: headers.length },
      };
      await workbook.xlsx.write(res);
      console.log(
        `🎉 Export Excel COMPLET réussi: ${totalWritten} lignes en ${(Date.now() - startTime) / 1000}s`
      );
    } catch (error) {
      console.error(`❌ ERREUR export Excel complet:`, error);
      if (!res.headersSent)
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export Excel complet",
          message: error.message,
        });
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
    if (!droits.autorise) return res.status(403).json({ success: false, error: droits.message });

    const exportId = `csv_complete_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();
    if (this.activeExports.size >= CONFIG.maxConcurrent)
      return res.status(429).json({ success: false, error: "Trop d'exports en cours" });
    this.activeExports.set(exportId, { startTime, type: 'csv_complete' });
    let client;

    try {
      client = await db.getClient();
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, []);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      if (totalRows === 0) {
        this.activeExports.delete(exportId);
        return res.status(404).json({ success: false, error: 'Aucune donnée à exporter' });
      }

      const timestamp = new Date().toISOString().split('T')[0];
      const time = new Date().toTimeString().split(' ')[0].replace(/:/g, '-');
      const filename = `export-complet-cartes-${timestamp}-${time}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('X-Export-Complete', 'true');
      res.setHeader('X-Total-Rows', totalRows);
      res.write('\uFEFF');

      const sampleResult = await client.query(
        'SELECT * FROM cartes WHERE deleted_at IS NULL LIMIT 1'
      );
      const firstRow = sampleResult.rows[0] || {};
      const excludedColumns = ['importbatchid', 'dateimport', 'created_at', 'updated_at'];
      const headers = Object.keys(firstRow).filter(
        (key) => !excludedColumns.includes(key.toLowerCase())
      );
      res.write(
        headers
          .map((h) => `"${h.replace(/"/g, '""').replace(/_/g, ' ').toUpperCase()}"`)
          .join(CONFIG.csvDelimiter) + '\n'
      );

      let offset = 0,
        totalWritten = 0,
        lastProgressLog = Date.now();
      let hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE deleted_at IS NULL AND 1=1';
        const filtreData = this.ajouterFiltreCoordination(req, dataQuery, []);
        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);
        const result = await client.query(finalQuery, [
          ...filtreData.params,
          CONFIG.chunkSize,
          offset,
        ]);
        if (result.rows.length === 0) {
          hasMoreData = false;
          break;
        }
        let batchCSV = '';
        for (const row of result.rows) {
          const csvRow = headers
            .map((header) => {
              let value = row[header];
              if (value === null || value === undefined) return '';
              let s = value instanceof Date ? value.toLocaleDateString('fr-FR') : String(value);
              if (s.includes(CONFIG.csvDelimiter) || s.includes('"') || s.includes('\n'))
                s = `"${s.replace(/"/g, '""')}"`;
              return s;
            })
            .join(CONFIG.csvDelimiter);
          batchCSV += csvRow + '\n';
          totalWritten++;
        }
        res.write(batchCSV);
        offset += result.rows.length;
        if (Date.now() - lastProgressLog > 5000) {
          console.log(`📊 CSV: ${totalWritten}/${totalRows} lignes`);
          lastProgressLog = Date.now();
          if (res.flush) res.flush();
        }
      }
      res.end();
      console.log(
        `🎉 Export CSV COMPLET réussi: ${totalWritten} lignes en ${(Date.now() - startTime) / 1000}s`
      );
    } catch (error) {
      console.error(`❌ ERREUR export CSV complet:`, error);
      if (!res.headersSent)
        res.status(500).json({
          success: false,
          error: "Erreur lors de l'export CSV complet",
          message: error.message,
        });
      else {
        try {
          res.end();
        } catch (e) {
          /* ignorer */
        }
      }
    } finally {
      if (client?.release) client.release();
      this.activeExports.delete(exportId);
    }
  }

  async exportAllData(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) return res.status(403).json({ success: false, error: droits.message });
    let client;
    try {
      client = await db.getClient();
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, []);
      const countResult = await client.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      const chosenFormat = totalRows > CONFIG.maxExportRowsRecommended ? 'csv' : 'excel';
      if (client?.release) client.release();
      if (chosenFormat === 'excel') await this.exportCompleteExcel(req, res);
      else await this.exportCompleteCSV(req, res);
    } catch (error) {
      console.error('❌ Erreur export tout en un:', error);
      if (!res.headersSent)
        res.status(500).json({
          success: false,
          error: "Erreur lors du choix de la méthode d'export",
          message: error.message,
        });
    }
  }

  async exportCSVBySite(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) return res.status(403).json({ success: false, error: droits.message });
    const { siteRetrait } = req.query;
    if (!siteRetrait)
      return res.status(400).json({ success: false, error: 'Paramètre siteRetrait requis' });
    const decodedSite = decodeURIComponent(siteRetrait).replace(/\+/g, ' ').trim();
    let client;
    try {
      client = await db.getClient();
      let countQuery = 'SELECT COUNT(*) as count FROM cartes WHERE "SITE DE RETRAIT" = $1';
      const filtreCount = this.ajouterFiltreCoordination(
        req,
        countQuery,
        [decodedSite],
        'coordination'
      );
      const siteCheck = await client.query(filtreCount.query, filtreCount.params);
      const count = parseInt(siteCheck.rows[0].count);
      if (count === 0)
        return res
          .status(404)
          .json({ success: false, error: `Aucune donnée pour le site: ${decodedSite}` });

      const safeSiteName = decodedSite.replace(/[^a-z0-9]/gi, '-').toLowerCase();
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `export-${safeSiteName}-${timestamp}.csv`;
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.write('\uFEFF');
      res.write(CONFIG.csvHeaders.map((h) => `"${h}"`).join(CONFIG.csvDelimiter) + '\n');

      let offset = 0,
        totalWritten = 0,
        hasMoreData = true;
      for (let page = 0; hasMoreData; page++) {
        let dataQuery = 'SELECT * FROM cartes WHERE "SITE DE RETRAIT" = $1';
        const filtreData = this.ajouterFiltreCoordination(
          req,
          dataQuery,
          [decodedSite],
          'coordination'
        );
        const finalQuery =
          filtreData.query +
          ' ORDER BY id LIMIT $' +
          (filtreData.params.length + 1) +
          ' OFFSET $' +
          (filtreData.params.length + 2);
        const result = await client.query(finalQuery, [
          ...filtreData.params,
          CONFIG.chunkSize,
          offset,
        ]);
        if (result.rows.length === 0) {
          hasMoreData = false;
          break;
        }
        let batchCSV = '';
        for (const row of result.rows) {
          const csvRow = CONFIG.csvHeaders
            .map((header) => {
              let value = row[header] || '';
              if (typeof value === 'string') {
                value = value.replace(/"/g, '""');
                if (
                  value.includes(CONFIG.csvDelimiter) ||
                  value.includes('"') ||
                  value.includes('\n')
                )
                  value = `"${value}"`;
              } else if (value instanceof Date) value = value.toLocaleDateString('fr-FR');
              return value;
            })
            .join(CONFIG.csvDelimiter);
          batchCSV += csvRow + '\n';
          totalWritten++;
        }
        res.write(batchCSV);
        offset += result.rows.length;
      }
      res.end();
      console.log(`✅ Export CSV site terminé: ${decodedSite} - ${totalWritten} lignes`);
    } catch (error) {
      console.error('❌ Erreur export CSV site:', error);
      if (!res.headersSent)
        res.status(500).json({ success: false, error: 'Erreur export CSV site: ' + error.message });
    } finally {
      if (client?.release) client.release();
    }
  }

  // ============================================
  // IMPORT CSV / EXCEL
  // ============================================
  async importCSV(req, res) {
    const droits = this.verifierDroitsImportExport(req);
    if (!droits.autorise) {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          /* ignorer */
        }
      }
      return res.status(403).json({ success: false, error: droits.message });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'Aucun fichier uploadé' });

    const importId = `import_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const importBatchId = uuidv4();
    const startTime = Date.now();
    console.log(
      `📥 Import CSV: ${req.file.originalname} (ID: ${importId}) par ${req.user?.nomUtilisateur} (${req.user?.role})`
    );

    if (this.activeImports.size >= 2) {
      fs.unlinkSync(req.file.path);
      return res.status(429).json({ success: false, error: "Trop d'imports en cours" });
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
      if (fileSizeMB > 100)
        throw new Error(`Fichier trop volumineux: ${Math.round(fileSizeMB)}MB (max 100MB)`);

      const csvData = await this.parseFile(req.file.path, req.file.originalname);
      if (csvData.length === 0) throw new Error('Le fichier CSV est vide');

      const headersDetected = Object.keys(csvData[0]);
      console.log(`📋 En-têtes détectés: ${headersDetected.join(' | ')}`);

      const HEADER_ALIASES = {
        NOM: ['NOM', 'NAME', 'LASTNAME', 'LAST NAME', 'FAMILLE'],
        PRENOMS: ['PRENOMS', 'PRENOM', 'FIRSTNAME', 'FIRST NAME', 'PRÉNOMS', 'PRÉNOM'],
        'SITE DE RETRAIT': ['SITE DE RETRAIT', 'SITE', 'SITERETRAIT', 'SITE_RETRAIT'],
        "LIEU D'ENROLEMENT": [
          "LIEU D'ENROLEMENT",
          'LIEU DENROLEMENT',
          'LIEU ENROLEMENT',
          'LIEU D ENROLEMENT',
          'LIEUDANROLEMENT',
          'ENROLEMENT',
        ],
        RANGEMENT: ['RANGEMENT', 'RANGE', 'CASIER'],
        'DATE DE NAISSANCE': [
          'DATE DE NAISSANCE',
          'DATENAISSANCE',
          'DATE_NAISSANCE',
          'DDN',
          'NAISSANCE',
        ],
        'LIEU NAISSANCE': [
          'LIEU NAISSANCE',
          'LIEUNAISSANCE',
          'LIEU_NAISSANCE',
          'LIEU DE NAISSANCE',
        ],
        CONTACT: ['CONTACT', 'TELEPHONE', 'TEL', 'PHONE', 'MOBILE'],
        DELIVRANCE: ['DELIVRANCE', 'DÉLIVRANCE', 'RETIRE', 'RETIRÉ', 'LIVRÉ', 'LIVRE'],
        'CONTACT DE RETRAIT': [
          'CONTACT DE RETRAIT',
          'CONTACTRETRAIT',
          'CONTACT_RETRAIT',
          'TEL RETRAIT',
        ],
        'DATE DE DELIVRANCE': [
          'DATE DE DELIVRANCE',
          'DATE DELIVRANCE',
          'DATEDELIVRANCE',
          'DATE_DELIVRANCE',
          'DATE RETRAIT',
        ],
        COORDINATION: ['COORDINATION', 'COORD', 'ZONE'],
      };

      const normaliserLigne = (row) => {
        const normalised = { ...row };
        for (const [standard, aliases] of Object.entries(HEADER_ALIASES)) {
          if (normalised[standard] !== undefined) continue;
          for (const alias of aliases) {
            if (row[alias] !== undefined) {
              normalised[standard] = row[alias];
              break;
            }
          }
        }
        return normalised;
      };

      const csvDataNormalisee = csvData.map(normaliserLigne);
      const firstRowNorm = csvDataNormalisee[0];
      const missingHeaders = CONFIG.requiredHeaders.filter(
        (h) => !Object.keys(firstRowNorm).some((key) => key.toUpperCase() === h)
      );
      if (missingHeaders.length > 0)
        throw new Error(
          `En-têtes requis manquants: ${missingHeaders.join(', ')}. En-têtes détectés: ${headersDetected.join(', ')}`
        );

      let imported = 0,
        updated = 0,
        duplicates = 0,
        errors = 0;
      const errorDetails = [];
      let processedRows = 0;

      for (let i = 0; i < csvDataNormalisee.length; i += CONFIG.batchSize) {
        const batch = csvDataNormalisee.slice(i, i + CONFIG.batchSize);
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
        duplicates += batchResult.duplicates || 0;
        errors += batchResult.errors;
        processedRows += batch.length;
        if (batchResult.errors > 0) errorDetails.push(...batchResult.errorDetails.slice(0, 10));
        const elapsed = (Date.now() - startTime) / 1000;
        console.log(
          `📈 Progression: ${Math.round((processedRows / csvDataNormalisee.length) * 100)}% (${processedRows}/${csvDataNormalisee.length}) - ${Math.round(processedRows / elapsed)} lignes/sec`
        );
      }

      await client.query('COMMIT');
      const duration = Date.now() - startTime;
      const speed =
        csvDataNormalisee.length > 0 ? Math.round(csvDataNormalisee.length / (duration / 1000)) : 0;

      await annulationService.enregistrerAction(
        req.user?.id,
        req.user?.nomUtilisateur,
        req.user?.nomComplet || req.user?.nomUtilisateur,
        req.user?.role,
        req.user?.agence || '',
        `Import terminé: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} doublons bloqués, ${errors} erreurs en ${duration}ms`,
        'IMPORT_COMPLETE',
        'Cartes',
        null,
        null,
        { imported, updated, duplicates, errors, duration, speed },
        req.ip,
        importBatchId,
        req.user?.coordination
      );

      console.log(`✅ Import terminé en ${duration}ms (${speed} lignes/sec)`);
      console.log(
        `📊 Résultats: ${imported} nouvelles, ${updated} mises à jour, ${duplicates} doublons bloqués, ${errors} erreurs`
      );

      res.json({
        success: true,
        message: 'Import terminé avec succès',
        stats: {
          totalRows: csvDataNormalisee.length,
          imported,
          updated,
          duplicates,
          errors,
          importBatchID: importBatchId,
        },
        performance: {
          duration_ms: duration,
          lines_per_second: speed,
          file_size_mb: Math.round(fileSizeMB * 10) / 10,
        },
        errors: errorDetails.slice(0, 20),
      });
    } catch (error) {
      console.error('❌ Erreur import CSV:', error);
      try {
        await client.query('ROLLBACK');
      } catch (e) {
        /* ignorer */
      }
      res
        .status(500)
        .json({ success: false, error: 'Erreur import CSV', message: error.message, importId });
    } finally {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          /* ignorer */
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
          /* ignorer */
        }
      }
      return res.status(403).json({ success: false, error: droits.message });
    }
    if (!req.file) return res.status(400).json({ success: false, error: 'Aucun fichier uploadé' });

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

      const csvDataRaw = await this.parseFile(req.file.path, req.file.originalname);
      const HEADER_ALIASES_SMART = {
        NOM: ['NOM', 'NAME', 'LASTNAME', 'LAST NAME', 'FAMILLE'],
        PRENOMS: ['PRENOMS', 'PRENOM', 'FIRSTNAME', 'FIRST NAME', 'PRÉNOMS', 'PRÉNOM'],
        'SITE DE RETRAIT': ['SITE DE RETRAIT', 'SITE', 'SITERETRAIT', 'SITE_RETRAIT'],
        "LIEU D'ENROLEMENT": [
          "LIEU D'ENROLEMENT",
          'LIEU DENROLEMENT',
          'LIEU ENROLEMENT',
          'LIEU D ENROLEMENT',
          'ENROLEMENT',
        ],
        RANGEMENT: ['RANGEMENT', 'RANGE', 'CASIER'],
        'DATE DE NAISSANCE': [
          'DATE DE NAISSANCE',
          'DATENAISSANCE',
          'DATE_NAISSANCE',
          'DDN',
          'NAISSANCE',
        ],
        'LIEU NAISSANCE': [
          'LIEU NAISSANCE',
          'LIEUNAISSANCE',
          'LIEU_NAISSANCE',
          'LIEU DE NAISSANCE',
        ],
        CONTACT: ['CONTACT', 'TELEPHONE', 'TEL', 'PHONE', 'MOBILE'],
        DELIVRANCE: ['DELIVRANCE', 'DÉLIVRANCE', 'RETIRE', 'RETIRÉ', 'LIVRÉ', 'LIVRE'],
        'CONTACT DE RETRAIT': [
          'CONTACT DE RETRAIT',
          'CONTACTRETRAIT',
          'CONTACT_RETRAIT',
          'TEL RETRAIT',
        ],
        'DATE DE DELIVRANCE': [
          'DATE DE DELIVRANCE',
          'DATE DELIVRANCE',
          'DATEDELIVRANCE',
          'DATE_DELIVRANCE',
          'DATE RETRAIT',
        ],
        COORDINATION: ['COORDINATION', 'COORD', 'ZONE'],
      };

      const csvData = csvDataRaw.map((row) => {
        const normalised = { ...row };
        for (const [standard, aliases] of Object.entries(HEADER_ALIASES_SMART)) {
          if (normalised[standard] !== undefined) continue;
          for (const alias of aliases) {
            if (row[alias] !== undefined) {
              normalised[standard] = row[alias];
              break;
            }
          }
        }
        return normalised;
      });

      console.log(`📋 ${csvData.length} lignes à traiter avec fusion intelligente`);
      let imported = 0,
        updated = 0,
        duplicates = 0,
        errors = 0;
      const errorDetails = [];

      for (let i = 0; i < csvData.length; i++) {
        try {
          const item = csvData[i];
          if (!item.COORDINATION && req.user?.coordination && req.user?.role === 'Gestionnaire')
            item.COORDINATION = req.user.coordination;
          if (!item.NOM || !item.PRENOMS) {
            errors++;
            errorDetails.push(`Ligne ${i + 2}: NOM et PRENOMS obligatoires`);
            continue;
          }

          const nom = item.NOM.toString().trim();
          const prenoms = item.PRENOMS.toString().trim();
          const dateNaissance = this.formatDate(item['DATE DE NAISSANCE']);
          const lieuNaissance = this.sanitizeString(item['LIEU NAISSANCE']);

          const contactNorm = this.formatPhone(item['CONTACT']) || '';
          const existingCarte = await client.query(
            `SELECT * FROM cartes
             WHERE LOWER(TRIM(nom))                  = LOWER($1)
               AND LOWER(TRIM(prenoms))              = LOWER($2)
               AND "DATE DE NAISSANCE"               = $3
               AND LOWER(TRIM("LIEU NAISSANCE"))     = LOWER($4)
               AND COALESCE(NULLIF(contact,''),'__VIDE__') = COALESCE(NULLIF($5,''),'__VIDE__')
               AND deleted_at IS NULL`,
            [nom, prenoms, dateNaissance, lieuNaissance, contactNorm]
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
        if ((i + 1) % 1000 === 0)
          console.log(
            `📊 Progression smart: ${Math.round(((i + 1) / csvData.length) * 100)}% (${i + 1}/${csvData.length})`
          );
      }

      await client.query('COMMIT');
      const duration = Date.now() - startTime;
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
      } catch (e) {
        /* ignorer */
      }
      res
        .status(500)
        .json({ success: false, error: 'Erreur import smart sync', message: error.message });
    } finally {
      if (req.file?.path) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (e) {
          /* ignorer */
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
            mapHeaders: ({ header }) =>
              header
                .trim()
                .toUpperCase()
                .replace(/[^\w\s'-]/g, '')
                .replace(/\s+/g, ' '),
            mapValues: ({ value }) => (value ? value.toString().trim() : ''),
            skipLines: 0,
          })
        )
        .on('data', (data) => {
          results.push(data);
          rowCount++;
          if (rowCount % 10000 === 0) console.log(`📖 CSV parsing: ${rowCount} lignes lues`);
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

  async parseExcelFile(filePath) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new Error('Le fichier Excel ne contient aucune feuille');
    const getCellValue = (cell) => {
      if (cell === null || cell === undefined) return '';
      if (typeof cell === 'object') {
        if (cell.text !== undefined) return String(cell.text).trim();
        if (cell.result !== undefined) return String(cell.result).trim();
        if (cell.value !== undefined) return getCellValue(cell.value);
      }
      return String(cell).trim();
    };
    const results = [];
    let headers = [],
      headerRowFound = false;
    worksheet.eachRow({ includeEmpty: false }, (row) => {
      const rawValues = [];
      row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
        rawValues[colNumber - 1] = getCellValue(cell.value);
      });
      if (!headerRowFound) {
        headers = rawValues.map((h) =>
          String(h || '')
            .trim()
            .toUpperCase()
            .replace(/[^\w\s'-]/g, '')
            .replace(/\s+/g, ' ')
        );
        headerRowFound = true;
      } else {
        const obj = {};
        headers.forEach((header, i) => {
          if (header) obj[header] = rawValues[i] || '';
        });
        if (Object.values(obj).some((v) => v !== '')) results.push(obj);
      }
    });
    console.log(`✅ Excel parsing terminé: ${results.length} lignes`);
    return results;
  }

  async parseFile(filePath, originalName) {
    const ext = (originalName || filePath).toLowerCase().split('.').pop();
    if (ext === 'xlsx' || ext === 'xls') {
      console.log(`📊 Format détecté: Excel (${ext})`);
      return this.parseExcelFile(filePath);
    }
    console.log(`📊 Format détecté: CSV`);
    return this.parseCSVStream(filePath);
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
    const result = { imported: 0, updated: 0, duplicates: 0, errors: 0, errorDetails: [] };

    const insertValues = [];
    const insertParams = [];
    let paramIndex = 0;

    for (let i = 0; i < batch.length; i++) {
      const data = batch[i];
      const lineNum = startLine + i;
      let nom = '',
        prenoms = '';

      try {
        if (!data.COORDINATION && userCoordination && userRole === 'Gestionnaire')
          data.COORDINATION = userCoordination;
        if (!data.NOM || !data.PRENOMS) {
          result.errors++;
          result.errorDetails.push(`Ligne ${lineNum}: NOM et PRENOMS obligatoires`);
          continue;
        }

        nom = data.NOM.toString().trim();
        prenoms = data.PRENOMS.toString().trim();
        const siteRetrait = data['SITE DE RETRAIT']?.toString().trim() || '';
        const dateNaissanceRaw = this.formatDate(data['DATE DE NAISSANCE']);
        const lieuNaissanceRaw = this.sanitizeString(data['LIEU NAISSANCE']);
        const rangementRaw = this.sanitizeString(data['RANGEMENT']);

        const contactRaw = this.formatPhone(data['CONTACT']) || '';
        const existing = await client.query(
          `SELECT id, coordination, "SITE DE RETRAIT" as site FROM cartes
           WHERE LOWER(TRIM(nom))                    = LOWER($1)
             AND LOWER(TRIM(prenoms))                = LOWER($2)
             AND "DATE DE NAISSANCE"                 = $3
             AND LOWER(TRIM("LIEU NAISSANCE"))       = LOWER($4)
             AND COALESCE(NULLIF(contact,''),'__VIDE__') = COALESCE(NULLIF($5,''),'__VIDE__')
             AND deleted_at IS NULL`,
          [nom, prenoms, dateNaissanceRaw, lieuNaissanceRaw, contactRaw]
        );

        const insertData = {
          "LIEU D'ENROLEMENT": this.sanitizeString(data["LIEU D'ENROLEMENT"]),
          'SITE DE RETRAIT': siteRetrait,
          RANGEMENT: rangementRaw,
          NOM: nom,
          PRENOMS: prenoms,
          'DATE DE NAISSANCE': dateNaissanceRaw,
          'LIEU NAISSANCE': lieuNaissanceRaw,
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
            result.duplicates++;
            result.errorDetails.push(
              `⛔ Ligne ${lineNum} [DOUBLON BLOQUÉ] "${nom} ${prenoms}" existe déjà dans la coordination "${existing.rows[0].coordination}" — modification non autorisée`
            );
            continue;
          }

          await client.query(
            `UPDATE cartes SET
              "LIEU D'ENROLEMENT" = $1, rangement = $2, "DATE DE NAISSANCE" = $3,
              "LIEU NAISSANCE" = $4, contact = $5, delivrance = $6,
              "CONTACT DE RETRAIT" = $7, "DATE DE DELIVRANCE" = $8,
              coordination = $9, dateimport = NOW()
             WHERE id = $10`,
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
              existing.rows[0].id,
            ]
          );
          result.updated++;
        } else {
          const p = paramIndex;
          insertValues.push(
            `($${p + 1},$${p + 2},$${p + 3},$${p + 4},$${p + 5},$${p + 6},$${p + 7},$${p + 8},$${p + 9},$${p + 10},$${p + 11},$${p + 12},NOW())`
          );
          insertParams.push(
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
            insertData['COORDINATION']
          );
          paramIndex += 12;
          result.imported++;
        }
      } catch (error) {
        result.errors++;
        let messageErreur = error.message;
        if (error.message.includes("n'existe pas")) {
          const match = error.message.match(/«\s*(.+?)\s*»/);
          messageErreur = `Colonne inconnue: "${match ? match[1] : '?'}"`;
        } else if (error.message.includes('duplicate key') || error.message.includes('unique'))
          messageErreur = `Doublon détecté`;
        result.errorDetails.push(
          `❌ Ligne ${lineNum} [${nom || '?'} ${prenoms || '?'}]: ${messageErreur}`
        );
        if (result.errors <= 3)
          console.error(`❌ Erreur import ligne ${lineNum} (${nom} ${prenoms}):`, error.message);
      }
    }

    if (insertValues.length > 0) {
      const query = `
        INSERT INTO cartes (
          "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
          "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
          "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, dateimport
        ) VALUES ${insertValues.join(', ')}
        ON CONFLICT (nom, prenoms, "DATE DE NAISSANCE", "LIEU NAISSANCE", COALESCE(NULLIF(contact,''),'__VIDE__'))
        WHERE deleted_at IS NULL
        DO UPDATE SET
          delivrance             = COALESCE(NULLIF(cartes.delivrance, ''),           EXCLUDED.delivrance),
          "CONTACT DE RETRAIT"   = COALESCE(NULLIF(cartes."CONTACT DE RETRAIT", ''), EXCLUDED."CONTACT DE RETRAIT"),
          "DATE DE DELIVRANCE"   = COALESCE(cartes."DATE DE DELIVRANCE",             EXCLUDED."DATE DE DELIVRANCE"),
          contact                = COALESCE(NULLIF(cartes.contact, ''),              EXCLUDED.contact),
          dateimport             = NOW()
      `;
      await client.query(query, insertParams);
    }

    return result;
  }

  async smartUpdateCarte(client, existingCarte, newData) {
    let updated = false;
    const updates = [],
      params = [];
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
        )
          shouldUpdate = false;
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
        `UPDATE cartes SET ${updates.join(', ')} WHERE id = $${paramCount}`,
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
      `INSERT INTO cartes (
        "LIEU D'ENROLEMENT", "SITE DE RETRAIT", rangement, nom, prenoms,
        "DATE DE NAISSANCE", "LIEU NAISSANCE", contact, delivrance,
        "CONTACT DE RETRAIT", "DATE DE DELIVRANCE", coordination, dateimport
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW())
      ON CONFLICT (nom, prenoms, "DATE DE NAISSANCE", "LIEU NAISSANCE", COALESCE(NULLIF(contact,''),'__VIDE__'))
      WHERE deleted_at IS NULL
      DO UPDATE SET
        delivrance           = COALESCE(NULLIF(cartes.delivrance, ''),           EXCLUDED.delivrance),
        "CONTACT DE RETRAIT" = COALESCE(NULLIF(cartes."CONTACT DE RETRAIT", ''), EXCLUDED."CONTACT DE RETRAIT"),
        "DATE DE DELIVRANCE" = COALESCE(cartes."DATE DE DELIVRANCE",             EXCLUDED."DATE DE DELIVRANCE"),
        contact              = COALESCE(NULLIF(cartes.contact, ''),              EXCLUDED.contact),
        dateimport           = NOW()
      RETURNING id`,
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
      if (value instanceof Date) date = value;
      else if (typeof value === 'string') {
        if (value.includes('/')) {
          const parts = value.split('/');
          if (parts.length === 3) date = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
        } else if (value.includes('-')) date = new Date(value);
        else if (!isNaN(parseInt(value))) date = new Date(parseInt(value));
        else date = new Date(value);
      } else date = new Date(value);
      if (isNaN(date.getTime())) return null;
      return date.toISOString().split('T')[0];
    } catch {
      return null;
    }
  }

  formatPhone(value) {
    if (!value) return '';
    const digits = value.toString().replace(/\D/g, '');
    if (digits.length === 10 && digits.startsWith('0')) return digits;
    else if (digits.length === 8) return '0' + digits;
    else if (digits.length === 12 && digits.startsWith('225')) return '0' + digits.substring(3);
    return digits.substring(0, 8);
  }

  formatDelivrance(value) {
    if (!value) return '';
    const upper = value.toString().trim().toUpperCase();
    if (upper === 'OUI' || upper === 'NON') return upper;
    return value.toString().trim();
  }

  formatValue(column, value) {
    if (!value) return '';
    if (column.includes('DATE')) return this.formatDate(value);
    else if (column.includes('CONTACT')) return this.formatPhone(value);
    else if (column === 'DELIVRANCE') return this.formatDelivrance(value);
    else return this.sanitizeString(value);
  }

  async getSitesList(req, res) {
    try {
      let query =
        'SELECT DISTINCT "SITE DE RETRAIT" as site FROM cartes WHERE "SITE DE RETRAIT" IS NOT NULL AND deleted_at IS NULL';
      const filtre = this.ajouterFiltreCoordination(req, query, []);
      const result = await db.query(filtre.query + ' ORDER BY site', filtre.params);
      const sites = result.rows.map((row) => row.site).filter((site) => site && site.trim() !== '');
      res.json({ success: true, sites, count: sites.length, timestamp: new Date().toISOString() });
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Erreur récupération sites: ' + error.message });
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
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2E75B5' } };
        cell.alignment = { vertical: 'middle', horizontal: 'center' };
      });
      const exampleRow = worksheet.addRow({
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
      });
      exampleRow.eachCell((cell) => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF2F2F2' } };
      });
      worksheet.addRow([]);
      worksheet.addRow(['INSTRUCTIONS IMPORTANTES:']).getCell(1).font = { bold: true };
      worksheet.addRow(['- NOM et PRENOMS sont obligatoires']);
      worksheet.addRow(['- Formats date: JJ/MM/AAAA ou AAAA-MM-JJ']);
      worksheet.addRow(['- Téléphone: 8 chiffres (sera formaté automatiquement)']);
      worksheet.addRow(['- DELIVRANCE: OUI ou NON (vide si non délivrée)']);
      worksheet.addRow(['- RANGEMENT: requis pour la détection des doublons (ex: A1-001)']);
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      );
      res.setHeader('Content-Disposition', 'attachment; filename="template-import-cartes.xlsx"');
      await workbook.xlsx.write(res);
    } catch (error) {
      res
        .status(500)
        .json({ success: false, error: 'Erreur génération template: ' + error.message });
    }
  }

  async diagnostic(req, res) {
    try {
      const memoryUsage = process.memoryUsage();
      const uptime = process.uptime();
      let countQuery = 'SELECT COUNT(*) as total FROM cartes WHERE deleted_at IS NULL AND 1=1';
      const filtreCount = this.ajouterFiltreCoordination(req, countQuery, []);
      const countResult = await db.query(filtreCount.query, filtreCount.params);
      const totalRows = parseInt(countResult.rows[0].total);
      const coordinationStats = await db.query(
        `SELECT coordination, COUNT(*) as total FROM cartes WHERE coordination IS NOT NULL AND deleted_at IS NULL GROUP BY coordination ORDER BY total DESC`
      );
      res.json({
        success: true,
        timestamp: new Date().toISOString(),
        service: 'import-export-lws',
        version: '4.1.0-lws',
        user: { role: req.user?.role, coordination: req.user?.coordination },
        data: {
          total_cartes_accessibles: totalRows,
          exports_en_cours: this.activeExports.size,
          imports_en_cours: this.activeImports.size,
        },
        coordination_stats: coordinationStats.rows,
        config: CONFIG,
        memory: {
          heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024) + 'MB',
          heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024) + 'MB',
        },
        uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`,
      });
    } catch (error) {
      res.status(500).json({ success: false, error: 'Erreur diagnostic: ' + error.message });
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
