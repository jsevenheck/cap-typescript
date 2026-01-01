/**
 * Business rules for client lifecycle operations (create/update/delete).
 */
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency } from '../../../shared/utils/concurrency';
import { createServiceError } from '../../../shared/utils/errors';
import {
  normalizeCompanyId,
} from '../../../shared/utils/normalization';
import type { UserContext } from '../../../shared/utils/auth';
import { collectAttributeValues, userHasRole } from '../../../shared/utils/auth';
import type { ClientEntity } from '../dto/client.dto';
import { findClientByCompanyId, findClientById } from '../repository/client.repo';

export const HR_ADMIN_ROLE = 'HRAdmin';
export const HR_VIEWER_ROLE = 'HRViewer';
export const HR_EDITOR_ROLE = 'HREditor';

/** Client ID must be exactly 4 numeric characters (e.g., 1010, 1026, 1069) */
const CLIENT_ID_FORMAT_REGEX = /^[0-9]{4}$/;

/**
 * Validates that a client ID follows the required 4-digit format.
 * @param companyId - The company/client ID to validate
 */
const validateClientIdFormat = (companyId: string): void => {
  if (!CLIENT_ID_FORMAT_REGEX.test(companyId)) {
    throw createServiceError(
      400,
      'Client ID must be exactly 4 numeric characters (e.g., 1010, 1026, 1069).',
    );
  }
};

const hasHrScope = (user: UserContext): boolean => userHasRole(user, HR_VIEWER_ROLE) || userHasRole(user, HR_EDITOR_ROLE);

export const ensureUserAuthorizedForCompany = (user: UserContext, companyId?: string | null): void => {
  if (!companyId) {
    return;
  }

  const normalizedCompanyId = normalizeCompanyId(companyId);
  if (!normalizedCompanyId) {
    throw createServiceError(400, 'Company identifier is required.');
  }

  if (userHasRole(user, HR_ADMIN_ROLE)) {
    return;
  }

  // Users without HR roles should be denied access
  if (!hasHrScope(user)) {
    throw createServiceError(403, 'User does not have required HR role.');
  }

  const attributeNames = ['CompanyCode', 'companyCodes'];
  const collected = collectAttributeValues(user, attributeNames)
    .map((value) => normalizeCompanyId(value))
    .filter((value): value is string => Boolean(value));

  if (!collected.includes(normalizedCompanyId)) {
    throw createServiceError(403, 'Forbidden: company code not assigned');
  }
};

export interface ClientUpsertContext {
  event: 'CREATE' | 'UPDATE';
  data: Partial<ClientEntity>;
  targetId?: string;
  user: UserContext;
  tx: Transaction;
  concurrency?: { headerValue?: string; hasHttpHeaders: boolean; payloadValue?: unknown };
}

export interface ClientUpsertResult {
  updates: Partial<ClientEntity>;
}

export const prepareClientUpsert = async ({
  event,
  data,
  targetId,
  user,
  tx,
  concurrency,
}: ClientUpsertContext): Promise<ClientUpsertResult> => {
  const updates: Partial<ClientEntity> = {};

  let existingClient: ClientEntity | undefined;
  if (event === 'UPDATE') {
    if (!targetId) {
      throw createServiceError(400, 'Client identifier is required.');
    }

    await ensureOptimisticConcurrency({
      tx,
      entityName: 'clientmgmt.Clients',
      targetId,
      headerValue: concurrency?.headerValue,
      hasHttpHeaders: concurrency?.hasHttpHeaders ?? false,
      payloadValue: concurrency?.payloadValue,
    });

    existingClient = await findClientById(tx, targetId, ['ID', 'companyId']);

    if (!existingClient) {
      throw createServiceError(404, `Client ${targetId} not found.`);
    }
  }

  if (data.companyId !== undefined) {
    const normalized = normalizeCompanyId(data.companyId);
    if (normalized) {
      validateClientIdFormat(normalized);
    }
    updates.companyId = normalized ?? undefined;
  }

  // For CREATE, companyId is required
  if (event === 'CREATE' && !updates.companyId && !data.companyId) {
    throw createServiceError(400, 'Client ID is required.');
  }

  const targetCompanyId =
    updates.companyId ??
    (event === 'UPDATE'
      ? normalizeCompanyId(existingClient?.companyId ?? undefined) ?? existingClient?.companyId
      : normalizeCompanyId(data.companyId ?? undefined) ?? data.companyId);

  ensureUserAuthorizedForCompany(user, targetCompanyId);

  // Validate client name
  if (event === 'CREATE' || 'name' in data) {
    if (data.name === undefined || data.name === null) {
      // name is explicitly set to undefined or null - reject for both CREATE and UPDATE
      throw createServiceError(400, 'Client name must not be empty.');
    }
    const trimmedName = typeof data.name === 'string' ? data.name.trim() : String(data.name).trim();
    if (!trimmedName) {
      throw createServiceError(400, 'Client name must not be empty.');
    }
    updates.name = trimmedName;
  }

  if (updates.companyId) {
    const existing = await findClientByCompanyId(tx, updates.companyId, event === 'UPDATE' ? targetId : undefined);

    if (existing && (!targetId || existing.ID !== targetId)) {
      throw createServiceError(409, `Company ID ${updates.companyId} already exists.`);
    }
  }

  return { updates };
};

export interface ClientDeletionContext {
  targetId: string;
  user: UserContext;
  tx: Transaction;
  concurrency: { headerValue?: string; hasHttpHeaders: boolean; payloadValue?: unknown };
}

export const validateClientDeletion = async ({
  targetId,
  user,
  tx,
  concurrency,
}: ClientDeletionContext): Promise<void> => {
  await ensureOptimisticConcurrency({
    tx,
    entityName: 'clientmgmt.Clients',
    targetId,
    headerValue: concurrency.headerValue,
    hasHttpHeaders: concurrency.hasHttpHeaders,
    payloadValue: concurrency.payloadValue,
  });

  const client = await findClientById(tx, targetId, ['companyId']);

  if (!client) {
    throw createServiceError(404, `Client ${targetId} not found.`);
  }

  ensureUserAuthorizedForCompany(user, client.companyId);
};
