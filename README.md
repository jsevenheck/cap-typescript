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

If no key is available at startup, the service skips registering the endpoint and logs an error.

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
- **Authentication:** Mocked users (dev), SAP XSUAA (production)
- **Authorization:** Role collections managed in XSUAA
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
```bash
# Install dependencies
npm install

# Deploy database
npm run deploy

# Start development servers (backend + frontend)
npm run dev
```

### Development URLs
- Backend OData: http://localhost:4004/odata/v4/clients/
- Frontend UI: http://localhost:8081
- Default Credentials: `dev` / `dev`

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
- Production: JWT token from SAP XSUAA with appropriate roles
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

#### MTA Modules (4)
1. **cap-ts-srv** - Node.js backend service (512MB)
2. **cap-ts-db-deployer** - HANA HDI deployer (256MB)
3. **cap-ts-app-hr-admin** - HTML5 frontend application
4. **cap-ts-approuter** - Application Router (256MB)

#### Required BTP Services (7)
1. **cap-ts-db** - SAP HANA HDI Container (schema-based isolation)
2. **cap-ts-xsuaa** - XSUAA instance for authentication and role management
3. **cap-ts-destination** - Destination Service (external system connectivity)
4. **cap-ts-connectivity** - Connectivity Service (on-premise integration)
5. **cap-ts-html5-repo-host** - HTML5 Application Repository (hosting)
6. **cap-ts-html5-repo-runtime** - HTML5 Application Repository (runtime)
7. **cap-ts-logging** - Application Logging Service (centralized logging)

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
