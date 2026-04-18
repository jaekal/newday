// routes/exports.js
import express from 'express';
import { Asset } from '../models/index.js';
import { Parser } from 'json2csv';
import * as XLSX from 'xlsx';
import PDFDocument from 'pdfkit';
import { csvSafeObject } from '../utils/csv.js';
import inventoryRepo from '../services/inventoryRepo.js';

const router = express.Router();

/* ───────────── Helpers ───────────── */

function sendCSV(res, rows, filename) {
  const parser = new Parser();
  const safe = rows.map(csvSafeObject);
  const csv = parser.parse(safe);
  res.header('Content-Type', 'text/csv');
  res.attachment(filename).send(csv);
}

function sendXLSX(res, rows, filename, sheetName = 'Sheet1') {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(rows);
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
  res.header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.attachment(filename).send(buf);
}

function sendPDF(res, buildFn, filename) {
  const doc = new PDFDocument({ autoFirstPage: false });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  doc.on('end', () => {
    const buf = Buffer.concat(chunks);
    res.header('Content-Type', 'application/pdf');
    res.attachment(filename).send(buf);
  });
  buildFn(doc);
  doc.end();
}

/* ───────────── Assets — CSV/XLSX ───────────── */

router.get('/assets.csv', async (_req, res, next) => {
  try {
    const rows = await Asset.findAll({ raw: true });
    sendCSV(res, rows, 'assets.csv');
  } catch (e) { next(e); }
});

router.get('/assets.xlsx', async (_req, res, next) => {
  try {
    const rows = await Asset.findAll({ raw: true });
    sendXLSX(res, rows, 'assets.xlsx', 'Assets');
  } catch (e) { next(e); }
});

/* ───────────── Inventory — CSV/XLSX ─────────────
   Use inventoryRepo to include derived fields (BelowSafetyLine, OrderStatus)
*/

router.get('/inventory.csv', async (_req, res, next) => {
  try {
    const rows = await inventoryRepo.getInventory();
    sendCSV(res, rows, 'inventory.csv');
  } catch (e) { next(e); }
});

router.get('/inventory.xlsx', async (_req, res, next) => {
  try {
    const rows = await inventoryRepo.getInventory();
    sendXLSX(res, rows, 'inventory.xlsx', 'Inventory');
  } catch (e) { next(e); }
});

/* ───────────── Low-stock quick export ───────────── */

router.get('/inventory.lowstock.csv', async (_req, res, next) => {
  try {
    const rows = await inventoryRepo.getInventory();
    const out = rows.filter(r => {
      const qty = Number(r.OnHandQty) || 0;
      const safety = Number(r.SafetyLevelQty) || 0;
      return qty === 0 || qty <= safety;
    });
    sendCSV(res, out, 'inventory_low_stock.csv');
  } catch (e) { next(e); }
});

/* ───────────── Low-stock PDF ───────────── */

router.get('/inventory.lowstock.pdf', async (_req, res, next) => {
  try {
    const rows = await inventoryRepo.getInventory();
    const low = rows.filter(r => {
      const qty = Number(r.OnHandQty) || 0;
      const safety = Number(r.SafetyLevelQty) || 0;
      return qty === 0 || qty <= safety;
    });

    sendPDF(res, (doc) => {
      const drawTable = (pageTitle, data) => {
        doc.addPage({ margin: 36 });
        doc.fontSize(18).text(pageTitle, { align: 'left' });
        doc.moveDown(0.5).fontSize(10).text(`Generated: ${new Date().toLocaleString()}`);
        doc.moveDown(1);

        const cols = ['ItemCode','Description','OnHandQty','SafetyLevelQty','Location','Vendor','OrderStatus'];
        const widths = [100, 220, 70, 90, 100, 120, 90];
        const startX = 36;
        let y = 120;
        const rowH = 18;

        const drawHeader = () => {
          doc.font('Helvetica-Bold');
          cols.forEach((c, i) => {
            const x = startX + widths.slice(0, i).reduce((a, b) => a + b, 0);
            doc.text(c, x, y, { width: widths[i] });
          });
          doc.font('Helvetica');
          y += rowH;
        };

        drawHeader();

        for (const r of data) {
          if (y > doc.page.height - 60) {
            doc.addPage({ margin: 36 });
            y = 60;
            drawHeader();
          }
          const v = [
            r.ItemCode,
            r.Description,
            String(r.OnHandQty ?? ''),
            String(r.SafetyLevelQty ?? ''),
            r.Location || '',
            r.Vendor || '',
            r.OrderStatus || '',
          ];
          v.forEach((val, i) => {
            const x = startX + widths.slice(0, i).reduce((a, b) => a + b, 0);
            doc.text(val || '', x, y, { width: widths[i] });
          });
          y += rowH;
        }
      };

      drawTable('Low Stock Report', low);
    }, 'inventory_low_stock.pdf');
  } catch (e) { next(e); }
});

/* ───────────── Asset label sheets (3x10) ─────────────
   Simple Avery-ish grid (Letter page). Three lines per label.
*/

router.get('/assets.labels.pdf', async (_req, res, next) => {
  try {
    const assets = await Asset.findAll({ raw: true });
    const labels = assets.map(a => ({
      line1: `${a.tagNumber || ''}`,
      line2: `${a.name || ''}`,
      line3: `${[a.location || '', a.category ? `· ${a.category}` : ''].filter(Boolean).join(' ')}`.trim(),
    }));

    sendPDF(res, (doc) => {
      // Letter page, margins + grid
      const margin = 36;
      const gutter = 12;
      const cols = 3;
      const rows = 10;

      const pageW = doc.page?.width || 612;   // PDF points (8.5" * 72)
      const pageH = doc.page?.height || 792;  // (11" * 72)
      const contentW = pageW - margin * 2;
      const contentH = pageH - margin * 2;
      const cellW = (contentW - gutter * (cols - 1)) / cols;
      const cellH = (contentH - gutter * (rows - 1)) / rows;

      let i = 0;
      const drawLabel = (x, y, w, h, { line1, line2, line3 }) => {
        // Optional border (commented)
        // doc.rect(x, y, w, h).stroke();

        const pad = 6;
        let ty = y + pad;
        doc.font('Helvetica-Bold').fontSize(12).text(line1 || '', x + pad, ty, { width: w - pad * 2 });
        ty += 14;
        doc.font('Helvetica').fontSize(10).text(line2 || '', x + pad, ty, { width: w - pad * 2 });
        ty += 12;
        doc.fontSize(9).text(line3 || '', x + pad, ty, { width: w - pad * 2 });
      };

      const newPage = () => {
        doc.addPage({ margin });
      };

      // Start first page
      doc.addPage({ margin });

      for (const lab of labels) {
        const r = Math.floor(i / cols) % rows;
        const c = i % cols;
        const pageIndex = Math.floor(i / (cols * rows));

        if (i > 0 && i % (cols * rows) === 0) {
          newPage();
        }

        const x = margin + c * (cellW + gutter);
        const y = margin + r * (cellH + gutter);
        drawLabel(x, y, cellW, cellH, lab);
        i++;
      }
    }, 'asset_labels.pdf');
  } catch (e) { next(e); }
});

export default router;
