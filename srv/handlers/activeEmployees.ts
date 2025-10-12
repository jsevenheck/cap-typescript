import cds from '@sap/cds';
import type { RequestHandler } from 'express';

type EmployeeEntityDefinition = {
  elements?: Record<string, unknown>;
};

type EmployeeRow = {
  ID: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  entryDate: string;
  exitDate?: string | null;
  costCenter?: {
    ID: string;
    code: string;
    name: string;
  } | null;
  manager?: {
    ID: string;
    employeeId: string;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
  status?: string | null;
};

type ActiveEmployee = {
  ID?: string;
  externalId?: string | null;
  firstName?: string;
  lastName?: string;
  email?: string;
  hireDate?: string;
  terminationDate?: string | null;
  costCenter?: {
    ID: string;
    code: string;
    name: string;
  } | null;
  manager?: {
    ID: string;
    externalId: string | null;
    firstName: string;
    lastName: string;
    email: string;
  } | null;
};

const DEFAULT_SELECT_FIELDS = [
  'ID',
  'externalId',
  'firstName',
  'lastName',
  'email',
  'hireDate',
  'terminationDate',
  'costCenter',
  'manager',
];

const parseSelect = (value: unknown): Set<string> | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }

  const fields = value
    .split(',')
    .map((field) => field.trim())
    .filter((field) => field.length > 0);

  if (fields.length === 0) {
    return undefined;
  }

  return new Set(fields);
};

const parseNonNegativeInteger = (value: unknown): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  return parsed;
};

const shapeEmployee = (row: EmployeeRow, selectFields?: Set<string>): ActiveEmployee => {
  const shouldInclude = (field: string): boolean => !selectFields || selectFields.has(field);
  const shaped: ActiveEmployee = {};

  if (shouldInclude('ID')) {
    shaped.ID = row.ID;
  }

  if (shouldInclude('externalId')) {
    shaped.externalId = row.employeeId ?? null;
  }

  if (shouldInclude('firstName')) {
    shaped.firstName = row.firstName;
  }

  if (shouldInclude('lastName')) {
    shaped.lastName = row.lastName;
  }

  if (shouldInclude('email')) {
    shaped.email = row.email;
  }

  if (shouldInclude('hireDate')) {
    shaped.hireDate = row.entryDate;
  }

  if (shouldInclude('terminationDate')) {
    shaped.terminationDate = row.exitDate ?? null;
  }

  if (shouldInclude('costCenter')) {
    shaped.costCenter = row.costCenter
      ? {
          ID: row.costCenter.ID,
          code: row.costCenter.code,
          name: row.costCenter.name,
        }
      : null;
  }

  if (shouldInclude('manager')) {
    shaped.manager = row.manager
      ? {
          ID: row.manager.ID,
          externalId: row.manager.employeeId ?? null,
          firstName: row.manager.firstName,
          lastName: row.manager.lastName,
          email: row.manager.email,
        }
      : null;
  }

  return shaped;
};

const EMPLOYEES_ENTITY_NAME = 'clientmgmt.Employees';

const resolveEmployeeDefinition = (): EmployeeEntityDefinition | undefined => {
  const cdsAny = cds as any;
  const namespaceEntities = typeof cdsAny.entities === 'function' ? cdsAny.entities('clientmgmt') : undefined;
  const employeesFromNamespace = namespaceEntities?.Employees as EmployeeEntityDefinition | undefined;

  if (employeesFromNamespace) {
    return employeesFromNamespace;
  }

  const model = cdsAny.model as { definitions?: Record<string, EmployeeEntityDefinition> } | undefined;
  return model?.definitions?.[EMPLOYEES_ENTITY_NAME];
};

export const activeEmployeesHandler: RequestHandler = async (req, res) => {
  try {
    const employeeDefinition = resolveEmployeeDefinition();
    if (!employeeDefinition) {
      throw new Error('Employees entity definition not found.');
    }

    const selectFields = parseSelect(req.query.$select);
    const top = parseNonNegativeInteger(req.query.$top);
    const skip = parseNonNegativeInteger(req.query.$skip);

    const query = cds.ql.SELECT.from(EMPLOYEES_ENTITY_NAME).columns(
      'ID',
      'employeeId',
      'firstName',
      'lastName',
      'email',
      'entryDate',
      'exitDate',
      { ref: ['costCenter'], expand: ['ID', 'code', 'name'] } as any,
      { ref: ['manager'], expand: ['ID', 'employeeId', 'firstName', 'lastName', 'email'] } as any,
      'status'
    );

    const elements = employeeDefinition.elements ?? {};
    if ('isActive' in elements) {
      (query as any).where({ isActive: true });
    } else {
      const today = new Date().toISOString().slice(0, 10);
      const parts = [
        `entryDate <= '${today}'`,
        `(exitDate IS NULL OR exitDate >= '${today}')`,
      ];

      if ('status' in elements) {
        parts.push("(status = 'active' OR status IS NULL)");
      }

      (query as any).where(parts.join(' AND '));
    }

    if (top !== undefined || skip !== undefined) {
      const limit = top ?? Number.MAX_SAFE_INTEGER;
      (query as any).limit(limit, skip ?? 0);
    }

    const rows = (await (cds as any).run(query)) as EmployeeRow[];
    const fieldsToApply = selectFields ?? new Set(DEFAULT_SELECT_FIELDS);

    const employees = rows.map((row) => shapeEmployee(row, fieldsToApply));

    if (!selectFields) {
      res.json(employees);
      return;
    }

    res.json(
      employees.map((employee) => {
        const filteredEntries = Object.entries(employee).filter(([key]) => selectFields.has(key));
        return Object.fromEntries(filteredEntries);
      })
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unexpected error';
    res.status(500).json({ error: 'internal_error', message });
  }
};

export default activeEmployeesHandler;
