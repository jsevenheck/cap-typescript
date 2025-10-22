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

const ANONYMIZED_PLACEHOLDER = 'ANONYMIZED';
const ANONYMIZED_EMAIL_DOMAIN = 'example.invalid';

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
  const BATCH_SIZE = parseInt(process.env.ANONYMIZATION_BATCH_SIZE || '100', 10);
  for (let i = 0; i < employeesToAnonymize.length; i += BATCH_SIZE) {
    const batch = employeesToAnonymize.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(employee =>
        anonymizeEmployeeRecord(tx, employee.ID, buildAnonymizedEmail(employee.employeeId), ANONYMIZED_PLACEHOLDER)
      )
    );
  }

  return employeesToAnonymize.length;
};
