import type { Request } from '@sap/cds';
import cds from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../../../shared/types/models';
import { buildUserContext, collectAttributeValues, userHasRole, type UserContext } from '../../../shared/utils/auth';
import { createServiceError } from '../../../shared/utils/errors';
import { requireRequestUser } from '../request-context';

/**
 * Extracts the user's assigned company codes from their attributes.
 * Checks both 'CompanyCode' and 'companyCodes' attributes.
 */
const getUserCompanyCodes = (user: UserContext): string[] => {
  return collectAttributeValues(user, ['CompanyCode', 'companyCodes']);
};

/**
 * Checks if a user is authorized to access data for a specific company.
 * HR admin users have access to all companies.
 * Company code comparison is case-insensitive.
 */
const isAuthorizedForCompany = (user: UserContext, companyId: string): boolean => {
  // HR admin users bypass company restrictions
  if (userHasRole(user, 'HRAdmin')) {
    return true;
  }

  const userCompanies = getUserCompanyCodes(user);

  // If no company restrictions are defined, deny access (secure by default)
  if (userCompanies.length === 0) {
    return false;
  }

  // Case-insensitive comparison for company codes
  const companyIdLower = companyId.toLowerCase();
  return userCompanies.some((code) => code.toLowerCase() === companyIdLower);
};

/**
 * Enforces company authorization for client entities.
 * Throws an error if any client references a company the user is not authorized for.
 *
 * @param ctx - The CAP request context containing user information
 * @param rows - Array of client entities to validate
 * @throws {ServiceError} 403 if user is not authorized for any referenced company
 */
export const enforceClientCompany = async (
  ctx: Request,
  rows: Partial<ClientEntity>[],
): Promise<void> => {
  if (!rows || rows.length === 0) {
    return;
  }

  const user = buildUserContext(requireRequestUser(ctx));
  const unauthorizedCompanies = new Set<string>();

  for (const row of rows) {
    if (!row.companyId) {
      continue;
    }

    if (!isAuthorizedForCompany(user, row.companyId)) {
      unauthorizedCompanies.add(row.companyId);
    }
  }

  if (unauthorizedCompanies.size > 0) {
    const companies = Array.from(unauthorizedCompanies).join(', ');
    throw createServiceError(
      403,
      `User is not authorized for company: ${companies}`,
    );
  }
};

/**
 * Enforces company authorization for cost center entities.
 * Validates that the cost center's associated client belongs to a company
 * the user is authorized for.
 *
 * @param ctx - The CAP request context containing user information
 * @param rows - Array of cost center entities to validate
 * @throws {ServiceError} 403 if user is not authorized for any referenced company
 */
export const enforceCostCenterCompany = async (
  ctx: Request,
  rows: Partial<CostCenterEntity>[],
): Promise<void> => {
  if (!rows || rows.length === 0) {
    return;
  }

  // Need to fetch the associated client records to check their company codes
  const clientIds = new Set<string>();
  for (const row of rows) {
    if (row.client_ID) {
      clientIds.add(row.client_ID);
    }
  }

  if (clientIds.size === 0) {
    return;
  }

  const tx = cds.transaction(ctx);

  const clients = (await tx.run(
    cds.ql.SELECT.from('clientmgmt.Clients')
      .columns('ID', 'companyId')
      .where({ ID: { in: Array.from(clientIds) } }),
  )) as Pick<ClientEntity, 'ID' | 'companyId'>[];

  const clientCompanyMap = new Map<string, string>();
  for (const client of clients) {
    clientCompanyMap.set(client.ID, client.companyId);
  }

  const user = buildUserContext(requireRequestUser(ctx));
  const unauthorizedCompanies = new Set<string>();

  for (const row of rows) {
    if (!row.client_ID) {
      continue;
    }

    const companyId = clientCompanyMap.get(row.client_ID);
    if (companyId && !isAuthorizedForCompany(user, companyId)) {
      unauthorizedCompanies.add(companyId);
    }
  }

  if (unauthorizedCompanies.size > 0) {
    const companies = Array.from(unauthorizedCompanies).join(', ');
    throw createServiceError(
      403,
      `User is not authorized for company: ${companies}`,
    );
  }
};

/**
 * Enforces company authorization for employee entities.
 * Validates that the employee's associated client belongs to a company
 * the user is authorized for.
 *
 * @param ctx - The CAP request context containing user information
 * @param rows - Array of employee entities to validate
 * @throws {ServiceError} 403 if user is not authorized for any referenced company
 */
export const enforceEmployeeCompany = async (
  ctx: Request,
  rows: Partial<EmployeeEntity>[],
): Promise<void> => {
  if (!rows || rows.length === 0) {
    return;
  }

  // Need to fetch the associated client records to check their company codes
  const clientIds = new Set<string>();
  for (const row of rows) {
    if (row.client_ID) {
      clientIds.add(row.client_ID);
    }
  }

  if (clientIds.size === 0) {
    return;
  }

  const tx = cds.transaction(ctx);

  const clients = (await tx.run(
    cds.ql.SELECT.from('clientmgmt.Clients')
      .columns('ID', 'companyId')
      .where({ ID: { in: Array.from(clientIds) } }),
  )) as Pick<ClientEntity, 'ID' | 'companyId'>[];

  const clientCompanyMap = new Map<string, string>();
  for (const client of clients) {
    clientCompanyMap.set(client.ID, client.companyId);
  }

  const user = buildUserContext(requireRequestUser(ctx));
  const unauthorizedCompanies = new Set<string>();

  for (const row of rows) {
    if (!row.client_ID) {
      continue;
    }

    const companyId = clientCompanyMap.get(row.client_ID);
    if (companyId && !isAuthorizedForCompany(user, companyId)) {
      unauthorizedCompanies.add(companyId);
    }
  }

  if (unauthorizedCompanies.size > 0) {
    const companies = Array.from(unauthorizedCompanies).join(', ');
    throw createServiceError(
      403,
      `User is not authorized for company: ${companies}`,
    );
  }
};
