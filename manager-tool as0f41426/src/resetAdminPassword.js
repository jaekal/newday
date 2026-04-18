// src/resetAdminPassword.js — run once then delete
import bcrypt from 'bcryptjs';
import sqlite3 from 'sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const dbPath = process.env.MANAGER_TOOL_DB_PATH
  || path.join(__dirname, '..', 'data', 'manager-tool.sqlite');

console.log('Using DB:', dbPath);

const hash = await bcrypt.hash('admin123', 10);
const db = new sqlite3.Database(dbPath);

db.run(
  `UPDATE Users SET passwordHash = ? WHERE username = 'admin'`,
  [hash],
  function (err) {
    if (err) { console.error('Error:', err.message); process.exit(1); }
    if (this.changes === 0) {
      console.error('No admin user found. Check the DB path above is correct.');
      process.exit(1);
    }
    console.log('Admin password reset to: admin123');
    db.close();
  }
);
