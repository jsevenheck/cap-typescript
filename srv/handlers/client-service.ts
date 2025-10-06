import cds from '@sap/cds';
import type { Request, Service } from '@sap/cds';
import { createHash } from 'crypto';
import type {
  ClientEntity,
  CostCenterEntity,
  EmployeeEntity,
  EmployeeIdCounterEntity,
} from '../types/models';

type ClientService = Service;

interface ExtendedRequest<T> extends Request {
  data: Partial<T>;
  params?: Array<Record<string, unknown>>;
}

type EmployeeRequest = ExtendedRequest<EmployeeEntity>;
type ClientRequest = ExtendedRequest<ClientEntity>;
type CostCenterRequest = ExtendedRequest<CostCenterEntity>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV?: string;
    }
  }
}

const { SELECT, INSERT, UPDATE } = cds.ql;

const MAX_EMPLOYEE_ID_RETRIES = 5;

const normalizeCompanyId = (value?: string): string | undefined =>
  value?.trim().toUpperCase();

const normalizeCostCenterCode = (value?: string): string | undefined =>
  value?.trim().toUpperCase();

interface EntityWithId {
  ID?: string;
}

const deriveRequestEntityId = <T extends EntityWithId>(req: ExtendedRequest<T>): string | undefined => {
  if (req.data?.ID) {
    return req.data.ID;
  }

  if (Array.isArray(req.params) && req.params.length > 0) {
    const lastParam = req.params[req.params.length - 1];
    if (lastParam && typeof lastParam === 'object' && 'ID' in lastParam) {
      return lastParam.ID as string | undefined;
    }
  }

  return undefined;
};

const sanitizeIdentifier = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const deriveClientPrefix = (client: ClientEntity | undefined, clientId: string): string => {
  const normalizedCompany = normalizeCompanyId(client?.companyId);
  if (normalizedCompany) {
    return normalizedCompany;
  }

  const sanitizedClientId = sanitizeIdentifier(clientId);
  if (sanitizedClientId.length >= 4) {
    return sanitizedClientId.slice(0, 8);
  }

  const hashed = createHash('sha256').update(clientId).digest('hex').toUpperCase();
  return (sanitizedClientId + hashed).slice(0, 8);
};

const isUniqueConstraintError = (error: unknown): boolean => {
  if (!error || typeof error !== 'object') {
    return false;
  }

  const { code, errno, message } = error as { code?: string; errno?: number; message?: string };
  if (code === '23505' || code === 'SQLITE_CONSTRAINT' || code === 'SQLITE_CONSTRAINT_UNIQUE') {
    return true;
  }
  if (typeof errno === 'number' && errno === 1062) {
    return true;
  }
  return typeof message === 'string' && /unique|constraint/i.test(message);
};

const withRowLock = <T extends object>(query: T): T => {
  const forUpdate = (query as T & { forUpdate?: () => T }).forUpdate;
  if (typeof forUpdate === 'function') {
    return forUpdate.call(query);
  }
  return query;
};

const ensureClientExists = async (req: EmployeeRequest, clientId?: string): Promise<boolean> => {
  if (!clientId) {
    req.error(400, 'Client reference is required.');
    return false;
  }

  const tx = cds.transaction(req);
  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('ID').where({ ID: clientId }),
  )) as ClientEntity | undefined;
  if (!client) {
    req.error(404, `Client ${clientId} not found.`);
    return false;
  }
  return true;
};

const ensureEmployeeAssignment = async (req: EmployeeRequest): Promise<void> => {
  const tx = cds.transaction(req);
  let { client_ID: clientId } = req.data;

  if (!clientId && req.event === 'UPDATE') {
    const employeeKey = deriveRequestEntityId(req);
    if (!employeeKey) {
      req.error(400, 'Employee identifier is required.');
      return;
    }

    const existingEmployee = (await tx.run(
      SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: employeeKey }),
    )) as EmployeeEntity | undefined;

    if (!existingEmployee) {
      req.error(404, `Employee ${employeeKey} not found.`);
      return;
    }

    clientId = existingEmployee.client_ID;
    req.data.client_ID = clientId;
  }

  const exists = await ensureClientExists(req, clientId);
  if (!exists) {
    return;
  }

  const trim = (val?: string) => val?.trim();
  if (req.data.firstName) req.data.firstName = req.data.firstName.trim();
  if (req.data.lastName) req.data.lastName = req.data.lastName.trim();
  if (req.data.email) req.data.email = req.data.email.trim().toLowerCase();
  if (req.data.location) req.data.location = trim(req.data.location);
  if (req.data.positionLevel) req.data.positionLevel = trim(req.data.positionLevel);

  if (req.data.manager_ID) {
    const manager = (await tx.run(
      SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: req.data.manager_ID }),
    )) as EmployeeEntity | undefined;
    if (!manager) {
      req.error(404, `Manager ${req.data.manager_ID} not found.`);
      return;
    }
    if (manager.client_ID !== clientId) {
      req.error(400, 'Manager must belong to the same client.');
      return;
    }
  }

  if (req.data.costCenter_ID) {
    const costCenter = (await tx.run(
      SELECT.one.from('clientmgmt.CostCenters')
        .columns('client_ID')
        .where({ ID: req.data.costCenter_ID }),
    )) as CostCenterEntity | undefined;
    if (!costCenter) {
      req.error(404, `Cost center ${req.data.costCenter_ID} not found.`);
      return;
    }
    if (costCenter.client_ID !== clientId) {
      req.error(400, 'Cost center must belong to the same client.');
      return;
    }
  }
};

const ensureUniqueEmployeeId = async (req: EmployeeRequest): Promise<boolean> => {
  const tx = cds.transaction(req);
  const { client_ID: clientId } = req.data;
  const currentEmployeeId = deriveRequestEntityId(req);
  if (!clientId) {
    return false;
  }

  if (req.data.employeeId) {
    req.data.employeeId = req.data.employeeId.trim().toUpperCase();
    const existing = (await tx.run(
      SELECT.one
        .from('clientmgmt.Employees')
        .columns('ID')
        .where({ employeeId: req.data.employeeId }),
    )) as EmployeeEntity | undefined;
    if (existing && existing.ID !== currentEmployeeId) {
      req.error(409, `Employee ID ${req.data.employeeId} already exists.`);
    }
    return false;
  }

  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('companyId').where({ ID: clientId }),
  )) as ClientEntity | undefined;

  for (let attempt = 0; attempt < MAX_EMPLOYEE_ID_RETRIES; attempt += 1) {
    try {
      const counterQuery = SELECT.one
        .from('clientmgmt.EmployeeIdCounters')
        .columns('lastCounter')
        .where({ client_ID: clientId }) as unknown as Record<string, unknown>;

      const counter = (await tx.run(withRowLock(counterQuery))) as EmployeeIdCounterEntity | undefined;

      const nextCounter = (counter?.lastCounter ?? 0) + 1;
      const prefix = deriveClientPrefix(client, clientId);
      const generatedId = `${prefix}-${String(nextCounter).padStart(4, '0')}`;
      req.data.employeeId = generatedId;

      if (counter) {
        await tx.run(
          UPDATE('clientmgmt.EmployeeIdCounters')
            .set({ lastCounter: nextCounter })
            .where({ client_ID: clientId }),
        );
      } else {
        await tx.run(
          INSERT.into('clientmgmt.EmployeeIdCounters').entries({
            client_ID: clientId,
            lastCounter: nextCounter,
          }),
        );
      }
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < MAX_EMPLOYEE_ID_RETRIES - 1) {
        // Retry the generation to obtain a fresh counter value.
        delete req.data.employeeId;
        continue;
      }
      throw error;
    }
  }

  req.error(500, 'Failed to generate a unique employee identifier.');
  return false;
};

const registerClientHandlers = (service: ClientService): void => {
  service.before(['CREATE', 'UPDATE'], 'Clients', async (req: ClientRequest) => {
    if (req.data.companyId) {
      req.data.companyId = normalizeCompanyId(req.data.companyId);
    }

    if (req.data.companyId) {
      const tx = cds.transaction(req);
      const whereClause: Record<string, unknown> = { companyId: req.data.companyId };
      const currentClientId = deriveRequestEntityId(req);

      if (req.event === 'UPDATE' && currentClientId) {
        whereClause.ID = { '!=': currentClientId };
      }

      const existing = (await tx.run(
        SELECT.one
          .from('clientmgmt.Clients')
          .columns('ID')
          .where(whereClause),
      )) as ClientEntity | undefined;
      if (existing) {
        req.error(409, `Company ID ${req.data.companyId} already exists.`);
      }
    }
  });
};

const registerEmployeeHandlers = (service: ClientService): void => {
  const serviceWithOn = service as ClientService & {
    on: (
      event: string | string[],
      entity: string,
      handler: (req: EmployeeRequest, next: () => Promise<unknown>) => Promise<unknown> | void,
    ) => unknown;
  };

  serviceWithOn.on('CREATE', 'Employees', async (req: EmployeeRequest, next) => {
    for (let attempt = 0; attempt < MAX_EMPLOYEE_ID_RETRIES; attempt += 1) {
      let generatedEmployeeId = false;
      try {
        await ensureEmployeeAssignment(req);
        generatedEmployeeId = await ensureUniqueEmployeeId(req);
        return await next();
      } catch (error) {
        if (generatedEmployeeId && isUniqueConstraintError(error) && attempt < MAX_EMPLOYEE_ID_RETRIES - 1) {
          delete req.data.employeeId;
          continue;
        }
        throw error;
      }
    }

    req.error(500, 'Failed to create employee after multiple attempts.');
  });

  service.before('UPDATE', 'Employees', async (req: EmployeeRequest) => {
    await ensureEmployeeAssignment(req);
    if (req.data.employeeId) {
      await ensureUniqueEmployeeId(req);
    }
  });
};

const registerCostCenterHandlers = (service: ClientService): void => {
  service.before(['CREATE', 'UPDATE'], 'CostCenters', async (req: CostCenterRequest) => {
    if (req.data.code) {
      req.data.code = normalizeCostCenterCode(req.data.code);
    }

    const tx = cds.transaction(req);
    let { client_ID: clientId } = req.data;
    const { responsible_ID: responsibleId } = req.data;

    if (!clientId && req.event === 'UPDATE') {
      const costCenterId = deriveRequestEntityId(req);
      if (!costCenterId) {
        req.error(400, 'Cost center identifier is required.');
        return;
      }

      const existingCostCenter = (await tx.run(
        SELECT.one
          .from('clientmgmt.CostCenters')
          .columns('client_ID')
          .where({ ID: costCenterId }),
      )) as CostCenterEntity | undefined;

      if (!existingCostCenter) {
        req.error(404, `Cost center ${costCenterId} not found.`);
        return;
      }

      clientId = existingCostCenter.client_ID;
      req.data.client_ID = clientId;
    }

    if (!clientId) {
      req.error(400, 'Client reference is required.');
      return;
    }

    const responsible = responsibleId
      ? ((await tx.run(
          SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: responsibleId }),
        )) as EmployeeEntity | undefined)
      : undefined;

    if (responsibleId && !responsible) {
      req.error(404, `Responsible employee ${responsibleId} not found.`);
      return;
    }
    if (responsible && responsible.client_ID !== clientId) {
      req.error(400, 'Responsible employee must belong to the same client.');
      return;
    }
  });
};

export default cds.service.impl((service: ClientService) => {
  registerClientHandlers(service);
  registerEmployeeHandlers(service);
  registerCostCenterHandlers(service);
});
