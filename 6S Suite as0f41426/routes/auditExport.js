/**
 * routes/auditExport.js
 * ──────────────────────
 * PDF export for audit runs.
 *
 * GET /audits/export/:id.pdf
 *   → Generates a formatted PDF report for a single audit task/run.
 *   → Requires auth + audits role (enforced by server.js mount).
 *
 * Wire in server.js inside the existing audits mount block, e.g.:
 *   import auditExportRouter from './routes/auditExport.js';
 *   app.use('/audits', requireRoleForToolMaybe('audits'), auditExportRouter);
 *
 * Dependencies already in package.json: pdfkit, express
 */

import express from 'express';
import PDFDocument from 'pdfkit';
import taskService from '../services/taskService.js';
import { requireAuth } from '../middleware/auth.js';

const router = express.Router();

const s    = v => (v == null ? '' : String(v)).trim();
const lc   = v => s(v).toLowerCase();
const fmtDate = iso => {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }); }
  catch { return s(iso); }
};

/* ─── Colour palette (matches suite design tokens) ─────────────────── */
const C = {
  accent:  '#2563eb',   // blue-600
  ok:      '#16a34a',   // green-600
  warn:    '#d97706',   // amber-600
  danger:  '#dc2626',   // red-600
  muted:   '#6b7280',   // gray-500
  border:  '#e5e7eb',   // gray-200
  bg:      '#f9fafb',   // gray-50
  fg:      '#111827',   // gray-900
};

/* ─── Helpers ──────────────────────────────────────────────────────── */
function statusColor(bucket) {
  if (bucket === 'done')    return C.ok;
  if (bucket === 'blocked') return C.danger;
  if (bucket === 'doing')   return C.warn;
  return C.muted;
}

function yesNo(v) {
  if (v === true || v === 'true' || v === 1) return '✓ Yes';
  if (v === false || v === 'false' || v === 0) return '✗ No';
  return s(v) || '—';
}

/* ─── Route ─────────────────────────────────────────────────────────── */
router.get('/export/:id.pdf', requireAuth, async (req, res, next) => {
  try {
    const allTasks = await taskService.getAll();
    const task = allTasks.find(t => t.id === req.params.id);
    if (!task) return res.status(404).json({ message: 'Audit not found' });

    const doc = new PDFDocument({
      autoFirstPage: false,
      margins: { top: 48, bottom: 48, left: 56, right: 56 },
      info: {
        Title:    `Audit Report — ${s(task.title)}`,
        Author:   'ZT Systems 6S Tool Suite',
        Subject:  'Audit Report',
        Creator:  '6S Tool Suite / PDFKit',
      },
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => {
      const buf = Buffer.concat(chunks);
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition',
        `attachment; filename="audit-${encodeURIComponent(s(task.id).slice(0,12))}.pdf"`);
      res.send(buf);
    });

    doc.addPage();

    const pageW = doc.page.width  - doc.page.margins.left - doc.page.margins.right;
    const left  = doc.page.margins.left;
    let   y     = doc.page.margins.top;

    /* ── Header bar ── */
    doc.rect(0, 0, doc.page.width, 56).fill(C.accent);
    doc.fillColor('#fff').fontSize(18).font('Helvetica-Bold')
      .text('6S Tool Suite — Audit Report', left, 18, { width: pageW });
    doc.fillColor('#bfdbfe').fontSize(9)
      .text('ZT Systems · Confidential', left, 38, { width: pageW });
    y = 72;

    /* ── Title ── */
    doc.fillColor(C.fg).fontSize(15).font('Helvetica-Bold')
      .text(s(task.title) || 'Untitled Audit', left, y, { width: pageW });
    y += 24;

    /* ── Status pill ── */
    const bucket    = lc(task.bucket || 'todo');
    const bucketLbl = { todo:'To Do', doing:'In Progress', blocked:'Blocked', done:'Completed' }[bucket] || bucket;
    const sc = statusColor(bucket);
    doc.rect(left, y, 90, 18).fill(sc);
    doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
      .text(bucketLbl.toUpperCase(), left + 6, y + 4, { width: 78, align: 'center' });
    y += 28;

    /* ── Metadata grid ── */
    const meta = [
      ['Kind',        task.kind || '—'],
      ['Shift',       task.shift || task.meta?.weekMode || '—'],
      ['Due Date',    fmtDate(task.dueDate)],
      ['Opened',      fmtDate(task.createdAt)],
      ['Last Updated',fmtDate(task.updatedAt)],
      ['Domain',      task.domain || '—'],
      ['Category',    task.category || task.meta?.category || '—'],
      ['Created By',  task.createdBy || task.meta?.owner || '—'],
    ];

    const colW = pageW / 2;
    doc.lineWidth(0.5).strokeColor(C.border);

    for (let i = 0; i < meta.length; i++) {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const rx  = left + col * colW;
      const ry  = y + row * 22;

      doc.rect(rx, ry, colW, 22).stroke(C.border).fill(row % 2 === 0 ? C.bg : '#fff');
      doc.fillColor(C.muted).fontSize(8).font('Helvetica')
        .text(meta[i][0], rx + 6, ry + 4, { width: colW * 0.38 });
      doc.fillColor(C.fg).fontSize(9).font('Helvetica-Bold')
        .text(s(meta[i][1]), rx + colW * 0.38 + 6, ry + 4, { width: colW * 0.58 });
    }
    y += Math.ceil(meta.length / 2) * 22 + 16;

    /* ── Description ── */
    const desc = s(task.description || task.meta?.description || '');
    if (desc) {
      doc.fillColor(C.fg).fontSize(10).font('Helvetica-Bold').text('Description', left, y);
      y += 14;
      doc.fillColor(C.fg).fontSize(9).font('Helvetica')
        .text(desc, left, y, { width: pageW });
      y += doc.heightOfString(desc, { width: pageW }) + 12;
    }

    /* ── Checklist ── */
    const items = task.meta?.items || [];
    if (items.length) {
      doc.fillColor(C.fg).fontSize(10).font('Helvetica-Bold').text('Checklist', left, y);
      y += 14;
      doc.lineWidth(0.5);

      for (let i = 0; i < items.length; i++) {
        const item = typeof items[i] === 'string' ? { text: items[i] } : items[i];
        const done = item.done === true;
        const bg   = done ? '#f0fdf4' : '#fff';
        doc.rect(left, y, pageW, 18).fill(bg).stroke(C.border);
        // Checkbox
        doc.rect(left + 6, y + 4, 10, 10).stroke(done ? C.ok : C.border);
        if (done) {
          doc.fillColor(C.ok).fontSize(8).font('Helvetica-Bold')
            .text('✓', left + 7, y + 4, { width: 10, align: 'center' });
        }
        doc.fillColor(done ? C.ok : C.fg).fontSize(8.5).font('Helvetica')
          .text(s(item.text || item), left + 22, y + 4, { width: pageW - 28 });
        y += 18;
        if (y > doc.page.height - 80) { doc.addPage(); y = doc.page.margins.top; }
      }
      y += 10;
    }

    /* ── Notes ── */
    const notes = s(task.meta?.notes || task.notes || '');
    if (notes) {
      doc.fillColor(C.fg).fontSize(10).font('Helvetica-Bold').text('Notes', left, y);
      y += 14;
      doc.rect(left, y, pageW, doc.heightOfString(notes, { width: pageW - 16 }) + 16)
        .fill('#fefce8').stroke(C.warn);
      doc.fillColor(C.fg).fontSize(9).font('Helvetica')
        .text(notes, left + 8, y + 8, { width: pageW - 16 });
      y += doc.heightOfString(notes, { width: pageW - 16 }) + 24;
    }

    /* ── Footer ── */
    const footerY = doc.page.height - 36;
    doc.moveTo(left, footerY).lineTo(left + pageW, footerY).strokeColor(C.border).lineWidth(0.5).stroke();
    doc.fillColor(C.muted).fontSize(8).font('Helvetica')
      .text(`Generated by 6S Tool Suite · ${new Date().toLocaleString()}`, left, footerY + 6, { width: pageW, align: 'center' });

    doc.end();
  } catch (err) {
    next(err);
  }
});

/* ─── CSV export for audit list ──────────────────────────────────────── */
router.get('/export/all.csv', requireAuth, async (req, res, next) => {
  try {
    const tasks  = await taskService.getAll();
    const audits = tasks.filter(t => t.domain === 'audit');

    const headers = ['id','title','kind','bucket','shift','dueDate','category','createdAt','updatedAt'];
    const lines = [
      headers.join(','),
      ...audits.map(t =>
        headers.map(h => {
          const v = s(t[h] || t.meta?.[h] || '');
          return `"${v.replace(/"/g, '""')}"`;
        }).join(',')
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="audits.csv"');
    res.send(lines.join('\n'));
  } catch (err) { next(err); }
});

export default router;
