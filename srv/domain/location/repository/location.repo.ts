import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type { ClientEntity, LocationEntity } from '../dto/location.dto';

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

export const findLocationById = async (
  tx: Transaction,
  id: string,
  columns: (keyof LocationEntity)[] = ['ID', 'client_ID'],
): Promise<LocationEntity | undefined> => {
  const required: Array<keyof LocationEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one.from('clientmgmt.Locations').columns(...(selection as string[])).where({ ID: id }),
  );

  if (!isRecord(row) || !hasRequiredFields<LocationEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<LocationEntity>(row, selection);
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

export const findEmployeesByLocation = async (
  tx: Transaction,
  locationId: string,
): Promise<number> => {
  const result = await tx.run(
    ql.SELECT.from('clientmgmt.Employees').columns('count(*) as count').where({ location_ID: locationId }),
  );

  if (Array.isArray(result) && result.length > 0 && isRecord(result[0])) {
    return Number(result[0].count) || 0;
  }

  return 0;
};
