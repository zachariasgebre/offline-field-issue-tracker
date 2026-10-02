import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { DatabaseSync as DatabaseSyncType } from 'node:sqlite';

const require = createRequire(import.meta.url);
const DatabaseSync = require('node:sqlite').DatabaseSync as typeof DatabaseSyncType;

export const db = new DatabaseSync(process.env.DB_PATH ?? 'field-issues.sqlite');
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
db.exec(`
CREATE TABLE IF NOT EXISTS reports (
 id TEXT PRIMARY KEY, client_id TEXT NOT NULL UNIQUE, category TEXT NOT NULL,
 description TEXT NOT NULL, lat REAL, lng REAL, location_text TEXT,
 priority TEXT NOT NULL, status TEXT NOT NULL, custom_fields TEXT NOT NULL DEFAULT '{}',
 reported_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS report_history (
 id TEXT PRIMARY KEY, report_id TEXT NOT NULL REFERENCES reports(id), event_type TEXT NOT NULL,
 from_status TEXT, to_status TEXT, actor TEXT, detail TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_ops (
 op_id TEXT PRIMARY KEY, report_id TEXT, response_status INTEGER NOT NULL, response_body TEXT NOT NULL, created_at TEXT NOT NULL
);`);
export function transaction<T>(operation: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
export const history = db.prepare('INSERT INTO report_history (id, report_id, event_type, from_status, to_status, actor, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
export const insertHistory = (reportId: string, event: string, from?: string | null, to?: string | null, actor = 'field_worker', detail?: unknown) => history.run(randomUUID(), reportId, event, from ?? null, to ?? null, actor, detail ? JSON.stringify(detail) : null, new Date().toISOString());
