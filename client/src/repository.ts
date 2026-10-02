import { InvalidTransitionError, canTransition, type ReportInput, type Status } from '@field/shared';
import { db, type OutboxOp, type Report } from './db.js';

const uuid = () => globalThis.crypto.randomUUID();
export async function createReport(input: Omit<ReportInput, 'clientId' | 'reportedAt' | 'status'> & { status?: Status }) {
  const now = new Date().toISOString(), clientId = uuid();
  const report: Report = { ...input, clientId, reportedAt: now, status: input.status ?? 'Draft', syncState: 'pending', syncAttempts: 0, updatedAt: now };
  await db.transaction('rw', db.reports, db.outbox, db.history, async () => {
    await db.reports.put(report);
    if (report.status !== 'Draft') await db.outbox.put({ opId: uuid(), clientId, type: 'CREATE', payload: toPayload(report), createdAt: now, attempts: 0, permanentlyFailed: false });
    await db.history.put({ id: uuid(), clientId, type: 'CREATED', toStatus: report.status, at: now, source: 'local' });
  });
  return report;
}
const toPayload = (r: Report) => ({ clientId: r.clientId, category: r.category, description: r.description, location: r.location, priority: r.priority, status: r.status, reportedAt: r.reportedAt, customFields: r.customFields });

export async function changeStatus(clientId: string, to: Status) {
  await db.transaction('rw', db.reports, db.outbox, db.history, async () => {
    const report = await db.reports.get(clientId); if (!report) throw new Error('Report not found.');
    if (!canTransition(report.status, to)) throw new InvalidTransitionError(report.status, to);
    const from = report.status, at = new Date().toISOString(); report.status = to; report.updatedAt = at; report.syncState = 'pending'; await db.reports.put(report);
    if (from === 'Draft' && !report.serverId) await db.outbox.put({ opId: uuid(), clientId, type: 'CREATE', payload: toPayload(report), createdAt: at, attempts: 0, permanentlyFailed: false });
    else await db.outbox.put({ opId: uuid(), clientId, type: 'STATUS_CHANGE', payload: { serverId: report.serverId, status: to, baseVersion: report.serverVersion }, createdAt: at, attempts: 0, permanentlyFailed: false });
    await db.history.put({ id: uuid(), clientId, type: 'STATUS_CHANGED', fromStatus: from, toStatus: to, at, source: 'local' });
  });
}
export async function updateReport(clientId: string, changes: Partial<Pick<Report, 'description' | 'priority' | 'category' | 'location' | 'customFields'>>) {
  await db.transaction('rw', db.reports, db.outbox, db.history, async () => {
    const report = await db.reports.get(clientId); if (!report) throw new Error('Report not found.');
    Object.assign(report, changes); report.updatedAt = new Date().toISOString(); report.syncState = 'pending'; await db.reports.put(report);
    const op: OutboxOp = { opId: uuid(), clientId, type: 'UPDATE', payload: { ...changes, baseVersion: report.serverVersion }, createdAt: report.updatedAt, attempts: 0, permanentlyFailed: false };
    await db.outbox.put(op); await db.history.put({ id: uuid(), clientId, type: 'UPDATED', at: report.updatedAt, source: 'local' });
  });
}
