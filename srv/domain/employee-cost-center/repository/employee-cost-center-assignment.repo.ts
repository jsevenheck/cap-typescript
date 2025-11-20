import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import type {
  EmployeeCostCenterAssignmentEntity,
  EmployeeEntity,
  CostCenterEntity,
  ClientEntity,
} from '../dto/employee-cost-center-assignment.dto';

export type { EmployeeEntity, CostCenterEntity };

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

export const findAssignmentById = async (
  tx: Transaction,
  id: string,
  columns: (keyof EmployeeCostCenterAssignmentEntity)[] = ['ID', 'client_ID'],
): Promise<EmployeeCostCenterAssignmentEntity | undefined> => {
  const required: Array<keyof EmployeeCostCenterAssignmentEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one
      .from('clientmgmt.EmployeeCostCenterAssignments')
      .columns(...(selection as string[]))
      .where({ ID: id }),
  );

  if (!isRecord(row) || !hasRequiredFields<EmployeeCostCenterAssignmentEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<EmployeeCostCenterAssignmentEntity>(row, selection);
};

export const findEmployeeById = async (
  tx: Transaction,
  employeeId: string,
  columns: (keyof EmployeeEntity)[] = ['ID', 'client_ID'],
): Promise<EmployeeEntity | undefined> => {
  const required: Array<keyof EmployeeEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one
      .from('clientmgmt.Employees')
      .columns(...(selection as string[]))
      .where({ ID: employeeId }),
  );

  if (!isRecord(row) || !hasRequiredFields<EmployeeEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<EmployeeEntity>(row, selection);
};

export const findCostCenterById = async (
  tx: Transaction,
  costCenterId: string,
  columns: (keyof CostCenterEntity)[] = ['ID', 'client_ID'],
): Promise<CostCenterEntity | undefined> => {
  const required: Array<keyof CostCenterEntity> = ['ID', 'client_ID'];
  const selection = selectColumns(columns, required);
  const row = await tx.run(
    ql.SELECT.one
      .from('clientmgmt.CostCenters')
      .columns(...(selection as string[]))
      .where({ ID: costCenterId }),
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
    ql.SELECT.one
      .from('clientmgmt.Clients')
      .columns(...(selection as string[]))
      .where({ ID: clientId }),
  );

  if (!isRecord(row) || !hasRequiredFields<ClientEntity>(row, required)) {
    return undefined;
  }

  return projectEntity<ClientEntity>(row, selection);
};

/**
 * Find overlapping assignments for a given employee within a date range
 * Used to validate that non-manager employees don't have overlapping cost center assignments
 */
export const findOverlappingAssignments = async (
  tx: Transaction,
  employeeId: string,
  validFrom: string,
  validTo: string | null | undefined,
  excludeId?: string,
): Promise<EmployeeCostCenterAssignmentEntity[]> => {
  const whereClause: Record<string, unknown> = {
    employee_ID: employeeId,
  };

  if (excludeId) {
    whereClause.ID = { '!=': excludeId };
  }

  // Query for overlapping date ranges:
  // An assignment overlaps if:
  // - Its validFrom is before the new validTo (or new validTo is null)
  // - Its validTo is after the new validFrom (or it has no validTo)
  const rows = await tx.run(
    ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
      .columns('ID', 'employee_ID', 'costCenter_ID', 'validFrom', 'validTo', 'isResponsible', 'client_ID')
      .where(whereClause),
  );

  if (!Array.isArray(rows)) {
    return [];
  }

  // Filter overlapping assignments in memory to handle null validTo properly
  const filteredRows = rows.filter((row) => {
    if (!isRecord(row)) return false;

    const existingFrom = row.validFrom as string | Date;
    const existingTo = row.validTo as string | Date | null | undefined;

    // Check if ranges overlap
    // Range 1: [validFrom, validTo]
    // Range 2: [existingFrom, existingTo]
    // Overlap if: validFrom <= existingTo (or existingTo is null) AND existingFrom <= validTo (or validTo is null)

    // Normalize dates to timestamps for comparison to handle both Date objects and strings
    const existingFromTime = new Date(existingFrom).getTime();
    const validFromTime = new Date(validFrom).getTime();
    const validToTime = validTo ? new Date(validTo).getTime() : null;
    const existingToTime = existingTo ? new Date(existingTo).getTime() : null;

    const startsBeforeNewEnds = validToTime !== null ? existingFromTime <= validToTime : true;
    const endsAfterNewStarts = existingToTime !== null ? existingToTime >= validFromTime : true;

    return startsBeforeNewEnds && endsAfterNewStarts;
  });

  return filteredRows.map((row) =>
    projectEntity<EmployeeCostCenterAssignmentEntity>(row as Record<string, unknown>, [
      'ID',
      'employee_ID',
      'costCenter_ID',
      'validFrom',
      'validTo',
      'isResponsible',
      'client_ID',
    ]),
  );
};

/**
 * Get all assignments for a specific employee
 */
export const findAssignmentsByEmployee = async (
  tx: Transaction,
  employeeId: string,
): Promise<EmployeeCostCenterAssignmentEntity[]> => {
  const query = ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
    .columns('ID', 'employee_ID', 'costCenter_ID', 'validFrom', 'validTo', 'isResponsible', 'client_ID')
    .where({ employee_ID: employeeId });

  (query as any).orderBy('validFrom');

  const result = await tx.run(query);
  const rows = result as unknown[];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter(isRecord)
    .map((row) =>
      projectEntity<EmployeeCostCenterAssignmentEntity>(row, [
        'ID',
        'employee_ID',
        'costCenter_ID',
        'validFrom',
        'validTo',
        'isResponsible',
        'client_ID',
      ]),
    );
};

/**
 * Get all employees responsible for a specific cost center
 */
export const findResponsibleEmployees = async (
  tx: Transaction,
  costCenterId: string,
): Promise<EmployeeCostCenterAssignmentEntity[]> => {
  const query = ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
    .columns('ID', 'employee_ID', 'costCenter_ID', 'validFrom', 'validTo', 'isResponsible', 'client_ID')
    .where({ costCenter_ID: costCenterId, isResponsible: true });

  (query as any).orderBy('validFrom');

  const result = await tx.run(query);
  const rows = result as unknown[];

  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .filter(isRecord)
    .map((row) =>
      projectEntity<EmployeeCostCenterAssignmentEntity>(row, [
        'ID',
        'employee_ID',
        'costCenter_ID',
        'validFrom',
        'validTo',
        'isResponsible',
        'client_ID',
      ]),
    );
};
