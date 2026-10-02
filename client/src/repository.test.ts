import 'fake-indexeddb/auto';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from './db.js';
import { changeStatus, createReport } from './repository.js';
import { refreshServerReports, retryReport, syncNow } from './sync.js';

const validReport = (overrides: Record<string, unknown> = {}) => ({ category: 'equipment' as const, priority: 'high' as const, description: 'Broken pump handle', location: { text: 'North well' }, customFields: {}, ...overrides });
beforeEach(async () => { await db.delete(); await db.open(); });
afterAll(async () => { await db.delete(); });

describe('offline report repository', () => {
  it('writes a submitted report, outbox operation, and history together', async () => {
    const report = await createReport(validReport());
    expect(await db.reports.get(report.clientId)).toMatchObject({ syncState: 'pending', status: 'Submitted' });
    expect(await db.outbox.where('clientId').equals(report.clientId).count()).toBe(1);
    expect(await db.history.where('clientId').equals(report.clientId).count()).toBe(1);
  });

  it('keeps drafts local until they are submitted', async () => {
    const report = await createReport(validReport({ status: 'Draft' }));
    expect(await db.outbox.where('clientId').equals(report.clientId).count()).toBe(0);
    await changeStatus(report.clientId, 'Submitted');
    expect((await db.outbox.where('clientId').equals(report.clientId).first())?.type).toBe('CREATE');
  });

  it('rejects invalid status moves without changing local state', async () => {
    const report = await createReport(validReport());
    await expect(changeStatus(report.clientId, 'Resolved')).rejects.toThrow('Cannot move a report');
    expect((await db.reports.get(report.clientId))?.status).toBe('Submitted');
  });

  it('rejects an invalid description before writing local rows', async () => {
    await expect(createReport(validReport({ description: ' ' }))).rejects.toThrow();
    expect(await db.reports.count()).toBe(0); expect(await db.outbox.count()).toBe(0);
  });
});

describe('sync engine', () => {
  it('imports coordinator reports from the API into the local database', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'remote-1', clientId: 'remote-client', category: 'safety', description: 'Loose railing', location: { text: 'Bridge' }, priority: 'critical', status: 'Assigned', reportedAt: new Date().toISOString(), customFields: {}, version: 3, updatedAt: new Date().toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await refreshServerReports();
    expect(await db.reports.get('remote-client')).toMatchObject({ serverId: 'remote-1', status: 'Assigned', syncState: 'synchronized', serverVersion: 3 });
    vi.unstubAllGlobals();
  });

  it('does not replace local fields while a report has queued work', async () => {
    const local = await createReport(validReport());
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'remote-1', clientId: local.clientId, category: 'safety', description: 'Server copy', location: {}, priority: 'low', status: 'Assigned', reportedAt: local.reportedAt, customFields: {}, version: 2, updatedAt: new Date().toISOString() }]), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    await refreshServerReports();
    expect(await db.reports.get(local.clientId)).toMatchObject({ description: local.description, status: 'Submitted' });
    vi.unstubAllGlobals();
  });

  it('acknowledges a create before removing its outbox operation', async () => {
    const report = await createReport(validReport());
    vi.stubGlobal('localStorage', { getItem: () => 'field_worker' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      return url.includes('/api/reports?') ? new Response('[]', { status: 200 }) : new Response(JSON.stringify({ id: 'server-1', clientId: report.clientId, status: 'Submitted', version: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    await syncNow();
    expect(await db.outbox.where('clientId').equals(report.clientId).count()).toBe(0);
    expect(await db.reports.get(report.clientId)).toMatchObject({ serverId: 'server-1', syncState: 'synchronized', serverVersion: 1 });
    vi.unstubAllGlobals();
  });

  it('creates a fresh idempotency key when a permanent failure is manually retried', async () => {
    const report = await createReport(validReport()), op = await db.outbox.where('clientId').equals(report.clientId).first();
    await db.outbox.update(op!.opId, { permanentlyFailed: true, lastError: 'Rejected' });
    await db.reports.update(report.clientId, { syncState: 'failed', lastSyncError: 'Rejected' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => String(input).includes('/api/reports?') ? new Response('[]') : new Response(JSON.stringify({ id: 'server-2', clientId: report.clientId, status: 'Submitted', version: 1 }), { status: 201, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('localStorage', { getItem: () => 'field_worker' }); vi.stubGlobal('fetch', fetchMock);
    await retryReport(report.clientId);
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'Idempotency-Key': expect.not.stringMatching(op!.opId) });
    expect(await db.outbox.where('clientId').equals(report.clientId).count()).toBe(0);
    vi.unstubAllGlobals();
  });
});
