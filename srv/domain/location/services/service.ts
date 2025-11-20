/**
 * Business rules for location lifecycle operations.
 */
import type { Transaction } from '@sap/cds';

import { ensureOptimisticConcurrency, type ConcurrencyCheckInput } from '../../../shared/utils/concurrency';
import { createServiceError } from '../../../shared/utils/errors';
import { isValidCountryCode } from '../../../shared/utils/normalization';
import type { UserContext } from '../../../shared/utils/auth';
import { ensureUserAuthorizedForCompany } from '../../client/services/lifecycle.service';
import type { ClientEntity, LocationEntity } from '../dto/location.dto';
import { findClientById, findLocationById, findEmployeesByLocation } from '../repository/location.repo';

export interface LocationUpsertContext {
  event: 'CREATE' | 'UPDATE';
  data: Partial<LocationEntity>;
  targetId?: string;
  tx: Transaction;
  user: UserContext;
  concurrency?: Omit<ConcurrencyCheckInput, 'tx' | 'entityName' | 'targetId'>;
}

export interface LocationUpsertResult {
  updates: Partial<LocationEntity>;
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

const validateLocationDates = (validFrom?: string, validTo?: string | null): void => {
  if (!validFrom) {
    throw createServiceError(400, 'Valid from date is required.');
  }

  if (validTo) {
    const fromDate = new Date(validFrom);
    const toDate = new Date(validTo);
    if (fromDate > toDate) {
      throw createServiceError(400, 'validFrom must be less than or equal to validTo.');
    }
  }
};

export const prepareLocationUpsert = async ({
  event,
  data,
  targetId,
  tx,
  user,
  concurrency,
}: LocationUpsertContext): Promise<LocationUpsertResult> => {
  const updates: Partial<LocationEntity> = {};

  let existingLocation: LocationEntity | undefined;
  if (event === 'UPDATE') {
    if (!targetId) {
      throw createServiceError(400, 'Location identifier is required.');
    }

    await ensureOptimisticConcurrency({
      tx,
      entityName: 'clientmgmt.Locations',
      targetId,
      headerValue: concurrency?.headerValue,
      hasHttpHeaders: concurrency?.hasHttpHeaders ?? false,
      payloadValue: concurrency?.payloadValue,
    });

    existingLocation = await findLocationById(tx, targetId, [
      'ID',
      'client_ID',
      'city',
      'country_code',
      'zipCode',
      'street',
      'validFrom',
      'validTo',
    ]);

    if (!existingLocation) {
      throw createServiceError(404, `Location ${targetId} not found.`);
    }
  }

  // Validate and normalize city
  if (data.city !== undefined) {
    if (!data.city || typeof data.city !== 'string') {
      throw createServiceError(400, 'City is required.');
    }
    updates.city = data.city.trim();
  } else if (event === 'CREATE') {
    throw createServiceError(400, 'City is required.');
  }

  // Validate and normalize country code
  if (data.country_code !== undefined) {
    if (!data.country_code || typeof data.country_code !== 'string') {
      throw createServiceError(400, 'Country code is required.');
    }
    const normalizedCountryCode = data.country_code.trim().toUpperCase();
    if (!isValidCountryCode(normalizedCountryCode)) {
      throw createServiceError(400, `Invalid country code: ${data.country_code}`);
    }
    updates.country_code = normalizedCountryCode;
  } else if (event === 'CREATE') {
    throw createServiceError(400, 'Country code is required.');
  }

  // Validate and normalize zip code
  if (data.zipCode !== undefined) {
    if (!data.zipCode || typeof data.zipCode !== 'string') {
      throw createServiceError(400, 'Zip code is required.');
    }
    updates.zipCode = data.zipCode.trim();
  } else if (event === 'CREATE') {
    throw createServiceError(400, 'Zip code is required.');
  }

  // Validate and normalize street
  if (data.street !== undefined) {
    if (!data.street || typeof data.street !== 'string') {
      throw createServiceError(400, 'Street is required.');
    }
    updates.street = data.street.trim();
  } else if (event === 'CREATE') {
    throw createServiceError(400, 'Street is required.');
  }

  // Normalize address supplement (optional)
  if (data.addressSupplement !== undefined) {
    if (data.addressSupplement && typeof data.addressSupplement === 'string') {
      const trimmed = data.addressSupplement.trim();
      updates.addressSupplement = trimmed || null;
    } else {
      // Explicitly clear when null or empty is sent
      updates.addressSupplement = null;
    }
  }

  // Validate dates
  const effectiveValidFrom = data.validFrom ?? existingLocation?.validFrom;
  const effectiveValidTo = data.validTo !== undefined ? data.validTo : existingLocation?.validTo;

  if (data.validFrom !== undefined || data.validTo !== undefined) {
    validateLocationDates(effectiveValidFrom, effectiveValidTo);
  }

  if (data.validFrom !== undefined) {
    updates.validFrom = data.validFrom;
  } else if (event === 'CREATE') {
    throw createServiceError(400, 'Valid from date is required.');
  }

  if (data.validTo !== undefined) {
    updates.validTo = data.validTo;
  }

  const clientId = data.client_ID ?? existingLocation?.client_ID;
  if (!clientId) {
    throw createServiceError(400, 'Client reference is required.');
  }

  const client = await ensureClientExists(tx, clientId);
  ensureUserAuthorizedForCompany(user, client.companyId);

  // Prevent changing client_ID if employees are assigned to this location
  if (
    event === 'UPDATE' &&
    existingLocation &&
    data.client_ID !== undefined &&
    data.client_ID !== existingLocation.client_ID
  ) {
    const assignedCount = await findEmployeesByLocation(tx, targetId!);
    if (assignedCount > 0) {
      throw createServiceError(
        409,
        `Cannot change location's client: ${assignedCount} employee(s) are still assigned to it.`
      );
    }
  }

  updates.client_ID = client.ID;

  return { updates, client };
};

export interface LocationDeletionContext {
  targetId: string;
  tx: Transaction;
  user: UserContext;
  concurrency: Omit<ConcurrencyCheckInput, 'tx' | 'entityName' | 'targetId'>;
}

export const validateLocationDeletion = async ({
  targetId,
  tx,
  user,
  concurrency,
}: LocationDeletionContext): Promise<void> => {
  await ensureOptimisticConcurrency({
    tx,
    entityName: 'clientmgmt.Locations',
    targetId,
    headerValue: concurrency.headerValue,
    hasHttpHeaders: concurrency.hasHttpHeaders,
    payloadValue: concurrency.payloadValue,
  });

  const location = await findLocationById(tx, targetId, ['client_ID']);

  if (!location) {
    throw createServiceError(404, `Location ${targetId} not found.`);
  }

  // Authorize before checking employee assignments to prevent information disclosure
  const client = await ensureClientExists(tx, location.client_ID);
  ensureUserAuthorizedForCompany(user, client.companyId);

  // Check for assigned employees before deletion (only after authorization)
  const assignedCount = await findEmployeesByLocation(tx, targetId);
  if (assignedCount > 0) {
    throw createServiceError(
      409,
      `Cannot delete location: ${assignedCount} employee(s) are still assigned to it.`
    );
  }
};
