// services/userService.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcrypt';
import { PATHS } from '../config/path.js';
import { loadJSON, saveJSON } from '../utils/fileUtils.js';
import { getBuildingOptions, normalizeBuilding } from '../utils/buildings.js';
import { recordEmployeeIdAlias } from '../utils/employeeAliases.js';
import { s, lc } from '../utils/text.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---- Config / Paths ----
const USERS_PATH = PATHS?.USERS_PATH || path.join(__dirname, '../data/users.json');
const BCRYPT_COST_RAW = Number(process.env.BCRYPT_COST || 12);
const BCRYPT_COST = Number.isFinite(BCRYPT_COST_RAW)
  ? Math.min(Math.max(BCRYPT_COST_RAW, 8), 14)
  : 12;
const MIN_PASSWORD_LEN = Number(process.env.MIN_PASSWORD_LEN || 8);
const ROLES = new Set(['admin', 'lead', 'management', 'coordinator', 'user']);

// ---- Utilities ----
function ensureUsersDir() {
  const dir = path.dirname(USERS_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

async function loadUsers() {
  ensureUsersDir();
  const list = await loadJSON(USERS_PATH, []);

  return list.map(u => ({
    username: s(u.username),
    usernameLC: lc(u.username || u.usernameLC || ''),
    passwordHash: u.passwordHash || '',
    role: ROLES.has(lc(u.role)) ? lc(u.role) : 'user',
    name: s(u.name || u.displayName || u.username || ''),
    techId: s(u.techId || u.employeeId || ''),
    building: normalizeBuilding(u.building, { allowBlank: true }),
    createdAt: u.createdAt || new Date().toISOString(),
    updatedAt: u.updatedAt || u.createdAt || new Date().toISOString(),
  }));
}

async function saveUsersSafe(users) {
  ensureUsersDir();
  await saveJSON(USERS_PATH, users);
}

function findIndexByUsername(users, username) {
  const target = lc(username);
  return users.findIndex(u => u.usernameLC === target);
}

function countAdmins(users) {
  return users.reduce((n, u) => n + (u.role === 'admin' ? 1 : 0), 0);
}

async function emitWebhook(event, payload) {
  try {
    const mod = await import('./webhooksOutService.js');
    await mod.default.emit(event, payload);
  } catch {
    // noop: optional
  }
}

function publicUserShape(u) {
  return {
    username: u.username,
    role: u.role,
    name: u.name,
    techId: u.techId,
    building: u.building,
    createdAt: u.createdAt,
    updatedAt: u.updatedAt,
  };
}

function getActorRole(req) {
  return lc(req.session?.user?.role || req.user?.role || '');
}

// ---- Service handlers ----

// GET all users (return non-sensitive info)
const getAllUsers = async (_req, res, next) => {
  try {
    const users = await loadUsers();
    res.json(users.map(publicUserShape));
  } catch (err) {
    next(err);
  }
};

// POST add user
const createUser = async (req, res, next) => {
  try {
    const actorRole = getActorRole(req);
    const actorIsAdmin = actorRole === 'admin';
    const actorIsManagement = actorRole === 'management';
    const username = s(req.body?.username);
    const password = s(req.body?.password);
    const roleReq = lc(req.body?.role || 'user');
    const name = s(req.body?.name || req.body?.displayName || username);
    const techId = s(req.body?.techId || req.body?.employeeId || '');
    const building = normalizeBuilding(req.body?.building, { allowBlank: true });

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password are required' });
    }

    if (password.length < MIN_PASSWORD_LEN) {
      return res.status(400).json({
        message: `Password must be at least ${MIN_PASSWORD_LEN} characters`,
      });
    }

    if (!ROLES.has(roleReq)) {
      return res.status(400).json({
        message: `Invalid role. Allowed: ${[...ROLES].join(', ')}`,
      });
    }

    if (!actorIsAdmin && !actorIsManagement) {
      return res.status(403).json({ message: 'Not allowed to create users' });
    }

    if (actorIsManagement && roleReq === 'admin') {
      return res.status(403).json({ message: 'Only admins can assign the admin role' });
    }

    const users = await loadUsers();
    if (findIndexByUsername(users, username) !== -1) {
      return res.status(409).json({ message: 'User already exists' });
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const now = new Date().toISOString();

    const record = {
      username,
      usernameLC: lc(username),
      passwordHash,
      role: roleReq,
      name,
      techId,
      building,
      createdAt: now,
      updatedAt: now,
    };

    users.push(record);
    await saveUsersSafe(users);

    emitWebhook('user.created', { username, role: roleReq, techId, building }).catch(() => {});

    return res.status(201).json({
      message: 'User created',
      user: {
        username,
        role: roleReq,
        name,
        techId,
        building,
      },
    });
  } catch (err) {
    next(err);
  }
};

// DELETE user
const deleteUser = async (req, res, next) => {
  try {
    const username = s(req.params.username);
    const users = await loadUsers();
    const idx = findIndexByUsername(users, username);

    if (idx === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    // Prevent deleting the last admin
    if (users[idx].role === 'admin' && countAdmins(users) <= 1) {
      return res.status(400).json({ message: 'Cannot delete the last admin' });
    }

    // Prevent deleting yourself
    if (lc(req.session?.user?.id) === users[idx].usernameLC) {
      return res.status(400).json({ message: 'You cannot delete your own account' });
    }

    const removed = users.splice(idx, 1)[0];
    await saveUsersSafe(users);

    emitWebhook('user.deleted', {
      username: removed.username,
      role: removed.role,
    }).catch(() => {});

    return res.json({
      message: 'User deleted',
      username: removed.username,
    });
  } catch (err) {
    next(err);
  }
};

// PUT update
// - Admin can change anyone's role, name, techId, password
// - User can change their own name, techId, password
// - Self password changes require currentPassword
const updateUser = async (req, res, next) => {
  try {
    const targetName = s(req.params.username);
    const newPassword = s(req.body?.password || '');
    const currentPassword = s(req.body?.currentPassword || '');
    const newRoleReq = s(req.body?.role || '');
    const newName = req.body?.name != null ? s(req.body.name) : null;
    const newTechId =
      req.body?.techId != null
        ? s(req.body.techId)
        : req.body?.employeeId != null
          ? s(req.body.employeeId)
          : null;
    const newBuilding =
      req.body?.building != null
        ? normalizeBuilding(req.body.building, { allowBlank: true })
        : null;

    const users = await loadUsers();
    const idx = findIndexByUsername(users, targetName);

    if (idx === -1) {
      return res.status(404).json({ message: 'User not found' });
    }

    const actor = req.session?.user || {};
    const actorRole = lc(actor.role);
    const actorIsAdmin = actorRole === 'admin';
    const actorIsManagement = actorRole === 'management';
    const actorIsLead = actorRole === 'lead';
    const isSelf = lc(actor.id) === users[idx].usernameLC;

    const before = { ...users[idx] };
    const updates = {};

    // Password change
    if (newPassword) {
      if (!isSelf && !actorIsAdmin) {
        return res.status(403).json({ message: 'Not allowed to change password' });
      }

      if (newPassword.length < MIN_PASSWORD_LEN) {
        return res.status(400).json({
          message: `Password must be at least ${MIN_PASSWORD_LEN} characters`,
        });
      }

      // Self-service password change must provide current password
      if (isSelf && !actorIsAdmin) {
        if (!currentPassword) {
          return res.status(400).json({ message: 'Current password is required' });
        }

        const ok = await bcrypt.compare(currentPassword, users[idx].passwordHash || '');
        if (!ok) {
          return res.status(401).json({ message: 'Current password is incorrect' });
        }
      }

      // If admin is editing self, also require current password
      if (isSelf && actorIsAdmin) {
        if (!currentPassword) {
          return res.status(400).json({ message: 'Current password is required' });
        }

        const ok = await bcrypt.compare(currentPassword, users[idx].passwordHash || '');
        if (!ok) {
          return res.status(401).json({ message: 'Current password is incorrect' });
        }
      }

      updates.passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
    }

    // Role change: admin only
    if (newRoleReq) {
      const roleLC = lc(newRoleReq);

      if (!actorIsAdmin && !actorIsManagement) {
        return res.status(403).json({ message: 'Only admins or management can change roles' });
      }

      if (!ROLES.has(roleLC)) {
        return res.status(400).json({
          message: `Invalid role. Allowed: ${[...ROLES].join(', ')}`,
        });
      }

      if (actorIsManagement && roleLC === 'admin') {
        return res.status(403).json({ message: 'Only admins can assign the admin role' });
      }

      if (actorIsManagement && users[idx].role === 'admin' && roleLC !== 'admin') {
        return res.status(403).json({ message: 'Only admins can change an admin account role' });
      }

      // Prevent demoting the last admin
      if (users[idx].role === 'admin' && roleLC !== 'admin' && countAdmins(users) <= 1) {
        return res.status(400).json({ message: 'Cannot demote the last admin' });
      }

      // Prevent admin from self-demoting through self edit
      if (isSelf && users[idx].role === 'admin' && roleLC !== 'admin') {
        return res.status(400).json({ message: 'You cannot change your own admin role' });
      }

      updates.role = roleLC;
    }

    // Name / techId: self, admin, management, or lead (lead cannot edit other admins)
    if (newName !== null) {
      if (!isSelf && !actorIsAdmin && !actorIsManagement && !actorIsLead) {
        return res.status(403).json({ message: 'Not allowed to change display name' });
      }
      if (actorIsLead && !isSelf && users[idx].role === 'admin') {
        return res.status(403).json({ message: 'Not allowed to change display name for administrators' });
      }
      updates.name = newName;
    }

    if (newTechId !== null) {
      if (!isSelf && !actorIsAdmin && !actorIsManagement && !actorIsLead) {
        return res.status(403).json({ message: 'Not allowed to change tech ID' });
      }
      if (actorIsLead && !isSelf && users[idx].role === 'admin') {
        return res.status(403).json({ message: 'Not allowed to change tech ID for administrators' });
      }
      updates.techId = newTechId;
    }

    if (newBuilding !== null) {
      if (!actorIsAdmin && !actorIsManagement) {
        return res.status(403).json({ message: 'Only admins or management can change assigned building' });
      }
      updates.building = newBuilding;
    }

    // Login username rename (admin only) — URL still identifies the user before rename
    if (req.body && Object.prototype.hasOwnProperty.call(req.body, 'newUsername')) {
      const nu = s(req.body.newUsername);
      if (lc(nu) !== users[idx].usernameLC) {
        if (!actorIsAdmin) {
          return res.status(403).json({ message: 'Only admins can change login username' });
        }
        if (!nu) {
          return res.status(400).json({ message: 'Username cannot be empty' });
        }
        const dup = findIndexByUsername(users, nu);
        if (dup !== -1 && dup !== idx) {
          return res.status(409).json({ message: 'That username is already taken' });
        }
        updates.username = nu;
        updates.usernameLC = lc(nu);
      }
    }

    if (
      !newPassword &&
      !newRoleReq &&
      newName === null &&
      newTechId === null &&
      newBuilding === null &&
      !('username' in updates)
    ) {
      return res.status(400).json({ message: 'No changes provided' });
    }

    users[idx] = {
      ...users[idx],
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    await saveUsersSafe(users);

    if ('techId' in updates && updates.techId !== before.techId) {
      await recordEmployeeIdAlias({
        aliasId: before.techId,
        currentId: updates.techId,
        employeeName: users[idx].name,
        changedBy: actor.id || actor.username || 'system',
      });
    }

    // Refresh session if actor changed their own record (including login rename)
    if (isSelf) {
      req.session.user = {
        id: users[idx].username,
        username: users[idx].username,
        role: users[idx].role,
        name: users[idx].name,
        techId: users[idx].techId,
        building: users[idx].building,
      };
    }

    const changed = {};
    if ('username' in updates && updates.username !== before.username) {
      changed.username = { from: before.username, to: updates.username };
    }
    if ('role' in updates && updates.role !== before.role) {
      changed.role = { from: before.role, to: updates.role };
    }
    if ('name' in updates && updates.name !== before.name) {
      changed.name = { from: before.name, to: updates.name };
    }
    if ('techId' in updates && updates.techId !== before.techId) {
      changed.techId = { from: before.techId, to: updates.techId };
    }
    if ('building' in updates && updates.building !== before.building) {
      changed.building = { from: before.building, to: updates.building };
    }
    if ('passwordHash' in updates) {
      changed.password = 'updated';
    }

    emitWebhook('user.updated', {
      username: users[idx].username,
      changes: changed,
    }).catch(() => {});

    return res.json({
      message: 'User updated',
      user: {
        username: users[idx].username,
        role: users[idx].role,
        name: users[idx].name,
        techId: users[idx].techId,
        building: users[idx].building,
      },
    });
  } catch (err) {
    next(err);
  }
};

// POST login
const login = async (req, res, next) => {
  try {
    const username = s(req.body?.username);
    const password = s(req.body?.password);

    if (!username || !password) {
      return res.status(400).json({ message: 'Username and password required' });
    }

    const users = await loadUsers();
    const idx = findIndexByUsername(users, username);

    if (idx === -1) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const ok = await bcrypt.compare(password, users[idx].passwordHash || '');
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    await new Promise((resolve, reject) => {
      req.session.regenerate(err => (err ? reject(err) : resolve()));
    });

    req.session.user = {
      id: users[idx].username,
      username: users[idx].username,
      role: users[idx].role,
      name: users[idx].name,
      techId: users[idx].techId,
      building: users[idx].building,
    };

    emitWebhook('user.login', { username: users[idx].username }).catch(() => {});

    return res.json({
      message: 'Logged in',
      user: req.session.user,
    });
  } catch (err) {
    next(err);
  }
};

// GET whoami
const whoami = async (req, res, _next) => {
  const user = req.session?.user || null;
  res.json({ user, buildings: getBuildingOptions() });
};

// POST logout
const logout = (req, res, _next) => {
  req.session.destroy(() => res.json({ message: 'Logged out' }));
};

export default {
  getAllUsers,
  createUser,
  deleteUser,
  updateUser,
  login,
  logout,
  whoami,
};
