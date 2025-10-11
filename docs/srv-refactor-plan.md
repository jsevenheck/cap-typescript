# srv refactor plan

## Current structure overview

- `srv/server.ts` mixes CAP bootstrap hooks with outbox processing logic (interval scheduling, environment parsing, HTTP dispatch to third-party endpoint).
- `srv/handlers/client-service.ts` implements all handlers for `ClientService`, combining request validation, authorization checks, data normalization, concurrency control, and domain logic in a single module.
- Utility routines (normalization, user role checks, concurrency helpers, etc.) are embedded inside the handler file and reused via closure rather than shared modules.

## Target directory layout

```
srv/
  api/
    ThirdPartyEmployeeClient.ts
  handlers/
    ClientServiceHandlers.ts
  services/
    ClientLifecycleService.ts
    CostCenterService.ts
    EmployeeLifecycleService.ts
    EmployeeRetentionService.ts
    OutboxService.ts
  utils/
    auth.ts
    authProvider.ts
    concurrency.ts
    date.ts
    environment.ts
    errors.ts
    normalization.ts
```

## Old → new mapping

| Responsibility | Source today | Destination module(s) |
| --- | --- | --- |
| CAP bootstrap hooks (`bootstrap`, `served`) and default export | `srv/server.ts` | `srv/server.ts` keeps bootstrap wiring but delegates to `OutboxService` and `ThirdPartyEmployeeClient` helpers |
| Outbox scheduling, environment parsing, HTTP dispatch | `srv/server.ts` | `services/OutboxService.ts`, `utils/environment.ts`, `api/ThirdPartyEmployeeClient.ts` |
| Outbox HTTP client (fetch + HMAC signature) | inline in `srv/server.ts` | `api/ThirdPartyEmployeeClient.ts` |
| General environment number parsing | inline in `srv/server.ts` | `utils/environment.ts` |
| Company/identifier normalization, date parsing, comparison helpers | inline in `handlers/client-service.ts` | `utils/normalization.ts`, `utils/date.ts` |
| Request user role/attribute extraction and authorization checks | inline in `handlers/client-service.ts` | `utils/auth.ts` |
| Optimistic concurrency support (If-Match parsing, metadata lookup) | inline in `handlers/client-service.ts` | `utils/concurrency.ts` |
| Employee ID generation (prefix derivation, counter locking) | inline in `handlers/client-service.ts` | `services/EmployeeLifecycleService.ts` |
| Employee create/update validation & notification outbox entry | `handlers/client-service.ts` | `handlers/ClientServiceHandlers.ts` orchestrating `EmployeeLifecycleService` + `OutboxService` |
| Client create/update/delete validation | `handlers/client-service.ts` | `services/ClientLifecycleService.ts` used by handler |
| Cost center create/update/delete validation | `handlers/client-service.ts` | `services/CostCenterService.ts` |
| Retention action `anonymizeFormerEmployees` | `handlers/client-service.ts` | `services/EmployeeRetentionService.ts` |
| Cross-cutting error creation (HTTP status mapping) | implicit via `req.error` calls | `utils/errors.ts` providing typed errors consumed by services |

## Handler registration strategy

- Replace `srv/handlers/client-service.ts` with a thin registration module (`ClientServiceHandlers.ts`) that wires CAP events to domain services.
- Each handler extracts the CAP request context (user roles, attributes, headers, parameters) and passes primitives/transactions into the relevant service functions.
- Services perform validation/business logic and either mutate DTOs or return sanitized payloads. On violations they throw `cds.ServiceError` via `utils/errors.ts` so existing HTTP semantics remain unchanged.

## Testing impact

- Update existing Jest tests to import helper exports from their new locations where necessary (e.g., outbox helpers re-exported via `srv/server.ts`).
- Ensure new modules are covered by existing integration tests; add lightweight unit coverage where gaps appear (especially around utility parsing and concurrency helpers).

## Risks & mitigations

- **Risk:** Regression in authorization/concurrency flow when moving logic.  
  **Mitigation:** Maintain dedicated services mirroring existing helper signatures and reuse them in handlers; cover scenarios with existing integration tests.
- **Risk:** Outbox processing timers misconfigured after extraction.  
  **Mitigation:** Keep default constants and configuration logic untouched, simply relocate into services/utils; verify via Jest outbox tests.
