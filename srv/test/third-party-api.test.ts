import path from 'node:path';
import { randomUUID } from 'node:crypto';
import cds from '@sap/cds';

const cap = cds.test(path.join(__dirname, '..'));

const http = cap as unknown as {
  get: <T = unknown>(
    url: string,
    config?: Record<string, unknown>,
  ) => Promise<{ status: number; data: T; headers: Record<string, string> }>;
};

const INSERT = (cds.ql as any).INSERT as any;
const DELETE = (cds.ql as any).DELETE as any;

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

let db: any;

const insertedEmployees: string[] = [];
const insertedCostCenters: string[] = [];

const insertEmployee = async (entry: Record<string, unknown>): Promise<void> => {
  insertedEmployees.push(entry.ID as string);
  await db.run(INSERT.into('clientmgmt.Employees').entries(entry));
};

const insertCostCenter = async (entry: Record<string, unknown>): Promise<void> => {
  insertedCostCenters.push(entry.ID as string);
  await db.run(INSERT.into('clientmgmt.CostCenters').entries(entry));
};

beforeAll(async () => {
  db = await cds.connect.to('db');
});

afterEach(async () => {
  for (const id of insertedEmployees.splice(0)) {
    await db.run(DELETE.from('clientmgmt.Employees').where({ ID: id }));
  }
  for (const id of insertedCostCenters.splice(0)) {
    await db.run(DELETE.from('clientmgmt.CostCenters').where({ ID: id }));
  }
});

describe('Third-party active employees API', () => {
  it('returns active employees enriched with manager and cost center data', async () => {
    const managerId = randomUUID();
    await insertEmployee({
      ID: managerId,
      employeeId: 'TPMANAGER1',
      firstName: 'Mary',
      lastName: 'Manager',
      email: 'mary.manager@example.com',
      entryDate: '2020-01-01',
      status: 'active',
      client_ID: CLIENT_ID,
    });

    const costCenterId = randomUUID();
    await insertCostCenter({
      ID: costCenterId,
      code: 'RND-100',
      name: 'Research & Development',
      client_ID: CLIENT_ID,
      responsible_ID: managerId,
    });

    await insertEmployee({
      ID: randomUUID(),
      employeeId: 'TPACTIVE1',
      firstName: 'April',
      lastName: 'Active',
      email: 'april.active@example.com',
      entryDate: '2021-06-15',
      status: 'active',
      client_ID: CLIENT_ID,
      manager_ID: managerId,
      costCenter_ID: costCenterId,
    });

    await insertEmployee({
      ID: randomUUID(),
      employeeId: 'TPINACTIVE1',
      firstName: 'Ian',
      lastName: 'Inactive',
      email: 'ian.inactive@example.com',
      entryDate: '2022-03-10',
      status: 'inactive',
      client_ID: CLIENT_ID,
      manager_ID: managerId,
    });

    const response = await http.get<{
      value: Array<{
        employeeId: string;
        manager: { id: string | null; firstName: string | null; lastName: string | null } | null;
        costCenter: { id: string | null; code: string | null; name: string | null } | null;
      }>;
    }>('/api/external/active-employees');

    expect(response.status).toBe(200);
    expect(Array.isArray(response.data.value)).toBe(true);

    const employees = response.data.value;
    expect(employees.some((employee) => employee.employeeId === 'TPINACTIVE1')).toBe(false);

    const activeRecord = employees.find((employee) => employee.employeeId === 'TPACTIVE1');
    expect(activeRecord).toBeDefined();
    expect(activeRecord?.manager).toEqual(
      expect.objectContaining({
        id: managerId,
        firstName: 'Mary',
        lastName: 'Manager',
      }),
    );
    expect(activeRecord?.costCenter).toEqual(
      expect.objectContaining({
        id: costCenterId,
        code: 'RND-100',
        name: 'Research & Development',
      }),
    );
  });
});

