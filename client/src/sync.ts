import { db, type OutboxOp } from './db.js';
let syncing: Promise<void> | undefined;
const api = import.meta.env.VITE_API_URL ?? 'http://localhost:3001';
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function push(op: OutboxOp) {
  const report = await db.reports.get(op.clientId); if (!report) { await db.outbox.delete(op.opId); return; }
  const isCreate = op.type === 'CREATE';
  const path = isCreate ? '/api/reports' : op.type === 'STATUS_CHANGE' ? `/api/reports/${op.payload.serverId}/status` : `/api/reports/${report.serverId}`;
  try {
    const response = await fetch(`${api}${path}`, { method: isCreate ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': op.opId, 'X-Role': localStorage.getItem('field-role') ?? 'field_worker' }, body: JSON.stringify(op.type === 'UPDATE' ? { ...op.payload, baseVersion: report.serverVersion } : op.payload) });
    const body = await response.json().catch(() => ({}));
    if (response.ok) {
      await db.transaction('rw', db.reports, db.outbox, db.history, async () => {
        const latest = await db.reports.get(op.clientId); if (!latest) return;
        latest.serverId = body.id ?? latest.serverId; latest.serverVersion = body.version ?? latest.serverVersion; latest.syncState = 'synchronized'; latest.lastSyncedAt = new Date().toISOString(); latest.lastSyncError = undefined;
        if (op.type === 'CREATE') latest.status = body.status;
        await db.reports.put(latest); await db.outbox.delete(op.opId);
        await db.history.put({ id: crypto.randomUUID(), clientId: op.clientId, type: 'SYNCED', at: new Date().toISOString(), source: 'server' });
      }); return;
    }
    if (response.status >= 500 || response.status === 429) throw new Error(body.message ?? `Server error ${response.status}`);
    await db.transaction('rw', db.reports, db.outbox, db.history, async () => {
      const latest = await db.reports.get(op.clientId); if (latest) { latest.syncState = 'failed'; latest.lastSyncError = body.message ?? `Request failed (${response.status})`; await db.reports.put(latest); }
      await db.outbox.update(op.opId, { permanentlyFailed: true, lastError: body.message ?? `Request failed (${response.status})` });
      await db.history.put({ id: crypto.randomUUID(), clientId: op.clientId, type: 'SYNC_FAILED', detail: body.message, at: new Date().toISOString(), source: 'local' });
    });
  } catch (error) {
    const attempts = op.attempts + 1, message = error instanceof Error ? error.message : 'Network error';
    const backoff = Math.min(300_000, 1000 * 2 ** Math.min(attempts, 8));
    await db.transaction('rw', db.reports, db.outbox, async () => {
      await db.outbox.update(op.opId, { attempts, lastError: message, nextRetryAt: new Date(Date.now() + backoff).toISOString() });
      const latest = await db.reports.get(op.clientId); if (latest) { latest.syncAttempts = attempts; latest.lastSyncError = message; if (attempts >= 5) latest.syncState = 'failed'; await db.reports.put(latest); }
    }); await wait(Math.min(backoff, 5000));
  }
}
export function syncNow() {
  if (syncing) return syncing;
  syncing = (async () => {
    const ops = await db.outbox.orderBy('createdAt').toArray();
    for (const op of ops) { if (op.permanentlyFailed || (op.nextRetryAt && op.nextRetryAt > new Date().toISOString())) continue; await push(op); }
    await pullUpdates();
  })().finally(() => { syncing = undefined; });
  return syncing;
}
async function pullUpdates() {
  try {
    const response = await fetch(`${api}/api/reports?updatedSince=${encodeURIComponent(new Date(Date.now() - 86_400_000).toISOString())}`);
    if (!response.ok) return;
    const rows = await response.json();
    for (const server of rows) {
      const local = await db.reports.where('clientId').equals(server.clientId).first();
      if (local && await db.outbox.where('clientId').equals(server.clientId).count() > 0) continue;
      if (local) await db.reports.put({ ...local, ...server, clientId: server.clientId, serverId: server.id, syncState: 'synchronized', serverVersion: server.version });
    }
  } catch { /* A pull failure leaves local data untouched. */ }
}
