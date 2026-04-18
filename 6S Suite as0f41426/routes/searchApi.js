import express from 'express';
import { Asset, AuditLog, Inventory, Sequelize } from '../models/index.js';

const { Op } = Sequelize;
const router = express.Router();

/* ───────── helpers ───────── */
function toInt(v, d = 25) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 500) : d;
}
function pageMeta(total, page, limit) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return { total, page, limit, pages, hasPrev: page > 1, hasNext: page < pages };
}
const ASSET_SORT_FIELDS = new Set(['id', 'name', 'tagNumber', 'location', 'category', 'createdAt', 'updatedAt']);
const INV_SORT_FIELDS   = new Set(['ItemCode', 'Description', 'Location', 'Vendor', 'OnHandQty', 'SafetyLevelQty', 'UnitPrice', 'createdAt', 'updatedAt']);

function parseSort(sortRaw, allowed, fallbackField) {
  const [fieldRaw, dirRaw] = String(sortRaw || `${fallbackField}:asc`).split(':');
  const field = allowed.has(fieldRaw) ? fieldRaw : fallbackField;
  const dir = String(dirRaw || 'asc').toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
  return [field, dir];
}

function buildTermsWhere(q, fields) {
  const qTrim = String(q || '').trim();
  if (!qTrim) return null;
  const terms = qTrim.split(/,|\n|\s+/).map(s => s.trim()).filter(Boolean);
  if (!terms.length) return null;

  // Match ANY term in ANY field (OR of ORs)
  return {
    [Op.or]: terms.flatMap(term =>
      fields.map(f => ({ [f]: { [Op.like]: `%${term}%` } }))
    )
  };
}

/* ───────── Routes ───────── */

/** GET /api/assets?q=&category=&page=&limit=&sort=name:asc */
router.get('/assets', async (req, res, next) => {
  try {
    const q        = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const page     = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit    = toInt(req.query.limit, 25);
    const [sortField, sortDir] = parseSort(req.query.sort, ASSET_SORT_FIELDS, 'id');

    const where = {};
    const qWhere = buildTermsWhere(q, ['name','tagNumber','location','description']);
    if (qWhere) Object.assign(where, qWhere);
    if (category) where.category = category;

    const total = await Asset.count({ where });
    const items = await Asset.findAll({
      where,
      include: [{ model: AuditLog, as: 'auditLogs' }],
      order: [[sortField, sortDir]],
      limit,
      offset: (page - 1) * limit,
    });

    res.json({ items, meta: pageMeta(total, page, limit) });
  } catch (e) { next(e); }
});

/** GET /api/inventory?q=&category=&status=&page=&limit=&sort=ItemCode:asc */
router.get('/inventory', async (req, res, next) => {
  try {
    const q        = String(req.query.q || '').trim();
    const category = String(req.query.category || '').trim();
    const status   = String(req.query.status || '').trim().toLowerCase();
    const page     = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit    = toInt(req.query.limit, 25);
    const [sortField, sortDir] = parseSort(req.query.sort, INV_SORT_FIELDS, 'ItemCode');

    const where = {};
    const qWhere = buildTermsWhere(q, ['ItemCode','Description','Location','Vendor','PartNumber','PurchaseOrderNumber']);
    if (qWhere) Object.assign(where, qWhere);
    if (category) where.Category = category;

    // Derived status via column-vs-column comparisons
    if (status) {
      if (status === 'out of stock') {
        where.OnHandQty = 0;
      } else if (status === 'low stock') {
        where[Op.and] = [
          { OnHandQty: { [Op.gt]: 0 } },
          Sequelize.where(Sequelize.col('OnHandQty'), Op.lte, Sequelize.col('SafetyLevelQty')),
        ];
      } else if (status === 'in stock') {
        where[Op.and] = [
          { OnHandQty: { [Op.gt]: 0 } },
          Sequelize.where(Sequelize.col('OnHandQty'), Op.gt, Sequelize.col('SafetyLevelQty')),
        ];
      }
    }

    const total = await Inventory.count({ where });
    const items = await Inventory.findAll({
      where,
      order: [[sortField, sortDir]],
      limit,
      offset: (page - 1) * limit,
    });

    res.json({ items, meta: pageMeta(total, page, limit) });
  } catch (e) { next(e); }
});

/** GET /api/search?q=&page=&limit=
 *  Returns a flat list of mixed results with basic totals.
 */
router.get('/search', async (req, res, next) => {
  try {
    const q     = String(req.query.q || '').trim();
    const page  = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 25, 1), 100);
    if (!q) return res.json({ items: [], meta: { total: 0, page, limit, pages: 1 } });

    const aWhere = buildTermsWhere(q, ['name','tagNumber','location','description']) || {};
    const iWhere = buildTermsWhere(q, ['ItemCode','Description','Location','Vendor','PartNumber','PurchaseOrderNumber']) || {};

    // Fetch a page from each; also compute simple totals
    const [assets, inventory, assetsTotal, inventoryTotal] = await Promise.all([
      Asset.findAll({ where: aWhere, limit, offset: (page - 1) * limit, order: [['id','ASC']] }),
      Inventory.findAll({ where: iWhere, limit, offset: (page - 1) * limit, order: [['ItemCode','ASC']] }),
      Asset.count({ where: aWhere }),
      Inventory.count({ where: iWhere }),
    ]);

    const items = [
      ...assets.map(a => ({
        type: 'asset',
        id: a.id,
        title: `${a.tagNumber || ''} — ${a.name || ''}`.trim(),
        subtitle: `${a.location || ''}${a.category ? ` · ${a.category}` : ''}`.trim(),
      })),
      ...inventory.map(i => ({
        type: 'inventory',
        id: i.ItemCode,
        title: `${i.ItemCode || ''} — ${i.Description || ''}`.trim(),
        subtitle: `${i.Location || ''}${i.Vendor ? ` · ${i.Vendor}` : ''}`.trim(),
      })),
    ];

    const total = assetsTotal + inventoryTotal;
    res.json({ items, meta: pageMeta(total, page, limit) });
  } catch (e) { next(e); }
});

export default router;
