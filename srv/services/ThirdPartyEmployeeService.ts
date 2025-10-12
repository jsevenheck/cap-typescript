import cds from '@sap/cds';

interface EmployeeRow {
  ID: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  client?: {
    ID?: string;
    companyId?: string;
    name?: string;
  };
  costCenter?: {
    ID?: string;
    code?: string;
    name?: string;
  } | null;
  manager?: {
    ID?: string;
    employeeId?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
  } | null;
}

export interface ThirdPartyEmployeeSummary {
  id: string;
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  client: {
    id: string | null;
    companyId: string | null;
    name: string | null;
  };
  costCenter: {
    id: string | null;
    code: string | null;
    name: string | null;
  } | null;
  manager: {
    id: string | null;
    employeeId: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
  } | null;
}

let cachedDb: cds.Service | undefined;

const getDb = async (): Promise<cds.Service> => {
  if (cachedDb) {
    return cachedDb;
  }
  const db = (cds as any).db ?? (await cds.connect.to('db'));
  cachedDb = db;
  return db;
};

const mapEmployee = (row: EmployeeRow): ThirdPartyEmployeeSummary => ({
  id: row.ID,
  employeeId: row.employeeId,
  firstName: row.firstName,
  lastName: row.lastName,
  email: row.email,
  client: {
    id: row.client?.ID ?? null,
    companyId: row.client?.companyId ?? null,
    name: row.client?.name ?? null,
  },
  costCenter: row.costCenter
    ? {
        id: row.costCenter.ID ?? null,
        code: row.costCenter.code ?? null,
        name: row.costCenter.name ?? null,
      }
    : null,
  manager: row.manager
    ? {
        id: row.manager.ID ?? null,
        employeeId: row.manager.employeeId ?? null,
        firstName: row.manager.firstName ?? null,
        lastName: row.manager.lastName ?? null,
        email: row.manager.email ?? null,
      }
    : null,
});

export const listActiveEmployeesForThirdParty = async (): Promise<ThirdPartyEmployeeSummary[]> => {
  const db = await getDb();
  const { SELECT } = cds.ql;

  const rows = (await db.run(
    SELECT.from('clientmgmt.Employees')
      .columns(
        'ID',
        'employeeId',
        'firstName',
        'lastName',
        'email',
        { client: ['ID', 'companyId', 'name'] },
        { costCenter: ['ID', 'code', 'name'] },
        { manager: ['ID', 'employeeId', 'firstName', 'lastName', 'email'] },
      )
      .where({ status: 'active' })
      .orderBy('lastName', 'firstName'),
  )) as EmployeeRow[];

  return rows.map(mapEmployee);
};

