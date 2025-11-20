import type { Request, Service } from '@sap/cds';

import { onUpsert } from './handlers/on-upsert';
import { onDelete } from './handlers/on-delete';
import { createIntegrityValidator } from '../shared/integrity-handler';

const collectPayloads = (req: Request): any[] => {
  const data = (req.data ?? (req as any).query?.UPDATE?.data) ?? [];
  if (Array.isArray(data)) {
    return data;
  }
  return data ? [data] : [];
};

const validateCostCenterIntegrity = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  if (!entries.length) {
    return;
  }

  const validator = createIntegrityValidator(req);
  await validator.validateCostCenterRelations(entries);
};

export const registerCostCenterHandlers = (srv: Service): void => {
  srv.before(['CREATE', 'UPDATE'], 'CostCenters', validateCostCenterIntegrity);
  srv.before('CREATE', 'CostCenters', onUpsert);
  srv.before('UPDATE', 'CostCenters', onUpsert);
  srv.before('DELETE', 'CostCenters', onDelete);
};

export default registerCostCenterHandlers;

module.exports = { registerCostCenterHandlers };
