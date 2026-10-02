import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { app } from './app.js';
import { db } from './db.js';

const createBody = () => ({ clientId: randomUUID(), category: 'equipment', description: 'Generator cable is damaged', priority: 'high', status: 'Submitted', reportedAt: new Date().toISOString(), customFields: {} });
async function createReport(body = createBody(), opId = randomUUID()) {
  const response = await request(app).post('/api/reports').set('Idempotency-Key', opId).send(body);
  expect(response.status).toBe(201); return { response, opId };
}
beforeEach(() => { db.exec('DELETE FROM processed_ops; DELETE FROM report_history; DELETE FROM reports;'); });

describe('report API idempotency and validation', () => {
  it('replays a create response for a repeated operation key', async () => {
    const body = createBody(), opId = randomUUID();
    const first = await createReport(body, opId), second = await createReport(body, opId);
    expect(second.response.body.id).toBe(first.response.body.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM reports').get()).toMatchObject({ count: 1 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM report_history').get()).toMatchObject({ count: 1 });
  });

  it('deduplicates a client id even when the operation key changes', async () => {
    const body = createBody(), first = await createReport(body), second = await createReport(body);
    expect(second.response.body.id).toBe(first.response.body.id);
    expect(db.prepare('SELECT COUNT(*) AS count FROM reports').get()).toMatchObject({ count: 1 });
  });

  it('rejects invalid workflow moves without modifying report state', async () => {
    const { response: created } = await createReport();
    const result = await request(app).patch(`/api/reports/${created.body.id}/status`).set('X-Role', 'coordinator').set('Idempotency-Key', randomUUID()).send({ status: 'Resolved' });
    expect(result.status).toBe(409); expect(result.body.code).toBe('INVALID_TRANSITION');
    expect((db.prepare('SELECT status FROM reports WHERE id = ?').get(created.body.id) as any).status).toBe('Submitted');
  });

  it('rejects field worker assignment and writes no transition', async () => {
    const { response: created } = await createReport();
    const result = await request(app).patch(`/api/reports/${created.body.id}/status`).set('Idempotency-Key', randomUUID()).send({ status: 'Assigned' });
    expect(result.status).toBe(403);
    expect(db.prepare('SELECT COUNT(*) AS count FROM report_history WHERE event_type = ?').get('STATUS_CHANGED')).toMatchObject({ count: 0 });
  });

  it('validates editable fields and idempotently records the successful edit', async () => {
    const { response: created } = await createReport(), opId = randomUUID();
    const sendEdit = () => request(app).patch(`/api/reports/${created.body.id}`).set('Idempotency-Key', opId).send({ baseVersion: 1, priority: 'critical' });
    const first = await sendEdit(), replay = await sendEdit();
    expect(first.status).toBe(200); expect(first.body.priority).toBe('critical');
    expect(replay.body.version).toBe(2);
    expect(db.prepare("SELECT COUNT(*) AS count FROM report_history WHERE event_type = 'UPDATED'").get()).toMatchObject({ count: 1 });
  });

  it('surfaces stale field edits as a conflict', async () => {
    const { response: created } = await createReport();
    const result = await request(app).patch(`/api/reports/${created.body.id}`).set('Idempotency-Key', randomUUID()).send({ baseVersion: 9, description: 'Stale update' });
    expect(result.status).toBe(409); expect(result.body.code).toBe('VERSION_CONFLICT');
  });
});
