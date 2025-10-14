import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId } from '../../shared/request-context';
import { validateEmployeeDeletion } from '../services/validation';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Employee identifier is required.');
  }
  await validateEmployeeDeletion({
    targetId,
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });
};

export default onDelete;
