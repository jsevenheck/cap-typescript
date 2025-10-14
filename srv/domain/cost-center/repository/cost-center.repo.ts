import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../dto/cost-center.dto';

const ql = cds.ql as typeof cds.ql;

export const findCostCenterById = async (
  tx: Transaction,
  id: string,
  columns: (keyof CostCenterEntity)[] = ['ID', 'client_ID'],
): Promise<CostCenterEntity | undefined> =>
  (await tx.run(
    ql.SELECT.one.from('clientmgmt.CostCenters').columns(...(columns as string[])).where({ ID: id }),
  )) as CostCenterEntity | undefined;

export const findClientById = async (
  tx: Transaction,
  clientId: string,
  columns: (keyof ClientEntity)[] = ['ID', 'companyId'],
): Promise<ClientEntity | undefined> =>
  (await tx.run(
    ql.SELECT.one.from('clientmgmt.Clients').columns(...(columns as string[])).where({ ID: clientId }),
  )) as ClientEntity | undefined;

export const findEmployeeById = async (
  tx: Transaction,
  employeeId: string,
  columns: (keyof EmployeeEntity)[] = ['client_ID'],
): Promise<EmployeeEntity | undefined> =>
  (await tx.run(
    ql.SELECT.one.from('clientmgmt.Employees').columns(...(columns as string[])).where({ ID: employeeId }),
  )) as EmployeeEntity | undefined;
