// config/roleAccess.js
export const roleAccess = {
  admin: [
    'screwdriver',
    'inventory',
    'assetCatalog',
    'expiration',
    'audits',
    'projects',
    'kiosk',
    'management',
    'employeeRoster',
    'esdCarts',
    'transfers',
  ],

  coordinator: [
    'screwdriver',
    'inventory',
    'assetCatalog',
    'expiration',
    'audits',
    'projects',
    'employeeRoster',
    'esdCarts',
    'transfers',
  ],

  management: [
    'screwdriver',
    'inventory',
    'assetCatalog',
    'expiration',
    'audits',
    'projects',
    'kiosk',
    'management',
    'employeeRoster',
    'esdCarts',
    'transfers',
  ],

  lead: [
    'screwdriver',
    'inventory',
    'assetCatalog',
    'expiration',
    'audits',
    'projects',
    'employeeRoster',
    'esdCarts',
    'kiosk',
    'transfers',
  ],

  user: [
    'kiosk',
  ],
};