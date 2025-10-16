# Repository Analysis Findings

## Backend Issues (srv/)

### 1. Active employee export ignores employment period filters
- **Location**: `srv/domain/employee/handlers/active-employees.read.ts` lines 188-213【F:srv/domain/employee/handlers/active-employees.read.ts†L188-L213】
- **Severity**: High
- **Description**: The handler builds the CQN with `query.where(...)` three times when the model lacks an `isActive` flag. Each invocation overwrites the previous `WHERE` clause instead of chaining it, so only the last condition survives. As a result, either the exit-date check or the status check is dropped.
- **Impact**: `/api/employees/active` can return employees who have not started yet or who already left the company, breaking downstream integrations that rely on an “active only” feed.
- **Reproduction steps**:
  1. Create an employee whose `entryDate` is in the future (or whose `exitDate` is in the past) but keep the status `active`.
  2. Call `GET /api/employees/active` with a valid API key.
  3. Observe that the employee is still returned even though they should be filtered out.
- **Suggested fix**: Combine the predicates into a single `.where` call using `and`, or pass the complete object once (e.g. `{ entryDate: {'<=': today}, and: [...] }`), so all filters are applied simultaneously.

## Frontend Issues (app/)

### 2. Selected client details shown in headers become stale after edits
- **Location**: `app/hr-admin/webapp/services/selection.service.ts` lines 19-32【F:app/hr-admin/webapp/services/selection.service.ts†L19-L32】
- **Severity**: Medium
- **Description**: The view-state model stores plain copies of the selected client’s name and company ID when `setClient` runs. Editing the client updates the OData context, but these snapshots are never refreshed, so the employee and cost-center headers continue showing the old values until the user reselects the client.
- **Impact**: Users see outdated context information after renaming a client or changing its company ID, which can lead to confusion and incorrect decisions (e.g., believing the change failed).
- **Reproduction steps**:
  1. Select a client and navigate to the Employees page.
  2. Edit that client’s name or company ID on the main page.
  3. Return to the Employees (or Cost Centers) page — the header still shows the previous name/ID.
- **Suggested fix**: Listen to `context` property change events (e.g., `context.attachPatchCompleted`) or derive the header text directly from the binding context instead of copying values into the view-state model.

### 3. Missing UI validation for status/exit-date consistency when saving employees
- **Location**: `app/hr-admin/webapp/controller/employees/EmployeeHandler.controller.ts` lines 162-215【F:app/hr-admin/webapp/controller/employees/EmployeeHandler.controller.ts†L162-L215】
- **Severity**: Low
- **Description**: The form validates required fields and ensures the exit date is not before the entry date, but it does not enforce the business rules that “inactive employees must have an exit date” and “employees with an exit date must be inactive.” The backend rejects such payloads, but the user only learns this after a failed save.
- **Impact**: Users receive generic backend errors and must re-open the dialog, reducing usability and increasing support load.
- **Reproduction steps**:
  1. Edit an employee, set status to `inactive`, leave exit date empty, and click **Save**.
  2. Observe the backend error message about missing exit date.
  3. Alternatively, set an exit date while keeping status `active` and observe the same backend error.
- **Suggested fix**: Add client-side checks before submission to block the save and show targeted messages when the status and exit date are inconsistent.

## Cross-Cutting Issues

_No additional cross-cutting issues were identified during this review._
