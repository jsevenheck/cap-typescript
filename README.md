# CAP TypeScript Monorepo

This repository contains a full SAP Cloud Application Programming Model (CAP) stack that has been migrated from the Java runtime to the TypeScript/Node.js runtime. Both the backend services and the HR Admin UI are contained in the same repository and can be developed, tested, and deployed together.

## Repository structure

```
/db                 # CDS data model and seed data
/srv                # CAP TypeScript service implementation (domain-driven structure)
/app/hr-admin       # SAPUI5 HR administration frontend (TypeScript)
/approuter          # Application router configuration for BTP
/tests              # Cross-cutting integration and e2e tests
```

## Getting started

### Prerequisites

- Node.js 20 LTS or newer (the workspace scripts depend on tooling that requires Node 20+)

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
* **Business logic:** Feature-specific handlers live under `srv/domain/<feature>/{handlers,services,repository}` and are wired through `srv/handlers.ts`. The handlers continue to perform validation, enforce cross-entity consistency, and generate sequential employee identifiers. The service enforces optimistic concurrency on writes and accepts either `If-Match` headers or a `modifiedAt` timestamp in the payload when the UI cannot send headers (e.g. during background jobs).
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
* The CAP runtime is configured for **IAS (Identity Authentication Service)** and **AMS (Authorization Management Service)** in production:
  - **IAS** (`cds.security.identity`): Handles user authentication and identity federation
  - **AMS** (`cds.requires.auth.ams`): Provides attribute-based access control with CompanyCode filtering
* **Role Configuration:** Three roles are enforced via `@restrict` annotations in CDS models:
  - `HRAdmin`: Full access to all HR data and operations
  - `HREditor`: Read/write access to assigned company codes (via CompanyCode attributes)
  - `HRViewer`: Read-only access to assigned company codes
* **AMS DCL Generation:** Authorization policies are defined in `srv/ams/schema.dcl` and deployed via AMS DCL deployer. Run `npm run ams:generate --workspace srv` whenever CDS annotations change.
* During deployment, bind both IAS (`identity` service, `application` plan) and AMS (`authorization` service, `application` plan) instances to the CAP service and approuter. The MTA project ships a dedicated AMS policy deployer module that uploads the generated DCL bundle from `srv/ams`.

## Observability & Logging

* **Structured Logging:** The application uses `@sap/logging` for structured, correlation-based logging. Each request receives a unique `x-correlation-id` header for distributed tracing.
* **Correlation IDs:** All logs include correlation IDs to trace requests across approuter → CAP → outbox → destination service flows.
* **Log Levels:** Configure via `NODE_ENV`. In production, logs are sent to the Application Logs service bound in `mta.yaml`.
* **Fallback:** If `@sap/logging` is unavailable, the application falls back to console-based logging with component prefixes.

## Secrets Management

* **BTP Credential Store:** API keys and secrets are loaded from BTP Credential Store service when bound in production.
* **Environment Variable Fallback:** For local development, secrets can be configured via environment variables:
  - `EMPLOYEE_EXPORT_API_KEY`: API key for the `/api/employees/active` endpoint
  - `THIRD_PARTY_EMPLOYEE_SECRET`: Secret for HMAC signing of employee notification payloads
* **Namespaces:** Secrets are organized by namespace in Credential Store (e.g., `employee-export/api-key`).
* Bind the Credential Store service (`cap-ts-credstore`) in `mta.yaml` for automatic secret loading at application startup.

## Outbox Pattern & Resilience

* **Outbox Pattern:** Employee creation events are queued in `EmployeeNotificationOutbox` table for reliable, asynchronous delivery to third-party systems.
* **Circuit Breaker:** HTTP calls to destination services are protected by circuit breakers (opens after 5 consecutive failures, resets after 10 seconds) to prevent cascade failures.
* **Dead Letter Queue (DLQ):** Messages that fail after 6 retry attempts are moved to `EmployeeNotificationDLQ` for manual inspection and replay.
* **Exponential Backoff:** Failed deliveries are retried with exponential backoff (base 5 seconds, max 6 attempts).
* **Configuration:** Outbox behavior can be tuned via environment variables:
  - `OUTBOX_DISPATCH_INTERVAL_MS`: Polling interval (default: 30000)
  - `OUTBOX_CONCURRENCY`: Max concurrent deliveries (default: 1)
  - `OUTBOX_MAX_ATTEMPTS`: Max retry attempts (default: 6)
  - `OUTBOX_BASE_BACKOFF_MS`: Base backoff delay (default: 5000)
  - `OUTBOX_RETENTION_HOURS`: Retention window for completed/failed entries (default: 168 hours / 7 days)

## Enterprise Features

### Data Integrity & Security

**Client Integrity Validation** (`srv/domain/shared/integrity-handler.ts`):
* Validates cross-entity relationships to prevent data inconsistencies:
  - Employee manager must belong to same client as employee
  - Employee cost center must belong to same client as employee
  - Cost center responsible employee must belong to same client as cost center
* Efficient caching minimizes database queries during batch operations
* Clear, actionable error messages guide users to fix violations

**Company-Based Authorization** (already present):
* `HRAdmin`: Full access across all companies
* `HREditor`/`HRViewer`: Restricted to assigned company codes
* Enforced at both declarative (CDS `@restrict`) and imperative (service layer) levels
* `ensureUserAuthorizedForCompany()` validates access on every operation

**GDPR Compliance**:
* `@PersonalData` annotations on Employee entity fields
* `anonymizedAt` timestamp tracks anonymization for auditing
* Personal data fields marked with `@PersonalData.IsPotentiallyPersonal`

**Schema Enhancements**:
* `Clients.notificationEndpoint`: External webhook URL for employee notifications
* `Clients.country`: Association to CommonCountries for better data modeling
* `Employees.isManager`: Boolean flag for manager identification
* `Employees.anonymizedAt`: Timestamp for GDPR anonymization tracking

### Enhanced Async Processing

**Parallel Outbox Dispatcher** (`srv/infrastructure/outbox/dispatcher.ts`):
* **p-limit integration**: True parallel processing with configurable worker count (default: 4)
* **Batch processing**: Processes multiple messages per cycle (default: 20)
* **Claim-based locking**: Supports distributed processing across multiple instances
* **Circuit breaker**: Per-destination fault tolerance (opens after 5 failures)
* **Exponential backoff**: Smart retry strategy for transient failures
* **Dead Letter Queue**: Permanently failed messages moved to DLQ for inspection

**Prometheus Metrics** (`srv/infrastructure/outbox/metrics.ts`):
* `outbox_messages_enqueued_total` - Messages enqueued by event type (counter)
* `outbox_messages_dispatched_total` - Successfully dispatched (counter)
* `outbox_messages_failed_total` - Failed deliveries by destination/reason (counter)
* `outbox_messages_dlq_total` - Messages moved to DLQ (counter)
* `outbox_messages_pending` - Current pending count (gauge)
* `outbox_processing_duration_seconds` - Processing latency (histogram)

**Third-Party Notifier** (`srv/infrastructure/api/third-party/employee-notifier.ts`):
* Prepares and enqueues employee creation notifications
* Groups employees by client notification endpoint
* Enriches payloads with client metadata (companyId, name)
* HMAC-SHA256 request signing for authentication (`x-signature-sha256` header)
* Graceful error handling - employee creation succeeds even if notification fails

**Environment Variables** (additional):
* `OUTBOX_BATCH_SIZE`: Batch size for processing (default: 20)
* `OUTBOX_DISPATCHER_WORKERS`: Parallel worker count (default: 4)
* `OUTBOX_ENQUEUE_MAX_ATTEMPTS`: Max enqueue retry attempts (default: 0 = unlimited)
* `THIRD_PARTY_EMPLOYEE_DESTINATION`: Destination name for HTTP calls
* `THIRD_PARTY_EMPLOYEE_SECRET`: HMAC signing secret

### Utility Libraries

**Association Helpers** (`srv/shared/utils/association.ts`):
* `extractAssociationId()`: Extract ID from association (supports both `field_ID` and `{ field: { ID } }`)
* `resolveAssociation()`: Get full association object
* `hasAssociation()`: Check if association is set
* `extractAssociationIds()`: Batch extract multiple associations

**Validation Helpers** (`srv/shared/utils/validation.ts`):
* `isValidEmail()`: RFC 5322 email validation
* `isValidUrl()`: HTTP/HTTPS URL validation
* `isValidDate()`: Date validation
* `isInDateRange()`: Date range checking
* `isValidUUID()`: UUID v4 validation
* `isValidLength()`: String length validation
* `matchesPattern()`: Regex pattern matching

**Error Builders** (`srv/shared/utils/errors.ts`):
* `ErrorBuilder.badRequest()`: 400 with details
* `ErrorBuilder.forbidden()`: 403
* `ErrorBuilder.notFound()`: 404 with entity/ID
* `ErrorBuilder.conflict()`: 409
* `ErrorBuilder.preconditionFailed()`: 412 for optimistic locking
* `ErrorBuilder.unprocessableEntity()`: 422 for validation
* `ErrorBuilder.internalServerError()`: 500

### Architecture

See `docs/ARCHITECTURE.md` for detailed documentation on:
* Layered architecture (Handler → Service → Repository)
* Domain-driven design patterns
* Data flow and transaction management
* Authorization and concurrency control
* Async processing patterns
* Testing strategies

## Deployment

* `mta.yaml` provisions the following BTP services:
  - **IAS** (`cap-ts-ias`): Identity authentication service for user login
  - **AMS** (`cap-ts-ams`): Authorization management with attribute-based access control
  - **Credential Store** (`cap-ts-credstore`): Secure secret storage with rotation support
  - **HANA** (`cap-ts-db`): HDI container for application data
  - **Destination** (`cap-ts-destination`): Third-party HTTP endpoint configuration
  - **Connectivity** (`cap-ts-connectivity`): On-premise system connectivity (if needed)
  - **Application Logs** (`cap-ts-logging`): Centralized structured logging
  - **HTML5 Application Repository** (`cap-ts-html5-repo-*`): UI5 app hosting
* Static UI build artefacts are served by the CAP service and the approuter via the `srv-api` destination.
* The approuter configuration forwards `/odata/v4/*` to the CAP service, enforces IAS authentication on all routes, and exposes the UI as the welcome route.

## Java → TypeScript mapping

| Former Java artifact | TypeScript replacement |
| --- | --- |
| `srv/src/main/java/com/acme/hr/Application.java` | `srv/server.ts` (exports `cds.server` with health check) |
| Spring Boot handlers & services | `srv/domain/*/handlers` registered via `srv/handlers.ts` |
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
| `EMPLOYEE_EXPORT_API_KEY` | API key required to call `GET /api/employees/active` without IAS authentication. |

### Employee export API

External systems can obtain the list of active employees through a dedicated, API-key-protected REST endpoint:

```
GET /api/employees/active
```

Set a strong API key via the `EMPLOYEE_EXPORT_API_KEY` environment variable. When running locally you can add the following snippet to your `.env` file:

```
EMPLOYEE_EXPORT_API_KEY=replace-with-a-strong-secret
```

Example requests:

```bash
# Successful call
curl -H "x-api-key: $EMPLOYEE_EXPORT_API_KEY" https://<host>/api/employees/active

# Unauthorized (missing key)
curl https://<host>/api/employees/active
```

The endpoint returns a JSON array containing active employees (including their cost centers and managers). Invalid or missing API keys result in `401 { "error": "invalid_api_key" }`.

## Notes

* Remove `sqlite.db` if you want a fresh local database.
* The repository intentionally keeps generated employee IDs deterministic within a tenant to guarantee backward compatibility with existing UI behavior.
* Playwright uses the APIRequest client so no headless browser is required during CI, but you can enable browser-based UI flows if desired.

