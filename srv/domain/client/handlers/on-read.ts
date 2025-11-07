import type { Request } from '@sap/cds';

import { buildUserContext, collectAttributeValues, userHasRole } from '../../../shared/utils/auth';
import { requireRequestUser } from '../../shared/request-context';

interface RequestWithQuery extends Request {
  query?: any;
}

/**
 * Handles READ operations on Clients entity.
 * Filters results based on user's company authorization:
 * - HR admin users can read all clients
 * - Other users can only read clients from their assigned companies
 *
 * Company codes are normalized (trimmed and uppercased) to ensure consistent
 * matching with database values regardless of IAS attribute casing.
 *
 * @param req - The CAP request context
 */
export const onRead = async (req: Request): Promise<void> => {
  const reqWithQuery = req as RequestWithQuery;
  const user = buildUserContext(requireRequestUser(req));

  // HR admin users can access all clients
  if (userHasRole(user, 'HRAdmin')) {
    return;
  }

  // Get user's assigned company codes
  const userCompanies = collectAttributeValues(user, ['CompanyCode', 'companyCodes']);

  // If no company codes are assigned, restrict to empty set (secure by default)
  if (userCompanies.length === 0) {
    // Add a WHERE clause that will return no results
    reqWithQuery.query?.where({ companyId: null });
    return;
  }

  // Normalize company codes to uppercase for consistent database matching
  // This handles IAS returning codes in different cases (e.g., 'comp-001' vs 'COMP-001')
  const normalizedCompanies = userCompanies.map((code) => code.toUpperCase());

  // Filter clients to only those the user is authorized for
  reqWithQuery.query?.where({ companyId: { in: normalizedCompanies } });
};

export default onRead;
