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

const validateLocationIntegrity = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  if (!entries.length) {
    return;
  }

  const validator = createIntegrityValidator(req);
  await validator.validateLocationRelations(entries);
};

export const registerLocationHandlers = (srv: Service): void => {
  srv.before(['CREATE', 'UPDATE'], 'Locations', validateLocationIntegrity);
  srv.before('CREATE', 'Locations', onUpsert);
  srv.before('UPDATE', 'Locations', onUpsert);
  srv.before('DELETE', 'Locations', onDelete);
};

export default registerLocationHandlers;

module.exports = { registerLocationHandlers };
