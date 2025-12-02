import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { ClientEntity } from '../../../shared/types/models';
import { resolveTenantFromTx } from '../../../shared/utils/tenant';

const { SELECT } = cds.ql;

export const findClientById = async (
  tx: Transaction,
  id: string,
  columns: (keyof ClientEntity)[] = ['ID', 'companyId'],
): Promise<ClientEntity | undefined> =>
  (await tx.run(
    SELECT.one
      .from('clientmgmt.Clients')
      .columns(...(columns as string[]))
      .where({ ID: id, tenant: resolveTenantFromTx(tx) }),
  )) as ClientEntity | undefined;

export const findClientByCompanyId = async (
  tx: Transaction,
  companyId: string,
  excludeId?: string,
): Promise<ClientEntity | undefined> => {
  const whereClause: Record<string, unknown> = { companyId, tenant: resolveTenantFromTx(tx) };
  if (excludeId) {
    whereClause.ID = { '!=': excludeId };
  }
  return (await tx.run(
    SELECT.one.from('clientmgmt.Clients').columns('ID').where(whereClause),
  )) as ClientEntity | undefined;
};
