import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../dto/cost-center.dto';

const ql = cds.ql as typeof cds.ql;

export const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object';

export const selectColumns = <T>(
  requested: (keyof T)[],
  required: (keyof T)[],
): (keyof T)[] => Array.from(new Set<keyof T>([...requested, ...required]));

export const projectEntity = <T>(
  record: Record<string, unknown>,
  columns: (keyof T)[],
): T => {
  const projection: Record<string, unknown> = {};
  for (const column of columns) {
    if (column in record) {
      projection[column as string] = record[column as string];
    }
  }
  return projection as T;
};

export const hasRequiredFields = <T>(
  record: Record<string, unknown>,
  required: (keyof T)[],
): boolean =>
  required.every((field) => {
    const value = record[field as string];
    return value !== undefined && value !== null;
  });

export const findCostCenterById = async (
  tx: Transaction,
  id: string,
  columns: (keyof CostCenterEntity)[] = ['ID', 'client_ID'],
): Promise<CostCenterEntity | undefined> => {
  const required: Array<keyof CostCenterEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one.from('clientmgmt.CostCenters').columns(...(selection as string[])).where({ ID: id }),
  );

  if (!isRecord(row) || !hasRequiredFields<CostCenterEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<CostCenterEntity>(row, selection);
};

export const findClientById = async (
  tx: Transaction,
  clientId: string,
  columns: (keyof ClientEntity)[] = ['ID', 'companyId'],
): Promise<ClientEntity | undefined> => {
  const required: Array<keyof ClientEntity> = ['ID', 'companyId'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one.from('clientmgmt.Clients').columns(...(selection as string[])).where({ ID: clientId }),
  );

  if (!isRecord(row) || !hasRequiredFields<ClientEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<ClientEntity>(row, selection);
};

export const findEmployeeById = async (
  tx: Transaction,
  employeeId: string,
  columns: (keyof EmployeeEntity)[] = ['client_ID'],
): Promise<EmployeeEntity | undefined> => {
  const required: Array<keyof EmployeeEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one.from('clientmgmt.Employees').columns(...(selection as string[])).where({ ID: employeeId }),
  );

  if (!isRecord(row) || !hasRequiredFields<EmployeeEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<EmployeeEntity>(row, selection);
};

export const findCostCenterByCode = async (
  tx: Transaction,
  clientId: string,
  code: string,
  excludeId?: string,
): Promise<CostCenterEntity | undefined> => {
  const required: Array<keyof CostCenterEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(['ID', 'client_ID', 'code'], required);

  const whereClause: Record<string, unknown> = { client_ID: clientId, code };
  if (excludeId) {
    whereClause['ID !='] = excludeId;
  }

  const row = await tx.run(
    ql.SELECT.one.from('clientmgmt.CostCenters').columns(...(selection as string[])).where(whereClause),
  );

  if (!isRecord(row) || !hasRequiredFields<CostCenterEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<CostCenterEntity>(row, selection);
};

export const findEmployeesByCostCenter = async (
  tx: Transaction,
  costCenterId: string,
): Promise<number> => {
  const result = await tx.run(
    ql.SELECT.from('clientmgmt.Employees').columns('count(*) as count').where({ costCenter_ID: costCenterId }),
  );

  if (Array.isArray(result) && result.length > 0 && isRecord(result[0])) {
    return Number(result[0].count) || 0;
  }

  return 0;
};
