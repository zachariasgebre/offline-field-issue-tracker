import express from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import { canTransition, reportInputSchema, type Status } from '@field/shared';
import { db, insertHistory } from './db.js';

export const app = express();
app.use(cors()); app.use(express.json());
const reportRow = db.prepare('SELECT * FROM reports WHERE id = ?');
const historyRows = db.prepare('SELECT * FROM report_history WHERE report_id = ? ORDER BY created_at');
const getByClientId = db.prepare('SELECT * FROM reports WHERE client_id = ?');
const getById = db.prepare('SELECT * FROM reports WHERE id = ?');
const saveOp = db.prepare('INSERT INTO processed_ops (op_id, report_id, response_status, response_body, created_at) VALUES (?, ?, ?, ?, ?)');
const getOp = db.prepare('SELECT response_status, response_body FROM processed_ops WHERE op_id = ?');
const toReport = (row: any) => row && ({ id: row.id, clientId: row.client_id, category: row.category, description: row.description, location: { lat: row.lat ?? undefined, lng: row.lng ?? undefined, text: row.location_text ?? undefined }, priority: row.priority, status: row.status, customFields: JSON.parse(row.custom_fields), reportedAt: row.reported_at, createdAt: row.created_at, updatedAt: row.updated_at, version: row.version });
const role = (req: express.Request) => req.header('X-Role') ?? 'field_worker';

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.post('/api/reports', (req, res, next) => {
  try {
    const opId = req.header('Idempotency-Key');
    if (!opId) return res.status(400).json({ code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key is required.' });
    const replay = getOp.get(opId) as any;
    if (replay) return res.status(replay.response_status).json(JSON.parse(replay.response_body));
    const input = reportInputSchema.parse(req.body);
    if (input.status === 'Draft') return res.status(400).json({ code: 'DRAFT_NOT_SYNCABLE', message: 'Drafts are stored locally until submitted.' });
    if (input.status !== 'Submitted' && role(req) !== 'coordinator') return res.status(403).json({ code: 'FORBIDDEN', message: 'Only coordinators can set this status.' });
    const result = db.transaction(() => {
      let report = getByClientId.get(input.clientId) as any;
      if (!report) {
        const now = new Date().toISOString(), id = randomUUID();
        db.prepare(`INSERT INTO reports (id, client_id, category, description, lat, lng, location_text, priority, status, custom_fields, reported_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(id, input.clientId, input.category, input.description, input.location.lat ?? null, input.location.lng ?? null, input.location.text ?? null, input.priority, input.status, JSON.stringify(input.customFields), input.reportedAt, now, now);
        insertHistory(id, 'CREATED', null, input.status, role(req));
        report = getById.get(id);
      }
      const body = toReport(report);
      saveOp.run(opId, report.id, 201, JSON.stringify(body), new Date().toISOString());
      return body;
    })();
    res.status(201).json(result);
  } catch (e) { next(e); }
});

app.get('/api/reports', (req, res) => {
  const clauses: string[] = []; const args: unknown[] = [];
  if (req.query.status) { clauses.push('status = ?'); args.push(req.query.status); }
  if (req.query.updatedSince) { clauses.push('updated_at > ?'); args.push(req.query.updatedSince); }
  const rows = db.prepare(`SELECT * FROM reports ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''} ORDER BY updated_at DESC`).all(...args);
  res.json(rows.map(toReport));
});
app.get('/api/reports/:id', (req, res) => {
  const row = reportRow.get(req.params.id) as any;
  if (!row) return res.status(404).json({ code: 'NOT_FOUND', message: 'Report not found.' });
  res.json({ ...toReport(row), history: historyRows.all(row.id) });
});

app.patch('/api/reports/:id/status', (req, res, next) => {
  try {
    const opId = req.header('Idempotency-Key'); if (!opId) return res.status(400).json({ code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key is required.' });
    const replay = getOp.get(opId) as any; if (replay) return res.status(replay.response_status).json(JSON.parse(replay.response_body));
    const result = db.transaction(() => {
      const row = reportRow.get(req.params.id) as any;
      if (!row) return { status: 404, body: { code: 'NOT_FOUND', message: 'Report not found.' } };
      const to = req.body.status as Status, from = row.status as Status;
      if (role(req) !== 'coordinator') return { status: 403, body: { code: 'FORBIDDEN', message: 'Only coordinators can change report status.' } };
      if (!canTransition(from, to)) return { status: 409, body: { code: 'INVALID_TRANSITION', message: `Cannot move from ${from} to ${to}.`, from, to, allowed: (awaitlessTransitions(from)) } };
      const now = new Date().toISOString(); db.prepare('UPDATE reports SET status = ?, updated_at = ?, version = version + 1 WHERE id = ?').run(to, now, row.id);
      insertHistory(row.id, 'STATUS_CHANGED', from, to, role(req));
      return { status: 200, body: toReport(reportRow.get(row.id)) };
    })();
    if (result.status >= 500) return res.status(result.status).json(result.body);
    db.transaction(() => saveOp.run(opId, req.params.id, result.status, JSON.stringify(result.body), new Date().toISOString()))();
    return res.status(result.status).json(result.body);
  } catch (e) { next(e); }
});
function awaitlessTransitions(status: Status) { return ({ Draft: ['Submitted'], Submitted: ['Assigned', 'Rejected'], Assigned: ['In Progress', 'Rejected'], 'In Progress': ['Resolved', 'Rejected'], Resolved: [], Rejected: [] } as Record<Status, string[]>)[status]; }

app.patch('/api/reports/:id', (req, res) => {
  const row = reportRow.get(req.params.id) as any; if (!row) return res.status(404).json({ code: 'NOT_FOUND', message: 'Report not found.' });
  if (req.body.baseVersion !== row.version) return res.status(409).json({ code: 'VERSION_CONFLICT', message: 'Report changed on the server.', current: toReport(row) });
  const now = new Date().toISOString();
  const fields = ['description', 'priority', 'category'] as const;
  const updates = fields.filter(k => req.body[k] !== undefined);
  if (req.body.location) { req.body.lat = req.body.location.lat; req.body.lng = req.body.location.lng; req.body.location_text = req.body.location.text; }
  const cols: Record<string, string> = { description: 'description', priority: 'priority', category: 'category', lat: 'lat', lng: 'lng', location_text: 'location_text' };
  const sets: string[] = [], values: unknown[] = [];
  for (const k of updates) { sets.push(`${cols[k]} = ?`); values.push(req.body[k]); }
  for (const k of ['lat', 'lng', 'location_text']) if (req.body[k] !== undefined) { sets.push(`${k} = ?`); values.push(req.body[k]); }
  if (req.body.customFields) { sets.push('custom_fields = ?'); values.push(JSON.stringify(req.body.customFields)); }
  sets.push('updated_at = ?', 'version = version + 1'); values.push(now, row.id);
  db.prepare(`UPDATE reports SET ${sets.join(', ')} WHERE id = ?`).run(...values);
  insertHistory(row.id, 'UPDATED', row.status, row.status, role(req)); res.json(toReport(reportRow.get(row.id)));
});

app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err?.name === 'ZodError') return res.status(422).json({ code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: err.issues });
  console.error(err); res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected server error.' });
});
