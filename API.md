# API Documentation

## Overview

This document provides comprehensive API documentation for the SAP CAP TypeScript HR Management application.

## Base URL

- **Development**: `http://localhost:4004/odata/v4/clients/`
- **Production**: `https://[your-app].cfapps.sap.hana.ondemand.com/odata/v4/clients/`

## Authentication

### Development
- **Method**: Basic Auth
- **Users**:
  - `dev` / `dev` - Full access (HRAdmin, HREditor, HRViewer)
  - `hreditor` / `hreditor` - Editor access for company 1010
  - `hrviewer` / `hrviewer` - Viewer access for company 1010

### Production
- **Method**: JWT Bearer Token
- **Provider**: SAP Identity Authentication Service (IAS)
- Tokens must be included in the `Authorization` header: `Bearer <token>`

## Common Request Headers

```
Authorization: Bearer <token>           # Production only
Content-Type: application/json          # For POST/PUT/PATCH requests
Accept: application/json
x-correlation-id: <uuid>               # Optional, for request tracing
If-Match: <etag>                       # Required for UPDATE/DELETE operations
```

## Common Response Headers

```
Content-Type: application/json
x-correlation-id: <uuid>               # Correlation ID for tracing
ETag: "2024-01-05T10:30:00Z"          # Entity version timestamp
```

## Error Response Format

All error responses follow this structure:

```json
{
  "error": "Error Type",
  "message": "Detailed error message",
  "code": 400,
  "timestamp": "2024-01-05T10:30:00.000Z",
  "correlationId": "550e8400-e29b-41d4-a716-446655440000"
}
```

### Common HTTP Status Codes

| Code | Meaning | Description |
|------|---------|-------------|
| 200 | OK | Request successful |
| 201 | Created | Resource created successfully |
| 204 | No Content | Resource deleted successfully |
| 400 | Bad Request | Invalid request parameters |
| 401 | Unauthorized | Missing or invalid authentication |
| 403 | Forbidden | Insufficient permissions |
| 404 | Not Found | Resource not found |
| 408 | Request Timeout | Request exceeded timeout (30s default) |
| 409 | Conflict | Concurrent modification detected |
| 413 | Payload Too Large | Request body exceeds 1MB limit |
| 414 | URI Too Long | URL exceeds 2KB limit |
| 415 | Unsupported Media Type | Invalid Content-Type |
| 429 | Too Many Requests | Rate limit exceeded |
| 431 | Request Header Fields Too Large | Headers exceed 8KB limit |
| 500 | Internal Server Error | Server error |
| 503 | Service Unavailable | Service temporarily unavailable |

## OData Query Options

All entity endpoints support standard OData v4 query options:

### $filter
Filter results based on conditions:
```
GET /Employees?$filter=status eq 'active'
GET /Employees?$filter=entryDate gt 2023-01-01
GET /Employees?$filter=contains(firstName, 'John')
```

### $select
Select specific fields:
```
GET /Employees?$select=employeeId,firstName,lastName,email
```

### $expand
Expand related entities:
```
GET /Employees?$expand=client,location,costCenter
GET /Clients?$expand=employees($filter=status eq 'active')
```

### $orderby
Sort results:
```
GET /Employees?$orderby=lastName asc,firstName asc
GET /CostCenters?$orderby=validFrom desc
```

### $top and $skip
Pagination:
```
GET /Employees?$top=20&$skip=0
GET /Employees?$top=20&$skip=20
```

### $count
Get total count:
```
GET /Employees?$count=true
GET /Employees/$count
```

### $search
Full-text search (if configured):
```
GET /Employees?$search=john
```

## Main Entities

### Clients

Company clients with unique company IDs.

**Endpoints:**
- `GET /Clients` - List all clients
- `GET /Clients(ID)` - Get single client
- `POST /Clients` - Create client
- `PATCH /Clients(ID)` - Update client
- `DELETE /Clients(ID)` - Delete client

**Entity Structure:**
```typescript
{
  ID: string;              // UUID
  companyId: string;       // 4-digit code (immutable)
  name: string;            // Max 120 chars
  createdAt: string;       // ISO 8601 timestamp
  createdBy: string;       // User ID
  modifiedAt: string;      // ISO 8601 timestamp (ETag)
  modifiedBy: string;      // User ID
  employees?: Employee[];  // Expanded navigation
  costCenters?: CostCenter[]; // Expanded navigation
  locations?: Location[];  // Expanded navigation
}
```

**Example Request:**
```bash
curl -X POST http://localhost:4004/odata/v4/clients/Clients \
  -H "Content-Type: application/json" \
  -u dev:dev \
  -d '{
    "companyId": "1030",
    "name": "Acme Corporation"
  }'
```

**Validation Rules:**
- `companyId`: Required, unique, 4 digits, immutable after creation
- `name`: Required, 1-120 characters

### Employees

Employee records with auto-generated IDs and status tracking.

**Endpoints:**
- `GET /Employees` - List all employees
- `GET /Employees(ID)` - Get single employee
- `POST /Employees` - Create employee
- `PATCH /Employees(ID)` - Update employee
- `DELETE /Employees(ID)` - Delete employee

**Entity Structure:**
```typescript
{
  ID: string;                    // UUID
  employeeId: string;            // Auto-generated company+counter (CCCC-NNNN), e.g. 1010-0001
  firstName: string;             // Max 60 chars
  lastName: string;              // Max 60 chars
  email: string;                 // RFC 5322 format, max 120 chars
  phoneNumber?: string;          // E.164 format, max 30 chars
  location_ID: string;           // UUID, required
  positionLevel?: string;        // Max 40 chars
  entryDate: string;             // ISO 8601 date
  exitDate?: string;             // ISO 8601 date
  status: 'active' | 'inactive'; // Default: 'active'
  employmentType: 'internal' | 'external'; // Default: 'internal'
  isManager: boolean;            // Default: false
  anonymizedAt?: string;         // ISO 8601 timestamp
  client_ID: string;             // UUID, required
  manager_ID?: string;           // UUID, must be same client
  costCenter_ID?: string;        // UUID, must be same client
  createdAt: string;
  createdBy: string;
  modifiedAt: string;            // ETag
  modifiedBy: string;
}
```

**Example Request:**
```bash
curl -X POST http://localhost:4004/odata/v4/clients/Employees \
  -H "Content-Type: application/json" \
  -u dev:dev \
  -d '{
    "firstName": "John",
    "lastName": "Doe",
    "email": "john.doe@example.com",
    "phoneNumber": "+1-555-0100",
    "entryDate": "2024-01-15",
    "status": "active",
    "employmentType": "internal",
    "client_ID": "550e8400-e29b-41d4-a716-446655440000",
    "location_ID": "660e8400-e29b-41d4-a716-446655440000"
  }'
```

**Validation Rules:**
- `employeeId`: Auto-generated, format: NNNN-NNNN (company code + counter)
- `firstName`, `lastName`: Required, 1-60 characters
- `email`: Required, valid email format, max 120 characters
- `phoneNumber`: Optional, valid phone format (E.164), max 30 characters
- `entryDate`: Required
- `exitDate`: Must be after entryDate if provided
- `manager`: Must belong to same client
- `costCenter`: Must belong to same client
- `location`: Required, must belong to same client

### Cost Centers

Cost center definitions with time-based validity and responsibility tracking.

**Endpoints:**
- `GET /CostCenters` - List all cost centers
- `GET /CostCenters(ID)` - Get single cost center
- `POST /CostCenters` - Create cost center
- `PATCH /CostCenters(ID)` - Update cost center
- `DELETE /CostCenters(ID)` - Delete cost center

**Entity Structure:**
```typescript
{
  ID: string;              // UUID
  code: string;            // Max 40 chars, unique per client
  name: string;            // Max 120 chars
  description?: string;    // Max 255 chars
  validFrom: string;       // ISO 8601 date
  validTo?: string;        // ISO 8601 date
  client_ID: string;       // UUID, required
  responsible_ID: string;  // UUID, must be same client
  createdAt: string;
  createdBy: string;
  modifiedAt: string;      // ETag
  modifiedBy: string;
}
```

**Validation Rules:**
- `code`: Required, unique per client, 1-40 characters
- `name`: Required, 1-120 characters
- `description`: Optional, max 255 characters
- `validFrom`: Required
- `validTo`: Must be after validFrom if provided
- `responsible`: Required, must be an employee from same client

### Locations

Office locations with address details and country associations.

**Endpoints:**
- `GET /Locations` - List all locations
- `GET /Locations(ID)` - Get single location
- `POST /Locations` - Create location
- `PATCH /Locations(ID)` - Update location
- `DELETE /Locations(ID)` - Delete location

**Entity Structure:**
```typescript
{
  ID: string;                // UUID
  city: string;              // Max 100 chars
  country_code: string;      // ISO 3166-1 alpha-3
  zipCode: string;           // Max 20 chars
  street: string;            // Max 200 chars
  addressSupplement?: string; // Max 200 chars
  validFrom: string;         // ISO 8601 date
  validTo?: string;          // ISO 8601 date
  client_ID: string;         // UUID, required
  createdAt: string;
  createdBy: string;
  modifiedAt: string;        // ETag
  modifiedBy: string;
}
```

**Validation Rules:**
- `city`: Required, 1-100 characters
- `country_code`: Required, valid ISO 3166-1 alpha-3 code
- `zipCode`: Required, 1-20 characters
- `street`: Required, 1-200 characters
- `addressSupplement`: Optional, max 200 characters
- `validFrom`: Required
- `validTo`: Must be after validFrom if provided

## Custom Functions and Actions

### userInfo Function

Get current user information including roles and attributes.

**Endpoint:** `GET /userInfo()`

**Authorization:** Requires HRAdmin, HREditor, or HRViewer role

**Response:**
```json
{
  "roles": ["HRAdmin", "HREditor"],
  "attributes": {
    "CompanyCode": ["1010", "1020"],
    "companyCodes": ["1010", "1020"]
  }
}
```

### employeeStatistics Function

Get aggregated employee statistics.

**Endpoint:** `GET /employeeStatistics(clientId=<UUID>)`

**Parameters:**
- `clientId` (optional): Filter statistics for specific client

**Authorization:** Requires HRAdmin, HREditor, or HRViewer role

**Response:**
```json
{
  "totalEmployees": 150,
  "activeEmployees": 140,
  "inactiveEmployees": 10,
  "internalEmployees": 130,
  "externalEmployees": 20,
  "managersCount": 15,
  "recentHires": 5,
  "upcomingExits": 2
}
```

### costCenterStatistics Function

Get aggregated cost center statistics.

**Endpoint:** `GET /costCenterStatistics(clientId=<UUID>)`

**Parameters:**
- `clientId` (optional): Filter statistics for specific client

**Authorization:** Requires HRAdmin, HREditor, or HRViewer role

**Response:**
```json
{
  "totalCostCenters": 45,
  "activeCostCenters": 40,
  "expiredCostCenters": 5,
  "upcomingExpiry": 3,
  "withAssignedEmployees": 38
}
```

### locationStatistics Function

Get aggregated location statistics.

**Endpoint:** `GET /locationStatistics(clientId=<UUID>)`

**Parameters:**
- `clientId` (optional): Filter statistics for specific client

**Authorization:** Requires HRAdmin, HREditor, or HRViewer role

**Response:**
```json
{
  "totalLocations": 12,
  "activeLocations": 10,
  "expiredLocations": 2,
  "upcomingExpiry": 1
}
```

### anonymizeFormerEmployees Action

Anonymize former employees who left before a specified date.

**Endpoint:** `POST /anonymizeFormerEmployees`

**Authorization:** Requires HREditor or HRAdmin role

**Request Body:**
```json
{
  "before": "2023-01-01"
}
```

**Response:**
```json
{
  "value": 5  // Number of employees anonymized
}
```

## Optimistic Concurrency Control

All entities support optimistic concurrency control via ETags. When updating or deleting entities:

1. First, retrieve the entity to get its current `modifiedAt` value
2. Include this value in the `If-Match` header when updating/deleting

**Example:**
```bash
# 1. Get current entity
curl -X GET http://localhost:4004/odata/v4/clients/Employees(ID) \
  -u dev:dev

# Response includes: "modifiedAt": "2024-01-05T10:30:00Z"

# 2. Update with If-Match header
curl -X PATCH http://localhost:4004/odata/v4/clients/Employees(ID) \
  -H "Content-Type: application/json" \
  -H "If-Match: 2024-01-05T10:30:00Z" \
  -u dev:dev \
  -d '{ "status": "inactive" }'
```

If the entity was modified by another user, you'll receive a 412 Precondition Failed response.

## Authorization Model

The application uses a multi-layer authorization approach:

### Role-Based Access Control (RBAC)

Three roles with hierarchical permissions:

1. **HRAdmin** - Full access to all data
2. **HREditor** - Read/write access to assigned companies
3. **HRViewer** - Read-only access to assigned companies

### Attribute-Based Access Control (ABAC)

Users are assigned company codes via attributes:
- `CompanyCode` attribute
- `companyCodes` attribute

HREditor and HRViewer roles can only access data for their assigned companies.

### Entity-Level Authorization

All entities include declarative `@restrict` annotations enforcing:
- Role requirements
- Company code filtering via `where` clauses
- Automatic data isolation

## Rate Limiting

API requests are rate-limited to prevent abuse:

- **Default**: 100 requests per minute per user
- **Burst**: 20 requests per second
- **Response Header**: `X-RateLimit-Remaining`, `X-RateLimit-Reset`
- **Exceeded Response**: 429 Too Many Requests

## Request Timeouts

All requests have a default timeout of 30 seconds:

- **Configurable**: Set `REQUEST_TIMEOUT_MS` environment variable
- **Maximum**: 300000ms (5 minutes)
- **Exceeded Response**: 408 Request Timeout

## Health Check Endpoints

### Liveness Probe
**Endpoint:** `GET /health/live`

Simple check that the application is running.

**Response:**
```json
{
  "status": "alive",
  "timestamp": "2024-01-05T10:30:00.000Z"
}
```

### Readiness Probe
**Endpoint:** `GET /health/ready`

Checks application readiness including database connectivity.

**Response (Ready):**
```json
{
  "status": "ready",
  "timestamp": "2024-01-05T10:30:00.000Z",
  "checks": {
    "database": "connected"
  }
}
```

**Response (Not Ready):**
```json
{
  "status": "not_ready",
  "timestamp": "2024-01-05T10:30:00.000Z",
  "checks": {
    "database": "disconnected"
  },
  "error": "Database connection not available"
}
```

### General Health Check
**Endpoint:** `GET /health`

General health check with database connectivity verification.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2024-01-05T10:30:00.000Z",
  "checks": {
    "database": "connected"
  }
}
```

## Best Practices

### Request Headers

Always include:
- `Content-Type: application/json` for POST/PATCH requests
- `Accept: application/json` to specify response format
- `If-Match` header for UPDATE/DELETE operations
- Custom `x-correlation-id` for request tracing (optional but recommended)

### Pagination

For large datasets, always use pagination:
```
GET /Employees?$top=50&$skip=0&$count=true
```

### Field Selection

Only request needed fields:
```
GET /Employees?$select=employeeId,firstName,lastName,email
```

### Filtering

Filter on the server side to reduce payload:
```
GET /Employees?$filter=status eq 'active' and entryDate gt 2023-01-01
```

### Error Handling

Always check response status codes and handle errors appropriately:
- 4xx errors: Client-side issues, fix the request
- 5xx errors: Server-side issues, implement retry logic with exponential backoff

### Concurrency

Always use ETags for UPDATE/DELETE operations to prevent conflicts.

### Security

- Never include credentials in URLs or logs
- Always use HTTPS in production
- Rotate API keys regularly
- Implement proper CORS policies

## Examples

### Complete CRUD Operations

#### Create Client
```bash
curl -X POST http://localhost:4004/odata/v4/clients/Clients \
  -H "Content-Type: application/json" \
  -u dev:dev \
  -d '{
    "companyId": "1030",
    "name": "Acme Corporation"
  }'
```

#### Read Client
```bash
curl -X GET "http://localhost:4004/odata/v4/clients/Clients?$filter=companyId eq '1030'" \
  -u dev:dev
```

#### Update Client
```bash
curl -X PATCH http://localhost:4004/odata/v4/clients/Clients(550e8400-e29b-41d4-a716-446655440000) \
  -H "Content-Type: application/json" \
  -H "If-Match: 2024-01-05T10:30:00Z" \
  -u dev:dev \
  -d '{
    "name": "Acme Corp (Updated)"
  }'
```

#### Delete Client
```bash
curl -X DELETE http://localhost:4004/odata/v4/clients/Clients(550e8400-e29b-41d4-a716-446655440000) \
  -H "If-Match: 2024-01-05T10:30:00Z" \
  -u dev:dev
```

## Support

For issues or questions:
- Check application logs for correlation IDs
- Review error messages and status codes
- Consult the main README.md for setup instructions
- Check SAP CAP documentation: https://cap.cloud.sap/docs/

## Changelog

See the repository's commit history for detailed changes and improvements.
