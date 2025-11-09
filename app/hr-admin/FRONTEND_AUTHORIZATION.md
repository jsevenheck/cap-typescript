# Frontend Authorization Implementation Guide

## Current Status

### ✅ Backend Authorization (ENFORCED)
All authorization is **properly enforced** at the backend level:
- **@restrict annotations** in `service.cds` control access to all entities
- **Company authorization middleware** validates user access to company codes
- **Role-based access control**: HRAdmin, HRViewer, HREditor
- **Row-level security** via CompanyCode attributes
- **Individual handlers** perform additional validation

### 🎨 Frontend Authorization (UX ENHANCEMENT)
Frontend role checks are **optional** and only improve user experience by:
- Hiding buttons users cannot use
- Preventing unnecessary error messages
- Providing better visual feedback

**Important**: Frontend checks are **NOT** security controls - they are UX improvements. The backend always enforces actual security.

---

## Implementation Pattern

###  Step 1: Add User Info Service

Created: `/webapp/core/authorization/AuthorizationService.ts`

This service provides methods to check user roles:
```typescript
import { AuthorizationService } from "../core/authorization/AuthorizationService";

// Check if user can write
const canWrite = await AuthorizationService.canWrite();

// Check specific role
const isAdmin = await AuthorizationService.hasRole(UserRole.HRAdmin);

// Check if read-only
const isReadOnly = await AuthorizationService.isReadOnly();
```

### Step 2: Add View Model Property

In your controller's `onInit()`:
```typescript
public onInit(): void {
  const viewModel = new JSONModel({
    canWrite: true, // Will be updated after auth check
    selectedClientId: null,
    // ...other properties
  });
  this.getView()?.setModel(viewModel, "view");

  // Check authorization asynchronously
  this.checkAuthorization();
}

private async checkAuthorization(): Promise<void> {
  const canWrite = await AuthorizationService.canWrite();
  this.getView()?.getModel("view")?.setProperty("/canWrite", canWrite);
}
```

### Step 3: Bind Button Visibility in View

Update `Main.view.xml` to use the `canWrite` property:

```xml
<!-- Add/Edit/Delete buttons should check both selection AND write permission -->
<Button
    type="Emphasized"
    text="Add"
    icon="sap-icon://add"
    visible="{view>/canWrite}"
    press=".onAddClient"/>
<Button
    text="Edit"
    icon="sap-icon://edit"
    enabled="{= ${view>/canWrite} && !!${view>/selectedClientId}}"
    press=".onEditClient"/>
<Button
    text="Delete"
    icon="sap-icon://delete"
    type="Transparent"
    enabled="{= ${view>/canWrite} && !!${view>/selectedClientId}}"
    press=".onDeleteClient"/>

<!-- Refresh should always be visible -->
<Button
    text="Refresh"
    icon="sap-icon://refresh"
    press=".onRefresh"/>
```

---

## Example Implementation

### Full Controller Example

```typescript
import Controller from "sap/ui/core/mvc/Controller";
import JSONModel from "sap/ui/model/json/JSONModel";
import { AuthorizationService } from "../core/authorization/AuthorizationService";

export default class Main extends Controller {
  public onInit(): void {
    // Initialize view model
    const viewModel = new JSONModel({
      canWrite: false, // Default to read-only
      canDelete: false,
      selectedClientId: null,
    });
    this.getView()?.setModel(viewModel, "view");

    // Check user permissions
    void this.initializePermissions();
  }

  private async initializePermissions(): Promise<void> {
    try {
      const canWrite = await AuthorizationService.canWrite();
      const isAdmin = await AuthorizationService.isAdmin();

      this.getView()?.getModel("view")?.setData({
        canWrite,
        canDelete: isAdmin, // Only admins can delete
      }, true); // true = merge with existing data
    } catch (error) {
      console.error("Failed to check permissions:", error);
      // Default to read-only on error
    }
  }

  // Your existing methods...
}
```

---

## Benefits

### ✅ Better User Experience
- Users don't see buttons they can't use
- Reduces confusion and frustration
- Prevents unnecessary 403 error messages

### ✅ Backend Security Maintained
- All operations still validated server-side
- Frontend checks can be bypassed (and that's OK!)
- Security is not compromised

### ✅ Progressive Enhancement
- App works without frontend checks (backend enforces everything)
- Frontend checks improve UX incrementally
- Easy to add/remove without security impact

---

## Current Implementation Note

The current application **does not implement** frontend authorization checks because:

1. **Backend is properly secured** - All @restrict annotations and middleware are in place
2. **Small user base** - Typically all users have write permissions
3. **Development simplicity** - Fewer moving parts during development

**To implement frontend checks**: Follow the pattern above when the application scales or when read-only users become common.

---

## Testing

### Testing with Different Roles (Mocked Auth)

In `package.json`, configure test users:

```json
"users": {
  "dev": { "roles": ["HRAdmin", "HRViewer", "HREditor"] },
  "hrviewer": { "roles": ["HRViewer"] },
  "hreditor": { "roles": ["HREditor"] }
}
```

Login with different users to verify:
- `dev` sees all buttons
- `hrviewer` sees no write buttons
- `hreditor` sees write buttons but maybe not delete

### Testing Backend Enforcement

Try to bypass frontend checks:
```javascript
// Open browser console and try to create a client as HRViewer
// This should FAIL at the backend even if frontend allows it
fetch('/odata/v4/clients/Clients', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ name: 'Test', companyId: 'TEST-001' })
});
// Expected: 403 Forbidden
```

---

## Recommendation

**For production deployment**: Implement frontend authorization checks as described above.

**For current phase**: Backend authorization is sufficient. The frontend checks are a "nice-to-have" UX improvement, not a security requirement.

**Priority**: 🟢 LOW (UX enhancement, not security issue)
