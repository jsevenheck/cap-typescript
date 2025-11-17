import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { LocationEntity } from '../dto/location.dto';
import { prepareLocationUpsert } from '../services/service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';

export const onUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    throw createServiceError(400, 'Request data is required.');
  }

  const user = buildUserContext(requireRequestUser(req));
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.Locations');
  const { updates } = await prepareLocationUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<LocationEntity>,
    targetId: deriveTargetId(req),
    tx: cds.transaction(req),
    user,
    concurrency,
  });
  Object.assign(req.data, updates);
};

export default onUpsert;
