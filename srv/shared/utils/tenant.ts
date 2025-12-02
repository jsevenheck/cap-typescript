import cds from '@sap/cds';
import type { Request, Transaction } from '@sap/cds';

interface TenantContext {
  tenant?: string | null;
  user?: { tenant?: string | null } | null;
}

const normalizeTenant = (value?: string | null): string => {
  const normalized = value && String(value).trim();
  if (!normalized) {
    const error: Error & { statusCode?: number } = new Error('Missing tenant in request context');
    error.statusCode = 401;
    throw error;
  }
  return normalized;
};

export const resolveTenant = (context?: TenantContext | null): string => {
  const cdsContext = (cds as any)?.context;
  if (!context) {
    return normalizeTenant(cdsContext?.tenant ?? process.env.CDS_DEFAULT_TENANT);
  }

  const fromContext = (context as any).tenant ?? (context as any)?.user?.tenant;
  return normalizeTenant(fromContext ?? cdsContext?.tenant ?? process.env.CDS_DEFAULT_TENANT);
};

export const resolveTenantFromReq = (req: Request): string =>
  resolveTenant({ tenant: (req as any).tenant, user: (req as any).user });

export const resolveTenantFromTx = (tx: Transaction): string => resolveTenant((tx as any).context);

export const tenantCondition = (tenant: string): any[] => [
  { ref: ['tenant'] },
  '=',
  { val: tenant },
];
