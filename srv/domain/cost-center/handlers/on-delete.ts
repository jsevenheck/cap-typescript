import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId } from '../../shared/request-context';
import { validateCostCenterDeletion } from '../services/validation';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Cost center identifier is required.');
  }
  await validateCostCenterDeletion({
    targetId,
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.CostCenters'),
  });
};

export default onDelete;
