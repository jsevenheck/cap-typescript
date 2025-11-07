import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { ClientEntity } from '../dto/client.dto';
import { prepareClientUpsert } from '../services/lifecycle.service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { enforceClientCompany } from '../../shared/security/company-authorization.service';

const handleClientUpsert = async (req: Request): Promise<void> => {
  // Enforce company authorization before processing
  await enforceClientCompany(req, [req.data as Partial<ClientEntity>]);

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
