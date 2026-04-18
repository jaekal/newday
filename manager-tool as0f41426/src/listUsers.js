// src/listUsers.js
import { initDb, User } from './models/index.js';

(async () => {
  await initDb();

  const users = await User.findAll();
  console.log('=== USERS IN DB ===');
  users.forEach(u => {
    console.log({
      id: u.id,
      name: u.name,
      username: u.username,
      email: u.email,
      role: u.role,
    });
  });

  process.exit(0);
})();
