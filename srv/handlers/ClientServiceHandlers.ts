/**
 * Registers CAP event handlers for the ClientService and delegates to domain-level services.
 */
import cds from '@sap/cds';
import type { Request, Service } from '@sap/cds';

import type {
  ClientEntity,
  CostCenterEntity,
  EmployeeEntity,
} from '../types/models';
import {
  deriveEntityId,
  extractIfMatchHeader,
  getEntityConcurrencyField,
  type HeaderMap,
} from '../utils/concurrency';
import { buildUserContext } from '../utils/auth';
import type { UserContext } from '../utils/auth';
import {
  prepareClientUpsert,
  validateClientDeletion,
} from '../services/ClientLifecycleService';
import {
  prepareCostCenterUpsert,
  validateCostCenterDeletion,
} from '../services/CostCenterService';
import {
  EMPLOYEE_ID_RETRIES,
  ensureEmployeeIdentifier,
  isEmployeeIdUniqueConstraintError,
  prepareEmployeeWrite,
  validateEmployeeDeletion,
} from '../services/EmployeeLifecycleService';
import { anonymizeFormerEmployees } from '../services/EmployeeRetentionService';
import { enqueueEmployeeCreatedNotification } from '../services/OutboxService';
import { normalizeCompanyId } from '../utils/normalization';
import type { EmployeeCreatedNotification } from '../services/OutboxService';
import { createServiceError } from '../utils/errors';

type ServiceWithOn = Service & {
  on: (
    event: string | string[],
    entityOrHandler:
      | string
      | ((req: Request, next: () => Promise<unknown>) => Promise<unknown> | void),
    maybeHandler?: (req: Request, next: () => Promise<unknown>) => Promise<unknown> | void,
  ) => unknown;
};

const EMPLOYEE_CONTEXT_KEY = Symbol('employeeContext');

interface EmployeeContext {
  client: ClientEntity;
  existingEmployee?: EmployeeEntity;
}

const getHeaders = (req: Request): HeaderMap => (req as Request & { headers?: HeaderMap }).headers;

const extractRequestParams = (req: Request): Array<Record<string, unknown>> | undefined =>
  (req as Request & { params?: Array<Record<string, unknown>> }).params;

const buildConcurrencyContext = (req: Request, entityName: string) => {
  const headers = getHeaders(req);
  const hasHttpHeaders = Boolean(headers && Object.keys(headers).length > 0);
  const headerValue = extractIfMatchHeader(headers);
  const { field } = getEntityConcurrencyField(entityName);
  let payloadValue: unknown;
  if (field) {
    const updatePayload = (req as { query?: { UPDATE?: { data?: Record<string, unknown> } } }).query?.UPDATE?.data;
    payloadValue = (req.data as Record<string, unknown> | undefined)?.[field] ?? updatePayload?.[field];
  }
  return { headerValue, hasHttpHeaders, payloadValue };
};

const storeEmployeeContext = (req: Request, context: EmployeeContext): void => {
  (req as unknown as Record<PropertyKey, unknown>)[EMPLOYEE_CONTEXT_KEY] = context;
};

const getEmployeeContext = (req: Request): EmployeeContext | undefined =>
  (req as unknown as Record<PropertyKey, unknown>)[EMPLOYEE_CONTEXT_KEY] as EmployeeContext | undefined;

const ensureEmployeeContext = async (req: Request, user: UserContext): Promise<EmployeeContext> => {
  const existing = getEmployeeContext(req);
  if (existing) {
    return existing;
  }

  const context = await prepareEmployeeWrite({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<EmployeeEntity>,
    targetId: deriveEntityId({
      data: req.data as { ID?: string },
      params: extractRequestParams(req),
      query: (req as any).query,
    }),
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });

  const enriched: EmployeeContext = {
    client: context.client,
    existingEmployee: context.existingEmployee,
  };
  storeEmployeeContext(req, enriched);
  return enriched;
};

type ServiceLogger = { error: (message?: unknown, ...optionalParams: unknown[]) => void };

const getServiceLogger = (): ServiceLogger => {
  const typedCds = cds as unknown as { log?: (component: string) => ServiceLogger };
  if (typeof typedCds.log === 'function') {
    return typedCds.log('client-service');
  }
  return console;
};

const logger = getServiceLogger();

const handleClientUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.Clients');
  const { updates } = await prepareClientUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<ClientEntity>,
    targetId: deriveEntityId({
      data: req.data as { ID?: string },
      params: extractRequestParams(req),
      query: (req as any).query,
    }),
    user,
    tx: cds.transaction(req),
    concurrency,
  });
  Object.assign(req.data, updates);
};

export const beforeClientCreate = handleClientUpsert;
export const beforeClientUpdate = handleClientUpsert;

export const beforeClientDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const targetId = deriveEntityId({
    data: req.data as { ID?: string },
    params: extractRequestParams(req),
    query: (req as any).query,
  });
  if (!targetId) {
    throw createServiceError(400, 'Client identifier is required.');
  }
  await validateClientDeletion({
    targetId,
    user,
    tx: cds.transaction(req),
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Clients'),
  });
};

const handleEmployeeUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const context = await prepareEmployeeWrite({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<EmployeeEntity>,
    targetId: deriveEntityId({
      data: req.data as { ID?: string },
      params: extractRequestParams(req),
      query: (req as any).query,
    }),
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });
  Object.assign(req.data, context.updates);
  storeEmployeeContext(req, { client: context.client, existingEmployee: context.existingEmployee });

  if (req.event === 'UPDATE' && req.data.employeeId) {
    await ensureEmployeeIdentifier(
      cds.transaction(req),
      req.data as Partial<EmployeeEntity>,
      context.client,
      context.existingEmployee?.ID,
    );
  }
};

export const beforeEmployeeCreate = handleEmployeeUpsert;
export const beforeEmployeeUpdate = handleEmployeeUpsert;

export const onEmployeeCreate = async (
  req: Request,
  next: () => Promise<unknown>,
): Promise<unknown> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const tx = cds.transaction(req);
  let lastError: unknown;

  for (let attempt = 0; attempt < EMPLOYEE_ID_RETRIES; attempt += 1) {
    let generatedEmployeeId = false;
    try {
      const context = await ensureEmployeeContext(req, user);
      generatedEmployeeId = await ensureEmployeeIdentifier(
        tx,
        req.data as Partial<EmployeeEntity>,
        context.client,
        context.existingEmployee?.ID,
      );

      const result = await next();
      const createdEmployee = Array.isArray(result)
        ? ((result[0] as Record<string, unknown> | undefined) ?? undefined)
        : (result as Record<string, unknown> | undefined);

      const endpoint = process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT;
      if (endpoint && createdEmployee && context.client.companyId) {
        const clientCompanyId = normalizeCompanyId(context.client.companyId) ?? context.client.companyId;
        const record = createdEmployee as Partial<EmployeeEntity>;
        const requestSnapshot = (req.data ?? {}) as Partial<EmployeeEntity>;
        const payload: EmployeeCreatedNotification['payload'] = {
          event: 'EMPLOYEE_CREATED',
          employeeId: record.employeeId ?? requestSnapshot.employeeId,
          employeeUUID: record.ID ?? requestSnapshot.ID,
          clientCompanyId,
          client_ID: record.client_ID ?? requestSnapshot.client_ID ?? context.client.ID,
          firstName: record.firstName ?? requestSnapshot.firstName,
          lastName: record.lastName ?? requestSnapshot.lastName,
          email: record.email ?? requestSnapshot.email,
        };

        await enqueueEmployeeCreatedNotification(tx, { endpoint, payload });
      }

      return result;
    } catch (error) {
      lastError = error;
      if (generatedEmployeeId && isEmployeeIdUniqueConstraintError(error) && attempt < EMPLOYEE_ID_RETRIES - 1) {
        delete (req.data as Partial<EmployeeEntity>).employeeId;
        continue;
      }
      throw error;
    }
  }

  const baseMessage = 'Failed to create employee after multiple attempts.';
  logger.error({ err: lastError }, baseMessage);
  throw createServiceError(500, baseMessage);
};

export const beforeEmployeeDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const targetId = deriveEntityId({
    data: req.data as { ID?: string },
    params: extractRequestParams(req),
    query: (req as any).query,
  });
  if (!targetId) {
    throw createServiceError(400, 'Employee identifier is required.');
  }

  await validateEmployeeDeletion({
    targetId,
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });
};

export const onAnonymizeFormerEmployees = async (req: Request): Promise<unknown> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const tx = cds.transaction(req);
  const count = await anonymizeFormerEmployees(tx, user, (req.data as { before?: unknown })?.before);
  const result = { value: count };
  const requestWithReply = req as Request & {
    reply?: (data: unknown) => unknown;
    http?: { res?: { json?: (body: unknown) => void } };
  };
  if (requestWithReply.http?.res && typeof requestWithReply.http.res.json === 'function') {
    requestWithReply.http.res.json(result);
    return undefined;
  }
  if (typeof requestWithReply.reply === 'function') {
    requestWithReply.reply(result);
    return undefined;
  }
  return result;
};

const handleCostCenterUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const concurrency = buildConcurrencyContext(req, 'clientmgmt.CostCenters');
  const { updates } = await prepareCostCenterUpsert({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<CostCenterEntity>,
    targetId: deriveEntityId({
      data: req.data as { ID?: string },
      params: extractRequestParams(req),
      query: (req as any).query,
    }),
    tx: cds.transaction(req),
    user,
    concurrency,
  });
  Object.assign(req.data, updates);
};

export const beforeCostCenterCreate = handleCostCenterUpsert;
export const beforeCostCenterUpdate = handleCostCenterUpsert;

export const beforeCostCenterDelete = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const targetId = deriveEntityId({
    data: req.data as { ID?: string },
    params: extractRequestParams(req),
    query: (req as any).query,
  });
  if (!targetId) {
    throw createServiceError(400, 'Cost center identifier is required.');
  }

  await validateCostCenterDeletion({
    targetId,
    tx: cds.transaction(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.CostCenters'),
  });
};

export const registerClientServiceHandlers = (service: Service): void => {
  service.before('CREATE', 'Clients', beforeClientCreate);
  service.before('UPDATE', 'Clients', beforeClientUpdate);
  service.before('DELETE', 'Clients', beforeClientDelete);

  service.before('CREATE', 'Employees', beforeEmployeeCreate);
  service.before('UPDATE', 'Employees', beforeEmployeeUpdate);
  service.before('DELETE', 'Employees', beforeEmployeeDelete);

  (service as ServiceWithOn).on('CREATE', 'Employees', onEmployeeCreate);
  (service as ServiceWithOn).on('anonymizeFormerEmployees', onAnonymizeFormerEmployees);

  service.before('CREATE', 'CostCenters', beforeCostCenterCreate);
  service.before('UPDATE', 'CostCenters', beforeCostCenterUpdate);
  service.before('DELETE', 'CostCenters', beforeCostCenterDelete);
};

cds.service.impl(registerClientServiceHandlers);

module.exports = Object.assign(registerClientServiceHandlers, {
  registerClientServiceHandlers,
  beforeClientCreate,
  beforeClientUpdate,
  beforeClientDelete,
  beforeEmployeeCreate,
  beforeEmployeeUpdate,
  onEmployeeCreate,
  beforeEmployeeDelete,
  onAnonymizeFormerEmployees,
  beforeCostCenterCreate,
  beforeCostCenterUpdate,
  beforeCostCenterDelete,
});

export default registerClientServiceHandlers;
