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

export const registerEmployeeHandlers = (srv: Service): void => {
  srv.before(['CREATE', 'UPDATE'], 'Employees', validateEmployeeIntegrity);
  srv.before('CREATE', 'Employees', onCreate);
  srv.before('UPDATE', 'Employees', onUpdate);
  srv.before('DELETE', 'Employees', onDelete);

  const srvWithOn = srv as { on: Service['on'] };
  srvWithOn.on('CREATE', 'Employees', onCreateEvent);
  srvWithOn.on('anonymizeFormerEmployees', onAnonymizeFormerEmployees);
};

export default registerEmployeeHandlers;

module.exports = { registerEmployeeHandlers };
