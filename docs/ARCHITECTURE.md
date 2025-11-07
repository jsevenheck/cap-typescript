# CAP TypeScript Architecture

This document describes the architecture and design patterns used in the CAP TypeScript HR Management System.

## Table of Contents

- [Overview](#overview)
- [Architecture Pattern](#architecture-pattern)
- [Directory Structure](#directory-structure)
- [Core Patterns](#core-patterns)
- [Data Flow](#data-flow)
- [Authorization](#authorization)
- [Concurrency Control](#concurrency-control)
- [Async Processing](#async-processing)
- [Error Handling](#error-handling)
- [Testing Strategy](#testing-strategy)

## Overview

This is a multi-tenant HR management system built with SAP Cloud Application Programming Model (CAP) in TypeScript. It manages clients, employees, and cost centers with enterprise-grade features including:

- Data integrity validation
- Multi-level authorization (declarative + imperative)
- Optimistic concurrency control
- Transactional outbox pattern for reliable async processing
- Prometheus metrics for observability
- GDPR compliance

## Architecture Pattern

The application follows a **layered architecture** with clear separation of concerns:

```
┌─────────────────────────────────────────────────────┐
│                   HTTP Layer                        │
│          (OData v4 API / Express Routes)            │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                Handler Layer                         │
│        (Request Orchestration & Validation)         │
│    srv/domain/{entity}/handlers/on-{event}.ts       │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│                Service Layer                         │
│         (Business Logic & Validation)               │
│    srv/domain/{entity}/services/{name}.service.ts  │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│              Repository Layer                        │
│          (Data Access & Queries)                    │
│     srv/domain/{entity}/repository/{name}.repo.ts   │
└──────────────────┬──────────────────────────────────┘
                   │
┌──────────────────▼──────────────────────────────────┐
│               Database Layer                         │
│           (SAP HANA / SQLite)                       │
└─────────────────────────────────────────────────────┘
```

## Directory Structure

```
cap-typescript/
├── db/                           # Database layer
│   ├── schema.cds               # Entity definitions
│   └── data/                    # Seed data (CSV)
├── srv/                          # Service layer
│   ├── service.cds              # Service definitions with @restrict
│   ├── handlers.ts              # Central handler registration
│   ├── server.ts                # Server bootstrap & lifecycle
│   ├── domain/                  # Domain-driven design
│   │   ├── client/
│   │   │   ├── handlers/        # Request handlers
│   │   │   ├── services/        # Business logic
│   │   │   ├── repository/      # Data access
│   │   │   └── dto/             # Data transfer objects
│   │   ├── employee/            # Same structure
│   │   ├── cost-center/         # Same structure
│   │   └── shared/              # Shared domain utilities
│   │       ├── integrity-handler.ts  # Cross-entity validation
│   │       └── request-context.ts    # Request utilities
│   ├── infrastructure/          # Infrastructure layer
│   │   ├── outbox/              # Transactional outbox pattern
│   │   │   ├── dispatcher.ts    # Parallel message processing
│   │   │   ├── metrics.ts       # Prometheus metrics
│   │   │   ├── config.ts        # Configuration
│   │   │   ├── cleanup.ts       # Retention cleanup
│   │   │   └── scheduler.ts     # Background jobs
│   │   └── api/                 # External API clients
│   │       └── third-party/
│   │           ├── employee.client.ts    # HTTP client with HMAC
│   │           └── employee-notifier.ts  # Notification service
│   ├── middleware/              # Middleware layer
│   │   └── apiKey.ts            # API key authentication
│   ├── shared/                  # Shared utilities
│   │   ├── types/               # TypeScript interfaces
│   │   └── utils/               # Utility functions
│   │       ├── association.ts   # Association helpers
│   │       ├── validation.ts    # Validation functions
│   │       ├── errors.ts        # Error builders
│   │       ├── auth.ts          # Authorization
│   │       ├── concurrency.ts   # Optimistic locking
│   │       ├── normalization.ts # Data normalization
│   │       ├── date.ts          # Date utilities
│   │       ├── logger.ts        # Structured logging
│   │       └── environment.ts   # Config helpers
│   └── test/                    # Test suites
│       ├── domain/              # Domain tests
│       └── infrastructure/      # Infrastructure tests
└── app/                         # UI5 frontend
```

## Core Patterns

### 1. Handler Pattern

Handlers are **thin orchestration layers** that:
- Extract request context (user, concurrency metadata)
- Call service layer methods
- Apply returned updates to `req.data`
- Handle transaction management

**Example:**
```typescript
export const handleClientUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.Clients');

  const { updates } = await prepareClientUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<ClientEntity>,
    targetId: deriveTargetId(req),
    user,
    tx: cds.transaction(req),
    concurrency,
  });

  Object.assign(req.data, updates);
};
```

### 2. Service Layer Pattern

Services contain **business logic and validation**:
- Authorize operations (company-based access control)
- Validate business rules
- Perform cross-entity integrity checks
- Normalize and transform data
- Return updates for handlers to apply

**Signature:**
```typescript
export interface ClientUpsertContext {
  event: 'CREATE' | 'UPDATE';
  data: Partial<ClientEntity>;
  targetId?: string;
  user: UserContext;
  tx: Transaction;
  concurrency?: ConcurrencyContext;
}

export const prepareClientUpsert = async (
  ctx: ClientUpsertContext
): Promise<{ updates: Partial<ClientEntity> }> => {
  // 1. Optimistic concurrency check (UPDATE only)
  // 2. Authorization check
  // 3. Data validation & normalization
  // 4. Uniqueness checks
  // 5. Return updates
};
```

### 3. Repository Pattern

Repositories provide **pure data access**:
- No business logic
- Type-safe queries using `cds.ql`
- Support for pessimistic locking (`forUpdate()`)
- Projection helpers for selecting specific columns

**Example:**
```typescript
export const findClientById = async (
  tx: Transaction,
  id: string,
  columns: (keyof ClientEntity)[] = ['ID', 'companyId'],
): Promise<ClientEntity | undefined> => {
  return await tx.run(
    SELECT.one.from('clientmgmt.Clients')
      .columns(...columns)
      .where({ ID: id })
  );
};
```

### 4. Domain-Driven Design

Each domain (Client, Employee, CostCenter) is self-contained with:
- **Handlers**: Request orchestration
- **Services**: Business logic
- **Repositories**: Data access
- **DTOs**: Type definitions

This allows teams to work independently on different domains.

## Data Flow

### Create/Update Flow

```
1. HTTP Request (OData POST/PATCH)
   ↓
2. CAP Framework (@Before event)
   ↓
3. Handler (on-create.ts / on-update.ts)
   - Extract user context
   - Extract concurrency metadata
   ↓
4. Service Layer (lifecycle.service.ts)
   - Validate optimistic concurrency (UPDATE only)
   - Authorize user for company
   - Validate business rules
   - Normalize data
   - Return updates
   ↓
5. Handler applies updates to req.data
   ↓
6. CAP Framework persists to database
   ↓
7. @After event handlers (if any)
   - Enqueue notifications to outbox
   ↓
8. HTTP Response (201 Created / 200 OK)
```

### Async Notification Flow

```
1. Employee Created
   ↓
2. @After handler (on-create.after.ts)
   - Prepare notification
   - Enqueue to outbox (transactional)
   ↓
3. Background Dispatcher (scheduled interval)
   - Claim pending messages
   - Process in parallel (p-limit)
   - Call external HTTP endpoint with HMAC signature
   - Record metrics (Prometheus)
   ↓
4. Retry on Failure
   - Exponential backoff
   - Max attempts (default: 6)
   - Move to DLQ after exhaustion
```

## Authorization

### Multi-Level Authorization

1. **Declarative** (CDS `@restrict`):
```cds
@restrict: [
  { grant: ['READ','CREATE','UPDATE','DELETE'], to: 'HRAdmin' },
  {
    grant: 'READ',
    to: 'HRViewer',
    where: '(companyId in $user.CompanyCode or companyId in $user.companyCodes)'
  },
  {
    grant: ['READ','CREATE','UPDATE','DELETE'],
    to: 'HREditor',
    where: '(companyId in $user.CompanyCode or companyId in $user.companyCodes)'
  }
]
```

2. **Imperative** (Service layer):
```typescript
export const ensureUserAuthorizedForCompany = (
  user: UserContext,
  companyId?: string
): void => {
  if (userHasRole(user, HR_ADMIN_ROLE)) {
    return; // HRAdmin bypasses company restrictions
  }

  if (!hasHrScope(user)) {
    throw createServiceError(403, 'User does not have required HR role.');
  }

  const allowedCompanies = collectAttributeValues(user, ['CompanyCode', 'companyCodes'])
    .map(normalizeCompanyId)
    .filter(Boolean);

  if (!allowedCompanies.includes(normalizeCompanyId(companyId))) {
    throw createServiceError(403, 'Forbidden: company code not assigned');
  }
};
```

### User Context

```typescript
interface UserContext {
  roles: Set<string>;
  attributes: {
    CompanyCode?: string[];
    companyCodes?: string[];
    [key: string]: unknown;
  };
}
```

## Concurrency Control

### Optimistic Locking

Uses **ETags and modifiedAt timestamps** to prevent lost updates:

1. **Schema annotation**:
```cds
@odata.etag: 'modifiedAt'
entity Clients : managed, cuid { ... }
```

2. **Client sends If-Match header** or **modifiedAt in payload**

3. **Service validates** before update:
```typescript
await ensureOptimisticConcurrency({
  tx,
  entityName: 'clientmgmt.Clients',
  targetId,
  headerValue: concurrency?.headerValue,
  hasHttpHeaders: concurrency?.hasHttpHeaders ?? false,
  payloadValue: concurrency?.payloadValue,
});
```

4. **HTTP 412 (Precondition Failed)** if mismatch

## Async Processing

### Transactional Outbox Pattern

Ensures **reliable message delivery** without distributed transactions:

1. **Write to outbox table in same transaction** as business operation
2. **Background dispatcher** processes messages independently
3. **Retry with exponential backoff** for transient failures
4. **Dead Letter Queue (DLQ)** for permanent failures
5. **Claim-based processing** for distributed systems

### Parallel Processing

- **Configurable worker count** (default: 4 workers)
- **p-limit** for controlled concurrency
- **Circuit breaker** per destination (prevents cascade failures)
- **Batch processing** with configurable batch sizes

### Metrics

Prometheus metrics for operational visibility:
- `outbox_messages_enqueued_total` - Messages enqueued by event type
- `outbox_messages_dispatched_total` - Successfully dispatched
- `outbox_messages_failed_total` - Failed deliveries by destination/reason
- `outbox_messages_dlq_total` - Moved to DLQ
- `outbox_messages_pending` - Current pending count (gauge)
- `outbox_processing_duration_seconds` - Processing duration histogram

## Error Handling

### Error Creation

```typescript
import { createServiceError, ErrorBuilder } from './shared/utils/errors';

// Standard approach
throw createServiceError(400, 'Invalid email format');

// Builder pattern
throw ErrorBuilder.badRequest('Invalid email format', { field: 'email' });
throw ErrorBuilder.notFound('Employee', employeeId);
throw ErrorBuilder.conflict('Email already exists');
```

### Error Types

- **400 Bad Request**: Invalid input data
- **401 Unauthorized**: Missing or invalid authentication
- **403 Forbidden**: Insufficient permissions
- **404 Not Found**: Resource not found
- **409 Conflict**: Uniqueness violation
- **412 Precondition Failed**: Optimistic concurrency conflict
- **422 Unprocessable Entity**: Validation failure
- **500 Internal Server Error**: Unexpected error

## Testing Strategy

### Test Levels

1. **Unit Tests**: Service layer in isolation
2. **Integration Tests**: End-to-end HTTP flows with database
3. **Repository Tests**: Query correctness

### Test Pattern

```typescript
const cap = cds.test(path.join(__dirname, '..', '..', '..'));

const http = cap as unknown as {
  post: <T>(url: string, data: unknown, config: unknown) => Promise<T>;
  // ... other methods
};

// HTTP-level test
await http.post('/odata/v4/clients/Employees', payload, authConfig);

// Service-level test
await runAs({ roles: ['HRAdmin'], companyCodes: [] }, async (tx) => {
  return tx.run(SELECT.from(tx.entities.Clients));
});
```

### Coverage Goals

- **>80% overall code coverage**
- **>90% for handlers and services**
- All critical paths tested
- Edge cases and error scenarios covered

---

## Summary

This architecture provides:

✅ **Scalability**: Layered design, parallel processing
✅ **Maintainability**: Clear separation of concerns, DDD
✅ **Reliability**: Optimistic locking, transactional outbox
✅ **Observability**: Structured logging, Prometheus metrics
✅ **Security**: Multi-level authorization, GDPR compliance
✅ **Testability**: Dependency injection, clear boundaries

The design follows **CAP best practices** while adding enterprise features required for production systems.
