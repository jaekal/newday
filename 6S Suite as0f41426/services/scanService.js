import fs from 'fs/promises';
import path from 'path';
import { PATHS } from '../config/path.js';
import { loadJSON, readModifyWriteJSON } from '../utils/fileUtils.js';
import inventoryRepo from './inventoryRepo.js';
import { Asset, AuditLog } from '../models/index.js';
import { checkoutToolBySerial, returnToolBySerial } from './toolService.js';
import { s, lc } from '../utils/text.js';

const SCAN_LOG = path.join(path.resolve('data'), 'scan_log.json');

async function appendScanLog(entry) {
  try {
    await readModifyWriteJSON(
      SCAN_LOG,
      (arr) => {
        const list = Array.isArray(arr) ? arr : [];
        list.push({ ...entry, time: new Date().toISOString() });
        // Hard-cap to the last 50k scans so the file doesn't grow unboundedly.
        const MAX = Number(process.env.SCAN_LOG_MAX || 50_000);
        return list.length > MAX ? list.slice(-MAX) : list;
      },
      null,
      []
    );
  } catch {}
}

async function findTool(serial) {
  const tools = await loadJSON(PATHS.TOOL_PATH, []);
  const target = lc(serial);
  return tools.find(t => lc(t.serialNumber || t.serial || t.SerialNumber) === target);
}

async function findInventory(code) {
  const item = await inventoryRepo.getItemByCode(s(code));
  return item || null;
}

async function findAssetByTag(tag) {
  if (!tag) return null;
  const a = await Asset.findOne({ where: { tagNumber: tag } });
  return a || null;
}

/**
 * Process a batch of scans with best-effort routing:
 * tools → inventory → assets.
 */
export async function processBatch({ scans = [], operatorId = '', strict = false, actor = 'system', io }) {
  const out = [];

  for (const raw of scans) {
    const barcode = s(raw.barcode);
    const action = lc(raw.action || '');
    const payload = raw.payload || {};

    if (!barcode) {
      out.push({ ok: false, barcode, reason: 'empty_barcode' });
      continue;
    }

    // 1) Tools by serial
    const tool = await findTool(barcode);
    if (tool) {
      try {
        if (action === 'return') {
          const { tool: updated } = await returnToolBySerial({ serial: barcode, actor, io });
          out.push({ ok: true, barcode, matched: 'tool', action: 'return', tool: updated });
        } else {
          const op = s(payload.operatorId || operatorId);
          if (!op) throw new Error('operatorId required for tool checkout');
          const { tool: updated } = await checkoutToolBySerial({ serial: barcode, operatorId: op, actor, io });
          out.push({ ok: true, barcode, matched: 'tool', action: 'checkout', tool: updated });
        }
      } catch (e) {
        out.push({ ok: false, barcode, matched: 'tool', error: String(e?.message || e) });
      }
      await appendScanLog({ barcode, action, domain: 'tool' });
      continue;
    }

    // 2) Inventory by ItemCode
    const inv = await findInventory(barcode);
    if (inv) {
      try {
        if (action === 'return') {
          // Not a stock-in operation here; record only.
          out.push({ ok: true, barcode, matched: 'inventory', action: 'seen', item: inv });
        } else {
          const qty = Number(payload.qty || 1);
          const updated = await inventoryRepo.checkout({ code: barcode, qty, operatorId, actor });
          io?.publish?.projectsUpdated?.({ reason: 'scan_checkout' });
          out.push({ ok: true, barcode, matched: 'inventory', action: 'checkout', item: updated });
        }
      } catch (e) {
        out.push({ ok: false, barcode, matched: 'inventory', error: String(e?.message || e) });
      }
      await appendScanLog({ barcode, action, domain: 'inventory' });
      continue;
    }

    // 3) Asset by tagNumber (audit ping)
    const asset = await findAssetByTag(barcode);
    if (asset) {
      try {
        if (action === 'audit' || !action) {
          await AuditLog.create({
            assetId: asset.id,
            auditorName: actor,
            comments: s(payload.note || 'Scanned during batch audit'),
            passed: true,
            auditDate: new Date(),
          });
          io?.publish?.auditUpdated?.({ reason: 'scan_audit', assetId: asset.id });
          out.push({ ok: true, barcode, matched: 'asset', action: 'audit', assetId: asset.id });
        } else {
          out.push({ ok: true, barcode, matched: 'asset', action: 'seen', assetId: asset.id });
        }
      } catch (e) {
        out.push({ ok: false, barcode, matched: 'asset', error: String(e?.message || e) });
      }
      await appendScanLog({ barcode, action, domain: 'asset' });
      continue;
    }

    // No match
    out.push({ ok: !strict, barcode, matched: null, reason: 'not_found' });
    await appendScanLog({ barcode, action, domain: 'unknown' });
  }

  return out;
}
