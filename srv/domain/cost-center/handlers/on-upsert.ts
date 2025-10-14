import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { CostCenterEntity } from '../dto/cost-center.dto';
import { prepareCostCenterUpsert } from '../services/service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';

export const onUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.CostCenters');
  const { updates } = await prepareCostCenterUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<CostCenterEntity>,
    targetId: deriveTargetId(req),
    tx: cds.transaction(req),
    user,
    concurrency,
  });
  Object.assign(req.data, updates);
};

export default onUpsert;
