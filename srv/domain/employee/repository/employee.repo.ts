import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { CostCenterEntity, EmployeeEntity, LocationEntity } from '../dto/employee.dto';
import {
  hasRequiredFields,
  isRecord,
  projectEntity,
  selectColumns,
} from '../../cost-center/repository/cost-center.repo';

const ql = cds.ql as typeof cds.ql & {
  UPDATE: typeof cds.ql.UPDATE;
  INSERT: typeof cds.ql.INSERT;
};

export const findEmployeeById = async (
  tx: Transaction,
  employeeId: string,
  columns: (keyof EmployeeEntity)[] = ['ID', 'client_ID'],
): Promise<EmployeeEntity | undefined> => {
  const required: Array<keyof EmployeeEntity> = ['ID', 'client_ID'];
  const selection = selectColumns<EmployeeEntity>(columns, required);
  const row = await tx.run(
    ql.SELECT.one
      .from('clientmgmt.Employees')
      .columns(...(selection as string[]))
      .where({ ID: employeeId}),
  );

  if (!isRecord(row) || !hasRequiredFields<EmployeeEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<EmployeeEntity>(row, selection);
};

export const findEmployeeByEmployeeId = async (
  tx: Transaction,
  clientId: string,
  employeeIdentifier: string,
  excludeUuid?: string,
): Promise<Pick<EmployeeEntity, 'ID' | 'employeeId'> | undefined> => {
  const whereClause: Record<string, unknown> = {
    employeeId: employeeIdentifier,
    client_ID: clientId,
  };

  if (excludeUuid) {
    whereClause.ID = { '!=': excludeUuid };
  }

  return (await tx.run(
    ql.SELECT.one
      .from('clientmgmt.Employees')
      .columns('ID', 'employeeId')
      .where(whereClause),
  )) as Pick<EmployeeEntity, 'ID' | 'employeeId'> | undefined;
};

export const findEmployeeIdCounter = async (
  tx: Transaction,
  clientId: string,
): Promise<{ lastCounter?: number } | undefined> =>
  (await tx.run(
    ql.SELECT.one
      .from('clientmgmt.EmployeeIdCounters')
      .columns('lastCounter')
      .where({ client_ID: clientId }),
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
    ql.INSERT.into('clientmgmt.EmployeeIdCounters').entries({
      client_ID: clientId,
      lastCounter: counter,
      }),
  );
};

type CostCenterRequiredFields = Extract<keyof CostCenterEntity, 'ID' | 'client_ID'>;

export const findCostCenterById = async <K extends keyof CostCenterEntity = 'responsible_ID'>(
  tx: Transaction,
  costCenterId: string,
  columns?: K[],
): Promise<Pick<CostCenterEntity, K | CostCenterRequiredFields> | undefined> => {
  const required: CostCenterRequiredFields[] = ['ID', 'client_ID'];
  const requested = columns ?? (['responsible_ID'] as K[]);
  const selection = selectColumns<CostCenterEntity>(requested, required) as Array<
    K | CostCenterRequiredFields
  >;

  const row = await tx.run(
    ql.SELECT.one
      .from('clientmgmt.CostCenters')
      .columns(...(selection as string[]))
      .where({ ID: costCenterId}),
  );

  if (!isRecord(row) || !hasRequiredFields<CostCenterEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<Pick<CostCenterEntity, K | CostCenterRequiredFields>>(row, selection);
};

type LocationRequiredFields = Extract<keyof LocationEntity, 'ID' | 'client_ID'>;

export const findLocationById = async <K extends keyof LocationEntity = 'ID' | 'client_ID'>(
  tx: Transaction,
  locationId: string,
  columns?: K[],
): Promise<Pick<LocationEntity, K | LocationRequiredFields> | undefined> => {
  const required: LocationRequiredFields[] = ['ID', 'client_ID'];
  const requested = columns ?? (['ID', 'client_ID'] as K[]);
  const selection = selectColumns<LocationEntity>(requested, required) as Array<
    K | LocationRequiredFields
  >;

  const row = await tx.run(
    ql.SELECT.one
      .from('clientmgmt.Locations')
      .columns(...(selection as string[]))
      .where({ ID: locationId}),
  );

  if (!isRecord(row) || !hasRequiredFields<LocationEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<Pick<LocationEntity, K | LocationRequiredFields>>(row, selection);
};

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
      .where({ ...whereClause }),
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
        phoneNumber: null,
        positionLevel: null,
        status: 'inactive',
        anonymizedAt: new Date().toISOString(),
      })
      .where({ ID: employeeId }),
  );
};

