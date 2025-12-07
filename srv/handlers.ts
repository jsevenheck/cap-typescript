import type { Request, Service } from '@sap/cds';

import { registerClientHandlers } from './domain/client';
import { registerEmployeeHandlers } from './domain/employee';
import { registerCostCenterHandlers } from './domain/cost-center';
import { registerLocationHandlers } from './domain/location';
import { registerEmployeeCostCenterAssignmentHandlers } from './domain/employee-cost-center';
import { buildUserContext, getAttributeValues, userHasRole } from './shared/utils/auth';

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
  // Authorization is now handled via @restrict annotations in srv/service.cds

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

  registerClientHandlers(srv);
  registerEmployeeHandlers(srv);
  registerCostCenterHandlers(srv);
  registerLocationHandlers(srv);
  registerEmployeeCostCenterAssignmentHandlers(srv);
};

export default registerHandlers;

module.exports = registerHandlers;
