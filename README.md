# SAP CAP TypeScript HR Management

A full-stack TypeScript application built with SAP Cloud Application Programming Model (CAP) for managing HR data including clients, employees, cost centers, and locations.

## 📋 Requirements

- **Node.js:** >= 20.0.0
- **npm:** >= 10.0.0
- **TypeScript:** 5.6.3

## 🎯 Key Features

- **Client Management** - Manage multiple company clients with unique company IDs
- **Employee Management** - Complete lifecycle with auto-generated IDs (format: NNNN-NNNN, where first 4 digits are company code and last 4 are sequential counter), manager hierarchy, status tracking, and GDPR-compliant anonymization
- **Cost Center Management** - Time-based validity, responsibility tracking, and employee assignments
- **Location Management** - Office locations with address details and country associations
- **Employee-Cost Center Assignments** - Historical tracking with date range validation
- **Event-Driven Architecture** - Transactional outbox pattern with parallel workers, retry logic, and webhook notifications
- **Authorization** - Multi-layer role-based and attribute-based access control
- **Third-party Integration** - REST API with API key authentication

## 🏗️ Architecture

### Tech Stack

**Backend:**
- SAP CAP 9.6.1 with TypeScript 5.6.3 (strict mode)
- Database: SQLite (dev), SAP HANA (production)
- OData v4 protocol
- Authentication: Mocked (dev), SAP IAS (production)
- Authorization: SAP AMS (Authorization Management Service)
- Monitoring: Prometheus metrics, @sap/logging with correlation IDs
- Scheduling: node-cron for outbox cleanup

**Frontend:**
- OpenUI5 1.136.0 with TypeScript 5.6.3
- Single Page Application with hash-based routing
- OData V4 Model with intelligent caching
- Responsive design (desktop, tablet, mobile)
- Horizon theme

**Deployment:**
- Single-tenant deployment on SAP BTP
- Application Router for central entry point
- Multi-Target Application (MTA) format

### Project Structure
```
/db                    # CDS data models and seed data
/srv                   # Backend CAP service (TypeScript)
  /domain             # Domain-driven business logic (client, employee, cost-center, location)
  /infrastructure     # Outbox pattern, third-party API integration
  /middleware         # Authorization middleware
/app/hr-admin         # Frontend SAPUI5 application
  /webapp
    /controller      # UI Controllers
    /view           # XML Views
    /services       # Business services
/approuter            # Application Router (BTP deployment)
/tests                # E2E tests (Playwright)
```

### Database Schema

**Core Entities:**
- **Clients** - Company records (UUID key, unique companyId)
- **Employees** - Employee records with auto-generated IDs (format: NNNN-NNNN, e.g., 1010-0001)
- **CostCenters** - Cost center definitions with time-based validity
- **Locations** - Office locations with country associations
- **EmployeeCostCenterAssignments** - Historical assignment tracking
- **Countries** - SAP Common reference data (read-only)

**Technical Entities:**
- **EmployeeIdCounters** - Auto-increment counter per client
- **EmployeeNotificationOutbox** - Transactional outbox for event delivery
- **EmployeeNotificationDLQ** - Dead letter queue for failed notifications

All entities support optimistic concurrency control via ETags (`modifiedAt` timestamp). Strategic indexes optimize queries on status, date ranges, and relationships.

## 🔒 Security & Data Integrity

### Authorization Roles
- **HRAdmin** - Full access to all data
- **HREditor** - Read/write access to assigned companies
- **HRViewer** - Read-only access to assigned companies

### Security Features
- Multi-layer authorization (declarative CDS annotations, imperative middleware, attribute-based filtering)
- XSS protection with HTML entity encoding
- SSRF prevention with URL validation
- Email validation (RFC 5322 compliant)
- Optimistic concurrency control (ETags) to prevent data corruption
- HMAC SHA-256 signing for webhook notifications
- Input sanitization and validation

### Data Integrity
- Referential integrity with cascade delete
- Date range overlap validation
- Cross-entity validation within client boundaries
- Transactional outbox pattern for reliable event delivery

## 🚀 Getting Started

### Prerequisites
```bash
node >= 20.0.0
npm >= 10.0.0
```

### Installation & Setup

1. **Install Dependencies**
```bash
npm install
cd approuter && npm install && cd ..
```

2. **Deploy Database**
```bash
npm run deploy
```

3. **Start Development Server**
```bash
# Backend + Frontend (recommended)
npm run dev

# Backend + Frontend + Approuter (test with app router)
npm run dev:approuter

# Backend only (API testing)
npm run watch --workspace srv
```

### Development URLs
- **Backend API**: http://localhost:4004/odata/v4/clients/
- **Backend Health**: http://localhost:4004/health
- **Frontend UI**: http://localhost:8081
- **Approuter**: http://localhost:5000 (when using dev:approuter)
- **Default Credentials**: `dev` / `dev`

### Testing

**Backend Tests:**
```bash
npm run test:backend
```

**Frontend E2E Tests (Playwright):**
```bash
npm run test:frontend
```

### Production Build
```bash
npm run build
npm start
```

## 📝 API Documentation

### OData V4 Service
Base URL: `/odata/v4/clients/`

**Main Entities:** (All support standard OData CRUD operations with ETag-based concurrency control)
- `Clients` - Company clients
- `Employees` - Employee records (auto-generated employeeId)
- `CostCenters` - Cost centers with validity dates
- `Locations` - Office locations
- `EmployeeCostCenterAssignments` - Assignment history
- `Countries` - Country reference data (read-only)

**Custom Functions & Actions:**
- `POST /anonymizeFormerEmployees` - Anonymize former employees (Roles: HREditor, HRAdmin)
  - Parameter: `before` (Date)
  - Returns: Integer (count)
- `GET /userInfo` - Current user roles and authorization attributes
- `GET /health` - Health check endpoint
- `GET /api/employees/active` - Active employees API (requires API key)

**OData Query Features:**
- Filtering: `$filter` (with company code restrictions)
- Sorting: `$orderby`
- Pagination: `$top` and `$skip`
- Selection: `$select`
- Expansion: `$expand`
- Counting: `$count`

**Authorization:**
- Development: Basic Auth with mocked users (`dev`, `hreditor`, `hrviewer`)
- Production: JWT token from SAP IAS

## 🔧 Configuration

### Environment Variables
```bash
# Database
CDS_DB=sqlite              # or hana for production

# Authentication
CDS_AUTH_KIND=mocked       # or jwt for production

# Outbox Configuration
OUTBOX_BATCH_SIZE=50
OUTBOX_MAX_ATTEMPTS=5
OUTBOX_RETRY_DELAY=5000
OUTBOX_PARALLEL_WORKERS=4

# Employee Export API Key
EMPLOYEE_EXPORT_API_KEY=<your-api-key>         # Production
LOCAL_EMPLOYEE_EXPORT_API_KEY=<your-api-key>   # Development fallback

# Rate Limiting (optional, for multi-instance deployments)
RATE_LIMIT_BACKEND=redis
RATE_LIMIT_REDIS_URL=<redis-url>
```

## ☁️ SAP BTP Deployment

### MTA Modules
1. **cap-ts-srv** - Node.js backend service (512MB)
2. **cap-ts-db-deployer** - HANA HDI deployer (256MB)
3. **cap-ts-ams-deployer** - AMS DCL deployer (256MB)
4. **cap-ts-app-hr-admin** - HTML5 frontend application
5. **cap-ts-approuter** - Application Router (256MB)

### Required BTP Services
1. **cap-ts-db** - SAP HANA HDI Container
2. **cap-ts-ias** - Identity Authentication Service
3. **cap-ts-ams** - Authorization Management Service
4. **cap-ts-destination** - Destination Service
5. **cap-ts-connectivity** - Connectivity Service
6. **cap-ts-html5-repo-host** - HTML5 Application Repository (hosting)
7. **cap-ts-html5-repo-runtime** - HTML5 Application Repository (runtime)
8. **cap-ts-logging** - Application Logging Service
9. **cap-ts-credstore** - Credential Store Service

### Deployment Commands
```bash
# Build MTA archive
mbt build

# Deploy to BTP Cloud Foundry
cf deploy mta_archives/cap-ts_1.0.0.mtar
```

## 🤝 Contributing

1. Create feature branch from `main`
2. Make changes following existing patterns
3. Run tests: `npm test`
4. Run linter: `npm run lint`
5. Submit pull request