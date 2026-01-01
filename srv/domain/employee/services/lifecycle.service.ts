/**
 * Business rules for employee lifecycle operations, including validation and identifier management.
 */

import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency, type ConcurrencyCheckInput } from '../../../shared/utils/concurrency';
import { createServiceError } from '../../../shared/utils/errors';
import { toDateValue } from '../../../shared/utils/date';
import {
  identifiersMatch,
  isInactiveStatus,
  normalizeCompanyId,
  normalizeIdentifier,
} from '../../../shared/utils/normalization';
import type { UserContext } from '../../../shared/utils/auth';
import { extractAssociationId, isAssociationProvided } from '../../../shared/utils/associations';
import { ensureUserAuthorizedForCompany } from '../../client/services/lifecycle.service';
import type { ClientEntity, EmployeeEntity } from '../dto/employee.dto';
import {
  findCostCenterById,
  findEmployeeByEmployeeId,
  findEmployeeById,
  findEmployeeIdCounterForUpdate,
  findLocationById,
  insertEmployeeIdCounter,
  updateEmployeeIdCounter,
} from '../repository/employee.repo';
import { findClientById } from '../../client/repository/client.repo';

export const EMPLOYEE_ID_RETRIES = 5;
/** Employee IDs follow the format {clientId}-{counter} where counter is 4 digits (0001-9999) */
const EMPLOYEE_ID_COUNTER_LENGTH = 4;
const MAX_EMPLOYEE_COUNTER = 9999;

const ensureClientExists = async (tx: Transaction, clientId?: string | null): Promise<ClientEntity> => {
  if (!clientId) {
    throw createServiceError(400, 'Client reference is required.');
  }

  const client = await findClientById(tx, clientId, ['ID', 'companyId']);

  if (!client) {
    throw createServiceError(404, `Client ${clientId} not found.`);
  }

  return client;
};

const loadExistingEmployee = async (tx: Transaction, employeeId: string): Promise<EmployeeEntity | undefined> =>
  findEmployeeById(tx, employeeId, [
    'ID',
    'client_ID',
    'employeeId',
    'entryDate',
    'exitDate',
    'status',
    'costCenter_ID',
    'manager_ID',
    'location_ID',
  ]);

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

const EMPLOYEE_ID_CONSTRAINT_TOKENS = [
  'employees_employeeid_unique',
  'employees_employeeid_key',
  'employees_employee_id_key',
  'employeeid',
  'employee_id',
  '"employeeid"',
  '`employeeid`',
];

export const isEmployeeIdUniqueConstraintError = (error: unknown): boolean => {
  if (!isUniqueConstraintError(error) || !error || typeof error !== 'object') {
    return false;
  }

  const { constraint, detail, column, columns, message } = error as {
    constraint?: string;
    detail?: string;
    column?: string;
    columns?: string[];
    message?: string;
  };

  const searchSpace = [constraint, detail, column, message]
    .filter((value): value is string => typeof value === 'string' && value.length > 0)
    .map((value) => value.toLowerCase());

  if (Array.isArray(columns)) {
    for (const columnName of columns) {
      if (typeof columnName === 'string') {
        searchSpace.push(columnName.toLowerCase());
      }
    }
  }

  return searchSpace.some((value) =>
    EMPLOYEE_ID_CONSTRAINT_TOKENS.some((token) => value.includes(token)),
  );
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
  if (data.positionLevel) data.positionLevel = data.positionLevel.trim();
  if (data.phoneNumber) data.phoneNumber = data.phoneNumber.trim();
};

/**
 * Applies cost center inheritance rules for CREATE operations.
 * If an employee has no explicit cost center but has a manager,
 * inherit the cost center from the manager.
 *
 * IMPORTANT: Only called for CREATE operations to avoid unexpected
 * manager reassignment during UPDATE operations.
 */
const applyCostCenterInheritance = async (
  tx: Transaction,
  event: 'CREATE' | 'UPDATE',
  data: Partial<EmployeeEntity>,
  existing: Partial<EmployeeEntity> | undefined,
): Promise<void> => {
  // Only inherit if no explicit cost center is provided
  const costCenterExplicit = isAssociationProvided(data, 'costCenter');
  if (costCenterExplicit) {
    // User explicitly set or cleared the cost center, don't inherit
    return;
  }

  // Check if employee already has a cost center from existing record
  const existingCostCenter = existing?.costCenter_ID;
  if (existingCostCenter && event === 'UPDATE') {
    // Employee already has a cost center, don't override
    return;
  }

  // Check if employee has a manager to inherit from
  const managerProvided = isAssociationProvided(data, 'manager');
  const resolvedManagerId = managerProvided ? extractAssociationId(data, 'manager') : undefined;

  let managerId: string | undefined;
  if (managerProvided) {
    if (resolvedManagerId === null) {
      // Manager explicitly cleared
      return;
    }

    if (typeof resolvedManagerId === 'string' && resolvedManagerId) {
      managerId = resolvedManagerId;
    }
  } else {
    managerId = existing?.manager_ID ?? undefined;
  }

  if (!managerId) {
    // No manager to inherit from or could not resolve manager ID
    return;
  }

  // Fetch manager's cost center
  const manager = await findEmployeeById(tx, managerId, ['ID', 'costCenter_ID']);
  if (!manager || !manager.costCenter_ID) {
    // Manager not found or has no cost center
    return;
  }

  // Inherit cost center from manager
  data.costCenter_ID = manager.costCenter_ID;

  // Note: We don't log here to avoid logging in every call
  // The calling code can log if needed
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

  // Normalize status to ensure consistency
  if (data.status) {
    const normalizedStatus = data.status.trim().toLowerCase();
    if (normalizedStatus === 'active' || normalizedStatus === 'inactive') {
      data.status = normalizedStatus as 'active' | 'inactive';
    } else {
      throw createServiceError(400, 'Status must be either "active" or "inactive".');
    }
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

const validateLocation = async (
  context: EmployeeWriteContext,
  client: ClientEntity,
  existing?: EmployeeEntity,
): Promise<Partial<EmployeeEntity>> => {
  const updates: Partial<EmployeeEntity> = {};
  const tx = context.tx;

  const locationExplicit = context.data.location_ID !== undefined;
  const requestedLocationId = locationExplicit ? normalizeIdentifier(context.data.location_ID) : undefined;
  const existingLocationId = normalizeIdentifier(existing?.location_ID);
  const finalLocationId = requestedLocationId ?? existingLocationId;

  // Location is required for CREATE
  if (context.event === 'CREATE' && !finalLocationId) {
    throw createServiceError(400, 'Location is required for new employees.');
  }

  if (finalLocationId) {
    const location = await findLocationById(tx, finalLocationId);

    if (!location) {
      throw createServiceError(404, `Location ${finalLocationId} not found.`);
    }

    if (location.client_ID && location.client_ID !== client.ID) {
      throw createServiceError(400, 'Location must belong to the same client.');
    }

    if (locationExplicit) {
      updates.location_ID = requestedLocationId ?? undefined;
    }
  }

  return updates;
};

const validateManagerAndCostCenter = async (
  context: EmployeeWriteContext,
  client: ClientEntity,
  existing?: EmployeeEntity,
): Promise<Partial<EmployeeEntity>> => {
  const updates: Partial<EmployeeEntity> = {};
  const tx = context.tx;

  const costCenterExplicit = context.data.costCenter_ID !== undefined;
  const removingCostCenter = costCenterExplicit && context.data.costCenter_ID === null;
  const requestedCostCenterId =
    costCenterExplicit && !removingCostCenter ? normalizeIdentifier(context.data.costCenter_ID) : undefined;
  const existingCostCenterId = normalizeIdentifier(existing?.costCenter_ID);
  const finalCostCenterId = removingCostCenter ? undefined : requestedCostCenterId ?? existingCostCenterId;

  const managerExplicit = context.data.manager_ID !== undefined;
  const requestedManagerId =
    managerExplicit && context.data.manager_ID !== null ? normalizeIdentifier(context.data.manager_ID) : undefined;
  const existingManagerId = normalizeIdentifier(existing?.manager_ID);
  let finalManagerId = managerExplicit ? requestedManagerId : existingManagerId;

  if (finalCostCenterId) {
    const costCenter = await findCostCenterById(tx, finalCostCenterId);

    if (!costCenter) {
      throw createServiceError(404, `Cost center ${finalCostCenterId} not found.`);
    }

    if (costCenter.client_ID && costCenter.client_ID !== client.ID) {
      throw createServiceError(400, 'Cost center must belong to the same client.');
    }

    const responsibleId = costCenter.responsible_ID;
    const costCenterChanged = costCenterExplicit && !identifiersMatch(existingCostCenterId, finalCostCenterId);

    if ((context.event === 'CREATE' || costCenterChanged) && !managerExplicit) {
      finalManagerId = normalizeIdentifier(responsibleId);
      updates.manager_ID = finalManagerId ?? undefined;
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

    // Always validate against self-management, regardless of whether values changed
    // This prevents circular references when cost centers or managers are updated elsewhere
    if (context.targetId && finalManagerId && identifiersMatch(finalManagerId, context.targetId)) {
      throw createServiceError(
        400,
        'An employee cannot be their own manager.',
      );
    }
  }

  if (context.data.manager_ID !== undefined) {
    // Preserve explicit null to clear the relation
    updates.manager_ID = context.data.manager_ID;
  } else if (updates.manager_ID === undefined && finalManagerId !== existingManagerId) {
    updates.manager_ID = finalManagerId ?? undefined;
  }

  if (context.data.costCenter_ID !== undefined) {
    // Preserve explicit null to clear the relation
    updates.costCenter_ID = context.data.costCenter_ID;
  }

  return updates;
};

/** Employee ID format: {clientId}-{counter} (e.g., 1010-0001) */
const EMPLOYEE_ID_FORMAT_REGEX = /^[0-9]{4}-[0-9]{4}$/;
const MAX_EMPLOYEE_ID_LENGTH = 9;

/**
 * Validates employee ID format matches the pattern {clientId}-{counter}.
 * Format: 4-digit client ID, hyphen, 4-digit counter (e.g., 1010-0001)
 */
const validateEmployeeIdFormat = (employeeId: string, clientCompanyId: string): void => {
  if (!EMPLOYEE_ID_FORMAT_REGEX.test(employeeId)) {
    throw createServiceError(
      400,
      `Employee ID must follow the format {clientId}-{counter} (e.g., ${clientCompanyId}-0001).`,
    );
  }

  // Ensure the prefix matches the client's company ID
  const prefix = employeeId.substring(0, 4);
  if (prefix !== clientCompanyId) {
    throw createServiceError(
      400,
      `Employee ID prefix must match the client ID (${clientCompanyId}).`,
    );
  }
};

const ensureUniqueEmployeeId = async (
  tx: Transaction,
  data: Partial<EmployeeEntity>,
  client: ClientEntity,
  currentEmployeeIdentifier?: string,
  excludeUuid?: string,
): Promise<boolean> => {
  const { client_ID: clientId } = data;
  if (!clientId) {
    return false;
  }

  const clientCompanyId = client.companyId ?? '';

  if (data.employeeId) {
    data.employeeId = data.employeeId.trim().toUpperCase();

    // Validate length constraint (matches database schema: String(9))
    if (data.employeeId.length > MAX_EMPLOYEE_ID_LENGTH) {
      throw createServiceError(
        400,
        `Employee ID cannot exceed ${MAX_EMPLOYEE_ID_LENGTH} characters.`,
      );
    }

    // Validate format: {clientId}-{counter}
    validateEmployeeIdFormat(data.employeeId, clientCompanyId);

    if (
      currentEmployeeIdentifier &&
      data.employeeId === currentEmployeeIdentifier.trim().toUpperCase()
    ) {
      return false;
    }
    const existing = await findEmployeeByEmployeeId(tx, clientId, data.employeeId, excludeUuid);
    if (existing) {
      throw createServiceError(409, `Employee ID ${data.employeeId} already exists.`);
    }
    return false;
  }

  for (let attempt = 0; attempt < EMPLOYEE_ID_RETRIES; attempt += 1) {
    try {
      const counter = await findEmployeeIdCounterForUpdate(tx, clientId);
      const nextCounter = (counter?.lastCounter ?? 0) + 1;

      // Check if we've exceeded the maximum counter value (9999)
      if (nextCounter > MAX_EMPLOYEE_COUNTER) {
        throw createServiceError(
          400,
          `Maximum employee capacity reached for client ${clientCompanyId}. Cannot create more than ${MAX_EMPLOYEE_COUNTER} employees.`,
        );
      }

      const counterPart = String(nextCounter).padStart(EMPLOYEE_ID_COUNTER_LENGTH, '0');
      const generatedId = `${clientCompanyId}-${counterPart}`;

      const existingEmployeeWithId = await findEmployeeByEmployeeId(tx, clientId, generatedId, excludeUuid);

      const persistCounter = async () => {
        if (counter) {
          await updateEmployeeIdCounter(tx, clientId, nextCounter);
        } else {
          await insertEmployeeIdCounter(tx, clientId, nextCounter);
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

    // Check for employeeId immutability on UPDATE
    if ('employeeId' in data) {
      const normalizedNew = normalizeIdentifier(data.employeeId);
      const normalizedExisting = normalizeIdentifier(existingEmployee.employeeId);
      // Reject attempts to clear (null/undefined/empty/whitespace) or change the employeeId
      if (!normalizedNew || normalizedNew !== normalizedExisting) {
        throw createServiceError(400, 'Employee ID cannot be modified.');
      }
    }
  }

  sanitizeEmployeeStrings(data);

  const client = await resolveClientForEmployee({ event, data, targetId, tx, user }, existingEmployee);
  data.client_ID = client.ID;

  validateTimeline(event, data, existingEmployee);

  // Apply cost center inheritance from manager only on CREATE
  // UPDATE operations should not auto-inherit to avoid unexpected manager reassignment
  if (event === 'CREATE') {
    await applyCostCenterInheritance(tx, event, data, existingEmployee);
  }

  const managerUpdates = await validateManagerAndCostCenter({ event, data, targetId, tx, user }, client, existingEmployee);
  const locationUpdates = await validateLocation({ event, data, targetId, tx, user }, client, existingEmployee);

  return {
    updates: { ...managerUpdates, ...locationUpdates },
    client,
    existingEmployee,
  };
};

export const ensureEmployeeIdentifier = async (
  tx: Transaction,
  data: Partial<EmployeeEntity>,
  client: ClientEntity,
  existingEmployeeIdentifier?: string,
  excludeUuid?: string,
): Promise<boolean> => ensureUniqueEmployeeId(tx, data, client, existingEmployeeIdentifier, excludeUuid);

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
