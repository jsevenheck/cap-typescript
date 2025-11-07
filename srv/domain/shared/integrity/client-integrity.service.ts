import type { Transaction } from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../../../shared/types/models';
import { normalizeIdentifier } from '../../../shared/utils/normalization';
import { createServiceError } from '../../../shared/utils/errors';
import { findClientById as loadClientById } from '../../client/repository/client.repo';
import { findCostCenterById as loadCostCenterById } from '../../cost-center/repository/cost-center.repo';
import { findEmployeeById as loadEmployeeById } from '../../employee/repository/employee.repo';

const ensureClientExists = async (
  tx: Transaction,
  clientCache: Map<string, ClientEntity>,
  clientId: string,
): Promise<ClientEntity> => {
  const cached = clientCache.get(clientId);
  if (cached) {
    return cached;
  }

  const client = await loadClientById(tx, clientId, ['ID', 'companyId']);
  if (!client) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Client ${clientId} not found.`);
  }

  clientCache.set(clientId, client);
  return client;
};

const ensureCostCenterExists = async (
  tx: Transaction,
  cache: Map<string, CostCenterEntity>,
  costCenterId: string,
): Promise<CostCenterEntity> => {
  const cached = cache.get(costCenterId);
  if (cached) {
    return cached;
  }

  const costCenter = await loadCostCenterById(tx, costCenterId, ['ID', 'client_ID', 'responsible_ID']);
  if (!costCenter) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Cost center ${costCenterId} not found.`);
  }

  cache.set(costCenterId, costCenter);
  return costCenter;
};

const ensureEmployeeExists = async (
  tx: Transaction,
  cache: Map<string, EmployeeEntity>,
  employeeId: string,
): Promise<EmployeeEntity> => {
  const cached = cache.get(employeeId);
  if (cached) {
    return cached;
  }

  const employee = await loadEmployeeById(tx, employeeId, ['ID', 'client_ID']);
  if (!employee) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Employee ${employeeId} not found.`);
  }

  cache.set(employeeId, employee);
  return employee;
};

export const enforceCostCenterRelations = async (
  tx: Transaction,
  rows: Partial<CostCenterEntity>[],
): Promise<void> => {
  if (!rows.length) {
    return;
  }

  const clientCache = new Map<string, ClientEntity>();
  const costCenterCache = new Map<string, CostCenterEntity>();
  const employeeCache = new Map<string, EmployeeEntity>();

  for (const row of rows) {
    const costCenterId = normalizeIdentifier(row.ID);
    let clientId = normalizeIdentifier(row.client_ID);

    if (!clientId && costCenterId) {
      const existing = await ensureCostCenterExists(tx, costCenterCache, costCenterId);
      clientId = normalizeIdentifier(existing.client_ID);
    }

    if (!clientId) {
      throw createServiceError('REFERENTIAL_INTEGRITY', 'Client reference is required for cost center operations.');
    }

    await ensureClientExists(tx, clientCache, clientId);

    let responsibleId = normalizeIdentifier(row.responsible_ID);
    if (!responsibleId && costCenterId) {
      const existing = await ensureCostCenterExists(tx, costCenterCache, costCenterId);
      responsibleId = normalizeIdentifier(existing.responsible_ID);
    }

    if (!responsibleId) {
      throw createServiceError('REFERENTIAL_INTEGRITY', 'Responsible employee is required for cost center operations.');
    }

    const responsible = await ensureEmployeeExists(tx, employeeCache, responsibleId);
    const responsibleClient = normalizeIdentifier(responsible.client_ID);

    if (responsibleClient && responsibleClient !== clientId) {
      throw createServiceError(
        'REFERENTIAL_INTEGRITY',
        `Responsible employee ${responsibleId} must belong to client ${clientId}.`,
      );
    }
  }
};

export const enforceEmployeeRelations = async (
  tx: Transaction,
  rows: Partial<EmployeeEntity>[],
): Promise<void> => {
  if (!rows.length) {
    return;
  }

  const clientCache = new Map<string, ClientEntity>();
  const costCenterCache = new Map<string, CostCenterEntity>();
  const employeeCache = new Map<string, EmployeeEntity>();
  const employeeLookupCache = new Map<string, EmployeeEntity>();

  for (const row of rows) {
    const employeeId = normalizeIdentifier(row.ID);
    let clientId = normalizeIdentifier(row.client_ID);

    if (!clientId && employeeId) {
      const existing = await ensureEmployeeExists(tx, employeeLookupCache, employeeId);
      clientId = normalizeIdentifier(existing.client_ID);
    }

    if (!clientId) {
      throw createServiceError('REFERENTIAL_INTEGRITY', 'Client reference is required for employee operations.');
    }

    await ensureClientExists(tx, clientCache, clientId);

    const costCenterId = normalizeIdentifier(row.costCenter_ID);
    if (costCenterId) {
      const costCenter = await ensureCostCenterExists(tx, costCenterCache, costCenterId);
      const costCenterClient = normalizeIdentifier(costCenter.client_ID);
      if (costCenterClient && costCenterClient !== clientId) {
        throw createServiceError(
          'REFERENTIAL_INTEGRITY',
          `Cost center ${costCenterId} must belong to client ${clientId}.`,
        );
      }
    }

    const managerId = normalizeIdentifier(row.manager_ID);
    if (managerId) {
      const manager = await ensureEmployeeExists(tx, employeeCache, managerId);
      const managerClient = normalizeIdentifier(manager.client_ID);
      if (managerClient && managerClient !== clientId) {
        throw createServiceError(
          'REFERENTIAL_INTEGRITY',
          `Manager ${managerId} must belong to client ${clientId}.`,
        );
      }
    }
  }
};
