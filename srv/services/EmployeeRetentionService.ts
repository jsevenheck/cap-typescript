/**
 * Domain logic for anonymising former employees on demand.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { createServiceError } from '../utils/errors';
import { toDateValue } from '../utils/date';
import { normalizeCompanyId, sanitizeIdentifier } from '../utils/normalization';
import type { EmployeeEntity } from '../types/models';
import type { UserContext } from '../utils/auth';
import { collectAttributeValues, userHasRole } from '../utils/auth';
import { HR_ADMIN_ROLE } from './ClientLifecycleService';

const { SELECT, UPDATE } = cds.ql as any;

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
      return 0;
    }

    whereClause['client.companyId'] = { in: allowedCompanyCodes };
  }

  const employeesToAnonymize = (await tx.run(
    SELECT.from('clientmgmt.Employees')
      .columns('ID', 'employeeId')
      .where(whereClause),
  )) as Array<Pick<EmployeeEntity, 'ID' | 'employeeId'>>;

  if (!employeesToAnonymize || employeesToAnonymize.length === 0) {
    return 0;
  }

  for (const employee of employeesToAnonymize) {
    await tx.run(
      UPDATE('clientmgmt.Employees')
        .set({
          firstName: ANONYMIZED_PLACEHOLDER,
          lastName: ANONYMIZED_PLACEHOLDER,
          email: buildAnonymizedEmail(employee.employeeId),
          location: null,
          positionLevel: null,
          status: 'inactive',
        })
        .where({ ID: employee.ID }),
    );
  }

  return employeesToAnonymize.length;
};
