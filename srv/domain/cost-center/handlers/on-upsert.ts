import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { CostCenterEntity } from '../dto/cost-center.dto';
import { prepareCostCenterUpsert } from '../services/service';
import { buildUserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId, requireRequestUser } from '../../shared/request-context';
import { enforceCostCenterCompany } from '../../shared/security/company-authorization.service';
import { enforceCostCenterRelations } from '../../shared/integrity/client-integrity.service';

export const onUpsert = async (req: Request): Promise<void> => {
  const tx = cds.transaction(req);

  // Enforce company authorization before processing
  await enforceCostCenterCompany(req, [req.data as Partial<CostCenterEntity>]);

  // Enforce referential integrity
  await enforceCostCenterRelations(tx, [req.data as Partial<CostCenterEntity>]);

  const user = buildUserContext(requireRequestUser(req));
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.CostCenters');
  const { updates } = await prepareCostCenterUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<CostCenterEntity>,
    targetId: deriveTargetId(req),
    tx,
    user,
    concurrency,
  });
  Object.assign(req.data, updates);
};

export default onUpsert;
