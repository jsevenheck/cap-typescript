import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { ClientEntity } from '../dto/client.dto';
import { createServiceError } from '../../../shared/utils/errors';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { validateClientDeletion } from '../services/validation';
import { enforceClientCompany } from '../../shared/security/company-authorization.service';

export const onDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const targetId = deriveTargetId(req);
  if (!targetId) {
    throw createServiceError(400, 'Client identifier is required.');
  }

  // Fetch the client to check company authorization
  const tx = cds.transaction(req);
  const client = (await tx.run(
    cds.ql.SELECT.one.from('clientmgmt.Clients')
      .columns('ID', 'companyId')
      .where({ ID: targetId }),
  )) as Partial<ClientEntity> | undefined;

  if (client) {
    await enforceClientCompany(req, [client]);
  }

  await validateClientDeletion({
    targetId,
    user,
    tx,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Clients'),
  });
};

export default onDelete;
