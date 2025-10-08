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

type RequestWithUser = Request & {
  user?: {
    is?: (role: string) => boolean;
    attr?: (name: string) => unknown;
  };
};

const getRequestUser = (req: Request): RequestWithUser['user'] => (req as RequestWithUser).user;

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

const HR_ADMIN_ROLE = 'HRAdmin';
const HR_VIEWER_ROLE = 'HRViewer';
const HR_EDITOR_ROLE = 'HREditor';

const canAccessCompany = (req: Request, companyId?: string | null): boolean => {
  if (!companyId) {
    return true;
  }

  const normalizedCompanyId = normalizeCompanyId(companyId);
  if (!normalizedCompanyId) {
    return true;
  }

  const user = getRequestUser(req);
  if (user?.is?.(HR_ADMIN_ROLE)) {
    return true;
  }

  const attributeSource = user?.attr;
  let rawValues: unknown;

  if (typeof attributeSource === 'function') {
    rawValues = attributeSource.call(user, 'companyCodes');
  } else if (attributeSource && typeof attributeSource === 'object') {
    rawValues = (attributeSource as { companyCodes?: unknown }).companyCodes;
  }

  const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];
  const normalizedValues = values
    .filter((value): value is string => typeof value === 'string')
    .map((value) => normalizeCompanyId(value))
    .filter((value): value is string => typeof value === 'string' && value.length > 0);

  return normalizedValues.includes(normalizedCompanyId);
};

const hasHrScope = (req: Request): boolean => {
  const user = getRequestUser(req);
  return Boolean(user?.is?.(HR_VIEWER_ROLE) || user?.is?.(HR_EDITOR_ROLE));
};

const ensureUserAuthorizedForCompany = (req: Request, companyId?: string | null): boolean => {
  if (!hasHrScope(req)) {
    return true;
  }

  if (canAccessCompany(req, companyId)) {
    return true;
  }

  req.reject(403, 'Forbidden: company code not assigned');
  return false;
};

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

type HeaderMap = Record<string, unknown>;

const getIfMatchHeader = (req: Request): string | undefined => {
  const headers = (req as Request & { headers?: HeaderMap }).headers;
  if (!headers) {
    return undefined;
  }
  const raw = headers['if-match'] ?? headers['If-Match'] ?? headers['IF-MATCH'];
  if (Array.isArray(raw)) {
    return raw
      .filter((value): value is string => typeof value === 'string')
      .join(',');
  }
  return typeof raw === 'string' ? raw : undefined;
};

const parseIfMatchHeader = (header: string): { wildcard: boolean; values: string[] } => {
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let wildcard = false;
  const values: string[] = [];

  for (const part of parts) {
    if (part === '*') {
      wildcard = true;
      continue;
    }

    let value = part;
    if (value.startsWith('W/')) {
      value = value.substring(2).trim();
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.substring(1, value.length - 1);
    }

    if (value.length > 0) {
      values.push(value);
    }
  }

  return { wildcard, values };
};

const normalizeConcurrencyValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
};

const getEntityConcurrencyField = (entityName: string): { etag?: string; field?: string } => {
  const definition = cds.model?.definitions?.[entityName] as
    | { ['@odata.etag']?: string; elements?: Record<string, unknown> }
    | undefined;

  const etagElement = typeof definition?.['@odata.etag'] === 'string' ? definition['@odata.etag'] : undefined;

  if (etagElement) {
    return { etag: etagElement, field: etagElement };
  }

  const hasModifiedAt = Boolean((definition as { elements?: Record<string, unknown> } | undefined)?.elements?.modifiedAt);

  if (hasModifiedAt) {
    return { field: 'modifiedAt' };
  }

  return {};
};

const ensureOptimisticConcurrency = async (
  req: ExtendedRequest<EntityWithId>,
  entityName: string,
): Promise<boolean> => {
  const { etag, field } = getEntityConcurrencyField(entityName);

  if (!field) {
    return true;
  }

  const header = getIfMatchHeader(req);

  const targetId = deriveRequestEntityId(req);
  if (!targetId) {
    req.error(400, 'Entity identifier is required.');
    return false;
  }

  const tx = cds.transaction(req);
  const record = (await tx.run(
    SELECT.one.from(entityName).columns(field).where({ ID: targetId }),
  )) as Record<string, unknown> | undefined;

  if (!record) {
    req.error(404, `Entity ${targetId} not found.`);
    return false;
  }

  const currentValue = normalizeConcurrencyValue(record[field]);

  if (header) {
    const { wildcard, values } = parseIfMatchHeader(header);
    if (wildcard) {
      return true;
    }

    if (values.length === 0) {
      req.reject(400, 'Invalid If-Match header.');
      return false;
    }

    if (currentValue === undefined) {
      req.reject(412);
      return false;
    }

    if (!values.includes(currentValue)) {
      req.reject(412);
      return false;
    }

    return true;
  }

  if (etag) {
    req.reject(428, 'Precondition required: supply an If-Match header.');
    return false;
  }

  const providedValue = normalizeConcurrencyValue((req.data as Record<string, unknown> | undefined)?.[field]);

  if (!providedValue) {
    req.reject(428, `Precondition required: include ${field} in the request payload.`);
    return false;
  }

  if (currentValue === undefined) {
    req.reject(412);
    return false;
  }

  if (providedValue !== currentValue) {
    req.reject(412);
    return false;
  }

  return true;
};

const sanitizeIdentifier = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

const deriveClientPrefix = (client: ClientEntity | undefined, clientId: string): string => {
  const normalizedCompany = normalizeCompanyId(client?.companyId);
  if (normalizedCompany) {
    return normalizedCompany.slice(0, 8);
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

const ensureClientExists = async (req: Request, clientId?: string): Promise<ClientEntity | undefined> => {
  if (!clientId) {
    req.error(400, 'Client reference is required.');
    return undefined;
  }

  const tx = cds.transaction(req);
  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('ID', 'companyId').where({ ID: clientId }),
  )) as ClientEntity | undefined;
  if (!client) {
    req.error(404, `Client ${clientId} not found.`);
    return undefined;
  }
  return client;
};

const ensureEmployeeAssignment = async (req: EmployeeRequest): Promise<ClientEntity | undefined> => {
  const tx = cds.transaction(req);
  let { client_ID: clientId } = req.data;
  let resolvedClient: ClientEntity | undefined;

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

  const client = await ensureClientExists(req, clientId);
  if (!client) {
    return;
  }

  resolvedClient = client;

  if (!ensureUserAuthorizedForCompany(req, client.companyId)) {
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
  return resolvedClient;
};

const ensureUniqueEmployeeId = async (
  req: EmployeeRequest,
  client?: ClientEntity,
): Promise<boolean> => {
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
        .where({ employeeId: req.data.employeeId, client_ID: clientId }),
    )) as EmployeeEntity | undefined;
    if (existing && existing.ID !== currentEmployeeId) {
      req.error(409, `Employee ID ${req.data.employeeId} already exists.`);
    }
    return false;
  }

  const clientInfo =
    client ??
    ((await tx.run(
      SELECT.one.from('clientmgmt.Clients').columns('companyId').where({ ID: clientId }),
    )) as ClientEntity | undefined);

  for (let attempt = 0; attempt < MAX_EMPLOYEE_ID_RETRIES; attempt += 1) {
    try {
      const counterQuery = SELECT.one
        .from('clientmgmt.EmployeeIdCounters')
        .columns('lastCounter')
        .where({ client_ID: clientId }) as unknown as Record<string, unknown>;

      const counter = (await tx.run(withRowLock(counterQuery))) as EmployeeIdCounterEntity | undefined;

      const nextCounter = (counter?.lastCounter ?? 0) + 1;
      const prefix = deriveClientPrefix(clientInfo, clientId);
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
    if (req.event === 'UPDATE') {
      const concurrencyOk = await ensureOptimisticConcurrency(req, 'clientmgmt.Clients');
      if (!concurrencyOk) {
        return;
      }
    }

    if (req.data.companyId) {
      req.data.companyId = normalizeCompanyId(req.data.companyId);
    }

    const tx = cds.transaction(req);
    const currentClientId = deriveRequestEntityId(req);
    let targetCompanyId = req.data.companyId;

    if (req.event === 'UPDATE') {
      if (!currentClientId) {
        req.error(400, 'Client identifier is required.');
        return;
      }

      const existingClient = (await tx.run(
        SELECT.one.from('clientmgmt.Clients').columns('ID', 'companyId').where({ ID: currentClientId }),
      )) as ClientEntity | undefined;

      if (!existingClient) {
        req.error(404, `Client ${currentClientId} not found.`);
        return;
      }

      if (!targetCompanyId) {
        targetCompanyId = existingClient.companyId;
      }
    }

    if (targetCompanyId && !ensureUserAuthorizedForCompany(req, targetCompanyId)) {
      return;
    }

    if (req.data.companyId) {
      const whereClause: Record<string, unknown> = { companyId: req.data.companyId };

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

  service.before('DELETE', 'Clients', async (req: ClientRequest) => {
    const concurrencyOk = await ensureOptimisticConcurrency(req, 'clientmgmt.Clients');
    if (!concurrencyOk) {
      return;
    }

    const clientId = deriveRequestEntityId(req);
    if (!clientId) {
      req.error(400, 'Client identifier is required.');
      return;
    }

    const tx = cds.transaction(req);
    const client = (await tx.run(
      SELECT.one.from('clientmgmt.Clients').columns('companyId').where({ ID: clientId }),
    )) as ClientEntity | undefined;

    if (!client) {
      req.error(404, `Client ${clientId} not found.`);
      return;
    }

    if (!ensureUserAuthorizedForCompany(req, client.companyId)) {
      return;
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
        const client = await ensureEmployeeAssignment(req);
        if (!client) {
          return;
        }
        generatedEmployeeId = await ensureUniqueEmployeeId(req, client);
        const result = await next();

        const createdEmployee = (Array.isArray(result) ? result[0] : result) as EmployeeEntity | undefined;
        const endpoint = process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT;
        if (endpoint && createdEmployee && client.companyId) {
          const tx = cds.transaction(req);
          const clientCompanyId = normalizeCompanyId(client.companyId) ?? client.companyId;
          const payload = {
            event: 'EMPLOYEE_CREATED',
            employeeId: createdEmployee.employeeId ?? req.data.employeeId,
            employeeUUID: createdEmployee.ID ?? req.data.ID,
            clientCompanyId,
            client_ID: createdEmployee.client_ID ?? req.data.client_ID ?? client.ID,
            firstName: createdEmployee.firstName ?? req.data.firstName,
            lastName: createdEmployee.lastName ?? req.data.lastName,
            email: createdEmployee.email ?? req.data.email,
          };

          await tx.run(
            INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries({
              eventType: 'EMPLOYEE_CREATED',
              endpoint,
              payload: JSON.stringify(payload),
              status: 'PENDING',
              attempts: 0,
              nextAttemptAt: new Date(),
            }),
          );
        }

        return result;
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
    const concurrencyOk = await ensureOptimisticConcurrency(req, 'clientmgmt.Employees');
    if (!concurrencyOk) {
      return;
    }

    const client = await ensureEmployeeAssignment(req);
    if (!client) {
      return;
    }
    if (req.data.employeeId) {
      await ensureUniqueEmployeeId(req, client);
    }
  });

  service.before('DELETE', 'Employees', async (req: EmployeeRequest) => {
    const concurrencyOk = await ensureOptimisticConcurrency(req, 'clientmgmt.Employees');
    if (!concurrencyOk) {
      return;
    }

    const employeeId = deriveRequestEntityId(req);
    if (!employeeId) {
      req.error(400, 'Employee identifier is required.');
      return;
    }

    const tx = cds.transaction(req);
    const employee = (await tx.run(
      SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: employeeId }),
    )) as EmployeeEntity | undefined;

    if (!employee) {
      req.error(404, `Employee ${employeeId} not found.`);
      return;
    }

    const client = await ensureClientExists(req, employee.client_ID);
    if (!client) {
      return;
    }

    if (!ensureUserAuthorizedForCompany(req, client.companyId)) {
      return;
    }
  });
};

const registerCostCenterHandlers = (service: ClientService): void => {
  service.before(['CREATE', 'UPDATE'], 'CostCenters', async (req: CostCenterRequest) => {
    if (req.event === 'UPDATE') {
      const concurrencyOk = await ensureOptimisticConcurrency(req, 'clientmgmt.CostCenters');
      if (!concurrencyOk) {
        return;
      }
    }

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

    const client = await ensureClientExists(req, clientId);
    if (!client) {
      return;
    }

    if (!ensureUserAuthorizedForCompany(req, client.companyId)) {
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

  service.before('DELETE', 'CostCenters', async (req: CostCenterRequest) => {
    const concurrencyOk = await ensureOptimisticConcurrency(req, 'clientmgmt.CostCenters');
    if (!concurrencyOk) {
      return;
    }

    const costCenterId = deriveRequestEntityId(req);
    if (!costCenterId) {
      req.error(400, 'Cost center identifier is required.');
      return;
    }

    const tx = cds.transaction(req);
    const costCenter = (await tx.run(
      SELECT.one.from('clientmgmt.CostCenters').columns('client_ID').where({ ID: costCenterId }),
    )) as CostCenterEntity | undefined;

    if (!costCenter) {
      req.error(404, `Cost center ${costCenterId} not found.`);
      return;
    }

    const client = await ensureClientExists(req, costCenter.client_ID);
    if (!client) {
      return;
    }

    if (!ensureUserAuthorizedForCompany(req, client.companyId)) {
      return;
    }
  });
};

export default cds.service.impl((service: ClientService) => {
  registerClientHandlers(service);
  registerEmployeeHandlers(service);
  registerCostCenterHandlers(service);
});
