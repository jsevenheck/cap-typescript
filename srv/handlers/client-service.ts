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
const EMPLOYEE_ID_PREFIX_LENGTH = 8;
const EMPLOYEE_ID_TOTAL_LENGTH = 14;
const EMPLOYEE_ID_COUNTER_LENGTH = Math.max(1, EMPLOYEE_ID_TOTAL_LENGTH - EMPLOYEE_ID_PREFIX_LENGTH);
const ANONYMIZED_PLACEHOLDER = 'ANONYMIZED';
const ANONYMIZED_EMAIL_DOMAIN = 'example.invalid';

const normalizeCompanyId = (value?: string): string | undefined =>
  value?.trim().toUpperCase();

const HR_ADMIN_ROLE = 'HRAdmin';
const HR_VIEWER_ROLE = 'HRViewer';
const HR_EDITOR_ROLE = 'HREditor';

const toDateValue = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
};

const normalizeIdentifier = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

const isInactiveStatus = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().toLowerCase() === 'inactive';

const normalizeForComparison = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
};

const identifiersMatch = (a: unknown, b: unknown): boolean =>
  normalizeForComparison(a) === normalizeForComparison(b);

const deriveCountryCodeFromCompanyId = (companyId?: string | null): string | undefined => {
  const normalized = normalizeCompanyId(companyId ?? undefined);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/(?:^|[^A-Z])([A-Z]{2})(?=[^A-Z]|$)/);
  return match ? match[1] : undefined;
};

const isValidCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);

const canAccessCompany = (req: Request, companyId?: string | null): boolean => {
  if (!companyId) {
    return true;
  }

  const normalizedCompanyId = normalizeCompanyId(companyId);
  if (!normalizedCompanyId) {
    return false;
  }

  const user = getRequestUser(req);
  if (user?.is?.(HR_ADMIN_ROLE)) {
    return true;
  }

  const attributeSource = user?.attr;
  const attributeNames: Array<'CompanyCode' | 'companyCodes'> = ['CompanyCode', 'companyCodes'];

  const collected = new Set<string>();

  for (const attributeName of attributeNames) {
    let rawValues: unknown;

    if (typeof attributeSource === 'function') {
      rawValues = attributeSource.call(user, attributeName);
    } else if (attributeSource && typeof attributeSource === 'object') {
      rawValues = (attributeSource as Record<string, unknown>)[attributeName];
    }

    const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];

    for (const value of values) {
      if (typeof value !== 'string') {
        continue;
      }

      const normalized = normalizeCompanyId(value);
      if (normalized) {
        collected.add(normalized);
      }
    }
  }

  return collected.has(normalizedCompanyId);
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

const extractIdFromWhereClause = (where: unknown): string | undefined => {
  if (!Array.isArray(where)) {
    return undefined;
  }

  for (let index = 0; index < where.length; index += 1) {
    const segment = where[index];
    if (
      segment &&
      typeof segment === 'object' &&
      'ref' in segment &&
      Array.isArray((segment as { ref: unknown[] }).ref) &&
      (segment as { ref: unknown[] }).ref.length === 1 &&
      (segment as { ref: unknown[] }).ref[0] === 'ID'
    ) {
      const operator = where[index + 1];
      const value = where[index + 2];

      if (operator === '=' || operator === '==') {
        if (value && typeof value === 'object' && 'val' in (value as Record<string, unknown>)) {
          const resolved = (value as Record<string, unknown>).val;
          return typeof resolved === 'string' ? resolved : undefined;
        }
      }
    }
  }

  return undefined;
};

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

  const query = (req as { query?: { UPDATE?: { where?: unknown }; DELETE?: { where?: unknown } } }).query;
  const where = query?.UPDATE?.where ?? query?.DELETE?.where;
  if (where) {
    const derived = extractIdFromWhereClause(where);
    if (derived) {
      return derived;
    }
  }

  return undefined;
};

type HeaderMap = Record<string, unknown>;

const getIfMatchHeader = (req: Request): string | undefined => {
  const headers = (req as Request & { headers?: HeaderMap }).headers;
  const hasHttpHeaders = headers && Object.keys(headers).length > 0;
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
  const definition = (cds as any).model?.definitions?.[entityName] as
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

  const headers = (req as Request & { headers?: HeaderMap }).headers;
  const hasHttpHeaders = headers && Object.keys(headers).length > 0;
  const header = getIfMatchHeader(req);

  if (!hasHttpHeaders && !header) {
    return true;
  }

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

  const queryPayload = (req as {
    query?: { UPDATE?: { data?: Record<string, unknown> }; DELETE?: Record<string, unknown> };
  }).query?.UPDATE?.data;
  const providedValue = normalizeConcurrencyValue(
    (req.data as Record<string, unknown> | undefined)?.[field] ??
      (queryPayload as Record<string, unknown> | undefined)?.[field],
  );

  if (etag && hasHttpHeaders) {
    req.reject(428, 'Precondition required: supply an If-Match header.');
    return false;
  }

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

const buildAnonymizedEmail = (employeeId?: string): string => {
  const sanitized = typeof employeeId === 'string' ? employeeId.replace(/[^A-Za-z0-9]/g, '').toLowerCase() : '';
  const localPartBase = sanitized ? `anonymized-${sanitized}` : 'anonymized';
  const localPart = localPartBase.slice(0, 64);
  return `${localPart}@${ANONYMIZED_EMAIL_DOMAIN}`;
};

const deriveClientPrefix = (client: ClientEntity | undefined, clientId: string): string => {
  const normalizedCompany = sanitizeIdentifier(normalizeCompanyId(client?.companyId) ?? '');
  const sanitizedClientId = sanitizeIdentifier(clientId);
  const hashSource = sanitizedClientId || clientId;
  const hashed = createHash('sha256').update(hashSource).digest('hex').toUpperCase();

  if (normalizedCompany) {
    return (normalizedCompany + hashed).slice(0, EMPLOYEE_ID_PREFIX_LENGTH);
  }

  if (sanitizedClientId) {
    return (sanitizedClientId + hashed).slice(0, EMPLOYEE_ID_PREFIX_LENGTH);
  }

  return hashed.slice(0, EMPLOYEE_ID_PREFIX_LENGTH);
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
      const counterPart = String(nextCounter).padStart(EMPLOYEE_ID_COUNTER_LENGTH, '0');
      const generatedId = `${prefix}${counterPart}`;

      const existingEmployeeWithId = (await tx.run(
        SELECT.one
          .from('clientmgmt.Employees')
          .columns('ID')
          .where({ employeeId: generatedId, client_ID: clientId }),
      )) as EmployeeEntity | undefined;

      const persistCounter = async () => {
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
      };

      if (existingEmployeeWithId) {
        await persistCounter();
        continue;
      }

      req.data.employeeId = generatedId;
      await persistCounter();
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

    if (req.data.country_code !== undefined) {
      if (typeof req.data.country_code !== 'string') {
        req.error(400, 'Country code must be a two-letter ISO code.');
        return;
      }

      const normalizedCountry = req.data.country_code.trim().toUpperCase();
      if (!isValidCountryCode(normalizedCountry)) {
        req.error(400, 'Country code must be a two-letter ISO code.');
        return;
      }

      req.data.country_code = normalizedCountry;
    }

    const tx = cds.transaction(req);
    const currentClientId = deriveRequestEntityId(req);
    let targetCompanyId = req.data.companyId;
    let existingClient: ClientEntity | undefined;

    if (req.event === 'UPDATE') {
      if (!currentClientId) {
        req.error(400, 'Client identifier is required.');
        return;
      }

      existingClient = (await tx.run(
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

    if (req.data.country_code === undefined) {
      const companyChanged =
        req.event === 'CREATE' ||
        (req.event === 'UPDATE' &&
          req.data.companyId !== undefined &&
          (!existingClient || req.data.companyId !== existingClient.companyId));

      if (companyChanged) {
        const derivedCode = deriveCountryCodeFromCompanyId(targetCompanyId);
        if (derivedCode) {
          req.data.country_code = derivedCode;
        }
      }
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

  service.before(['CREATE', 'UPDATE'], 'Employees', async (req: EmployeeRequest) => {
    const tx = cds.transaction(req);

    let existingEmployee: Partial<EmployeeEntity> | undefined;
    if (req.event === 'UPDATE') {
      const employeeKey = deriveRequestEntityId(req);
      if (!employeeKey) {
        req.error(400, 'Employee identifier is required.');
        return;
      }

      existingEmployee = (await tx.run(
        SELECT.one
          .from('clientmgmt.Employees')
          .columns('ID', 'client_ID', 'entryDate', 'exitDate', 'status', 'costCenter_ID', 'manager_ID')
          .where({ ID: employeeKey }),
      )) as Partial<EmployeeEntity> | undefined;

      if (!existingEmployee) {
        req.error(404, `Employee ${employeeKey} not found.`);
        return;
      }
    }

    const entryCandidate =
      req.data.entryDate !== undefined ? req.data.entryDate : existingEmployee?.entryDate;
    const entryDate = toDateValue(entryCandidate);

    if (!entryDate) {
      req.error(400, 'Entry date is required.');
      return;
    }

    const exitCandidate =
      req.data.exitDate !== undefined ? req.data.exitDate : existingEmployee?.exitDate;
    const exitDate = toDateValue(exitCandidate);

    const statusCandidate =
      req.data.status !== undefined ? req.data.status : existingEmployee?.status ?? 'active';
    const inactive = isInactiveStatus(statusCandidate);

    if (exitDate && entryDate && exitDate.getTime() < entryDate.getTime()) {
      req.error(400, 'Exit date must be on or after entry date.');
      return;
    }

    if (inactive && !exitDate) {
      req.error(400, 'Inactive employees must have an exit date.');
      return;
    }

    if (exitDate && !inactive) {
      req.error(400, 'Employees with an exit date must have status set to inactive.');
      return;
    }

    const existingCostCenterId = normalizeIdentifier(existingEmployee?.costCenter_ID);
    const requestedCostCenterId =
      req.data.costCenter_ID === null ? undefined : normalizeIdentifier(req.data.costCenter_ID);
    const finalCostCenterId = requestedCostCenterId ?? existingCostCenterId;

    const managerExplicit = req.data.manager_ID !== undefined;
    const requestedManagerId =
      managerExplicit && req.data.manager_ID !== null
        ? normalizeIdentifier(req.data.manager_ID)
        : undefined;
    const existingManagerId = normalizeIdentifier(existingEmployee?.manager_ID);
    let finalManagerId = managerExplicit ? requestedManagerId : existingManagerId;

    const finalClientId =
      (req.data.client_ID ?? existingEmployee?.client_ID) !== null
        ? (req.data.client_ID ?? existingEmployee?.client_ID)
        : undefined;

    if (finalCostCenterId) {
      const costCenter = (await tx.run(
        SELECT.one
          .from('clientmgmt.CostCenters')
          .columns('ID', 'client_ID', 'responsible_ID')
          .where({ ID: finalCostCenterId }),
      )) as Partial<CostCenterEntity> | undefined;

      if (!costCenter) {
        req.error(404, `Cost center ${finalCostCenterId} not found.`);
        return;
      }

      if (finalClientId && costCenter.client_ID && costCenter.client_ID !== finalClientId) {
        req.error(400, 'Cost center must belong to the same client.');
        return;
      }

      const responsibleId = costCenter.responsible_ID;
      const costCenterExplicit = req.data.costCenter_ID !== undefined;
      const costCenterChanged =
        req.event === 'CREATE' ||
        (costCenterExplicit && !identifiersMatch(existingCostCenterId, finalCostCenterId));

      if ((req.event === 'CREATE' || costCenterChanged) && !managerExplicit) {
        req.data.manager_ID = responsibleId;
        finalManagerId = normalizeIdentifier(responsibleId) ?? responsibleId;
      }

      const shouldValidateManager = req.event === 'CREATE' || managerExplicit || costCenterChanged;
      const managerToValidate = managerExplicit ? requestedManagerId : finalManagerId;

      if (shouldValidateManager) {
        if (!managerToValidate) {
          req.error(
            400,
            'Employees assigned to a cost center must be managed by the responsible employee.',
          );
          return;
        }

        if (!identifiersMatch(managerToValidate, responsibleId)) {
          req.error(
            400,
            'Employees assigned to a cost center must be managed by the responsible employee.',
          );
          return;
        }
      }
    }
  });

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

const registerEmployeeRetentionHandlers = (service: ClientService): void => {
  service.on('anonymizeFormerEmployees', async (req) => {
    const cutoffDate = toDateValue(req.data?.before);
    if (!cutoffDate) {
      req.error(400, 'Parameter "before" must be a valid date.');
      return;
    }

    const cutoff = cutoffDate.toISOString().split('T')[0];
    const tx = cds.transaction(req);

    // Build WHERE clause with company code filtering for HREditor
    const whereClause: Record<string, unknown> = {
      exitDate: { '<': cutoff },
      firstName: { '!=': ANONYMIZED_PLACEHOLDER },
    };

    const user = getRequestUser(req);
    if (!user?.is?.(HR_ADMIN_ROLE)) {
      // HREditor or HRViewer - apply company code filter
      const allowedCompanyCodes: string[] = [];
      const attributeSource = user?.attr;
      const attributeNames: Array<'CompanyCode' | 'companyCodes'> = ['CompanyCode', 'companyCodes'];

      for (const attributeName of attributeNames) {
        let rawValues: unknown;
        if (typeof attributeSource === 'function') {
          rawValues = attributeSource.call(user, attributeName);
        } else if (attributeSource && typeof attributeSource === 'object') {
          rawValues = (attributeSource as Record<string, unknown>)[attributeName];
        }
        const values = Array.isArray(rawValues) ? rawValues : rawValues ? [rawValues] : [];
        for (const value of values) {
          if (typeof value === 'string') {
            const normalized = normalizeCompanyId(value);
            if (normalized) allowedCompanyCodes.push(normalized);
          }
        }
      }

      if (allowedCompanyCodes.length === 0) {
        return 0; // No authorized companies
      }

      // Filter employees by allowed company codes via client relationship
      whereClause['client.companyId'] = { in: allowedCompanyCodes };
    }

    const employeesToAnonymize = (await tx.run(
      SELECT.from('clientmgmt.Employees')
        .columns('ID', 'employeeId')
        .where(whereClause),
    )) as Array<Pick<EmployeeEntity, 'ID' | 'employeeId'>>;

    if (!employeesToAnonymize || employeesToAnonymize.length === 0) {
      return 0;
    }

    for (const employee of employeesToAnonymize) {
      await tx.run(
        UPDATE('clientmgmt.Employees')
          .set({
            firstName: ANONYMIZED_PLACEHOLDER,
            lastName: ANONYMIZED_PLACEHOLDER,
            email: buildAnonymizedEmail(employee.employeeId),
            location: null,
            positionLevel: null,
            status: 'inactive',
          })
          .where({ ID: employee.ID }),
      );
    }

    return employeesToAnonymize.length;
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
  registerEmployeeRetentionHandlers(service);
  registerCostCenterHandlers(service);
});
