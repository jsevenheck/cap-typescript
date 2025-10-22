/**
 * Domain logic for anonymising former employees on demand.
 */
import type { Transaction } from '@sap/cds';

import { createServiceError } from '../../../shared/utils/errors';
import { toDateValue } from '../../../shared/utils/date';
import { normalizeCompanyId, sanitizeIdentifier } from '../../../shared/utils/normalization';
import type { UserContext } from '../../../shared/utils/auth';
import { collectAttributeValues, userHasRole } from '../../../shared/utils/auth';
import { HR_ADMIN_ROLE } from '../../client/services/lifecycle.service';
import { anonymizeEmployeeRecord, listEmployeesForAnonymization } from '../repository/employee.repo';
import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('employee-retention');

const ANONYMIZED_PLACEHOLDER = 'ANONYMIZED';
const ANONYMIZED_EMAIL_DOMAIN = 'example.invalid';
const DEFAULT_BATCH_SIZE = 100;
const MAX_BATCH_SIZE = 10000;

/**
 * Safely parse and validate the anonymization batch size from environment variable.
 * Returns a positive integer between 1 and MAX_BATCH_SIZE (10000).
 * Logs a warning and returns DEFAULT_BATCH_SIZE if the value is invalid.
 */
const getValidatedBatchSize = (): number => {
  const envValue = process.env.ANONYMIZATION_BATCH_SIZE;

  if (!envValue) {
    return DEFAULT_BATCH_SIZE;
  }

  const parsed = parseInt(envValue, 10);

  // Check for NaN
  if (Number.isNaN(parsed)) {
    logger.warn(
      { configuredValue: envValue, defaultValue: DEFAULT_BATCH_SIZE },
      'Invalid ANONYMIZATION_BATCH_SIZE: not a number. Using default.'
    );
    return DEFAULT_BATCH_SIZE;
  }

  // Check for values <= 0
  if (parsed <= 0) {
    logger.warn(
      { configuredValue: parsed, defaultValue: DEFAULT_BATCH_SIZE },
      'Invalid ANONYMIZATION_BATCH_SIZE: must be positive. Using default.'
    );
    return DEFAULT_BATCH_SIZE;
  }

  // Check for unreasonably large values
  if (parsed > MAX_BATCH_SIZE) {
    logger.warn(
      { configuredValue: parsed, maxValue: MAX_BATCH_SIZE },
      'ANONYMIZATION_BATCH_SIZE exceeds maximum. Using maximum allowed value.'
    );
    return MAX_BATCH_SIZE;
  }

  // Value is valid
  return parsed;
};

const buildAnonymizedEmail = (employeeId?: string): string => {
  const sanitized = typeof employeeId === 'string' ? sanitizeIdentifier(employeeId).toLowerCase() : '';
  const localPartBase = sanitized ? `anonymized-${sanitized}` : 'anonymized';
  const localPart = localPartBase.slice(0, 64);
  return `${localPart}@${ANONYMIZED_EMAIL_DOMAIN}`;
};

export const anonymizeFormerEmployees = async (
  tx: Transaction,
  user: UserContext,
  before: unknown,
): Promise<number> => {
  const cutoffDate = toDateValue(before);
  if (!cutoffDate) {
    throw createServiceError(400, 'Parameter "before" must be a valid date.');
  }

  const cutoff = cutoffDate.toISOString().split('T')[0];

  const whereClause: Record<string, unknown> = {
    exitDate: { '<': cutoff },
    firstName: { '!=': ANONYMIZED_PLACEHOLDER },
  };

  if (!userHasRole(user, HR_ADMIN_ROLE)) {
    const allowedCompanyCodes = collectAttributeValues(user, ['CompanyCode', 'companyCodes'])
      .map((value) => normalizeCompanyId(value))
      .filter((value): value is string => Boolean(value));

    if (allowedCompanyCodes.length === 0) {
      throw createServiceError(403, 'User is not authorized for any company.');
    }

    whereClause['client.companyId'] = { in: allowedCompanyCodes };
  }

  const employeesToAnonymize = await listEmployeesForAnonymization(tx, whereClause);

  if (!employeesToAnonymize || employeesToAnonymize.length === 0) {
    return 0;
  }

  // Batch anonymization in chunks for better performance
  const batchSize = getValidatedBatchSize();
  for (let i = 0; i < employeesToAnonymize.length; i += batchSize) {
    const batch = employeesToAnonymize.slice(i, i + batchSize);
    await Promise.all(
      batch.map(employee =>
        anonymizeEmployeeRecord(tx, employee.ID, buildAnonymizedEmail(employee.employeeId), ANONYMIZED_PLACEHOLDER)
      )
    );
  }

  return employeesToAnonymize.length;
};
