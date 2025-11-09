import cds from '@sap/cds';
import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { createServiceError } from '../../../shared/utils/errors';

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

  // Validate selected fields against allowed fields
  const validFields = new Set(DEFAULT_SELECT_FIELDS);
  const requestedFields = new Set(fields);

  for (const field of requestedFields) {
    if (!validFields.has(field)) {
      throw createServiceError(400, `Invalid field in $select: ${field}`);
    }
  }

  return requestedFields;
};

const MAX_TOP_LIMIT = 10000;

const parseNonNegativeInteger = (value: unknown, max?: number): number | undefined => {
  if (value === undefined) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return undefined;
  }

  if (max !== undefined && parsed > max) {
    throw createServiceError(400, `Value exceeds maximum allowed limit of ${max}`);
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

const EMPLOYEE_ENTITY_CANDIDATES = ['ClientService.Employees', 'clientmgmt.Employees'] as const;

type EmployeeEntityInfo = {
  name: string;
  definition: EmployeeEntityDefinition;
};

const resolveEmployeeEntity = (): EmployeeEntityInfo | undefined => {
  const cdsAny = cds as any;
  const model = cdsAny.model as { definitions?: Record<string, EmployeeEntityDefinition> } | undefined;

  if (!model?.definitions) {
    return undefined;
  }

  for (const candidate of EMPLOYEE_ENTITY_CANDIDATES) {
    const definition = model.definitions[candidate];
    if (definition) {
      return { name: candidate, definition };
    }
  }

  return undefined;
};

const executeActiveEmployeesQuery = async (
  req: Request,
  selectFields: Set<string> | undefined,
  top: number | undefined,
  skip: number | undefined
): Promise<ActiveEmployee[]> => {
  const entityInfo = resolveEmployeeEntity();
  if (!entityInfo) {
    throw createServiceError(500, 'Employees entity definition not found.');
  }

  const query = cds.ql.SELECT.from(entityInfo.name).columns(
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

  const elements = entityInfo.definition.elements ?? {};
  if ('isActive' in elements) {
    (query as any).where({ isActive: true });
  } else {
    const today = new Date().toISOString().slice(0, 10);

    const predicates: any[] = [
      { entryDate: { '<=': today } },
      { or: [{ exitDate: null }, { exitDate: { '>=': today } }] },
    ];

    // Directly use 'status' field as defined in schema
    if ('status' in elements) {
      predicates.push({ status: { '=': 'active' } });
    }

    (query as any).where({ and: predicates });
  }

  if (top !== undefined) {
    (query as any).limit(top, skip ?? 0);
  }

  // Cast to any since this is an Express handler that uses CAP transaction API
  // At runtime, the Express request is augmented by CAP middleware with necessary properties
  const transaction = cds.transaction(req as any);
  if (!transaction || typeof transaction.run !== 'function') {
    throw createServiceError(500, 'Failed to acquire transaction for request.');
  }

  const rows = (await transaction.run(query)) as EmployeeRow[];
  const fieldsToApply = selectFields ?? new Set(DEFAULT_SELECT_FIELDS);
  return rows.map((row) => shapeEmployee(row, fieldsToApply));
};

const handleActiveEmployees = async (req: Request, res: Response): Promise<void> => {
  const selectFields = parseSelect(req.query.$select);
  const top = parseNonNegativeInteger(req.query.$top, MAX_TOP_LIMIT);
  const skip = parseNonNegativeInteger(req.query.$skip);

  if (skip !== undefined && top === undefined) {
    res.status(400).json({ error: '$top parameter is required when using $skip' });
    return;
  }

  const employees = await executeActiveEmployeesQuery(req, selectFields, top, skip);

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
};

export const activeEmployeesHandler: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
  handleActiveEmployees(req, res).catch((error) => {
    if (!res.headersSent) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      res.status(500).json({ error: 'internal_error', message });
    }

    if (typeof next === 'function') {
      next(error);
    }
  });
};

export default activeEmployeesHandler;
