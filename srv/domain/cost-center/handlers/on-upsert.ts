import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { CostCenterEntity } from '../dto/cost-center.dto';
import { prepareCostCenterUpsert } from '../services/service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';
import { validateDateRange } from '../../../shared/utils/date';

export const onUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    throw createServiceError(400, 'Request data is required.');
  }

  const data = req.data as Partial<CostCenterEntity>;

  // Validate date range: validFrom must be before validTo
  try {
    validateDateRange(data.validFrom, data.validTo, 'CostCenter');
  } catch (error) {
    throw createServiceError(400, error instanceof Error ? error.message : 'Invalid date range');
  }

  const user = buildUserContext(requireRequestUser(req));
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.CostCenters');
  const { updates } = await prepareCostCenterUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data,
    targetId: deriveTargetId(req),
    tx: cds.tx(req),
    user,
    concurrency,
  });
  Object.assign(req.data, updates);
};

export default onUpsert;
