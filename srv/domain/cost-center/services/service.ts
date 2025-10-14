/**
 * Business rules for cost center lifecycle operations.
 */
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency, type ConcurrencyCheckInput } from '../../../shared/utils/concurrency';
import { createServiceError } from '../../../shared/utils/errors';
import { normalizeCostCenterCode } from '../../../shared/utils/normalization';
import type { UserContext } from '../../../shared/utils/auth';
import { ensureUserAuthorizedForCompany } from '../../client/services/lifecycle.service';
import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../dto/cost-center.dto';
import { findClientById, findCostCenterById, findEmployeeById } from '../repository/cost-center.repo';

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
  responsibleId?: string | null,
): Promise<void> => {
  if (!responsibleId) {
    return;
  }

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

    existingCostCenter = await findCostCenterById(tx, targetId, ['ID', 'client_ID']);

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

  await ensureResponsibleEmployee(tx, client.ID, data.responsible_ID);

  if (data.responsible_ID !== undefined) {
    updates.responsible_ID = data.responsible_ID;
  }

  updates.client_ID = client.ID;

  return { updates, client };
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

  const client = await ensureClientExists(tx, costCenter.client_ID);
  ensureUserAuthorizedForCompany(user, client.companyId);
};
