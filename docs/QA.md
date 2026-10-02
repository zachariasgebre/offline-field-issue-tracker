# QA and acceptance checks

## Automated checks

Run the production build and test suites from the workspace root:

```sh
npm run build
npm test
```

Shared and client tests run without a server process. Server API tests use Supertest with an in-memory SQLite database. `better-sqlite3` is a native module; if there is no prebuilt binary for the installed Node release, install the platform C++ build tools or use a Node release with a published binary.

## Manual offline workflow

- [ ] Start the API and client, create a report, and confirm its sync badge becomes **Synced**.
- [ ] Disconnect the network in browser developer tools, create a report, and confirm it remains visible as **Pending**.
- [ ] Refresh while offline and confirm the report and its history are still present.
- [ ] Reconnect and confirm the report syncs once, without a duplicate server row.
- [ ] Stop the API during a sync attempt, restart it, and confirm the queued operation succeeds.
- [ ] Cause a permanent API rejection and confirm the report shows the error and stays in the failed filter.
- [ ] Use **Retry** after addressing a permanent rejection; confirm the retry uses a new operation key.

## Coordinator workflow

- [ ] Select **Coordinator** and confirm server reports load into the coordinator queue.
- [ ] Open a report and confirm its server history appears.
- [ ] Move a report through valid states and confirm the server list and version update.
- [ ] Attempt a terminal or otherwise invalid transition through the API and confirm it returns 409.
- [ ] Edit a report offline, reconnect, and confirm the new fields sync.
- [ ] Submit a stale edit and confirm the version conflict is visible rather than silently overwriting server data.

## Validation and persistence

- [ ] Confirm an empty description is blocked by form validation and by API validation.
- [ ] Confirm out-of-range coordinates are rejected by the shared schema.
- [ ] Confirm each local write stores the report, outbox operation, and local history together.
