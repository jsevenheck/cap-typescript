# CAP TypeScript Monorepo

This repository contains a full SAP Cloud Application Programming Model (CAP) stack that has been migrated from the Java runtime to the TypeScript/Node.js runtime. Both the backend services and the HR Admin UI are contained in the same repository and can be developed, tested, and deployed together.

## Repository structure

```
/db                 # CDS data model and seed data
/srv                # CAP TypeScript service implementation
/app/hr-admin       # SAPUI5 HR administration frontend (TypeScript)
/approuter          # Application router configuration for BTP
/tests              # Cross-cutting integration and e2e tests
```

## Getting started

```bash
npm install
npm run dev
```

The command above starts `cds watch` (with TypeScript support) and the UI5 dev server side-by-side via `concurrently`. The UI development server proxies `/odata` calls to the CAP service that runs on port **4004**.

### Available scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Starts CAP (`cds watch`) and the UI5 dev server concurrently. |
| `npm run build` | Builds the CAP TypeScript sources (`tsc`) and the UI5 application (`ui5 build`). |
| `npm run start` | Builds the full stack and starts CAP in production mode (serving the static UI from `app/hr-admin/dist`). |
| `npm test` | Runs Jest based service tests and Playwright e2e tests against an in-memory SQLite database. |
| `npm run lint` | Runs ESLint with TypeScript rules for the CAP service. |

### Backend specifics

* **Runtime:** `@sap/cds` 9 with TypeScript handlers loaded through `ts-node`.
* **Database:** Local development uses SQLite (`sqlite.db`). Tests run entirely in-memory.
* **Security:** Authentication relies on SAP Cloud Identity Services (IAS) and authorization decisions are delegated to the Authorization Management Service (AMS). Local development still uses mocked users so existing tests continue to run unchanged.
* **Business logic:** Custom handlers in `srv/handlers/client-service.ts` perform validation, enforce cross-entity consistency, and generate sequential employee identifiers.
* **Health endpoint:** `/health` responds with `{ status: 'ok' }` for platform readiness probes.

### Frontend specifics

* The UI5 app continues to consume the `/odata/v4/clients` service as before.
* `ui5-middleware-simpleproxy` proxies OData calls to the CAP server during development.
* Production builds (served by CAP or the approuter) live in `app/hr-admin/dist`.

## Testing

The test suite is split into three layers:

1. **Service tests (Jest + Supertest)** – Validates business logic like automatic employee ID creation and authorisation checks via HTTP calls to the CAP service (`srv/test`).
2. **End-to-end tests (Playwright)** – Uses the Playwright request API to interact with the running CAP service and verify that the published OData API is reachable (`tests/e2e`).
3. **UI unit tests** – UI5 unit tests can be added under `app/hr-admin/webapp/test` (unchanged from the original Java project).

Run all tests with `npm test`.

To collect coverage for the backend run `npm run test --workspace srv -- --coverage`.

## Authentication & Authorization

* Local profiles keep mocked users (including the HR roles and company attributes) so day-to-day development does not require cloud credentials.
* The CAP runtime is configured for IAS (`cds.security.identity`) and AMS (`cds.requires.auth.ams`). The generated AMS DCL files live in `srv/ams`; run `npm run ams:generate --workspace srv` whenever CDS annotations change.
* During deployment bind both the IAS (`identity` service, `application` plan) and AMS (`authorization` service, `application` plan) instances to the CAP service and approuter. The MTA project also ships a dedicated AMS policy deployer module that uploads the generated DCL bundle from `srv/ams`.

## Deployment

* `mta.yaml` now provisions `cap-ts-ias` and `cap-ts-ams` service instances alongside the existing database, destination, connectivity, HTML5 repo, and logging services.
* Static UI build artefacts are served by the CAP service and the approuter via the `srv-api` destination.
* The approuter configuration forwards `/odata/*` to the CAP service, enforces IAS authentication on all routes, and exposes the UI as the welcome route.

## Java → TypeScript mapping

| Former Java artifact | TypeScript replacement |
| --- | --- |
| `srv/src/main/java/com/acme/hr/Application.java` | `srv/server.ts` (exports `cds.server` with health check) |
| Spring Boot handlers & services | `srv/handlers/client-service.ts` (CAP hooks with identical semantics) |
| Maven build (`pom.xml`) | `package.json` workspaces + TypeScript toolchain |
| Spring Security roles | IAS scopes `HRViewer` / `HREditor` / `HRAdmin` |
| JUnit tests | Jest service tests + Playwright e2e tests |

## Environment variables

| Variable | Purpose |
| --- | --- |
| `CDS_ENV` | Standard CAP profile selection (`test` profile uses in-memory SQLite). |
| `NODE_ENV` | Influences CAP logging and caching (set to `production` for `npm run start`). |
| `TS_NODE_TRANSPILE_ONLY` | Speeds up ts-node execution for dev/test (set by scripts). |
| `IAS_TENANT`, `IAS_CLIENT_ID`, `IAS_CLIENT_SECRET` | Optional overrides to connect to IAS without Cloud Foundry bindings during local troubleshooting. |
| `AMS_DCL_ROOT` | Overrides the folder in which the AMS DCL files are generated (defaults to `srv/ams`). |
| `OUTBOX_DISPATCH_INTERVAL_MS` | Interval in milliseconds between background outbox polls (defaults to `30000`). |
| `OUTBOX_CONCURRENCY` | Number of outbox entries processed concurrently per poll (defaults to `1`). |
| `OUTBOX_CLAIM_TTL_MS` | Time in milliseconds after which a `PROCESSING` entry becomes claimable again (defaults to `120000`). |
| `OUTBOX_MAX_ATTEMPTS` | Maximum retry attempts before an entry is marked as `FAILED` (defaults to `6`). |
| `OUTBOX_BASE_BACKOFF_MS` | Base delay in milliseconds used for the exponential backoff between retries (defaults to `5000`). |
| `OUTBOX_RETENTION_HOURS` | Number of hours delivered/failed entries are retained before cleanup (defaults to `168`). |
| `OUTBOX_CLEANUP_INTERVAL_MS` | Interval in milliseconds for the periodic cleanup task (defaults to six hours). |
| `OUTBOX_CLEANUP_CRON` | Optional simple cron expression (`*/N * * * *` for minutes or `0 */N * * *` for hours) that overrides the cleanup interval. |

## Notes

* Remove `sqlite.db` if you want a fresh local database.
* The repository intentionally keeps generated employee IDs deterministic within a tenant to guarantee backward compatibility with existing UI behavior.
* Playwright uses the APIRequest client so no headless browser is required during CI, but you can enable browser-based UI flows if desired.

