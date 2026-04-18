const mkId = (domain, slug) => `catalog:${domain}:${slug}`;

const project = [
  ['organize-slt-rlt-panel-cabling', 'Organize SLT/RLT panel cabling', 'daily'],
  ['submit-attendance-staffing-updates', 'Submit attendance and staffing updates', 'daily'],
  ['receive-register-new-laptops', 'Receive and register new laptops', 'daily'],
  ['process-damaged-laptop-exchanges', 'Process damaged laptop IT exchanges', 'daily'],
  ['prepare-toolboxes-onboarding-kits', 'Prepare toolboxes and onboarding kits', 'daily'],
  ['create-track-jira-servicenow-tickets', 'Create and track Jira or ServiceNow tickets', 'daily'],
  ['sort-incoming-materials-purchase-orders', 'Sort incoming materials and tools from purchase orders', 'daily'],
  ['restock-panel-consumable-supplies', 'Restock earplug dispensers, OC/RLT panel containers, Velcro, labels, and similar supplies', 'daily'],
  ['register-tools-equipment-assets-inventory', 'Register tools, equipment, assets, and inventory', 'daily'],
  ['request-expendable-materials', 'Request expendable materials from Supply Center', 'weekly'],
  ['return-laptops-to-it', 'Return laptops to IT', 'weekly'],
  ['recalibrate-screwdrivers-required-torque', 'Recalibrate screwdrivers to required torque', 'weekly'],
  ['weekly-findings-review', 'Conduct weekly lead and manager review of findings, reports, and improvement actions', 'weekly'],
  ['build-stage-new-hire-toolboxes', 'Build and stage new hire toolboxes', 'biweekly'],
  ['prepare-monthly-6s-purchase-order', 'Prepare monthly 6S and materials purchase order', 'monthly'],
  ['receive-record-monthly-materials', 'Receive and record monthly materials', 'monthly'],
  ['monthly-inventory-reconciliation', 'Perform monthly inventory reconciliation', 'monthly'],
  ['print-labels-equipment-materials-cables', 'Print labels for equipment, materials, and cables', 'on-demand'],
  ['submit-supply-requests-outside-normal-replenishment', 'Submit supply requests outside normal replenishment', 'on-demand'],
  ['replace-whips-register-mes', 'Replace whips and register changes in MES', 'on-demand'],
].map(([slug, title, repeatCadence]) => ({
  id: mkId('project', slug),
  domain: 'project',
  title,
  kind: 'project',
  source: 'catalog',
  bucket: 'todo',
  ownerId: '',
  ownerName: '',
  ownerLabel: '',
  meta: {
    template: true,
    catalog: true,
    repeatCadence,
  },
}));

const audit = [
  ['fusebox-inspection', 'Fusebox Inspection', 'daily', ''],
  ['unistrut-inspection', 'Unistrut Inspection', 'daily', ''],
  ['esd-compliance-audit', 'ESD Compliance Audit', 'daily', ''],
  ['screwdriver-and-drill-audit', 'Screwdriver and Drill Audit', 'daily', ''],
  ['inspect-heavy-lift-office-lifter', 'Inspect Heavy Lift, Office lifter and complete daily checklist.', 'daily', ''],
  ['audit-test-whips', 'Audit Test Whips', 'daily', ''],
  ['audit-power-boxes', 'Audit Power boxes', 'daily', ''],
  ['esd-cart-audit', 'ESD Cart Audit', 'daily', ''],
  ['weekly-torque-calibration', 'Torque calibration on screwdriver testers.', 'weekly'],
  ['weekly-6s-cross-department-audit', '6S cross-department audit.', 'weekly'],
  ['weekly-inventory-6s-materials', 'Physical Inventory Audit', 'weekly'],
  ['weekly-full-area-audit', 'Weekly task review / full area audit every Friday.', 'weekly'],
  ['weekly-toolbox-inspection', 'Toolbox inspection.', 'weekly'],
  ['drill-bit-audit', 'Drill Bit Audit', 'weekly', 'weekly'],
  ['laptop-inventory-audit', 'Laptop inventory Audit', 'monthly', ''],
].map(([slug, title, kind, weekMode]) => {
  const toolMeta = slug === 'screwdriver-and-drill-audit'
    ? { moduleTool: 'tool-verify', moduleToolLabel: 'Tool Verify' }
    : slug === 'weekly-torque-calibration'
      ? { moduleTool: 'torque-import', moduleToolLabel: 'Torque Import' }
    : {};
  return {
    id: mkId('audit', slug),
    domain: 'audit',
    title,
    description: '',
    kind,
    shiftMode: kind === 'daily' ? 'once' : '',
    weekMode: kind === 'weekly' ? (weekMode || 'weekly') : '',
    source: 'catalog',
    bucket: 'todo',
    ownerId: '',
    ownerName: '',
    ownerLabel: '',
    meta: {
      template: true,
      catalog: true,
      ...toolMeta,
    },
  };
});

export const PROJECT_TEMPLATE_CATALOG = project;
export const AUDIT_TEMPLATE_CATALOG = audit;

export function getProjectCatalogTemplates() {
  return PROJECT_TEMPLATE_CATALOG.map((item) => structuredClone(item));
}

export function getAuditCatalogTemplates() {
  return AUDIT_TEMPLATE_CATALOG.map((item) => structuredClone(item));
}

export function findProjectCatalogTemplate(id) {
  return PROJECT_TEMPLATE_CATALOG.find((item) => item.id === String(id)) || null;
}

export function findAuditCatalogTemplate(id) {
  return AUDIT_TEMPLATE_CATALOG.find((item) => item.id === String(id)) || null;
}
