// models/Inventory.js
export default (sequelize, DataTypes) => {
  const dialect = typeof sequelize.getDialect === 'function' ? sequelize.getDialect() : 'sqlite';

  const INT_NONNEG = DataTypes.INTEGER;

  const Inventory = sequelize.define('Inventory', {
    ItemCode: {
      type: DataTypes.STRING(128),
      primaryKey: true,
      allowNull: false,
      validate: {
        notEmpty: true,
        // no all-whitespace
        isNotBlank(value) {
          if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error('ItemCode must not be blank');
          }
        },
        len: [1, 128]
      },
      set(v) {
        // Always store trimmed
        if (typeof v === 'string') this.setDataValue('ItemCode', v.trim());
        else this.setDataValue('ItemCode', v);
      }
    },

    Location:        { type: DataTypes.STRING(128) },
    Description:     { type: DataTypes.STRING(1024) },

    OnHandQty:       { type: INT_NONNEG, allowNull: false, defaultValue: 0, validate: { min: 0 } },
    UnitPrice:       { type: DataTypes.DECIMAL(10, 2), allowNull: false, defaultValue: 0, validate: { min: 0 } },

    SafetyWarningOn: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    SafetyLevelQty:  { type: INT_NONNEG, allowNull: false, defaultValue: 0, validate: { min: 0 } },

    BelowSafetyLine: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    Category:        { type: DataTypes.STRING(128), allowNull: true },

    Vendor:          { type: DataTypes.STRING(256) },
    PurchaseLink:    { type: DataTypes.TEXT },
    TrackingNumber:  { type: DataTypes.STRING(256) },
    OrderDate:       { type: DataTypes.STRING(32) },
    ExpectedArrival: { type: DataTypes.STRING(32) },

    // 'In Stock' | 'Low Stock' | 'Out of Stock' | 'Ordered'
    OrderStatus:     { type: DataTypes.STRING(32), allowNull: false, defaultValue: 'In Stock' },

    PartNumber:      { type: DataTypes.STRING(256) },
    PurchaseOrderNumber: { type: DataTypes.STRING(128) },

    EmailNoticeSent: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },

    // Which building this stock belongs to.  Defaults to Bldg-350 (existing data).
    Building:        { type: DataTypes.STRING(64), allowNull: true, defaultValue: 'Bldg-350' },

    updatedAtIso:    { type: DataTypes.STRING(32) },
  }, {
    tableName: 'inventory',
    timestamps: true,
    indexes: [
      { name: 'inventory__order_status', fields: ['OrderStatus'] },
      { name: 'inventory__vendor',       fields: ['Vendor'] },
      { name: 'inventory__category',     fields: ['Category'] },
      { name: 'inventory__description',  fields: ['Description'] },
      { name: 'inventory__part_number',  fields: ['PartNumber'] },
    ],
    defaultScope: { order: [['ItemCode', 'ASC']] },
  });

  // ---------- Helpers used in hooks ----------
  function computeDerived(instance) {
    const qty    = Number(instance.OnHandQty) || 0;
    const safety = Number(instance.SafetyLevelQty) || 0;

    instance.BelowSafetyLine = qty <= safety;

    const derived = qty === 0
      ? 'Out of Stock'
      : (instance.BelowSafetyLine ? 'Low Stock' : 'In Stock');

    if (!instance.changed('OrderStatus')) {
      if (instance.OrderStatus === 'Ordered' && derived !== 'Out of Stock') {
        // keep 'Ordered'
      } else {
        instance.OrderStatus = derived;
      }
    } else {
      if (qty === 0) instance.OrderStatus = 'Out of Stock';
    }
  }

  function coerceNumbers(instance) {
    const n = (v) => {
      const x = Number(v);
      return Number.isFinite(x) && x >= 0 ? x : 0;
    };
    instance.OnHandQty      = n(instance.OnHandQty);
    instance.SafetyLevelQty = n(instance.SafetyLevelQty);
    if (instance.UnitPrice == null || Number(instance.UnitPrice) < 0) {
      instance.UnitPrice = 0;
    }
  }

  async function syncIsoTimestamp(instance) {
    instance.set('updatedAtIso', new Date().toISOString());
  }

  // ---------- Hooks ----------
  Inventory.addHook('beforeValidate', (instance) => {
    // Ensure ItemCode trimmed (also handled in setter, but safe)
    if (typeof instance.ItemCode === 'string') {
      instance.ItemCode = instance.ItemCode.trim();
    }
    coerceNumbers(instance);
  });

  Inventory.addHook('beforeSave', async (instance) => {
    if (typeof instance.ItemCode === 'string' && instance.ItemCode.trim().length === 0) {
      throw new Error('ItemCode must not be blank');
    }
    coerceNumbers(instance);
    computeDerived(instance);
    await syncIsoTimestamp(instance);
  });

  // ---------- Optional: atomic checkout helper ----------
  Inventory.checkoutAtomic = async function ({ code, qty, transaction: externalTx } = {}) {
    if (!code || String(code).trim().length === 0) throw new Error('Item code required');
    const q = Number(qty);
    if (!Number.isFinite(q) || q <= 0) throw new Error('Invalid quantity');

    return await sequelize.transaction(
      { transaction: externalTx },
      async (t) => {
        const item = await Inventory.findOne({
          where: { ItemCode: String(code).trim() },
          transaction: t,
          lock: t.LOCK.UPDATE
        });
        if (!item) throw new Error('Item not found');
        if (q > item.OnHandQty) throw new Error('Insufficient stock');

        item.OnHandQty = item.OnHandQty - q;
        item.EmailNoticeSent = false;
        await item.save({ transaction: t });
        return item;
      }
    );
  };

  return Inventory;
};
