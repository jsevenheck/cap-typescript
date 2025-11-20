import type { Service } from '@sap/cds';

import { onUpsert } from './handlers/on-upsert';
import { onDelete } from './handlers/on-delete';
import { afterUpsert } from './handlers/after-upsert';

type ServiceWithAfter = Service & {
  after: (
    event: string | string[],
    entityOrHandler: string | ((...args: any[]) => unknown),
    maybeHandler?: (...args: any[]) => unknown,
  ) => unknown;
};

export const registerEmployeeCostCenterAssignmentHandlers = (srv: Service): void => {
  srv.before('CREATE', 'EmployeeCostCenterAssignments', onUpsert);
  srv.before('UPDATE', 'EmployeeCostCenterAssignments', onUpsert);
  srv.before('DELETE', 'EmployeeCostCenterAssignments', onDelete);
  (srv as ServiceWithAfter).after(['CREATE', 'UPDATE'], 'EmployeeCostCenterAssignments', afterUpsert);
};

export default registerEmployeeCostCenterAssignmentHandlers;

module.exports = { registerEmployeeCostCenterAssignmentHandlers };
