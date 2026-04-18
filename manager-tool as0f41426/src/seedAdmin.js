// src/seedAdmin.js
import bcrypt from 'bcryptjs';
import { initDb, User } from './models/index.js';

(async () => {
  await initDb();

  const existing = await User.findOne({ where: { username: 'admin' } });
  if (existing) {
    console.log('Admin user already exists');
    process.exit(0);
  }

  const password = 'Admin123!'; // change after first login
  const passwordHash = await bcrypt.hash(password, 10);

  await User.create({
    name: 'Admin User',
    username: 'admin',
    email: 'admin@example.com',
    role: 'MANAGER',
    phone: '',
    passwordHash,
  });

  console.log('Seeded admin user:');
  console.log('  username: admin');
  console.log('  password:', password);
  process.exit(0);
})();
