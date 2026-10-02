import Dexie, { type Table } from 'dexie';
import type { Category, Priority, Status } from '@field/shared';

export interface Report {
  clientId: string; serverId?: string; category: Category; description: string;
  location: { lat?: number; lng?: number; text?: string }; priority: Priority; status: Status;
  reportedAt: string; customFields: Record<string, string | number | boolean>;
  syncState: 'pending' | 'synchronized' | 'failed'; syncAttempts: number; lastSyncError?: string;
  lastSyncedAt?: string; serverVersion?: number; updatedAt: string;
}
export interface OutboxOp { opId: string; clientId: string; type: 'CREATE' | 'STATUS_CHANGE' | 'UPDATE'; payload: any; createdAt: string; attempts: number; nextRetryAt?: string; lastError?: string; permanentlyFailed: boolean }
export interface HistoryItem { id: string; clientId: string; type: string; fromStatus?: string; toStatus?: string; detail?: string; at: string; source: 'local' | 'server' }
class FieldDatabase extends Dexie {
  reports!: Table<Report, string>; outbox!: Table<OutboxOp, string>; history!: Table<HistoryItem, string>;
  constructor() { super('offline-field-issues'); this.version(1).stores({ reports: '&clientId,status,syncState,priority,reportedAt', outbox: '&opId,clientId,createdAt', history: '&id,clientId,at' }); }
}
export const db = new FieldDatabase();
