import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { ClientEntity } from '../dto/client.dto';
import { prepareClientUpsert } from '../services/lifecycle.service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';

const handleClientUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    throw createServiceError(400, 'Request data is required.');
  }

  const user = buildUserContext(requireRequestUser(req));
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.Clients');
  const { updates } = await prepareClientUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<ClientEntity>,
    targetId: deriveTargetId(req),
    user,
    tx: cds.transaction(req),
    concurrency,
  });
  Object.assign(req.data, updates);
};

export const onCreate = handleClientUpsert;
export const handleClientCreateOrUpdate = handleClientUpsert;
export default onCreate;
