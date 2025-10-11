/**
 * Business rules for employee lifecycle operations, including validation and identifier management.
 */
import { createHash } from 'node:crypto';

import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency, type ConcurrencyCheckInput } from '../utils/concurrency';
import { createServiceError } from '../utils/errors';
import { toDateValue } from '../utils/date';
import {
  identifiersMatch,
  isInactiveStatus,
  normalizeCompanyId,
  normalizeIdentifier,
  sanitizeIdentifier,
} from '../utils/normalization';
import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../types/models';
import type { UserContext } from '../utils/auth';
import { ensureUserAuthorizedForCompany } from './ClientLifecycleService';

const { SELECT } = cds.ql as any;
const INSERT = (cds.ql as any).INSERT as any;
const UPDATE = (cds.ql as any).UPDATE as any;

export const EMPLOYEE_ID_RETRIES = 5;
const EMPLOYEE_ID_PREFIX_LENGTH = 8;
const EMPLOYEE_ID_TOTAL_LENGTH = 14;
const EMPLOYEE_ID_COUNTER_LENGTH = Math.max(1, EMPLOYEE_ID_TOTAL_LENGTH - EMPLOYEE_ID_PREFIX_LENGTH);

const ensureClientExists = async (tx: Transaction, clientId?: string | null): Promise<ClientEntity> => {
  if (!clientId) {
    throw createServiceError(400, 'Client reference is required.');
  }

  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('ID', 'companyId').where({ ID: clientId }),
  )) as ClientEntity | undefined;

  if (!client) {
    throw createServiceError(404, `Client ${clientId} not found.`);
  }

  return client;
};

const loadExistingEmployee = async (tx: Transaction, employeeId: string): Promise<EmployeeEntity | undefined> =>
  (await tx.run(
    SELECT.one
      .from('clientmgmt.Employees')
      .columns('ID', 'client_ID', 'entryDate', 'exitDate', 'status', 'costCenter_ID', 'manager_ID')
      .where({ ID: employeeId }),
  )) as EmployeeEntity | undefined;

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

export const isUniqueConstraintError = (error: unknown): boolean => {
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

export interface EmployeeWriteContext {
  event: 'CREATE' | 'UPDATE';
  data: Partial<EmployeeEntity>;
  targetId?: string;
  tx: Transaction;
  user: UserContext;
  concurrency?: Omit<ConcurrencyCheckInput, 'tx' | 'entityName' | 'targetId'>;
}

export interface EmployeeWriteResult {
  updates: Partial<EmployeeEntity>;
  client: ClientEntity;
  existingEmployee?: EmployeeEntity;
}

const sanitizeEmployeeStrings = (data: Partial<EmployeeEntity>): void => {
  if (data.firstName) data.firstName = data.firstName.trim();
  if (data.lastName) data.lastName = data.lastName.trim();
  if (data.email) data.email = data.email.trim().toLowerCase();
  if (data.location) data.location = data.location.trim();
  if (data.positionLevel) data.positionLevel = data.positionLevel.trim();
};

const validateTimeline = (
  event: 'CREATE' | 'UPDATE',
  data: Partial<EmployeeEntity>,
  existing: Partial<EmployeeEntity> | undefined,
): void => {
  const entryCandidate = data.entryDate !== undefined ? data.entryDate : existing?.entryDate;
  const entryDate = toDateValue(entryCandidate);

  if (!entryDate) {
    throw createServiceError(400, 'Entry date is required.');
  }

  const exitCandidate = data.exitDate !== undefined ? data.exitDate : existing?.exitDate;
  const exitDate = toDateValue(exitCandidate);

  const statusCandidate = data.status !== undefined ? data.status : existing?.status ?? 'active';
  const inactive = isInactiveStatus(statusCandidate);

  if (exitDate && entryDate && exitDate.getTime() < entryDate.getTime()) {
    throw createServiceError(400, 'Exit date must be on or after entry date.');
  }

  if (inactive && !exitDate) {
    throw createServiceError(400, 'Inactive employees must have an exit date.');
  }

  if (exitDate && !inactive) {
    throw createServiceError(400, 'Employees with an exit date must have status set to inactive.');
  }

  if (!inactive && data.status && isInactiveStatus(data.status)) {
    data.status = 'inactive';
  }
};

const resolveClientForEmployee = async (
  context: EmployeeWriteContext,
  existing?: EmployeeEntity,
): Promise<ClientEntity> => {
  let clientId = context.data.client_ID;

  if (!clientId && context.event === 'UPDATE') {
    clientId = existing?.client_ID;
  }

  const client = await ensureClientExists(context.tx, clientId);
  ensureUserAuthorizedForCompany(context.user, client.companyId);
  return client;
};

const validateManagerAndCostCenter = async (
  context: EmployeeWriteContext,
  client: ClientEntity,
  existing?: EmployeeEntity,
): Promise<Partial<EmployeeEntity>> => {
  const updates: Partial<EmployeeEntity> = {};
  const tx = context.tx;

  const existingCostCenterId = normalizeIdentifier(existing?.costCenter_ID);
  const requestedCostCenterId =
    context.data.costCenter_ID === null ? undefined : normalizeIdentifier(context.data.costCenter_ID);
  const finalCostCenterId = requestedCostCenterId ?? existingCostCenterId;

  const managerExplicit = context.data.manager_ID !== undefined;
  const requestedManagerId =
    managerExplicit && context.data.manager_ID !== null ? normalizeIdentifier(context.data.manager_ID) : undefined;
  const existingManagerId = normalizeIdentifier(existing?.manager_ID);
  let finalManagerId = managerExplicit ? requestedManagerId : existingManagerId;

  if (finalCostCenterId) {
    const costCenter = (await tx.run(
      SELECT.one
        .from('clientmgmt.CostCenters')
        .columns('ID', 'client_ID', 'responsible_ID')
        .where({ ID: finalCostCenterId }),
    )) as Partial<CostCenterEntity> | undefined;

    if (!costCenter) {
      throw createServiceError(404, `Cost center ${finalCostCenterId} not found.`);
    }

    if (costCenter.client_ID && costCenter.client_ID !== client.ID) {
      throw createServiceError(400, 'Cost center must belong to the same client.');
    }

    const responsibleId = costCenter.responsible_ID;
    const costCenterExplicit = context.data.costCenter_ID !== undefined;
    const costCenterChanged =
      context.event === 'CREATE' ||
      (costCenterExplicit && !identifiersMatch(existingCostCenterId, finalCostCenterId));

    if ((context.event === 'CREATE' || costCenterChanged) && !managerExplicit) {
      updates.manager_ID = responsibleId ?? undefined;
      finalManagerId = normalizeIdentifier(responsibleId) ?? responsibleId ?? undefined;
    }

    const shouldValidateManager = context.event === 'CREATE' || managerExplicit || costCenterChanged;
    const managerToValidate = managerExplicit ? requestedManagerId : finalManagerId;

    if (shouldValidateManager) {
      if (!managerToValidate) {
        throw createServiceError(
          400,
          'Employees assigned to a cost center must be managed by the responsible employee.',
        );
      }

      if (!identifiersMatch(managerToValidate, responsibleId)) {
        throw createServiceError(
          400,
          'Employees assigned to a cost center must be managed by the responsible employee.',
        );
      }
    }
  }

  if (context.data.manager_ID !== undefined) {
    updates.manager_ID = context.data.manager_ID ?? undefined;
  } else if (updates.manager_ID === undefined && finalManagerId !== existingManagerId) {
    updates.manager_ID = finalManagerId ?? undefined;
  }

  if (context.data.costCenter_ID !== undefined) {
    updates.costCenter_ID = context.data.costCenter_ID ?? undefined;
  }

  return updates;
};

const ensureUniqueEmployeeId = async (
  tx: Transaction,
  data: Partial<EmployeeEntity>,
  client: ClientEntity,
  currentEmployeeId?: string,
): Promise<boolean> => {
  const { client_ID: clientId } = data;
  if (!clientId) {
    return false;
  }

  if (data.employeeId) {
    data.employeeId = data.employeeId.trim().toUpperCase();
    const existing = (await tx.run(
      SELECT.one
        .from('clientmgmt.Employees')
        .columns('ID')
        .where({ employeeId: data.employeeId, client_ID: clientId }),
    )) as EmployeeEntity | undefined;
    if (existing && existing.ID !== currentEmployeeId) {
      throw createServiceError(409, `Employee ID ${data.employeeId} already exists.`);
    }
    return false;
  }

  for (let attempt = 0; attempt < EMPLOYEE_ID_RETRIES; attempt += 1) {
    try {
      const counterQuery = SELECT.one
        .from('clientmgmt.EmployeeIdCounters')
        .columns('lastCounter')
        .where({ client_ID: clientId }) as unknown as Record<string, unknown>;

      const counter = (await tx.run(withRowLock(counterQuery))) as EmployeeEntity | undefined;

      const nextCounter = ((counter as unknown as { lastCounter?: number })?.lastCounter ?? 0) + 1;
      const prefix = deriveClientPrefix(client, clientId);
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

      data.employeeId = generatedId;
      await persistCounter();
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error) && attempt < EMPLOYEE_ID_RETRIES - 1) {
        delete data.employeeId;
        continue;
      }
      throw error;
    }
  }

  throw createServiceError(500, 'Failed to generate a unique employee identifier.');
};

export const prepareEmployeeWrite = async ({
  event,
  data,
  targetId,
  tx,
  user,
  concurrency,
}: EmployeeWriteContext): Promise<EmployeeWriteResult> => {
  let existingEmployee: EmployeeEntity | undefined;

  if (event === 'UPDATE') {
    if (!targetId) {
      throw createServiceError(400, 'Employee identifier is required.');
    }

    await ensureOptimisticConcurrency({
      tx,
      entityName: 'clientmgmt.Employees',
      targetId,
      headerValue: concurrency?.headerValue,
      hasHttpHeaders: concurrency?.hasHttpHeaders ?? false,
      payloadValue: concurrency?.payloadValue,
    });

    existingEmployee = await loadExistingEmployee(tx, targetId);
    if (!existingEmployee) {
      throw createServiceError(404, `Employee ${targetId} not found.`);
    }
  }

  sanitizeEmployeeStrings(data);

  const client = await resolveClientForEmployee({ event, data, targetId, tx, user }, existingEmployee);
  data.client_ID = client.ID;

  validateTimeline(event, data, existingEmployee);
  const managerUpdates = await validateManagerAndCostCenter({ event, data, targetId, tx, user }, client, existingEmployee);

  return {
    updates: { ...managerUpdates },
    client,
    existingEmployee,
  };
};

export const ensureEmployeeIdentifier = async (
  tx: Transaction,
  data: Partial<EmployeeEntity>,
  client: ClientEntity,
  existingEmployeeId?: string,
): Promise<boolean> => ensureUniqueEmployeeId(tx, data, client, existingEmployeeId);

export interface EmployeeDeletionContext {
  targetId: string;
  tx: Transaction;
  user: UserContext;
  concurrency: Omit<ConcurrencyCheckInput, 'tx' | 'entityName' | 'targetId'>;
}

export const validateEmployeeDeletion = async ({
  targetId,
  tx,
  user,
  concurrency,
}: EmployeeDeletionContext): Promise<ClientEntity> => {
  await ensureOptimisticConcurrency({
    tx,
    entityName: 'clientmgmt.Employees',
    targetId,
    headerValue: concurrency.headerValue,
    hasHttpHeaders: concurrency.hasHttpHeaders,
    payloadValue: concurrency.payloadValue,
  });

  const employee = await loadExistingEmployee(tx, targetId);
  if (!employee) {
    throw createServiceError(404, `Employee ${targetId} not found.`);
  }

  const client = await ensureClientExists(tx, employee.client_ID);
  ensureUserAuthorizedForCompany(user, client.companyId);
  return client;
};
