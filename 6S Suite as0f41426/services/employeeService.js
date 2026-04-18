// services/employeeService.js
import { loadJSON, readModifyWriteJSON } from '../utils/fileUtils.js';
import { PATHS } from '../config/path.js';
import { recordEmployeeIdAlias } from '../utils/employeeAliases.js';
import { s, lc } from '../utils/text.js';

const EMPLOYEE_PATH = PATHS.EMPLOYEE_PATH;
const normalizeShift = (value) => {
  const raw = s(value);
  if (!raw) return 1;
  if (raw.toUpperCase() === 'WKND') return 'WKND';
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : 1;
};

export default {
  async getAllEmployees(_req, res, next) {
    try {
      const employees = await loadJSON(EMPLOYEE_PATH, []);
      res.json(employees);
    } catch (err) {
      next(err);
    }
  },

  async getEmployee(req, res, next) {
    try {
      const employees = await loadJSON(EMPLOYEE_PATH, []);
      const targetId = lc(req.params.id);
      const emp = employees.find(e => lc(e.id) === targetId);
      if (!emp) return res.status(404).json({ message: 'Employee not found' });
      res.json(emp);
    } catch (err) {
      next(err);
    }
  },

  async addOrUpdateEmployee(req, res, next) {
    try {
      const { id, originalId, name, role, building, shift } = req.body || {};
      if (!id || !name) return res.status(400).json({ message: 'ID and Name required' });

      const normalizedId = lc(id);
      const normalizedOriginalId = lc(originalId || id);
      const entry = {
        id: normalizedId,
        name: s(name),
        role: s(role) || 'Technician',
        building: s(building),
        shift: normalizeShift(shift),
      };

      let conflict = false;
      await readModifyWriteJSON(
        EMPLOYEE_PATH,
        (current) => {
          const employees = Array.isArray(current) ? current.slice() : [];
          const currentIdx = employees.findIndex(e => lc(e.id) === normalizedId);
          const originalIdx = employees.findIndex(e => lc(e.id) === normalizedOriginalId);
          if (normalizedOriginalId !== normalizedId && currentIdx > -1 && currentIdx !== originalIdx) {
            conflict = true;
            return current;
          }
          const idx = originalIdx > -1 ? originalIdx : currentIdx;
          if (idx > -1) employees[idx] = entry;
          else employees.push(entry);
          return employees;
        },
        null,
        []
      );

      if (conflict) return res.status(409).json({ message: 'Employee ID already exists' });

      if (normalizedOriginalId && normalizedOriginalId !== normalizedId) {
        await recordEmployeeIdAlias({
          aliasId: normalizedOriginalId,
          currentId: normalizedId,
          employeeName: entry.name,
          changedBy: req.session?.user?.id || 'system',
        });
      }
      res.json({ message: 'Employee upserted', employee: entry });
    } catch (err) {
      next(err);
    }
  },

  async deleteEmployee(req, res, next) {
    try {
      const id = lc(req.params.id);
      let found = false;
      await readModifyWriteJSON(
        EMPLOYEE_PATH,
        (current) => {
          const employees = Array.isArray(current) ? current.slice() : [];
          const idx = employees.findIndex(e => lc(e.id) === id);
          if (idx === -1) return current;
          found = true;
          employees.splice(idx, 1);
          return employees;
        },
        null,
        []
      );
      if (!found) return res.status(404).json({ message: 'Employee not found' });
      res.json({ message: 'Employee deleted' });
    } catch (err) {
      next(err);
    }
  },
};
