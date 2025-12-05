import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { ClientEntity } from '../../../shared/types/models';

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
      .where({ ID: id }),
  )) as ClientEntity | undefined;

export const findClientByCompanyId = async (
  tx: Transaction,
  companyId: string,
  excludeId?: string,
): Promise<ClientEntity | undefined> => {
  const whereClause: Record<string, unknown> = { companyId };
  if (excludeId) {
    whereClause.ID = { '!=': excludeId };
  }
  return (await tx.run(SELECT.one.from('clientmgmt.Clients').columns('ID').where(whereClause))) as
    | ClientEntity
    | undefined;
};
