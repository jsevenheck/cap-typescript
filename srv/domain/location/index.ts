import type { Request, Service } from '@sap/cds';

import { onRead } from './handlers/on-read';
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

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ((...args: any[]) => unknown),
    maybeHandler?: (...args: any[]) => unknown,
  ) => unknown;
};

export const registerLocationHandlers = (srv: Service): void => {
  srv.before(['CREATE', 'UPDATE'], 'Locations', validateLocationIntegrity);
  srv.before('CREATE', 'Locations', onUpsert);
  srv.before('UPDATE', 'Locations', onUpsert);
  srv.before('DELETE', 'Locations', onDelete);
  (srv as ServiceWithOn).on('READ', 'Locations', onRead);
};

export default registerLocationHandlers;

module.exports = { registerLocationHandlers };
