import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../dto/employee.dto';

const ql = cds.ql as typeof cds.ql & {
  UPDATE: typeof cds.ql.UPDATE;
  INSERT: typeof cds.ql.INSERT;
};

export const findEmployeeById = async (
  tx: Transaction,
  employeeId: string,
  columns: (keyof EmployeeEntity)[] = ['ID', 'client_ID'],
): Promise<EmployeeEntity | undefined> =>
  (await tx.run(
    ql.SELECT.one
      .from('clientmgmt.Employees')
      .columns(...(columns as string[]))
      .where({ ID: employeeId }),
  )) as EmployeeEntity | undefined;

export const findEmployeeByEmployeeId = async (
  tx: Transaction,
  clientId: string,
  employeeIdentifier: string,
): Promise<EmployeeEntity | undefined> =>
  (await tx.run(
    ql.SELECT.one
      .from('clientmgmt.Employees')
      .columns('ID')
      .where({ employeeId: employeeIdentifier, client_ID: clientId }),
  )) as EmployeeEntity | undefined;

export const findEmployeeIdCounter = async (
  tx: Transaction,
  clientId: string,
): Promise<{ lastCounter?: number } | undefined> =>
  (await tx.run(
    ql.SELECT.one.from('clientmgmt.EmployeeIdCounters').columns('lastCounter').where({ client_ID: clientId }),
  )) as { lastCounter?: number } | undefined;

export const findEmployeeIdCounterForUpdate = async (
  tx: Transaction,
  clientId: string,
): Promise<{ lastCounter?: number } | undefined> =>
  (await tx.run(
    withForUpdate(
      ql.SELECT.one
        .from('clientmgmt.EmployeeIdCounters')
        .columns('lastCounter')
        .where({ client_ID: clientId }) as unknown as Record<string, unknown>,
    ),
  )) as { lastCounter?: number } | undefined;

export const updateEmployeeIdCounter = async (
  tx: Transaction,
  clientId: string,
  nextCounter: number,
): Promise<void> => {
  await tx.run(
    ql.UPDATE('clientmgmt.EmployeeIdCounters')
      .set({ lastCounter: nextCounter })
      .where({ client_ID: clientId }),
  );
};

export const insertEmployeeIdCounter = async (
  tx: Transaction,
  clientId: string,
  counter: number,
): Promise<void> => {
  await tx.run(
    ql.INSERT.into('clientmgmt.EmployeeIdCounters').entries({ client_ID: clientId, lastCounter: counter }),
  );
};

export const findCostCenterById = async (
  tx: Transaction,
  costCenterId: string,
  columns: (keyof CostCenterEntity)[] = ['ID', 'client_ID', 'responsible_ID'],
): Promise<Partial<CostCenterEntity> | undefined> =>
  (await tx.run(
    ql.SELECT.one
      .from('clientmgmt.CostCenters')
      .columns(...(columns as string[]))
      .where({ ID: costCenterId }),
  )) as Partial<CostCenterEntity> | undefined;

export const withForUpdate = <T extends object>(query: T): T => {
  const forUpdate = (query as T & { forUpdate?: () => T }).forUpdate;
  if (typeof forUpdate === 'function') {
    return forUpdate.call(query);
  }
  return query;
};

export const listEmployeesForAnonymization = async (
  tx: Transaction,
  whereClause: Record<string, unknown>,
): Promise<Array<Pick<EmployeeEntity, 'ID' | 'employeeId'>>> =>
  (await tx.run(
    ql.SELECT.from('clientmgmt.Employees')
      .columns('ID', 'employeeId')
      .where(whereClause),
  )) as Array<Pick<EmployeeEntity, 'ID' | 'employeeId'>>;

export const anonymizeEmployeeRecord = async (
  tx: Transaction,
  employeeId: string,
  email: string,
  placeholder: string,
): Promise<void> => {
  await tx.run(
    ql.UPDATE('clientmgmt.Employees')
      .set({
        firstName: placeholder,
        lastName: placeholder,
        email,
        location: null,
        positionLevel: null,
        status: 'inactive',
      })
      .where({ ID: employeeId }),
  );
};
