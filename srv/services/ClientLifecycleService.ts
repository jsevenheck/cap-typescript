/**
 * Business rules for client lifecycle operations (create/update/delete).
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency } from '../utils/concurrency';
import { createServiceError } from '../utils/errors';
import {
  deriveCountryCodeFromCompanyId,
  isValidCountryCode,
  normalizeCompanyId,
} from '../utils/normalization';
import type { ClientEntity } from '../types/models';
import type { UserContext } from '../utils/auth';
import { collectAttributeValues, userHasRole } from '../utils/auth';

const { SELECT } = cds.ql;

export const HR_ADMIN_ROLE = 'HRAdmin';
export const HR_VIEWER_ROLE = 'HRViewer';
export const HR_EDITOR_ROLE = 'HREditor';

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

  if (!hasHrScope(user)) {
    return;
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

    existingClient = (await tx.run(
      SELECT.one.from('clientmgmt.Clients').columns('ID', 'companyId').where({ ID: targetId }),
    )) as ClientEntity | undefined;

    if (!existingClient) {
      throw createServiceError(404, `Client ${targetId} not found.`);
    }
  }

  if (data.companyId !== undefined) {
    const normalized = normalizeCompanyId(data.companyId);
    updates.companyId = normalized ?? undefined;
  }

  if (data.country_code !== undefined) {
    if (typeof data.country_code !== 'string') {
      throw createServiceError(400, 'Country code must be a two-letter ISO code.');
    }

    const normalizedCountry = data.country_code.trim().toUpperCase();
    if (!isValidCountryCode(normalizedCountry)) {
      throw createServiceError(400, 'Country code must be a two-letter ISO code.');
    }
    updates.country_code = normalizedCountry;
  }

  const targetCompanyId =
    updates.companyId ??
    (event === 'UPDATE'
      ? normalizeCompanyId(existingClient?.companyId ?? undefined) ?? existingClient?.companyId
      : normalizeCompanyId(data.companyId ?? undefined) ?? data.companyId);

  ensureUserAuthorizedForCompany(user, targetCompanyId);

  if (data.country_code === undefined && updates.country_code === undefined) {
    const companyChanged =
      event === 'CREATE' ||
      (event === 'UPDATE' &&
        data.companyId !== undefined &&
        (!existingClient || normalizeCompanyId(data.companyId) !== normalizeCompanyId(existingClient.companyId)));

    if (companyChanged) {
      const derivedCode = deriveCountryCodeFromCompanyId(targetCompanyId);
      if (derivedCode) {
        updates.country_code = derivedCode;
      }
    }
  }

  if (updates.companyId) {
    const whereClause: Record<string, unknown> = { companyId: updates.companyId };

    if (event === 'UPDATE' && targetId) {
      whereClause.ID = { '!=': targetId };
    }

    const existing = (await tx.run(
      SELECT.one.from('clientmgmt.Clients').columns('ID').where(whereClause),
    )) as ClientEntity | undefined;

    if (existing) {
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

  const client = (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('companyId').where({ ID: targetId }),
  )) as ClientEntity | undefined;

  if (!client) {
    throw createServiceError(404, `Client ${targetId} not found.`);
  }

  ensureUserAuthorizedForCompany(user, client.companyId);
};
