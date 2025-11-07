import type { Transaction } from '@sap/cds';
import cds from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../../../shared/types/models';
import { createServiceError } from '../../../shared/utils/errors';

/**
 * Enforces referential integrity for cost center entities.
 * Validates that:
 * - The referenced client exists
 * - The referenced responsible employee exists and belongs to the same client
 *
 * @param tx - Database transaction
 * @param rows - Array of cost center entities to validate
 * @throws {ServiceError} 400 if referential integrity constraints are violated
 */
export const enforceCostCenterRelations = async (
  tx: Transaction,
  rows: Partial<CostCenterEntity>[],
): Promise<void> => {
  if (!rows || rows.length === 0) {
    return;
  }

  const clientIds = new Set<string>();
  const responsibleIds = new Set<string>();

  for (const row of rows) {
    if (row.client_ID) {
      clientIds.add(row.client_ID);
    }
    if (row.responsible_ID) {
      responsibleIds.add(row.responsible_ID);
    }
  }

  // Validate that all referenced clients exist
  if (clientIds.size > 0) {
    const clients = (await tx.run(
      cds.ql.SELECT.from('clientmgmt.Clients')
        .columns('ID')
        .where({ ID: { in: Array.from(clientIds) } }),
    )) as Pick<ClientEntity, 'ID'>[];

    const existingClientIds = new Set(clients.map((c) => c.ID));
    const missingClientIds = Array.from(clientIds).filter((id) => !existingClientIds.has(id));

    if (missingClientIds.length > 0) {
      throw createServiceError(
        400,
        `Referenced client(s) do not exist: ${missingClientIds.join(', ')}`,
      );
    }
  }

  // Validate that all referenced responsible employees exist and belong to the correct client
  if (responsibleIds.size > 0) {
    const employees = (await tx.run(
      cds.ql.SELECT.from('clientmgmt.Employees')
        .columns('ID', 'client_ID')
        .where({ ID: { in: Array.from(responsibleIds) } }),
    )) as Pick<EmployeeEntity, 'ID' | 'client_ID'>[];

    const employeeMap = new Map<string, string>();
    for (const emp of employees) {
      employeeMap.set(emp.ID, emp.client_ID);
    }

    for (const row of rows) {
      if (!row.responsible_ID || !row.client_ID) {
        continue;
      }

      const responsibleClientId = employeeMap.get(row.responsible_ID);

      if (!responsibleClientId) {
        throw createServiceError(
          400,
          `Referenced responsible employee does not exist: ${row.responsible_ID}`,
        );
      }

      if (responsibleClientId !== row.client_ID) {
        throw createServiceError(
          400,
          `Responsible employee ${row.responsible_ID} does not belong to client ${row.client_ID}`,
        );
      }
    }
  }
};

/**
 * Enforces referential integrity for employee entities.
 * Validates that:
 * - The referenced client exists
 * - If a manager is referenced, they exist and belong to the same client
 * - If a cost center is referenced, it exists and belongs to the same client
 *
 * @param tx - Database transaction
 * @param rows - Array of employee entities to validate
 * @throws {ServiceError} 400 if referential integrity constraints are violated
 */
export const enforceEmployeeRelations = async (
  tx: Transaction,
  rows: Partial<EmployeeEntity>[],
): Promise<void> => {
  if (!rows || rows.length === 0) {
    return;
  }

  const clientIds = new Set<string>();
  const managerIds = new Set<string>();
  const costCenterIds = new Set<string>();

  for (const row of rows) {
    if (row.client_ID) {
      clientIds.add(row.client_ID);
    }
    if (row.manager_ID) {
      managerIds.add(row.manager_ID);
    }
    if (row.costCenter_ID) {
      costCenterIds.add(row.costCenter_ID);
    }
  }

  // Validate that all referenced clients exist
  if (clientIds.size > 0) {
    const clients = (await tx.run(
      cds.ql.SELECT.from('clientmgmt.Clients')
        .columns('ID')
        .where({ ID: { in: Array.from(clientIds) } }),
    )) as Pick<ClientEntity, 'ID'>[];

    const existingClientIds = new Set(clients.map((c) => c.ID));
    const missingClientIds = Array.from(clientIds).filter((id) => !existingClientIds.has(id));

    if (missingClientIds.length > 0) {
      throw createServiceError(
        400,
        `Referenced client(s) do not exist: ${missingClientIds.join(', ')}`,
      );
    }
  }

  // Validate that all referenced managers exist and belong to the correct client
  if (managerIds.size > 0) {
    const managers = (await tx.run(
      cds.ql.SELECT.from('clientmgmt.Employees')
        .columns('ID', 'client_ID')
        .where({ ID: { in: Array.from(managerIds) } }),
    )) as Pick<EmployeeEntity, 'ID' | 'client_ID'>[];

    const managerMap = new Map<string, string>();
    for (const mgr of managers) {
      managerMap.set(mgr.ID, mgr.client_ID);
    }

    for (const row of rows) {
      if (!row.manager_ID || !row.client_ID) {
        continue;
      }

      const managerClientId = managerMap.get(row.manager_ID);

      if (!managerClientId) {
        throw createServiceError(
          400,
          `Referenced manager does not exist: ${row.manager_ID}`,
        );
      }

      if (managerClientId !== row.client_ID) {
        throw createServiceError(
          400,
          `Manager ${row.manager_ID} does not belong to client ${row.client_ID}`,
        );
      }
    }
  }

  // Validate that all referenced cost centers exist and belong to the correct client
  if (costCenterIds.size > 0) {
    const costCenters = (await tx.run(
      cds.ql.SELECT.from('clientmgmt.CostCenters')
        .columns('ID', 'client_ID')
        .where({ ID: { in: Array.from(costCenterIds) } }),
    )) as Pick<CostCenterEntity, 'ID' | 'client_ID'>[];

    const costCenterMap = new Map<string, string>();
    for (const cc of costCenters) {
      costCenterMap.set(cc.ID, cc.client_ID);
    }

    for (const row of rows) {
      if (!row.costCenter_ID || !row.client_ID) {
        continue;
      }

      const costCenterClientId = costCenterMap.get(row.costCenter_ID);

      if (!costCenterClientId) {
        throw createServiceError(
          400,
          `Referenced cost center does not exist: ${row.costCenter_ID}`,
        );
      }

      if (costCenterClientId !== row.client_ID) {
        throw createServiceError(
          400,
          `Cost center ${row.costCenter_ID} does not belong to client ${row.client_ID}`,
        );
      }
    }
  }
};
