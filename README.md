# SAP CAP TypeScript HR Management Application

A full-stack TypeScript application built with SAP Cloud Application Programming Model (CAP) for managing HR data including clients, employees, cost centers, and locations.

## 📋 Requirements

**Node Version:** >=20.0.0 (tested with 20.19.6)
**npm Version:** >=10.0.0
**TypeScript Version:** 5.6.3

### Employee Export API Key

The `/api/employees/active` endpoint requires an API key for access. Configure it by either:

- Binding a **Credential Store** instance that provides the `employee-export/api-key` secret, or
- Setting the `EMPLOYEE_EXPORT_API_KEY` environment variable (used for local development or as a fallback).

For convenience during local development, the service falls back to a deterministic key (`local-dev-api-key`).
You can override it without changing your main environment by setting `LOCAL_EMPLOYEE_EXPORT_API_KEY`. In
production you must bind the Credential Store or set `EMPLOYEE_EXPORT_API_KEY` explicitly.

### Rate limiting backend (in-memory vs. distributed)

The built-in rate limiter defaults to an in-memory store for local development and automated tests. For
multi-instance deployments (e.g., BTP), configure a shared cache such as Redis or SAP Cache as follows:

- Set `RATE_LIMIT_BACKEND=redis`.
- Provide the cache endpoint via `RATE_LIMIT_REDIS_URL` (or `REDIS_URL`).
- Optionally set `RATE_LIMIT_NAMESPACE` to avoid key collisions across applications and `RATE_LIMIT_MAX_KEYS`
  to cap distinct keys.
- If the backend is unavailable during initialization or at runtime (for example, due to invalid configuration
  or connection failures), the limiter logs a warning and transparently falls back to the in-memory store so
  startup is not blocked and requests continue to be processed. Rate limiting remains functional but may be less
  precise during backend outages. Monitor logs and health checks to detect and mitigate prolonged backend
  outages.
- Advanced deployments can supply a custom store implementation through the middleware configuration when
  bootstrapping the Express app.

## 🎯 Key Features

- **Client Management** - Manage multiple company clients
- **Employee Management** - Complete lifecycle management with auto-generated employee IDs
  - Auto-generated employee IDs: 8-character prefix + 6-digit counter per client
  - Manager hierarchy with self-referencing relationships
  - Personal data anonymization for GDPR compliance
  - Status tracking (active/inactive) and employment type (internal/external)
- **Cost Center Management** - Organize cost centers with time-based validity and responsibilities
- **Location Management** - Maintain office locations with address details and country associations
- **Employee-Cost Center Assignments** - Track historical and future cost center assignments
  - Date range overlap validation
  - Responsibility flag for cost center managers
  - Automatic manager updates based on assignments
- **Event-Driven Architecture** - Transactional outbox pattern for reliable event delivery
  - Parallel dispatcher with 4 configurable workers
  - Exponential backoff retry logic with dead letter queue
  - Webhook notifications with HMAC SHA-256 signing for security
  - Prometheus metrics for monitoring outbox performance
- **Multi-layer Authorization** - Role-based and attribute-based access control
  - Company code filtering enforced at database level
  - Frontend authorization checks using AuthorizationService
- **Third-party Integration** - REST API endpoint for active employees with API key authentication

## 🏗️ Architecture

### Backend (SAP CAP)
- **Framework:** SAP Cloud Application Programming Model (CAP) 9.4.0
- **Language:** TypeScript 5.6.3 (strict mode)
- **Database:** SQLite (dev), SAP HANA (production via @cap-js/hana)
- **OData Version:** v4
- **Architecture Style:** Domain-Driven Design (DDD)
- **Authentication:** Mocked users (dev), SAP IAS (production)
- **Authorization:** SAP AMS (Authorization Management Service)
- **Monitoring:** Prometheus metrics via prom-client
- **Logging:** @sap/logging with correlation IDs
- **Scheduling:** node-cron for outbox cleanup

### Tenant Model

This solution is deployed as **single-tenant** on BTP. MTX/tenant-host routing has been removed (including `TENANT_HOST_PATTERN` in `mta.yaml`), and the application assumes one dedicated tenant per space.

### Frontend (SAPUI5)
- **Framework:** SAPUI5 1.126.1 (OpenUI5)
- **Language:** TypeScript 5.6.3
- **UI Pattern:** Single Page Application with UI5 Router
- **Routing:** Hash-based routing with browser history support
- **Data Binding:** OData V4 Model
- **Internationalization:** i18n with ResourceBundle
- **Theme:** Horizon
- **Build Tool:** UI5 CLI 4.0
- **Dev Server:** Port 8081 with proxy to backend

### Project Structure
```
/db                    # CDS data models and seed data
/srv                   # Backend CAP service (TypeScript)
  /domain             # Domain-driven business logic
    /client           # Client management
    /employee         # Employee management
    /cost-center      # Cost center management
    /location         # Location management
    /employee-cost-center  # Assignment management
    /shared           # Shared validators and utilities
  /infrastructure     # Infrastructure concerns
    /outbox          # Transactional outbox pattern
    /api             # Third-party integrations
  /middleware         # Authorization middleware
  /shared/utils       # Utility functions
/app/hr-admin         # Frontend SAPUI5 application
  /webapp
    /controller      # UI Controllers
    /view           # XML Views
    /core           # Core services and utilities
    /services       # Business services
    /model          # Model initialization
/approuter            # Application Router (BTP deployment)
/tests                # E2E tests (Playwright)
```

### Frontend UI Structure

The application is a **Single Page Application (SPA)** with a tab-based interface:

**Main Tabs (IconTabBar):**
1. **Clients Tab** - Manage company clients
   - Client list table with lazy loading
   - Client detail form (Company ID, Name, Notification Endpoint)
   - Actions: Add, Edit, Delete, Refresh

2. **Employees Tab** - Manage employee records
   - Employee list table with filtering
   - Employee detail form (all personal & employment data)
   - Actions: Add, Edit, Delete, Refresh, Anonymize Former Employees

3. **Cost Centers Tab** - Manage cost centers
   - Cost center list table
   - Cost center detail form with validity dates
   - Actions: Add, Edit, Delete, Refresh

4. **Locations Tab** - Manage office locations
   - Location list table
   - Location detail form with address details
   - Actions: Add, Edit, Delete, Refresh

**Key UI Features:**
- **Responsive Design** - Works on desktop, tablet, and phone
- **Optimistic Concurrency** - ETag handling with modifiedAt timestamps
- **Global Error Handling** - Catches OData errors and displays user-friendly messages
- **Validation** - Client-side validation before API submission
- **Loading Indicators** - Busy states during all operations
- **Data Formatters** - Date, status, and boolean field formatting

### Database Schema

**Core Entities:**
- **Clients** - Client records (UUID key, unique companyId)
- **Employees** - Employee records with auto-generated employeeId (8-char prefix + 6-digit counter)
- **CostCenters** - Cost center definitions with time-based validity
- **Locations** - Office locations with country associations
- **EmployeeCostCenterAssignments** - Historical assignment tracking
- **Countries** - SAP Common Countries (read-only reference data)

**Technical Entities:**
- **EmployeeIdCounters** - Auto-increment counter per client
- **EmployeeNotificationOutbox** - Transactional outbox for reliable event delivery
- **EmployeeNotificationDLQ** - Dead letter queue for failed notifications

**Key Relationships:**
- Clients → Employees (1:N, cascade delete)
- Clients → CostCenters (1:N, cascade delete)
- Clients → Locations (1:N, cascade delete)
- Employees → Manager (self-reference for hierarchy)
- Employees → CostCenter (N:1, current assignment)
- Employees → Location (N:1, current location)
- EmployeeCostCenterAssignments → Employee (N:1)
- EmployeeCostCenterAssignments → CostCenter (N:1)

**Strategic Indexes (12 total):**
- Employees: status, employmentType, client+status composite
- Locations: validFrom+validTo date ranges
- CostCenters: validFrom+validTo, code+client unique constraint
- Assignments: employee+dates, costCenter+dates, responsible flag
- Outbox: status+nextAttemptAt for efficient polling

## 🔒 Security Features

### Authentication & Authorization
- **Multi-layer Authorization:**
  - Declarative (CDS annotations)
  - Imperative (middleware)
  - Attribute-based (company code filtering)
- **Roles:**
  - `HRAdmin` - Full access to all data
  - `HREditor` - Read/write access to assigned companies
  - `HRViewer` - Read-only access to assigned companies

### Security Hardening
- **XSS Protection** - All user input properly escaped with HTML entity encoding
- **SSRF Prevention** - URL validation blocks private IP ranges and localhost
- **Email Validation** - RFC 5322 compliant with length constraints
- **Optimistic Concurrency** - Prevents data corruption from concurrent updates
- **HMAC Signing** - Third-party webhooks signed with SHA-256
- **Input Sanitization** - All user input validated and normalized

## ⚡ Performance Features

### Database Indexes
Optimized queries with strategic indexing:
- Employees: status, employmentType, client+status composite
- Locations: validFrom+validTo date ranges
- CostCenters: validFrom+validTo date ranges
- Assignments: employee+dates, costCenter+dates, responsible flag

### Query Optimization
- Batch UPDATE operations for bulk updates
- Database-level date filtering
- Reduced N+1 query patterns

### Frontend Performance
- **Intelligent Caching Strategy**:
  - OData V4 model caching with earlyRequests for optimized data loading
  - Browser storage caching (sessionStorage/localStorage) with TTL expiration
  - Automatic cache cleanup every 5 minutes
  - Selective cache invalidation on refresh actions
- **List Optimization**:
  - Lazy loading on all lists (load 20 items, scroll for more)
  - Optimized for 1000+ records
- **Request Management**:
  - Abortable requests to prevent memory leaks
  - Automatic request batching via OData groupProperties
- **Error Handling**:
  - Global error handling for OData errors and unhandled promise rejections

## 🛡️ Data Integrity Features

### Optimistic Concurrency Control
All entities use ETags (via `modifiedAt` timestamp) to prevent lost updates:
- Clients require If-Match header or modifiedAt in payload
- Employees require If-Match or modifiedAt
- Cost Centers require If-Match or modifiedAt
- Locations require If-Match or modifiedAt
- Employee-Cost Center Assignments require If-Match or modifiedAt

### Referential Integrity
- Client deletion cascades to employees, cost centers, locations
- Employee deletion validated (no orphaned assignments)
- Cost center deletion validated (no active assignments)
- Cross-entity validation ensures relationships within client boundaries

### Transactional Outbox Pattern
Reliable event delivery to third-party systems:
- Messages persist in outbox table within same transaction
- Parallel dispatcher with configurable workers
- Exponential backoff retry logic
- Dead letter queue for permanently failed messages
- Prometheus metrics for monitoring

## 🚀 Getting Started

### Prerequisites
```bash
node >= 20.0.0
npm >= 10.0.0
```

### Installation

#### 1. Install Dependencies
```bash
# Install root and workspace dependencies
npm install

# Install approuter dependencies (required for approuter mode)
cd approuter && npm install && cd ..
```

#### 2. Deploy Database
```bash
# Deploy SQLite database with initial data
npm run deploy
```

This creates `db/sqlite.db` and loads initial data from CSV files.

#### 3. Start Development Servers

**Option A: Backend + Frontend** (recommended for most development)
```bash
npm run dev
```

**Option B: Backend + Frontend + Approuter** (for testing with application router)
```bash
npm run dev:approuter
```

**Option C: Backend Only** (for API testing with Postman/curl)
```bash
npm run watch --workspace srv
```

### Development URLs
- **Backend API (direct)**: http://localhost:4004/odata/v4/clients/
- **Backend Health Check**: http://localhost:4004/health
- **Frontend UI**: http://localhost:8081
- **Approuter** (when using dev:approuter): http://localhost:5000
- **Default Credentials**: `dev` / `dev`

### Local authentication (mocked)
The development profile uses mocked authentication, which expects **Basic Auth** for CAP requests.
When running the approuter locally, configure credentials via env vars (defaults to `dev/dev`):

```bash
export CAP_BASIC_USER=dev
export CAP_BASIC_PASSWORD=dev
```

**Smoke checks (direct to CAP):**
```bash
curl -i http://localhost:4004/health
curl -i http://localhost:4004/odata/v4/clients/$metadata
curl -i -u dev:dev http://localhost:4004/odata/v4/clients/$metadata
```

**Smoke checks (via approuter):**
```bash
curl -i http://localhost:5000/health
curl -i http://localhost:5000/odata/v4/clients/$metadata
```

### Testing with Postman

To test the backend API directly with Postman:

1. **URL**: `http://localhost:4004/odata/v4/clients/Clients`
2. **Method**: GET
3. **Auth**: Basic Auth
   - Username: `dev`
   - Password: `dev`
4. **Headers** (optional):
   - `Content-Type`: `application/json`

**Example Requests:**
- Get all clients: `GET http://localhost:4004/odata/v4/clients/Clients`
- Get all employees: `GET http://localhost:4004/odata/v4/clients/Employees`
- Health check: `GET http://localhost:4004/health`

### Troubleshooting

**Backend not responding on localhost:4004?**

1. Ensure dependencies are installed:
   ```bash
   npm install
   ```

2. Ensure database is deployed:
   ```bash
   npm run deploy
   ```

3. Check if port 4004 is available:
   ```bash
   # On macOS/Linux
   lsof -i :4004
   
   # On Windows
   netstat -ano | findstr :4004
   ```

4. Start backend server and check for errors:
   ```bash
   npm run watch --workspace srv
   ```

**Approuter not connecting?**

1. Ensure approuter dependencies are installed:
   ```bash
   cd approuter && npm install
   ```

2. Ensure backend is running on port 4004

3. Start approuter:
   ```bash
   npm run dev:approuter
   ```

4. Access via approuter: `http://localhost:5000`

### Building for Production
```bash
# Build all workspaces
npm run build

# Start production server
npm start
```

## 🧪 Testing

### Backend Tests
```bash
npm run test:backend
```

Test Coverage: ~12% (target: 70%+)

### Frontend E2E Tests
```bash
npm run test:frontend
```

Playwright tests for full-stack integration scenarios.

## 📝 API Endpoints

### OData V4 Service
Base URL: `/odata/v4/clients/`

#### Entities (All support standard OData operations)

**Clients**
- `GET /Clients` - List all clients (filtered by authorization)
- `POST /Clients` - Create new client
- `PATCH /Clients(ID)` - Update client (requires ETag via If-Match header or modifiedAt)
- `DELETE /Clients(ID)` - Delete client with cascade (requires ETag)

**Employees**
- `GET /Employees` - List all employees (filtered by company code)
- `POST /Employees` - Create new employee (auto-generates employeeId)
- `PATCH /Employees(ID)` - Update employee (requires ETag)
- `DELETE /Employees(ID)` - Delete employee (requires ETag)
- Supports `$expand` for: client, manager, costCenter, location, costCenterAssignments

**CostCenters**
- `GET /CostCenters` - List all cost centers
- `POST /CostCenters` - Create new cost center
- `PATCH /CostCenters(ID)` - Update cost center (requires ETag)
- `DELETE /CostCenters(ID)` - Delete cost center (requires ETag)
- Supports `$expand` for: client, responsible, employees, assignments

**Locations**
- `GET /Locations` - List all locations
- `POST /Locations` - Create new location
- `PATCH /Locations(ID)` - Update location (requires ETag)
- `DELETE /Locations(ID)` - Delete location (requires ETag)
- Supports `$expand` for: client, country, employees

**EmployeeCostCenterAssignments**
- `GET /EmployeeCostCenterAssignments` - List all assignments
- `POST /EmployeeCostCenterAssignments` - Create new assignment
- `PATCH /EmployeeCostCenterAssignments(ID)` - Update assignment (requires ETag)
- `DELETE /EmployeeCostCenterAssignments(ID)` - Delete assignment (requires ETag)
- Supports `$expand` for: employee, costCenter, client

**Countries** (Read-only, SAP Common)
- `GET /Countries` - List all countries

#### Custom Actions & Functions
- `POST /anonymizeFormerEmployees` - Anonymize former employees before a specific date
  - Parameter: `before` (Date)
  - Returns: Integer (count of anonymized employees)
  - Roles: HREditor, HRAdmin

#### Utility Endpoints
- `GET /userInfo` - Get current user's roles and authorization attributes
  - Returns: `{ roles: string[], attributes: { CompanyCode, companyCodes } }`
  - Requires: HRViewer, HREditor, or HRAdmin role
  - Used by frontend for authorization checks

- `GET /health` - Health check endpoint
  - Returns: `{ status: 'ok' }`

- `GET /api/employees/active` - Active employees API for third-party integration
  - Requires: API key authentication
  - Returns: List of active employees

#### OData Query Features
- **Filtering:** `$filter` with company code restrictions enforced
- **Sorting:** `$orderby` on any field
- **Pagination:** `$top` and `$skip` for paging
- **Selection:** `$select` to limit returned fields
- **Expansion:** `$expand` to include related entities
- **Counting:** `$count` to get total count

### Authorization
- Production: JWT token from SAP IAS with appropriate roles
- Development: Mocked users (`dev`, `hreditor`, `hrviewer`)

## 🔧 Configuration

### Environment Variables
```bash
# Database
CDS_DB=sqlite  # or hana for production

# Authentication
CDS_AUTH_KIND=mocked  # or jwt for production

# Outbox Configuration
OUTBOX_BATCH_SIZE=50
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_RETRY_DELAY=5000
OUTBOX_CLAIM_TTL=300000
OUTBOX_PARALLEL_WORKERS=4
```

### SAP BTP Deployment

This application is configured for deployment to SAP Business Technology Platform (BTP) using Multi-Target Application (MTA) format.

#### MTA Modules (5)
1. **cap-ts-srv** - Node.js backend service (512MB)
2. **cap-ts-db-deployer** - HANA HDI deployer (256MB)
3. **cap-ts-ams-deployer** - AMS DCL deployer (256MB)
4. **cap-ts-app-hr-admin** - HTML5 frontend application
5. **cap-ts-approuter** - Application Router (256MB)

#### Required BTP Services (8)
1. **cap-ts-db** - SAP HANA HDI Container (schema-based isolation)
2. **cap-ts-ias** - Identity Authentication Service (user authentication)
3. **cap-ts-ams** - Authorization Management Service (role & attribute management)
4. **cap-ts-destination** - Destination Service (external system connectivity)
5. **cap-ts-connectivity** - Connectivity Service (on-premise integration)
6. **cap-ts-html5-repo-host** - HTML5 Application Repository (hosting)
7. **cap-ts-html5-repo-runtime** - HTML5 Application Repository (runtime)
8. **cap-ts-logging** - Application Logging Service (centralized logging)

#### Deployment Commands
```bash
# Build MTA archive
mbt build

# Deploy to BTP Cloud Foundry
cf deploy mta_archives/cap-ts_1.0.0.mtar
```

## 🐛 Known Issues & Limitations

### Current Limitations
- Test coverage at ~12% (target: 70%+)

### Completed Improvements ✅
- [x] **Implement proper UI5 routing with browser history support**
  - Full routing configuration with 4 routes (clients, employees, costCenters, locations)
  - Deep linking support with route parameters
  - Browser back/forward button functionality
  - SAP Fiori Design Guidelines compliant
- [x] **Migrate hardcoded strings to i18n for better internationalization**
  - All 109 strings in Main.view.xml migrated to i18n bindings
  - All controllers fully internationalized (Client, Employee, CostCenter, Location)
  - 140+ i18n keys added across the application
  - Consistent ResourceBundle usage pattern throughout
  - Ready for multi-language support (German, French, etc.)
- [x] **Add navigation guards for unsaved changes warning**
  - UnsavedChangesGuard service tracks form dirty state
  - beforeMatched route event interception
  - Confirmation dialog with Yes/No options
  - Integrated with all entity handlers (Client, Employee, CostCenter, Location)
  - Prevents accidental data loss during navigation across entire application
- [x] **Implement frontend caching for frequently accessed data**
  - CacheService with TTL (time-to-live) support and automatic expiration
  - Support for both sessionStorage (session-only) and localStorage (persistent)
  - CacheManager for coordinated cache invalidation (OData + browser storage)
  - OData V4 model caching enabled with earlyRequests and groupProperties
  - Periodic cache cleanup (every 5 minutes) to free up storage space
  - Manual cache invalidation on refresh button clicks
  - Cache statistics for monitoring (entry count, size in KB)

### Planned Improvements
- [ ] Increase test coverage to 70%+ (currently at ~12%)

## 🤝 Contributing

1. Create feature branch from `main`
2. Make changes following existing patterns
3. Ensure all tests pass: `npm test`
4. Run linter: `npm run lint`
5. Submit pull request
