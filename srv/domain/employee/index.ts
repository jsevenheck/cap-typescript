import type { Request, Service } from '@sap/cds';

import { onCreate } from './handlers/on-create';
import { onUpdate } from './handlers/on-update';
import { onDelete } from './handlers/on-delete';
import { onCreateEvent } from './handlers/on-create.after';
import { onAnonymizeFormerEmployees } from './handlers/anonymize-former-employees.action';
import { createIntegrityValidator } from '../shared/integrity-handler';

const collectPayloads = (req: Request): any[] => {
  const data = (req.data ?? (req as any).query?.UPDATE?.data) ?? [];
  if (Array.isArray(data)) {
    return data;
  }
  return data ? [data] : [];
};

const validateEmployeeIntegrity = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  if (!entries.length) {
    return;
  }

  const validator = createIntegrityValidator(req);
  await validator.validateEmployeeRelations(entries);
};

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ((...args: any[]) => unknown),
    maybeHandler?: (...args: any[]) => unknown,
  ) => unknown;
};

export const registerEmployeeHandlers = (srv: Service): void => {
  srv.before(['CREATE', 'UPDATE'], 'Employees', validateEmployeeIntegrity);
  srv.before('CREATE', 'Employees', onCreate);
  srv.before('UPDATE', 'Employees', onUpdate);
  srv.before('DELETE', 'Employees', onDelete);

  (srv as ServiceWithOn).on('CREATE', 'Employees', onCreateEvent);
  (srv as ServiceWithOn).on('anonymizeFormerEmployees', onAnonymizeFormerEmployees);
};

export default registerEmployeeHandlers;

module.exports = { registerEmployeeHandlers };
