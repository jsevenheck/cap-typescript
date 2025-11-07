import type { Request } from '@sap/cds';

import { buildUserContext, collectAttributeValues, userHasRole } from '../../../shared/utils/auth';
import { normalizeCompanyId } from '../../../shared/utils/normalization';
import { createServiceError } from '../../../shared/utils/errors';
import { requireRequestUser } from '../../shared/request-context';

const HR_ADMIN_ROLE = 'HRAdmin';
const COMPANY_ATTRIBUTE_NAMES = ['CompanyCode', 'companyCodes'] as const;

const applyCompanyFilter = (query: Record<string, unknown>, companies: string[]): void => {
  const select = query.SELECT as { where?: unknown[] } | undefined;
  if (!select) {
    return;
  }

  const filter: unknown[] = [
    { ref: ['companyId'] },
    'in',
    {
      list: companies.map((value) => ({ val: value })),
    },
  ];

  if (!select.where || select.where.length === 0) {
    select.where = filter;
    return;
  }

  select.where = ['(', ...select.where, ')', 'and', ...filter];
};

export const onRead = async (req: Request, next: () => Promise<unknown>): Promise<unknown> => {
  const user = buildUserContext(requireRequestUser(req));
  if (userHasRole(user, HR_ADMIN_ROLE)) {
    return next();
  }

  const companies = collectAttributeValues(user, [...COMPANY_ATTRIBUTE_NAMES])
    .map((value) => normalizeCompanyId(value))
    .filter((value): value is string => Boolean(value));

  if (companies.length === 0) {
    throw createServiceError('UNAUTHORIZED_COMPANY', 'User is not authorized for any company.');
  }

  const requestWithQuery = req as Request & { query: Record<string, unknown> };
  applyCompanyFilter(requestWithQuery.query, companies);

  return next();
};

export default onRead;
