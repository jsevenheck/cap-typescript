import type { Service } from '@sap/cds';

import { registerClientHandlers } from './domain/client';
import { registerEmployeeHandlers } from './domain/employee';
import { registerCostCenterHandlers } from './domain/cost-center';
import {
  authorizeClients,
  authorizeCostCenters,
  authorizeEmployees,
} from './middleware/company-authorization';

const registerHandlers = (srv: Service): void => {
  // Register company authorization middleware for all write operations
  // Note: Individual handlers also perform authorization checks for additional validation
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Clients', authorizeClients);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'Employees', authorizeEmployees);
  srv.before(['CREATE', 'UPDATE', 'DELETE'], 'CostCenters', authorizeCostCenters);

  registerClientHandlers(srv);
  registerEmployeeHandlers(srv);
  registerCostCenterHandlers(srv);
};

export default registerHandlers;

module.exports = registerHandlers;
