// routes/assetCatalog.js  (updated)
// ─────────────────────────────────────────────────────────────────────────────
// Changes from original:
//   1. createSchema / updateSchema now include itemType and equipment fields.
//   2. Three new routes:
//        PATCH /:id/calibration  — record a calibration date
//        POST  /:id/checkout     — check equipment out to a tech
//        POST  /:id/checkin      — return equipment
//   3. GET /api/equipment — returns only itemType='equipment' assets with
//      their calibration status, used by the kiosk equipment picker and
//      the Expiration Dashboard filter.
// ─────────────────────────────────────────────────────────────────────────────
import express from 'express';
import Joi     from 'joi';
import assetService from '../services/assetsService.js';
import { requireRole } from '../middleware/roleCheck.js';
import { requireAuth } from '../middleware/auth.js';
import { apiLimiter }  from '../middleware/rateLimit.js';
import { Asset, AuditLog } from '../models/index.js';
import { Op } from 'sequelize';

export default (io) => {
  if (!io) throw new Error('Socket.io instance must be passed to assetCatalog router.');
  const router = express.Router();
  router.use(express.json());

  // ── Validator middleware ────────────────────────────────────────────────────
  const validate = (schema) => (req, res, next) => {
    const { error, value } = schema.validate(
      { body: req.body, params: req.params, query: req.query },
      { abortEarly: false, allowUnknown: true }
    );
    if (error) return res.status(400).json({ message: 'Validation failed', details: error.details });
    req.validatedBody   = value.body;
    req.validatedParams = value.params;
    req.validatedQuery  = value.query;
    next();
  };

  // ── Shared sub-schemas ──────────────────────────────────────────────────────
  const idParam = Joi.object({ id: Joi.number().integer().positive().required() });

  const equipmentFields = {
    itemType:               Joi.string().valid('fleet', 'equipment').default('fleet'),
    equipmentClass:         Joi.string().trim().allow('', null).optional(),
    managedSource:          Joi.string().valid('asset-catalog', 'tools', 'esd-carts', 'manual').default('asset-catalog'),
    serialNumber:           Joi.string().trim().allow('', null).optional(),
    torque:                 Joi.string().trim().allow('', null).optional(),
    toolClassification:     Joi.string().valid('manual', 'wired', 'wireless').allow('', null).optional(),
    lastCalibrationDate:    Joi.string().trim().allow('', null).optional(),
    nextCalibrationDue:     Joi.string().trim().allow('', null).optional(),
    calibrationIntervalDays: Joi.number().integer().min(1).empty('').allow(null).optional(),
  };

  const baseAssetFields = {
    tagNumber:   Joi.string().trim().required(),
    name:        Joi.string().trim().allow(''),
    category:    Joi.string().trim().allow(''),
    location:    Joi.string().trim().allow(''),
    building:    Joi.string().trim().allow('').optional(),
    status:      Joi.string().trim().allow(''),
    description: Joi.string().trim().allow(''),
    ...equipmentFields,
  };

  const createSchema = Joi.object({
    body:   Joi.object(baseAssetFields),
    params: Joi.object({}),
    query:  Joi.object({}),
  });

  const updateSchema = Joi.object({
    body:   Joi.object({ ...baseAssetFields, tagNumber: Joi.string().trim().optional() }),
    params: idParam,
    query:  Joi.object({}),
  });

  const idOnly = Joi.object({
    body:   Joi.object({}),
    params: idParam,
    query:  Joi.object({}),
  });

  const calibrationSchema = Joi.object({
    body: Joi.object({
      lastCalibrationDate:     Joi.string().trim().required(),
      calibrationIntervalDays: Joi.number().integer().min(1).empty('').allow(null).optional(),
      nextCalibrationDue:      Joi.string().trim().allow('', null).optional(),
    }),
    params: idParam,
    query:  Joi.object({}),
  });

  const checkoutSchema = Joi.object({
    body:   Joi.object({ operatorId: Joi.string().trim().required() }),
    params: idParam,
    query:  Joi.object({}),
  });

  const checkinSchema = Joi.object({
    body: Joi.object({
      operatorId: Joi.string().trim().allow('', null).optional(),
      condition:  Joi.string().valid('Good', 'Needs Inspection', 'Damaged').default('Good'),
    }),
    params: idParam,
    query:  Joi.object({}),
  });

  // ── Routes ──────────────────────────────────────────────────────────────────

  // Catalog page (EJS render)
  router.get('/', assetService.renderCatalog);

  // ── NEW: equipment-only JSON list (used by kiosk + expiration dashboard) ───
  // GET /asset-catalog/api/equipment
  // Returns all itemType='equipment' assets with calibration status fields.
  // No auth middleware here — requireAuth is applied at the server level.
  router.get('/api/equipment', requireAuth, apiLimiter, async (req, res, next) => {
    try {
      const where = { itemType: 'equipment' };
      if (req.query.status) where.status = req.query.status;
      if (req.query.building && req.query.building !== 'all') where.building = String(req.query.building).trim();

      const assets = await Asset.findAll({
        where,
        include: [{ model: AuditLog, as: 'auditLogs' }],
        order: [['name', 'ASC']],
      });

      const today = new Date().toISOString().slice(0, 10);
      const result = assets.map(a => {
        const due = a.nextCalibrationDue || null;
        let calStatus = 'ok';
        if (due) {
          const daysUntil = Math.ceil((new Date(due) - new Date(today)) / 86_400_000);
          if (daysUntil < 0)   calStatus = 'overdue';
          else if (daysUntil <= 14) calStatus = 'due-soon';
        }
        return {
          ...a.toJSON(),
          calStatus,
        };
      });

      res.json(result);
    } catch (err) { next(err); }
  });

  // Import/Export
  router.get('/export',  requireRole('admin', 'lead'), assetService.exportCSV);
  router.get('/import-template', requireRole('admin', 'lead'), (req, res) => {
    const itemType = String(req.query.itemType || '').trim().toLowerCase() === 'equipment' ? 'equipment' : 'fleet';
    const headers = [
      'tagNumber',
      'name',
      'category',
      'equipmentClass',
      'location',
      'building',
      'status',
      'description',
      'itemType',
      'managedSource',
      'serialNumber',
      'torque',
      'toolClassification',
      'lastCalibrationDate',
      'nextCalibrationDue',
      'calibrationIntervalDays',
    ];
    const guidance = [
      'REQUIRED: tagNumber | name',
      'Status allowed: Available | Expired | Defective | Maintenance | In Use | Checked Out',
      'Optional fields may be left blank',
      `itemType must be fleet or equipment (template default: ${itemType})`,
      'managedSource should usually be asset-catalog, tools, esd-carts, or manual',
      'Use building values like Bldg-350 or Bldg-4050',
      'For equipment, use YYYY-MM-DD dates and a whole number for calibrationIntervalDays',
      '',
      '',
      '',
      '',
      '',
      '',
    ];
    const sample = itemType === 'equipment'
      ? ['EQ-1001', 'Torque Tester', 'Equipment', 'Test Equipment', 'Lab A', 'Bldg-350', 'Available', 'Bench calibration tester', 'equipment', 'asset-catalog', 'TT-4451', '0.6 Nm', 'wired', '2026-03-01', '2026-08-28', '180']
      : ['ASSET-1001', 'Tow Motor', 'Fleet', '', 'Dock 2', 'Bldg-350', 'Available', 'Material handling vehicle', 'fleet', 'asset-catalog', '', '', '', '', '', ''];
    const blank = ['', '', '', '', '', 'Bldg-350', 'Available', '', itemType, 'asset-catalog', '', '', '', '', '', ''];
    const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = [headers, guidance, sample, blank].map((row) => row.map(escape).join(',')).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="asset-catalog-import-template-${itemType}.csv"`);
    res.send(csv);
  });
  router.post('/import', requireRole('admin', 'lead'), assetService.importCSV(io));

  // Bulk audit
  router.post('/bulk-audit', requireRole('admin', 'lead'), assetService.bulkAudit(io));
  router.post('/api/sync-managed-assets', requireRole('admin', 'lead'), assetService.syncManagedAssets(io));

  // CRUD
  router.post('/', requireRole('admin'), validate(createSchema), assetService.createAsset(io));

  // JSON APIs
  router.get('/api/all',    assetService.getAllAssets);
  router.get('/:id/data',   validate(idOnly), assetService.getAssetData);
  router.get('/:id/audits', validate(idOnly), assetService.getAudits);
  router.get('/:id/audit-log', validate(idOnly), assetService.getAudits);
  router.get('/:id',        validate(idOnly), assetService.viewAsset);

  router.put('/:id',    requireRole('admin', 'lead'), validate(updateSchema), assetService.updateAsset(io));
  router.post('/:id/edit', requireRole('admin', 'lead'), validate(updateSchema), assetService.updateAsset(io));

  router.delete('/:id', requireRole('admin', 'lead', 'management'), validate(idOnly), assetService.deleteAsset(io));
  router.post('/:id/delete', requireRole('admin', 'lead', 'management'), validate(idOnly), assetService.deleteAsset(io));

  // ── NEW: calibration update ─────────────────────────────────────────────────
  // PATCH /asset-catalog/:id/calibration
  router.patch(
    '/:id/calibration',
    requireRole('admin', 'lead', 'coordinator'),
    validate(calibrationSchema),
    assetService.updateCalibration(io)
  );

  // ── NEW: equipment checkout ─────────────────────────────────────────────────
  // POST /asset-catalog/:id/checkout
  // Open to any authenticated user (techs use kiosk which calls this).
  router.post(
    '/:id/checkout',
    requireAuth,
    apiLimiter,
    validate(checkoutSchema),
    assetService.checkoutEquipment(io)
  );

  // ── NEW: equipment checkin (return) ─────────────────────────────────────────
  // POST /asset-catalog/:id/checkin
  router.post(
    '/:id/checkin',
    requireAuth,
    apiLimiter,
    validate(checkinSchema),
    assetService.checkinEquipment(io)
  );

  return router;
};
