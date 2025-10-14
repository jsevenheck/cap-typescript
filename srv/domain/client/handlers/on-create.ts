import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { ClientEntity } from '../dto/client.dto';
import { prepareClientUpsert } from '../services/lifecycle.service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId } from '../../shared/request-context';

const handleClientUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
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
