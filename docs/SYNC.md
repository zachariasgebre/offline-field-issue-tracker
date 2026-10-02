# Offline and sync design

Reports are written to IndexedDB first. Every non-draft write also adds an outbox operation in the same Dexie transaction. The sync loop sends operations in creation order and removes an operation only after the API acknowledges it.

## Local model

`reports` stores the editable report and latest server version. `outbox` stores durable operations with a stable UUID idempotency key. `history` is the local timeline; the API keeps a corresponding audit log.

## Connectivity and retry

Browser online/offline events update the indicator. The client also pings `/api/health`, syncs on app load, every 30 seconds when work is queued, and on demand. Network errors and 5xx responses are retried with exponential backoff capped at five minutes. Permanent 4xx responses are marked failed and remain visible. A manual retry after a permanent failure creates a new operation ID; retries for transient failures keep their original key.

## Idempotency

`clientId` is unique in SQLite. Each outbox operation sends its immutable `opId` in `Idempotency-Key`; the server stores the response in `processed_ops` in the same transaction as report and history changes. A retry after a lost response replays the original response.

## Conflict policy

The server is authoritative for status transitions. Field edits carry `baseVersion`; stale versions receive 409 so the client can surface the conflict. Pull updates merge only when there is no queued local operation for that report. The role header is a demo assumption, not authentication.

## Known limitations

- No service worker: the app shell requires an initial online load.
- No real authentication or multi-user permissions.
- Conflict resolution surfaces stale edits instead of automatically merging fields.
- Device clock skew can affect report timestamps.
- No attachments; SQLite targets a single server instance.
