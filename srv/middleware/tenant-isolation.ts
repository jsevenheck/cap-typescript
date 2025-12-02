import type { Request } from '@sap/cds';

import { resolveTenantFromReq, tenantCondition } from '../shared/utils/tenant';

const TENANT_SCOPED_ENTITIES = [
  'Clients',
  'Locations',
  'Employees',
  'CostCenters',
  'EmployeeCostCenterAssignments',
  'EmployeeIdCounters',
  'EmployeeNotificationOutbox',
  'EmployeeNotificationDLQ',
];

const whereContainsTenant = (where?: unknown[]): boolean => {
  if (!Array.isArray(where)) {
    return false;
  }
  return where.some((segment) => {
    if (Array.isArray(segment)) {
      return whereContainsTenant(segment as unknown[]);
    }
    return typeof segment === 'object' && !!segment && 'ref' in (segment as Record<string, unknown>)
      ? (segment as { ref: unknown[] }).ref?.[0] === 'tenant'
      : false;
  });
};

const appendTenantCondition = (query: any, tenant: string): void => {
  const target = query?.SELECT ?? query?.UPDATE ?? query?.DELETE;
  if (!target) {
    return;
  }

  if (whereContainsTenant(target.where)) {
    return;
  }

  const condition = tenantCondition(tenant);
  if (Array.isArray(target.where) && target.where.length > 0) {
    target.where = ['(', ...target.where, ')', 'and', ...condition];
    return;
  }
  target.where = condition;
};

export const registerTenantIsolation = (srv: any): void => {
  srv.before('CREATE', TENANT_SCOPED_ENTITIES, (req: Request) => {
    const tenant = resolveTenantFromReq(req);
    if (Array.isArray(req.data)) {
      req.data = (req.data as any[]).map((entry) => ({ ...entry, tenant }));
      return;
    }
    if (req.data && typeof req.data === 'object') {
      (req.data as Record<string, unknown>).tenant = tenant;
    }
  });

  srv.before(['READ', 'UPDATE', 'DELETE'], TENANT_SCOPED_ENTITIES, (req: Request) => {
    const tenant = resolveTenantFromReq(req);
    appendTenantCondition(req.query, tenant);
  });
};

export default registerTenantIsolation;
