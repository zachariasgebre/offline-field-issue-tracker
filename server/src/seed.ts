import { randomUUID } from 'node:crypto';
import { db, insertHistory } from './db.js';
const id = randomUUID(), clientId = randomUUID(), now = new Date().toISOString();
db.prepare(`INSERT INTO reports (id, client_id, category, description, priority, status, custom_fields, reported_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '{}', ?, ?, ?)`)
  .run(id, clientId, 'water_point', 'Example: hand pump needs inspection', 'medium', 'Submitted', now, now, now);
insertHistory(id, 'CREATED', null, 'Submitted');
console.log(`Seeded report ${id}`);
