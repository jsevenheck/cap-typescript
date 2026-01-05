import type { Request, Service } from '@sap/cds';

import { onCreate } from './handlers/on-create';
import { onUpdate } from './handlers/on-update';
import { onDelete } from './handlers/on-delete';
import { onCreateEvent } from './handlers/on-create.after';
import { onAnonymizeFormerEmployees } from './handlers/anonymize-former-employees.action';
import { createIntegrityValidator } from '../shared/integrity-handler';

type RequestData = Record<string, unknown>;

/**
 * Extracts payloads from the request data or UPDATE query
 * @param req - The CAP request object
 * @returns Array of data payloads to process
 */
const collectPayloads = (req: Request): RequestData[] => {
  const data = (req.data ?? (req as { query?: { UPDATE?: { data?: unknown } } }).query?.UPDATE?.data) ?? [];
  if (Array.isArray(data)) {
    return data as RequestData[];
  }
  return data ? [data as RequestData] : [];
};

const validateEmployeeIntegrity = async (req: Request): Promise<void> => {
  const entries = collectPayloads(req);
  if (!entries.length) {
    return;
  }

  const validator = createIntegrityValidator(req);
  await validator.validateEmployeeRelations(entries);
};

type ServiceHandler = (req: Request) => Promise<void> | void;

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler: string | ServiceHandler,
    maybeHandler?: ServiceHandler,
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
