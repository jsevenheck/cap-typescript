/**
 * Business rules for cost center lifecycle operations.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency, type ConcurrencyCheckInput } from '../../../shared/utils/concurrency';
import { createServiceError } from '../../../shared/utils/errors';
import { normalizeCostCenterCode } from '../../../shared/utils/normalization';
import type { UserContext } from '../../../shared/utils/auth';
import { ensureUserAuthorizedForCompany } from '../../client/services/lifecycle.service';
import type { ClientEntity, CostCenterEntity } from '../dto/cost-center.dto';
import { findClientById, findCostCenterById, findCostCenterByCode, findEmployeeById, findEmployeesByCostCenter } from '../repository/cost-center.repo';

const ql = cds.ql as typeof cds.ql;

export interface CostCenterUpsertContext {
  event: 'CREATE' | 'UPDATE';
  data: Partial<CostCenterEntity>;
  targetId?: string;
  tx: Transaction;
  user: UserContext;
  concurrency?: Omit<ConcurrencyCheckInput, 'tx' | 'entityName' | 'targetId'>;
}

export interface CostCenterUpsertResult {
  updates: Partial<CostCenterEntity>;
  client: ClientEntity;
}

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

const ensureResponsibleEmployee = async (
  tx: Transaction,
  clientId: string,
  responsibleId: string,
): Promise<void> => {
  const responsible = await findEmployeeById(tx, responsibleId, ['client_ID']);

  if (!responsible) {
    throw createServiceError(404, `Responsible employee ${responsibleId} not found.`);
  }

  if (responsible.client_ID !== clientId) {
    throw createServiceError(400, 'Responsible employee must belong to the same client.');
  }
};

export const prepareCostCenterUpsert = async ({
  event,
  data,
  targetId,
  tx,
  user,
  concurrency,
}: CostCenterUpsertContext): Promise<CostCenterUpsertResult> => {
  const updates: Partial<CostCenterEntity> = {};

  let existingCostCenter: CostCenterEntity | undefined;
  if (event === 'UPDATE') {
    if (!targetId) {
      throw createServiceError(400, 'Cost center identifier is required.');
    }

    await ensureOptimisticConcurrency({
      tx,
      entityName: 'clientmgmt.CostCenters',
      targetId,
      headerValue: concurrency?.headerValue,
      hasHttpHeaders: concurrency?.hasHttpHeaders ?? false,
      payloadValue: concurrency?.payloadValue,
    });

    existingCostCenter = await findCostCenterById(tx, targetId, ['ID', 'client_ID', 'responsible_ID', 'validFrom', 'validTo']);

    if (!existingCostCenter) {
      throw createServiceError(404, `Cost center ${targetId} not found.`);
    }
  }

  if (data.code !== undefined) {
    updates.code = normalizeCostCenterCode(data.code) ?? undefined;
  }

  const clientId = data.client_ID ?? existingCostCenter?.client_ID;
  if (!clientId) {
    throw createServiceError(400, 'Client reference is required.');
  }

  const client = await ensureClientExists(tx, clientId);
  ensureUserAuthorizedForCompany(user, client.companyId);

  // Validate cost center code uniqueness per client
  const finalCode = updates.code ?? (event === 'UPDATE' ? existingCostCenter?.code : data.code);
  if (finalCode) {
    const existingByCode = await findCostCenterByCode(tx, client.ID, finalCode, event === 'UPDATE' ? targetId : undefined);
    if (existingByCode) {
      throw createServiceError(409, `Cost center code ${finalCode} already exists for this client.`);
    }
  }

  let normalizedResponsibleId: string | undefined;
  if (data.responsible_ID !== undefined) {
    if (data.responsible_ID === null || typeof data.responsible_ID !== 'string') {
      throw createServiceError(400, 'Responsible employee is required.');
    }

    normalizedResponsibleId = data.responsible_ID.trim();
    if (!normalizedResponsibleId) {
      throw createServiceError(400, 'Responsible employee is required.');
    }
  }

  const effectiveResponsibleId =
    normalizedResponsibleId ?? existingCostCenter?.responsible_ID ?? undefined;

  if (!effectiveResponsibleId) {
    throw createServiceError(400, 'Responsible employee is required.');
  }

  await ensureResponsibleEmployee(tx, client.ID, effectiveResponsibleId);

  if (normalizedResponsibleId !== undefined) {
    updates.responsible_ID = normalizedResponsibleId;
  }

  // Validate date range
  const validFrom = data.validFrom ?? (event === 'UPDATE' ? existingCostCenter?.validFrom : undefined);
  const validTo = data.validTo !== undefined ? data.validTo : (event === 'UPDATE' ? existingCostCenter?.validTo : undefined);

  if (!validFrom) {
    throw createServiceError(400, 'validFrom is required.');
  }

  if (validTo) {
    const fromDate = new Date(validFrom);
    const toDate = new Date(validTo);

    if (fromDate > toDate) {
      throw createServiceError(400, 'validFrom must be less than or equal to validTo.');
    }
  }

  if (data.validFrom !== undefined) {
    updates.validFrom = validFrom;
  }

  if (data.validTo !== undefined) {
    updates.validTo = validTo;
  }

  updates.client_ID = client.ID;

  return { updates, client };
};

const findCostCenterAssignments = async (
  tx: Transaction,
  costCenterId: string,
): Promise<number> => {
  const result = await tx.run(
    ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
      .columns('count(*) as count')
      .where({ costCenter_ID: costCenterId }),
  );

  if (Array.isArray(result) && result.length > 0 && typeof result[0] === 'object' && result[0] !== null) {
    return Number((result[0] as Record<string, unknown>).count) || 0;
  }

  return 0;
};

export interface CostCenterDeletionContext {
  targetId: string;
  tx: Transaction;
  user: UserContext;
  concurrency: Omit<ConcurrencyCheckInput, 'tx' | 'entityName' | 'targetId'>;
}

export const validateCostCenterDeletion = async ({
  targetId,
  tx,
  user,
  concurrency,
}: CostCenterDeletionContext): Promise<void> => {
  await ensureOptimisticConcurrency({
    tx,
    entityName: 'clientmgmt.CostCenters',
    targetId,
    headerValue: concurrency.headerValue,
    hasHttpHeaders: concurrency.hasHttpHeaders,
    payloadValue: concurrency.payloadValue,
  });

  const costCenter = await findCostCenterById(tx, targetId, ['client_ID']);

  if (!costCenter) {
    throw createServiceError(404, `Cost center ${targetId} not found.`);
  }

  // Authorize before checking employee assignments to prevent information disclosure
  const client = await ensureClientExists(tx, costCenter.client_ID);
  ensureUserAuthorizedForCompany(user, client.companyId);

  // Check for assigned employees before deletion (only after authorization)
  const assignedCount = await findEmployeesByCostCenter(tx, targetId);
  if (assignedCount > 0) {
    throw createServiceError(
      409,
      `Cannot delete cost center: ${assignedCount} employee(s) are still assigned to it.`
    );
  }

  // Check for cost center assignments to prevent data loss
  const assignmentCount = await findCostCenterAssignments(tx, targetId);
  if (assignmentCount > 0) {
    throw createServiceError(
      409,
      `Cannot delete cost center: ${assignmentCount} assignment record(s) exist. This would result in loss of historical data.`
    );
  }
};
