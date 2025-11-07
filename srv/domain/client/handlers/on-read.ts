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

  // Filter clients to only those the user is authorized for
  reqWithQuery.query?.where({ companyId: { in: userCompanies } });
};

export default onRead;
