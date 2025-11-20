import type { Request, Service } from '@sap/cds';

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
} from './middleware/company-authorization';
import { buildUserContext, getAttributeValues } from './shared/utils/auth';

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ((...args: any[]) => unknown),
    maybeHandler?: (...args: any[]) => unknown,
  ) => unknown;
};

const registerHandlers = (srv: Service): void => {
  // Register company authorization middleware for all write operations
  // Note: Individual handlers also perform authorization checks for additional validation
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Clients', authorizeClients);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Employees', authorizeEmployees);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'CostCenters', authorizeCostCenters);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Locations', authorizeLocations);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'EmployeeCostCenterAssignments', authorizeEmployeeCostCenterAssignments);

  // Register userInfo function handler
  (srv as ServiceWithOn).on('userInfo', (req: Request) => {
    const userContext = buildUserContext(req.user as any);

    return {
      roles: Array.from(userContext.roles),
      attributes: {
        CompanyCode: getAttributeValues(userContext, 'CompanyCode'),
        companyCodes: getAttributeValues(userContext, 'companyCodes'),
      },
    };
  });

  registerClientHandlers(srv);
  registerEmployeeHandlers(srv);
  registerCostCenterHandlers(srv);
  registerLocationHandlers(srv);
  registerEmployeeCostCenterAssignmentHandlers(srv);
};

export default registerHandlers;

module.exports = registerHandlers;
