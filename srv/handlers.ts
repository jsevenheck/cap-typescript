import type { Request, Service } from '@sap/cds';
import cds from '@sap/cds';

import { registerClientHandlers } from './domain/client';
import { registerEmployeeHandlers } from './domain/employee';
import { registerCostCenterHandlers } from './domain/cost-center';
import { registerLocationHandlers } from './domain/location';
import { registerEmployeeCostCenterAssignmentHandlers } from './domain/employee-cost-center';
import {
  authorizeClients,
  authorizeCostCenters,
  authorizeEmployees,
  authorizeLocations,
  authorizeEmployeeCostCenterAssignments,
  CompanyAuthorization,
} from './middleware/company-authorization';
import { buildUserContext, getAttributeValues, userHasRole } from './shared/utils/auth';
import { getEmployeeStatistics } from './domain/employee/services/statistics.service';
import { getCostCenterStatistics } from './domain/cost-center/services/statistics.service';
import { getLocationStatistics } from './domain/location/services/statistics.service';
import { getClientDeletePreview } from './domain/client/services/delete-preview.service';
import { getCostCenterDeletePreview } from './domain/cost-center/services/delete-preview.service';
import { getLocationDeletePreview } from './domain/location/services/delete-preview.service';
import type { CapServiceError } from './shared/utils/errors';

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ((...args: any[]) => unknown),
    maybeHandler?: (...args: any[]) => unknown,
  ) => unknown;
};

// Define a minimal User interface if strict typing is required and standard types are insufficient
interface CAPUser {
  id: string;
  roles: { [key: string]: any } | string[];
  attr: { [key: string]: any };
}

const registerHandlers = (srv: Service): void => {
  // Register company authorization middleware for all write operations
  // Note: Individual handlers also perform authorization checks for additional validation
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Clients', authorizeClients);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Employees', authorizeEmployees);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'CostCenters', authorizeCostCenters);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Locations', authorizeLocations);
  srv.before(
    ['CREATE', 'UPDATE', 'DELETE'],
    'EmployeeCostCenterAssignments',
    authorizeEmployeeCostCenterAssignments,
  );

  // Register userInfo function handler
  (srv as ServiceWithOn).on('userInfo', (req: Request) => {
    // req.user is usually present but not strictly typed in older definitions
    // We cast it to our expected shape or use 'any' if necessary
    const user = (req as unknown as { user: CAPUser }).user;
    const userContext = buildUserContext(user);

    const requiredRoles = ['HRAdmin', 'HREditor', 'HRViewer'];
    const hasRequiredRole = requiredRoles.some((role) => userHasRole(userContext, role));
    if (!hasRequiredRole) {
      return req.reject(403, 'User is not authorized to access userInfo');
    }

    return {
      roles: Array.from(userContext.roles),
      attributes: {
        CompanyCode: getAttributeValues(userContext, 'CompanyCode'),
        companyCodes: getAttributeValues(userContext, 'companyCodes'),
      },
    };
  });

  // Register employeeStatistics function handler
  (srv as ServiceWithOn).on('employeeStatistics', async (req: Request) => {
    const clientId = (req.data as { clientId?: string })?.clientId ?? null;

    try {
      const authorization = new CompanyAuthorization(req);
      const clientScope = await authorization.resolveAuthorizedClientScope(clientId);
      const tx = cds.transaction(req);
      const statistics = await getEmployeeStatistics(tx, clientScope);
      return statistics;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve statistics';
      const serviceError = error as CapServiceError;
      const status = typeof serviceError?.status === 'number' ? serviceError.status : 500;
      return req.reject(status, message);
    }
  });

  // Register clientDeletePreview function handler
  (srv as ServiceWithOn).on('clientDeletePreview', async (req: Request) => {
    const clientId = (req.data as { clientId?: string })?.clientId;

    if (!clientId) {
      return req.reject(400, 'Client ID is required');
    }

    try {
      // Verify authorization for the client
      const authorization = new CompanyAuthorization(req);
      await authorization.resolveAuthorizedClientScope(clientId);

      const tx = cds.transaction(req);
      const preview = await getClientDeletePreview(tx, clientId);

      if (!preview) {
        return req.reject(404, 'Client not found');
      }

      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve delete preview';
      const serviceError = error as CapServiceError;
      const status = typeof serviceError?.status === 'number' ? serviceError.status : 500;
      return req.reject(status, message);
    }
  });

  // Register costCenterStatistics function handler
  (srv as ServiceWithOn).on('costCenterStatistics', async (req: Request) => {
    const clientId = (req.data as { clientId?: string })?.clientId ?? null;

    try {
      const authorization = new CompanyAuthorization(req);
      const clientScope = await authorization.resolveAuthorizedClientScope(clientId);
      const tx = cds.transaction(req);
      const statistics = await getCostCenterStatistics(tx, clientScope);
      return statistics;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve cost center statistics';
      const serviceError = error as CapServiceError;
      const status = typeof serviceError?.status === 'number' ? serviceError.status : 500;
      return req.reject(status, message);
    }
  });

  // Register locationStatistics function handler
  (srv as ServiceWithOn).on('locationStatistics', async (req: Request) => {
    const clientId = (req.data as { clientId?: string })?.clientId ?? null;

    try {
      const authorization = new CompanyAuthorization(req);
      const clientScope = await authorization.resolveAuthorizedClientScope(clientId);
      const tx = cds.transaction(req);
      const statistics = await getLocationStatistics(tx, clientScope);
      return statistics;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve location statistics';
      const serviceError = error as CapServiceError;
      const status = typeof serviceError?.status === 'number' ? serviceError.status : 500;
      return req.reject(status, message);
    }
  });

  // Register costCenterDeletePreview function handler
  (srv as ServiceWithOn).on('costCenterDeletePreview', async (req: Request) => {
    const costCenterId = (req.data as { costCenterId?: string })?.costCenterId;

    if (!costCenterId) {
      return req.reject(400, 'Cost Center ID is required');
    }

    try {
      const tx = cds.transaction(req);
      const preview = await getCostCenterDeletePreview(tx, costCenterId);

      if (!preview) {
        return req.reject(404, 'Cost center not found');
      }

      // Verify authorization for the cost center's client
      const authorization = new CompanyAuthorization(req);
      await authorization.resolveAuthorizedClientScope(preview.clientId);

      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve delete preview';
      const serviceError = error as CapServiceError;
      const status = typeof serviceError?.status === 'number' ? serviceError.status : 500;
      return req.reject(status, message);
    }
  });

  // Register locationDeletePreview function handler
  (srv as ServiceWithOn).on('locationDeletePreview', async (req: Request) => {
    const locationId = (req.data as { locationId?: string })?.locationId;

    if (!locationId) {
      return req.reject(400, 'Location ID is required');
    }

    try {
      const tx = cds.transaction(req);
      const preview = await getLocationDeletePreview(tx, locationId);

      if (!preview) {
        return req.reject(404, 'Location not found');
      }

      // Verify authorization for the location's client
      const authorization = new CompanyAuthorization(req);
      await authorization.resolveAuthorizedClientScope(preview.clientId);

      return preview;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to retrieve delete preview';
      const serviceError = error as CapServiceError;
      const status = typeof serviceError?.status === 'number' ? serviceError.status : 500;
      return req.reject(status, message);
    }
  });

  registerClientHandlers(srv);
  registerEmployeeHandlers(srv);
  registerCostCenterHandlers(srv);
  registerLocationHandlers(srv);
  registerEmployeeCostCenterAssignmentHandlers(srv);
};

export default registerHandlers;

module.exports = registerHandlers;
