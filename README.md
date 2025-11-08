# CAP TypeScript Monorepo

This repository hosts a full SAP Cloud Application Programming Model (CAP) solution that runs entirely on the TypeScript/Node.js runtime. It contains the CAP backend, an SAPUI5 HR administration UI, end-to-end tests, and deployment descriptors so that the complete stack can be developed, tested, and delivered from one place.

## Repository structure

```
/db                 # CDS data model, CSV seed data, and HDI artefacts
/srv                # CAP TypeScript service (domain logic, infrastructure, tests)
/app/hr-admin       # SAPUI5 frontend written in TypeScript
/approuter          # Application router configuration for BTP
/tests              # Cross-cutting Playwright e2e tests and utilities
/types              # Additional TypeScript typings (e.g. CAP declarations)
```

## Getting started

### Prerequisites

- Node.js 22 or newer (the root `package.json` enforces `>=22.0.0`).
- npm 10 (ships with Node 22).

### Install and run locally

```bash
npm install          # installs root and workspace dependencies
npm run deploy       # creates/updates the local SQLite database in ./db
npm run dev          # runs cds watch (TypeScript aware) + UI5 dev server concurrently
```

`npm run dev` launches `cds watch` through the service workspace (`srv`) and the UI5 tooling dev server for the HR admin UI (`app/hr-admin`). During development the UI5 server proxies `/odata` requests to `http://localhost:4004/odata`, so CAP and the UI run side-by-side. Use `npm run dev:fresh` to drop the SQLite database (`db/*.db`) before starting the dev servers when you need a clean environment.

### Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Runs the CAP watcher (`npm run watch --workspace srv`) and the UI5 dev server in parallel. |
| `npm run dev:fresh` | Recreates the SQLite database (`npm run deploy:clean`) and then starts the dev servers. |
| `npm run build` | Builds the CAP service (`tsc` via `srv` workspace) and bundles the UI (`ui5 build`). |
| `npm run start` | Builds the stack and starts CAP in production mode serving the built UI from `app/hr-admin/dist`. |
| `npm run start:runtime` | Starts only the CAP runtime from the service workspace (expects compiled JavaScript). |
| `npm run deploy` | Executes `cds deploy --to sqlite:db/sqlite.db` to create/update the local database. |
| `npm run deploy:clean` | Removes existing SQLite database files in `db/` and redeploys CDS artefacts. |
| `npm test` | Runs backend Jest tests (`npm run test --workspace srv`) followed by Playwright e2e tests. |
| `npm run test:backend` | Executes Jest with ts-node against the CAP service (runs in `srv`). |
| `npm run test:frontend` | Runs the Playwright suite from `tests/e2e`. |
| `npm run lint` | Lints all TypeScript sources in the service workspace with ESLint. |

## Backend specifics

- **Runtime:** CAP 9 running on Node.js/TypeScript. `srv/watch` compiles TypeScript with `tsc --watch` and runs `cds watch` through `ts-node/register` so you can change `.ts` handlers without manual builds.【F:srv/package.json†L6-L16】【F:srv/package.json†L42-L55】
- **Data model:** `db/schema.cds` defines Clients, Employees, CostCenters, and outbox entities. Clients own employees and cost centres, employee records include optimistic concurrency metadata (`@odata.etag: 'modifiedAt'`), and there is a DLQ (`EmployeeNotificationDLQ`) alongside the outbox table used for third-party notifications.【F:db/schema.cds†L9-L90】
- **Domain-driven layout:** Business logic lives in `srv/domain/<feature>` packages. Each feature exposes DTOs, repositories, services, and handler registration via `srv/handlers.ts` so cross-cutting middleware (like company authorization) is centralised.【F:srv/handlers.ts†L1-L21】【F:srv/domain/employee/handlers/on-create.ts†L1-L40】
- **Optimistic concurrency:** Utility helpers enforce ETag or `modifiedAt` checks. If a client does not send `If-Match` headers, the payload must include the latest `modifiedAt` value; otherwise requests fail with `428 Precondition Required` or `412 Precondition Failed`.【F:srv/shared/utils/concurrency.ts†L1-L200】【F:srv/service.cds†L15-L45】
- **Business rules:**
  - Employee lifecycle services normalise identifiers, ensure entry/exit date consistency, and generate deterministic employee IDs per client with retry-on-unique-constraint logic.【F:srv/domain/employee/services/lifecycle.service.ts†L1-L120】【F:srv/domain/employee/services/lifecycle.service.ts†L360-L429】
  - The `anonymizeFormerEmployees` action batches anonymisation of exited staff. The batch size can be tuned through `ANONYMIZATION_BATCH_SIZE` with defensive bounds enforced in code.【F:srv/domain/employee/services/retention.service.ts†L1-L90】
  - Third-party notifications are prepared in `srv/infrastructure/api/third-party/employee-notifier.ts`, which groups employees per client endpoint and signs payloads using HMAC if a secret is configured.【F:srv/infrastructure/api/third-party/employee-notifier.ts†L1-L120】【F:srv/infrastructure/api/third-party/employee-notifier.ts†L164-L213】
- **Security & authorisation:**
  - Local development uses CAP’s mocked authentication provider with three roles (`HRAdmin`, `HREditor`, `HRViewer`) and company code attributes defined in `package.json`. Production profiles switch to IAS and AMS bindings automatically.【F:package.json†L28-L94】
  - CDS service annotations (`@restrict`) enforce role-based access and attribute filters. Additional runtime checks in `srv/middleware/company-authorization.ts` validate that write operations stay within the caller’s allowed company codes.【F:srv/service.cds†L5-L45】【F:srv/middleware/company-authorization.ts†L1-L120】
- **API surface:**
  - `/health` responds with `{ status: 'ok' }` for platform readiness probes.【F:srv/server.ts†L33-L40】
  - `/api/employees/active` exposes an API-key protected export. Keys are loaded from the BTP Credential Store when bound, or fall back to the `EMPLOYEE_EXPORT_API_KEY` environment variable. The middleware compares keys using `crypto.timingSafeEqual`.【F:srv/server.ts†L42-L53】【F:srv/middleware/apiKey.ts†L1-L65】
- **Outbox & integration resilience:**
  - Employee create events enqueue payloads into `EmployeeNotificationOutbox`. A scheduler dispatches them with configurable retry/backoff, moves permanently failing messages to `EmployeeNotificationDLQ`, and exposes Prometheus metrics (enqueued, dispatched, failed, pending).【F:db/schema.cds†L56-L90】【F:srv/infrastructure/outbox/index.ts†L1-L18】【F:srv/infrastructure/outbox/metrics.ts†L1-L40】
  - The dispatcher honours `OUTBOX_*` environment variables for retry delay, batch size, worker count, claim TTL, enqueue retries, cleanup retention, dispatch interval, and cleanup cron expression.【F:srv/infrastructure/outbox/config.ts†L1-L89】
  - Background jobs start when services are served (unless `NODE_ENV=test`) and shut down gracefully on process exit.【F:srv/server.ts†L6-L78】
- **Observability & logging:** Correlation IDs are generated for every request, propagated to responses, and forwarded to the structured logger. If `@sap/logging` is unavailable the code falls back to console logging while preserving component prefixes.【F:srv/server.ts†L14-L37】【F:srv/shared/utils/logger.ts†L1-L62】
- **Secrets management:** Helper utilities attempt to read secrets from the BTP Credential Store and fall back to environment variables (`EMPLOYEE_EXPORT_API_KEY`, `THIRD_PARTY_EMPLOYEE_SECRET`). Missing secrets are logged with context to aid troubleshooting.【F:srv/shared/utils/secrets.ts†L1-L120】【F:srv/shared/utils/secrets.ts†L122-L147】

## Frontend specifics

- The HR admin UI is a TypeScript-based UI5 application located in `app/hr-admin`. UI5 tooling transpiles TypeScript sources via custom middleware/tasks and serves the app on port 8081 during development.【F:app/hr-admin/ui5.yaml†L1-L28】
- `ui5-middleware-simpleproxy` forwards `/odata` calls to the local CAP server so that the UI can consume live OData during development without additional configuration.【F:app/hr-admin/ui5.yaml†L23-L28】
- Production builds are emitted to `app/hr-admin/dist` and are served either directly by CAP (via `cds.serve.static`) or through the approuter + HTML5 repo modules defined in `mta.yaml`.【F:package.json†L112-L120】【F:mta.yaml†L14-L120】

## Testing

The test suite is split into layers:

1. **Service tests (Jest + Supertest)** – Located in `srv/test`. Tests cover domain logic, outbox dispatchers, company-code authorisation, and API key behaviour using the mocked authentication provider.【F:srv/package.json†L6-L16】【F:srv/test/domain/employee/active-employees.test.ts†L1-L40】
2. **End-to-end tests (Playwright)** – `tests/e2e` starts a throwaway CAP process (via `tests/utils/cap-server.ts`) and exercises the published OData API using Playwright’s request API.【F:tests/utils/cap-server.ts†L1-L80】【F:tests/e2e/client-service.spec.ts†L1-L28】
3. **UI unit tests** – The UI5 project keeps the standard `webapp/test` location; add QUnit/OPA5 tests there as needed.

Run all tests with `npm test`. To collect backend coverage execute `npm run test --workspace srv -- --coverage`.

## Authentication & authorisation

- Mocked users (dev, hrviewer, hreditor) with preconfigured company codes are defined in the CAP configuration for local development.【F:package.json†L54-L94】
- Production switches `auth` to IAS and `ams` to the Authorization Management Service when service bindings are available. AMS attribute propagation is wired through `srv/attributes.cds` so company codes flow into AMS policies automatically.【F:package.json†L95-L127】【F:srv/attributes.cds†L1-L4】
- Role restrictions in `srv/service.cds` align with AMS scopes (`HRAdmin`, `HREditor`, `HRViewer`) and ensure read/write segregation across company codes.【F:srv/service.cds†L5-L45】

## Deployment

The `mta.yaml` file describes the Cloud Foundry deployment:

- **cap-ts-srv** – CAP service (Node.js) bound to HANA, IAS, AMS, Destination, Connectivity, Application Logs, and Credential Store. Provides a `srv-api` destination for other modules.【F:mta.yaml†L14-L78】
- **cap-ts-db-deployer** – HDI deployer for CDS artefacts.【F:mta.yaml†L80-L94】
- **cap-ts-ams-deployer** – Deploys generated AMS DCL bundles with an IAS X.509 client.【F:mta.yaml†L96-L131】
- **cap-ts-app-hr-admin** & **cap-ts-app-deployer** – Build and publish the UI5 app to the HTML5 application repository.【F:mta.yaml†L133-L178】
- **cap-ts-approuter** – Serves the UI, protects routes via IAS, and forwards `/odata/v4/*` to the CAP service.【F:mta.yaml†L180-L214】【F:approuter/xs-app.json†L1-L18】
- Shared resources include HANA, IAS, AMS, Destination, Connectivity, HTML5 repo host/runtime, Application Logs, and Credential Store.【F:mta.yaml†L216-L240】

## Environment variables

| Variable | Purpose |
| --- | --- |
| `EMPLOYEE_EXPORT_API_KEY` | Fallback API key for `/api/employees/active` when Credential Store is unavailable.【F:srv/middleware/apiKey.ts†L17-L47】【F:srv/shared/utils/secrets.ts†L122-L147】 |
| `THIRD_PARTY_EMPLOYEE_SECRET` | Optional shared secret used to sign third-party employee notifications (HMAC SHA-256).【F:srv/infrastructure/api/third-party/employee-notifier.ts†L121-L213】 |
| `ANONYMIZATION_BATCH_SIZE` | Overrides the batch size for the `anonymizeFormerEmployees` action (capped at 10,000).【F:srv/domain/employee/services/retention.service.ts†L1-L90】 |
| `OUTBOX_RETRY_DELAY_MS` | Delay (ms) between retry attempts when dispatching outbox entries.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_MAX_ATTEMPTS` | Maximum dispatch attempts before moving an entry to the DLQ.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_BATCH_SIZE` | Maximum number of entries fetched per polling cycle.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_CLAIM_TTL_MS` | Time (ms) after which a claimed entry becomes available again if not processed.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_DISPATCHER_WORKERS` | Number of parallel dispatcher workers processing batches.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_ENQUEUE_MAX_ATTEMPTS` | Retry limit for enqueue operations encountering transient failures.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_CLEANUP_RETENTION_MS` | Retention window (ms) before completed/failed entries are purged by the cleanup task.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_DISPATCH_INTERVAL_MS` | Interval (ms) at which the scheduler wakes up to dispatch pending outbox entries.【F:srv/infrastructure/outbox/config.ts†L1-L89】 |
| `OUTBOX_CLEANUP_CRON` | Cron expression controlling the periodic cleanup job (supports minute/hour shortcuts).【F:srv/infrastructure/outbox/config.ts†L1-L89】 |

For local-only scenarios you can also set `NODE_ENV`, `CDS_ENV`, and `CDS_PROFILES` to `test` when running tests outside of npm scripts (the Playwright utilities do this automatically).【F:tests/utils/cap-server.ts†L1-L40】

## Employee export API

External systems can request the list of active employees via the dedicated REST endpoint:

```
GET /api/employees/active
```

Provide the API key through the `x-api-key` header or the `Authorization: ApiKey <key>` scheme. If no key is configured, the middleware rejects requests with `401 { "error": "invalid_api_key" }`. Use the Credential Store binding in production and `EMPLOYEE_EXPORT_API_KEY` for local testing.【F:srv/middleware/apiKey.ts†L1-L65】【F:srv/middleware/apiKey.ts†L67-L90】
