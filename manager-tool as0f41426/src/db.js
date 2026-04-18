// src/db.js
import { Sequelize } from 'sequelize';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


const storagePath = path.join(__dirname, '..', 'data', 'manager-tool.sqlite');

fs.mkdirSync(path.dirname(storagePath), { recursive: true });
console.log('DB DEBUG → using sqlite file:', storagePath);

const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: storagePath,
  logging: false,
});

export default sequelize;
