import type { Service } from '@sap/cds';

import { onUpsert } from './handlers/on-upsert';
import { onDelete } from './handlers/on-delete';
import { afterUpsert } from './handlers/after-upsert';
import { afterDelete } from './handlers/after-delete';

export const registerEmployeeCostCenterAssignmentHandlers = (srv: Service): void => {
  srv.before('CREATE', 'EmployeeCostCenterAssignments', onUpsert);
  srv.before('UPDATE', 'EmployeeCostCenterAssignments', onUpsert);
  srv.before('DELETE', 'EmployeeCostCenterAssignments', onDelete);
  const srvWithAfter = srv as { after: Service['after'] };
  srvWithAfter.after(['CREATE', 'UPDATE'], 'EmployeeCostCenterAssignments', afterUpsert);
  srvWithAfter.after('DELETE', 'EmployeeCostCenterAssignments', afterDelete);
};

export default registerEmployeeCostCenterAssignmentHandlers;

module.exports = { registerEmployeeCostCenterAssignmentHandlers };
