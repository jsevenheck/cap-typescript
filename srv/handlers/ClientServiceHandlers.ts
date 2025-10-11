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

const registerClientHandlers = (service: Service): void => {
  service.before(['CREATE', 'UPDATE'], 'Clients', async (req: Request) => {
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
  });

  service.before('DELETE', 'Clients', async (req: Request) => {
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
  });
};

const registerEmployeeHandlers = (service: Service): void => {
  const serviceWithOn = service as ServiceWithOn;

  service.before(['CREATE', 'UPDATE'], 'Employees', async (req: Request) => {
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
      await ensureEmployeeIdentifier(cds.transaction(req), req.data as Partial<EmployeeEntity>, context.client, context.existingEmployee?.ID);
    }
  });

  serviceWithOn.on('CREATE', 'Employees', async (req: Request, next) => {
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

        const createdEmployee = (Array.isArray(result) ? result[0] : result) as Record<string, unknown> | undefined;
        const endpoint = process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT;
        if (endpoint && createdEmployee && context.client.companyId) {
          const clientCompanyId = normalizeCompanyId(context.client.companyId) ?? context.client.companyId;
          const requestData = req.data as Partial<EmployeeEntity>;
          const payload: EmployeeCreatedNotification['payload'] = {
            event: 'EMPLOYEE_CREATED',
            employeeId: (createdEmployee as Partial<EmployeeEntity>).employeeId ?? requestData.employeeId,
            employeeUUID: (createdEmployee as Partial<EmployeeEntity>).ID ?? requestData.ID,
            clientCompanyId,
            client_ID:
              (createdEmployee as Partial<EmployeeEntity>).client_ID ?? requestData.client_ID ?? context.client.ID,
            firstName: (createdEmployee as Partial<EmployeeEntity>).firstName ?? requestData.firstName,
            lastName: (createdEmployee as Partial<EmployeeEntity>).lastName ?? requestData.lastName,
            email: (createdEmployee as Partial<EmployeeEntity>).email ?? requestData.email,
          };

          await enqueueEmployeeCreatedNotification(tx, { endpoint, payload });
        }

        return result;
      } catch (error) {
        lastError = error;
        if (
          generatedEmployeeId &&
          isEmployeeIdUniqueConstraintError(error) &&
          attempt < EMPLOYEE_ID_RETRIES - 1
        ) {
          delete (req.data as Partial<EmployeeEntity>).employeeId;
          continue;
        }
        throw error;
      }
    }

    const errorDetails = lastError as { message?: string; stack?: string } | undefined;
    const segments = ['Failed to create employee after multiple attempts.'];
    if (errorDetails?.message) {
      segments.push(`Last error: ${errorDetails.message}`);
    }
    if (errorDetails?.stack) {
      segments.push(`Stack: ${errorDetails.stack}`);
    }

    throw createServiceError(500, segments.join('\n'));
  });

  service.before('DELETE', 'Employees', async (req: Request) => {
    const user = buildUserContext((req as Request & { user?: unknown }).user as any);
    const targetId = deriveEntityId({
      data: req.data as { ID?: string },
      params: extractRequestParams(req),
      query: (req as any).query,
    });
    if (!targetId) {
      throw createServiceError(400, 'Employee identifier is required.');
    }

    const client = await validateEmployeeDeletion({
      targetId,
      tx: cds.transaction(req),
      user,
      concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
    });

  });
};

const registerRetentionHandlers = (service: Service): void => {
  const serviceWithOn = service as ServiceWithOn;
  serviceWithOn.on('anonymizeFormerEmployees', async (req: Request) => {
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
      return;
    }
    if (typeof requestWithReply.reply === 'function') {
      requestWithReply.reply(result);
      return;
    }
    return result;
  });
};

const registerCostCenterHandlers = (service: Service): void => {
  service.before(['CREATE', 'UPDATE'], 'CostCenters', async (req: Request) => {
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
  });

  service.before('DELETE', 'CostCenters', async (req: Request) => {
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
  });
};

export default cds.service.impl((service: Service) => {
  registerClientHandlers(service);
  registerEmployeeHandlers(service);
  registerRetentionHandlers(service);
  registerCostCenterHandlers(service);
});
