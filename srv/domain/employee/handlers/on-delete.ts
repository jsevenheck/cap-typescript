import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { enforceEmployeeCompany } from '../../shared/security/company-authorization.service';
import { validateEmployeeDeletion } from '../services/validation';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Employee identifier is required.');
  }
  await enforceEmployeeCompany(req, [{ ID: targetId }]);
  await validateEmployeeDeletion({
    targetId,
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });
};

export default onDelete;
