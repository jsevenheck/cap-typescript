# SAP CAP TypeScript HR Management Application

A full-stack TypeScript application built with SAP Cloud Application Programming Model (CAP) for managing HR data including clients, employees, cost centers, and locations.

## 📋 Requirements

**Node Version:** >=22.0.0
**npm Version:** >=10.0.0
**TypeScript Version:** 5.6.3

## 🎯 Key Features

- **Multi-tenant Client Management** - Manage multiple company clients with isolated data
- **Employee Management** - Track employees with personal data, assignments, and hierarchy
- **Cost Center Management** - Organize cost centers with time-based validity and responsibilities
- **Location Management** - Maintain office locations with address details
- **Employee-Cost Center Assignments** - Track historical and future cost center assignments
- **Manager Hierarchy** - Automatic manager assignment based on cost center responsibilities
- **Event-Driven Architecture** - Transactional outbox pattern for reliable event delivery
- **Multi-layer Authorization** - Role-based and attribute-based access control

## 🏗️ Architecture

### Backend (SAP CAP)
- **Framework:** SAP Cloud Application Programming Model (CAP)
- **Language:** TypeScript (strict mode)
- **Database:** SQLite (dev), SAP HANA (production)
- **OData Version:** v4
- **Architecture Style:** Domain-Driven Design (DDD)

### Frontend (SAPUI5)
- **Framework:** SAPUI5 1.126 (OpenUI5)
- **Language:** TypeScript
- **UI Pattern:** Custom SAPUI5 Application
- **Data Binding:** OData V4 Model

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
- Lazy loading on all lists (load 20 items, scroll for more)
- Optimized for 1000+ records

### Frontend Authorization
- Role-based UI controls (hide/show buttons based on user permissions)
- Backend `/userInfo()` function exposes user roles and attributes
- HRViewer sees read-only UI (no Add/Edit/Delete buttons)
- HREditor and HRAdmin see full write capabilities
- Frontend provides UX enhancement only - backend enforces all security

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
node >= 22.0.0
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

#### Entities
- `GET /Clients` - List all clients
- `POST /Clients` - Create client
- `PATCH /Clients(ID)` - Update client (requires ETag)
- `DELETE /Clients(ID)` - Delete client (requires ETag)

[Additional endpoints for Employees, CostCenters, Locations, EmployeeCostCenterAssignments]

#### Actions
- `POST /anonymizeFormerEmployees` - Anonymize former employees (batch operation)

### Authorization
All requests require JWT token with appropriate roles.

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
OUTBOX_PARALLEL_WORKERS=3
```

## 🐛 Known Issues & Limitations

### Current Limitations
- No routing implementation (browser back button limitations)
- i18n keys defined but not used in views (hardcoded strings remain)
- Test coverage at ~12% (target: 70%+)

### Planned Improvements
- [ ] Implement proper UI5 routing
- [ ] Migrate hardcoded strings to i18n
- [x] Integrate authorization service in frontend
- [ ] Increase test coverage to 70%+
- [ ] Add navigation guards for unsaved changes

## 🤝 Contributing

1. Create feature branch from `main`
2. Make changes following existing patterns
3. Ensure all tests pass: `npm test`
4. Run linter: `npm run lint`
5. Submit pull request
