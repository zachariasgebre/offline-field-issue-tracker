# Offline Field Issue Tracker

A field-first issue tracker that keeps reports in the browser while offline and syncs them to a SQLite API when connectivity returns.

## Features

- Local-first issue capture with IndexedDB persistence
- Status workflow, report history, priority and location details
- Idempotent API operations, retry queue and coordinator status actions
- Offline indicator, health check, automatic and manual sync

## Stack

React, Vite and TypeScript; Dexie/IndexedDB; Express and SQLite; shared Zod domain validation.

## Getting started

Requires Node 22.13+ (the server uses Node's built-in SQLite module).

```sh
npm install
npm run dev
```

The client runs at `http://localhost:5173` and API at `http://localhost:3001`. Optional sample data: `npm run seed`.

## Commands

```sh
npm test
npm run build
```

Server tests use an in-memory SQLite database.

## Structure

- `client/` React application, Dexie repository and sync engine
- `server/` Express API and SQLite persistence
- `shared/` schemas, types and report status state machine
- `docs/SYNC.md` sync and conflict policy
- `docs/QA.md` automated test guidance and manual acceptance checklist

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health` | Connectivity check |
| `GET` | `/api/reports` | List reports; optional `status` and `updatedSince` filters |
| `POST` | `/api/reports` | Create or deduplicate a report (`Idempotency-Key` required) |
| `GET` | `/api/reports/:id` | Report details and server history |
| `PATCH` | `/api/reports/:id/status` | Validated workflow transition (`X-Role: coordinator`) |
| `PATCH` | `/api/reports/:id` | Optimistic field edit (`baseVersion` and `Idempotency-Key` required) |

## Assumptions and limitations

There is no authentication; `X-Role` is a demo role switch. Drafts stay local until submitted. Resolved and Rejected are terminal. There is no service worker, so the app shell requires a first online load. Attachments and multi-instance SQLite deployments are out of scope. Field edits use optimistic version checks and surface conflicts.

## Manual QA

See [docs/QA.md](docs/QA.md) for the full acceptance checklist.

## AI tool disclosure

This implementation was created with OpenAI Codex from the supplied implementation plan. Review and validate changes before deployment; the demo role toggle is not authentication.
