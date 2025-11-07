import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { enforceClientCompany } from '../../shared/security/company-authorization.service';
import { validateClientDeletion } from '../services/validation';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Client identifier is required.');
  }
  await enforceClientCompany(req, [{ ID: targetId }]);
  await validateClientDeletion({
    targetId,
    user,
    tx: cds.transaction(req),
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Clients'),
  });
};

export default onDelete;
