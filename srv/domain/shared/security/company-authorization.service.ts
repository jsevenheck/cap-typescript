import cds from '@sap/cds';
import type { Request, Transaction } from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../../../shared/types/models';
import { buildUserContext, collectAttributeValues, userHasRole, type UserContext } from '../../../shared/utils/auth';
import { normalizeCompanyId, normalizeIdentifier } from '../../../shared/utils/normalization';
import { createServiceError } from '../../../shared/utils/errors';
import { requireRequestUser } from '../../shared/request-context';
import { findClientById as loadClientById } from '../../client/repository/client.repo';
import { findCostCenterById as loadCostCenterById } from '../../cost-center/repository/cost-center.repo';
import { findEmployeeById as loadEmployeeById } from '../../employee/repository/employee.repo';

const AUTH_ATTRIBUTE_NAMES = ['CompanyCode', 'companyCodes'] as const;
const HR_ADMIN_ROLE = 'HRAdmin';

type ClientLike = Partial<ClientEntity>;
type CostCenterLike = Partial<CostCenterEntity>;
type EmployeeLike = Partial<EmployeeEntity>;

interface EnforcementContext {
  user: UserContext;
  tx: Transaction;
  adminBypass: boolean;
  allowedCompanies: Set<string>;
}

const buildEnforcementContext = (req: Request): EnforcementContext => {
  const user = buildUserContext(requireRequestUser(req));
  const adminBypass = userHasRole(user, HR_ADMIN_ROLE);
  const allowedCompanies = new Set<string>();

  if (!adminBypass) {
    const collected = collectAttributeValues(user, [...AUTH_ATTRIBUTE_NAMES]);
    for (const value of collected) {
      const normalized = normalizeCompanyId(value);
      if (normalized) {
        allowedCompanies.add(normalized);
      }
    }

    if (!allowedCompanies.size) {
      throw createServiceError('UNAUTHORIZED_COMPANY', 'User is not authorized for any company.');
    }
  }

  return { user, tx: cds.transaction(req), adminBypass, allowedCompanies };
};

const ensureCompanyAuthorized = (
  context: EnforcementContext,
  companyId: string | undefined,
  reference: string,
): void => {
  if (context.adminBypass) {
    return;
  }

  if (!companyId) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Unable to determine company for ${reference}.`);
  }

  if (!context.allowedCompanies.has(companyId)) {
    throw createServiceError('UNAUTHORIZED_COMPANY', `User is not authorized for company ${companyId}.`);
  }
};

const resolveClientCompany = async (
  context: EnforcementContext,
  cache: Map<string, string>,
  clientId: string,
): Promise<string> => {
  const cached = cache.get(clientId);
  if (cached) {
    return cached;
  }

  const client = await loadClientById(context.tx, clientId, ['ID', 'companyId']);
  if (!client) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Client ${clientId} not found.`);
  }

  const normalized = normalizeCompanyId(client.companyId);
  if (!normalized) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Client ${clientId} is missing a company assignment.`);
  }

  cache.set(clientId, normalized);
  return normalized;
};

export const enforceClientCompany = async (
  req: Request,
  rows: ClientLike[],
): Promise<void> => {
  if (!rows.length) {
    return;
  }

  const context = buildEnforcementContext(req);
  if (context.adminBypass) {
    return;
  }

  const clientCache = new Map<string, string>();

  for (const row of rows) {
    const providedCompany = normalizeCompanyId(row.companyId);
    if (providedCompany) {
      ensureCompanyAuthorized(context, providedCompany, `client ${row.companyId}`);
      continue;
    }

    const clientId = normalizeIdentifier(row.ID);
    if (!clientId) {
      throw createServiceError('REFERENTIAL_INTEGRITY', 'Client identifier is required for authorization.');
    }

    const companyId = await resolveClientCompany(context, clientCache, clientId);
    ensureCompanyAuthorized(context, companyId, `client ${clientId}`);
  }
};

const resolveCostCenterClient = async (
  context: EnforcementContext,
  costCenter: CostCenterLike,
  costCenterCache: Map<string, string>,
  clientCache: Map<string, string>,
): Promise<string> => {
  const directClient = normalizeIdentifier(costCenter.client_ID);
  if (directClient) {
    return resolveClientCompany(context, clientCache, directClient);
  }

  const costCenterId = normalizeIdentifier(costCenter.ID);
  if (!costCenterId) {
    throw createServiceError('REFERENTIAL_INTEGRITY', 'Cost center identifier is required for authorization.');
  }

  const cached = costCenterCache.get(costCenterId);
  if (cached) {
    return resolveClientCompany(context, clientCache, cached);
  }

  const existing = await loadCostCenterById(context.tx, costCenterId, ['ID', 'client_ID']);
  if (!existing?.client_ID) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Cost center ${costCenterId} not found.`);
  }

  const normalizedClient = normalizeIdentifier(existing.client_ID);
  if (!normalizedClient) {
    throw createServiceError('REFERENTIAL_INTEGRITY', `Cost center ${costCenterId} is missing a client assignment.`);
  }

  costCenterCache.set(costCenterId, normalizedClient);
  return resolveClientCompany(context, clientCache, normalizedClient);
};

export const enforceCostCenterCompany = async (
  req: Request,
  rows: CostCenterLike[],
): Promise<void> => {
  if (!rows.length) {
    return;
  }

  const context = buildEnforcementContext(req);
  if (context.adminBypass) {
    return;
  }

  const costCenterCache = new Map<string, string>();
  const clientCache = new Map<string, string>();

  for (const row of rows) {
    const companyId = await resolveCostCenterClient(context, row, costCenterCache, clientCache);
    ensureCompanyAuthorized(context, companyId, `cost center ${row.ID ?? row.client_ID ?? ''}`);
  }
};

const resolveEmployeeClient = async (
  context: EnforcementContext,
  employee: EmployeeLike,
  employeeCache: Map<string, string>,
  clientCache: Map<string, string>,
  costCenterCache: Map<string, string>,
): Promise<string> => {
  const directClient = normalizeIdentifier(employee.client_ID);
  if (directClient) {
    return resolveClientCompany(context, clientCache, directClient);
  }

  const employeeId = normalizeIdentifier(employee.ID);
  if (employeeId) {
    const cached = employeeCache.get(employeeId);
    if (cached) {
      return resolveClientCompany(context, clientCache, cached);
    }

    const existing = await loadEmployeeById(context.tx, employeeId, ['ID', 'client_ID']);
    if (!existing?.client_ID) {
      throw createServiceError('REFERENTIAL_INTEGRITY', `Employee ${employeeId} not found.`);
    }

    const normalizedClient = normalizeIdentifier(existing.client_ID);
    if (!normalizedClient) {
      throw createServiceError('REFERENTIAL_INTEGRITY', `Employee ${employeeId} is missing a client assignment.`);
    }

    employeeCache.set(employeeId, normalizedClient);
    return resolveClientCompany(context, clientCache, normalizedClient);
  }

  // Fallback: infer from cost center if provided
  const costCenterId = normalizeIdentifier(employee.costCenter_ID);
  if (costCenterId) {
    const costCenterClient = await resolveCostCenterClient(
      context,
      { ID: costCenterId },
      costCenterCache,
      clientCache,
    );
    return costCenterClient;
  }

  throw createServiceError('REFERENTIAL_INTEGRITY', 'Employee client assignment is required for authorization.');
};

export const enforceEmployeeCompany = async (
  req: Request,
  rows: EmployeeLike[],
): Promise<void> => {
  if (!rows.length) {
    return;
  }

  const context = buildEnforcementContext(req);
  if (context.adminBypass) {
    return;
  }

  const employeeCache = new Map<string, string>();
  const clientCache = new Map<string, string>();
  const costCenterCache = new Map<string, string>();

  for (const row of rows) {
    const companyId = await resolveEmployeeClient(context, row, employeeCache, clientCache, costCenterCache);
    ensureCompanyAuthorized(context, companyId, `employee ${row.ID ?? row.client_ID ?? ''}`);
  }
};
