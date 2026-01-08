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
    // Validate that each element is an object and filter out invalid items
    const validItems: RequestData[] = [];
    let filteredCount = 0;
    
    for (const item of data) {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        validItems.push(item as RequestData);
      } else {
        filteredCount++;
      }
    }
    
    // Log warning if non-object elements were filtered to aid debugging
    if (filteredCount > 0) {
      const message = `collectPayloads: filtered out ${filteredCount} non-object item(s) from request data array`;
      type RequestWithLogger = Request & {
        log?: { warn?: (msg: string) => void };
        warn?: (msg: string) => void;
      };
      const reqWithLogger = req as RequestWithLogger;
      if (typeof reqWithLogger.log?.warn === 'function') {
        reqWithLogger.log.warn(message);
      } else if (typeof reqWithLogger.warn === 'function') {
        reqWithLogger.warn(message);
      }
    }
    
    return validItems;
  }
  // Single object case
  if (data !== null && typeof data === 'object' && !Array.isArray(data)) {
    return [data as RequestData];
  }
  return [];
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
  on: (...args: unknown[]) => unknown;
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
