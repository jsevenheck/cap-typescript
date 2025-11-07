import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { EmployeeEntity } from '../dto/employee.dto';
import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { validateEmployeeDeletion } from '../services/validation';
import { enforceEmployeeCompany } from '../../shared/security/company-authorization.service';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Employee identifier is required.');
  }

  // Fetch the employee to check company authorization
  const tx = cds.transaction(req);
  const employee = (await tx.run(
    cds.ql.SELECT.one.from('clientmgmt.Employees')
      .columns('ID', 'client_ID')
      .where({ ID: targetId }),
  )) as Partial<EmployeeEntity> | undefined;

  if (employee) {
    await enforceEmployeeCompany(req, [employee]);
  }

  await validateEmployeeDeletion({
    targetId,
    tx,
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });
};

export default onDelete;
