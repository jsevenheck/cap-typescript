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
  srv.before(['CREATE', 'UPDATE'], 'Clients', authorizeClients);
  srv.before(['CREATE', 'UPDATE'], 'Employees', authorizeEmployees);
  srv.before(['CREATE', 'UPDATE'], 'CostCenters', authorizeCostCenters);
  srv.before(['CREATE', 'UPDATE'], 'Locations', authorizeLocations);
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
    const user = (req as unknown as { user: CAPUser }).user;
    const userContext = buildUserContext(user);

    const requiredRoles = ['HRAdmin', 'HREditor', 'HRViewer'];
    const hasRequiredRole = requiredRoles.some((role) => userHasRole(userContext, role));
    if (!hasRequiredRole) {
      return req.reject(403, 'User is not authorized to access employee statistics');
    }

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

  registerClientHandlers(srv);
  registerEmployeeHandlers(srv);
  registerCostCenterHandlers(srv);
  registerLocationHandlers(srv);
  registerEmployeeCostCenterAssignmentHandlers(srv);
};

export default registerHandlers;

module.exports = registerHandlers;
