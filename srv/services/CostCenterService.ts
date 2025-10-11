/**
 * Business rules for cost center lifecycle operations.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency, type ConcurrencyCheckInput } from '../utils/concurrency';
import { createServiceError } from '../utils/errors';
import { normalizeCostCenterCode } from '../utils/normalization';
import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../types/models';
import type { UserContext } from '../utils/auth';
import { ensureUserAuthorizedForCompany } from './ClientLifecycleService';

const { SELECT } = cds.ql;

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

  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('ID', 'companyId').where({ ID: clientId }),
  )) as ClientEntity | undefined;

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

  const responsible = (await tx.run(
    SELECT.one.from('clientmgmt.Employees').columns('client_ID').where({ ID: responsibleId }),
  )) as EmployeeEntity | undefined;

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

    existingCostCenter = (await tx.run(
      SELECT.one.from('clientmgmt.CostCenters').columns('ID', 'client_ID').where({ ID: targetId }),
    )) as CostCenterEntity | undefined;

    if (!existingCostCenter) {
      throw createServiceError(404, `Cost center ${targetId} not found.`);
    }
  }

  if (data.code !== undefined) {
    updates.code = normalizeCostCenterCode(data.code) ?? undefined;
  }

  let clientId = data.client_ID ?? existingCostCenter?.client_ID;
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

  const costCenter = (await tx.run(
    SELECT.one.from('clientmgmt.CostCenters').columns('client_ID').where({ ID: targetId }),
  )) as CostCenterEntity | undefined;

  if (!costCenter) {
    throw createServiceError(404, `Cost center ${targetId} not found.`);
  }

  const client = await ensureClientExists(tx, costCenter.client_ID);
  ensureUserAuthorizedForCompany(user, client.companyId);
};
