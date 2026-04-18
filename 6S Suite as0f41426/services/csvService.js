// services/csvService.js
import { parse } from 'csv-parse/sync';

/**
 * Parse CSV buffer/string into normalized items array.
 * Case-insensitive headers + common synonyms supported.
 * Returned fields match inventory service expectations.
 *
 * Recognized headers (any casing / synonyms):
 * - ItemCode:  "ItemCode", "Item Code", "Code", "SKU"
 * - Category:  "Category", "Cat", "Group", "Type"
 * - Description: "Description", "Desc", "Item Description", "Name"
 * - Location:  "Location", "Loc", "Bin", "Shelf"
 * - OnHandQty: "OnHandQty", "On Hand", "Qty", "QOH", "Quantity"
 * - UnitPrice: "UnitPrice", "Unit Price", "Price", "Cost"
 * - Vendor:    "Vendor", "Supplier", "Manufacturer"
 * - PurchaseLink: "PurchaseLink", "URL", "Link"
 * - OrderStatus:  "OrderStatus", "Status"
 * - SafetyLevelQty: "SafetyLevelQty", "Safety Level", "Min", "Min Qty", "ReorderPoint"
 * - TrackingNumber: "TrackingNumber", "Tracking #", "Tracking"
 * - PurchaseOrderNumber: "PurchaseOrderNumber", "PO", "PO Number"
 * - OrderDate: "OrderDate", "Order Date", "Ordered"
 * - ExpectedArrival: "ExpectedArrival", "ETA", "Expected"
 * - PartNumber: "PartNumber", "PN", "Part #"
 * - SafetyWarningOn: "SafetyWarningOn", "Safety Warning"
 */

const SYN = {
  ItemCode: ['itemcode', 'item code', 'code', 'sku'],
  Category: ['category', 'cat', 'group', 'type'],
  Description: ['description', 'desc', 'item description', 'name', 'title'],
  Location: ['location', 'loc', 'bin', 'shelf'],
  OnHandQty: ['onhandqty', 'on hand', 'qty', 'qoh', 'quantity', 'on_hand', 'on-hand'],
  UnitPrice: ['unitprice', 'unit price', 'price', 'cost', 'unit_cost', 'unit cost'],
  Vendor: ['vendor', 'supplier', 'manufacturer'],
  PurchaseLink: ['purchaselink', 'url', 'link'],
  OrderStatus: ['orderstatus', 'status'],
  SafetyLevelQty: ['safetylevelqty', 'safety level', 'min', 'min qty', 'reorderpoint', 'reorder point'],
  TrackingNumber: ['trackingnumber', 'tracking #', 'tracking', 'tracking no', 'tracking number'],
  PurchaseOrderNumber: ['purchaseordernumber', 'po', 'po number', 'purchase order', 'purchase order number'],
  OrderDate: ['orderdate', 'order date', 'ordered', 'po date'],
  ExpectedArrival: ['expectedarrival', 'eta', 'expected'],
  PartNumber: ['partnumber', 'pn', 'part #', 'part no', 'part number'],
  SafetyWarningOn: ['safetywarningon', 'safety warning', 'safety flag'],
};

function indexify(obj) {
  const map = new Map();
  for (const k of Object.keys(obj || {})) {
    map.set(k.toLowerCase().trim(), k);
  }
  return map;
}

function findKey(headerMap, target) {
  const lower = target.toLowerCase();
  if (headerMap.has(lower)) return headerMap.get(lower);
  const alts = SYN[target] || [];
  for (const alt of alts) {
    if (headerMap.has(alt)) return headerMap.get(alt);
  }
  return null;
}

function num(v, d = 0) {
  if (v == null) return d;
  const n = Number(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : d;
}

function bool(v, d = false) {
  if (v == null || v === '') return d;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y'].includes(s)) return true;
  if (['0', 'false', 'no', 'n'].includes(s)) return false;
  return d;
}

function str(v) {
  if (v == null) return '';
  return String(v).replace(/\s+/g, ' ').trim();
}

function deriveOrderStatus(onHandQty, safetyLevelQty, provided) {
  const p = str(provided);
  if (p) return p;
  if (onHandQty === 0) return 'Out of Stock';
  if (onHandQty > 0 && onHandQty <= safetyLevelQty) return 'Low Stock';
  return 'In Stock';
}

/**
 * @param {Buffer|string} csvInput
 * @returns {Array<{ItemCode:string,Category:string,Description:string,Location:string,OnHandQty:number,UnitPrice:number,Vendor:string,PurchaseLink:string,OrderStatus:string,SafetyLevelQty:number,TrackingNumber:string,PurchaseOrderNumber:string,OrderDate:string,ExpectedArrival:string,PartNumber:string,SafetyWarningOn:boolean}>}
 */
export function parseCsvToItems(csvInput) {
  const text = Buffer.isBuffer(csvInput) ? csvInput.toString('utf8') : String(csvInput || '');
  if (!text.trim()) return [];

  const rows = parse(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    bom: true,
    trim: true,
  });

  return rows
    .map((r) => {
      const headers = indexify(r);
      const pick = (field) => {
        const key = findKey(headers, field);
        return key ? r[key] : undefined;
      };

      const ItemCode = str(pick('ItemCode'));
      const Category = str(pick('Category'));
      const Description = str(pick('Description'));
      const Location = str(pick('Location'));
      const OnHandQty = num(pick('OnHandQty'), 0);
      const UnitPrice = num(pick('UnitPrice'), 0);
      const Vendor = str(pick('Vendor'));
      const PurchaseLink = str(pick('PurchaseLink'));
      const SafetyLevelQty = num(pick('SafetyLevelQty'), 0);
      const TrackingNumber = str(pick('TrackingNumber'));
      const PurchaseOrderNumber = str(pick('PurchaseOrderNumber'));
      const OrderDate = str(pick('OrderDate'));
      const ExpectedArrival = str(pick('ExpectedArrival'));
      const PartNumber = str(pick('PartNumber'));
      const SafetyWarningOn = bool(pick('SafetyWarningOn'), false);
      const OrderStatus = deriveOrderStatus(OnHandQty, SafetyLevelQty, pick('OrderStatus'));

      return {
        ItemCode,
        Category,
        Description,
        Location,
        OnHandQty,
        UnitPrice,
        Vendor,
        PurchaseLink,
        OrderStatus,
        SafetyLevelQty,
        TrackingNumber,
        PurchaseOrderNumber,
        OrderDate,
        ExpectedArrival,
        PartNumber,
        SafetyWarningOn,
      };
    })
    // Keep at least the primary key to avoid introducing ambiguous rows
    .filter((x) => x.ItemCode);
}
