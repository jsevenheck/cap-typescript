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
  srv.before(['CREATE', 'UPDATE'], 'Clients', authorizeClients);
  srv.before(['CREATE', 'UPDATE'], 'Employees', authorizeEmployees);
  srv.before(['CREATE', 'UPDATE'], 'CostCenters', authorizeCostCenters);

  registerClientHandlers(srv);
  registerEmployeeHandlers(srv);
  registerCostCenterHandlers(srv);
};

export default registerHandlers;

module.exports = registerHandlers;
