import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { enforceCostCenterCompany } from '../../shared/security/company-authorization.service';
import { validateCostCenterDeletion } from '../services/validation';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Cost center identifier is required.');
  }
  await enforceCostCenterCompany(req, [{ ID: targetId }]);
  await validateCostCenterDeletion({
    targetId,
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.CostCenters'),
  });
};

export default onDelete;
