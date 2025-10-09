jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import cds from '@sap/cds';
import fetch, { type RequestInit } from 'node-fetch';

import { cleanupOutbox, processOutbox } from '../server';

const cap = cds.test(path.join(__dirname, '..'));
const encoded = Buffer.from('dev:dev').toString('base64');
const authConfig = {
  auth: { username: 'dev', password: 'dev' },
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Basic ${encoded}`,
    'x-cds-roles': 'HRViewer HREditor HRAdmin',
  },
} as const;

jest.setTimeout(60000);

const http = cap as unknown as {
  get: <T = unknown>(
    url: string,
    config?: Record<string, unknown>,
  ) => Promise<{ status: number; data: T; headers: Record<string, string> }>;
  post: <T = unknown>(
    url: string,
    data?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<{ status: number; data: T; headers: Record<string, string> }>;
  patch: <T = unknown>(
    url: string,
    data?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<{ status: number; data: T; headers: Record<string, string> }>;
};

const mockedFetch = fetch as jest.MockedFunction<typeof fetch>;
const { SELECT } = cds.ql;
const INSERT = (cds.ql as any).INSERT as any;
const DELETE = (cds.ql as any).DELETE as any;
const UPDATE = (cds.ql as any).UPDATE as any;

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const BETA_CLIENT_ID = '22222222-2222-2222-2222-222222222222';

let db: any;

beforeAll(async () => {
  db = await cds.connect.to('db');
});

const captureErrorStatus = async (promise: Promise<unknown>): Promise<number> => {
  try {
    await promise;
    return 0;
  } catch (error: unknown) {
    if (error && typeof error === 'object' && 'response' in error) {
      const response = (error as { response?: { status?: number } }).response;
      return response?.status ?? 0;
    }
    return 0;
  }
};

afterEach(async () => {
  mockedFetch.mockReset();
  delete process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT;
  delete process.env.THIRD_PARTY_EMPLOYEE_SECRET;
  delete process.env.OUTBOX_CLAIM_TTL_MS;
  delete process.env.OUTBOX_DISPATCH_INTERVAL_MS;
  delete process.env.OUTBOX_MAX_ATTEMPTS;
  delete process.env.OUTBOX_BASE_BACKOFF_MS;
  delete process.env.OUTBOX_CONCURRENCY;
  delete process.env.OUTBOX_RETENTION_HOURS;
  delete process.env.OUTBOX_CLEANUP_INTERVAL_MS;
  delete process.env.OUTBOX_CLEANUP_CRON;
  if (db) {
    await db.run(DELETE.from('clientmgmt.EmployeeNotificationOutbox'));
  }
});

describe('ClientService (HTTP)', () => {
  it('serves seeded clients', async () => {
    const { status, data } = await http.get<{ value: Array<{ companyId: string; name: string }> }>(
      '/odata/v4/clients/Clients?$select=companyId,name',
      authConfig,
    );

    expect(status).toBe(200);

    const rawClients = (data as { value?: Array<{ companyId: string; name: string }> }).value ?? data;
    const clients = Array.isArray(rawClients)
      ? (rawClients as Array<{ companyId: string; name: string }>)
      : [];

    expect(clients).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ companyId: 'COMP-001', name: 'Alpha Industries' }),
      ]),
    );
  });

  it('auto-generates sequential employee IDs', async () => {
    const payload = {
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      entryDate: '2024-01-01',
      client_ID: CLIENT_ID,
    };

    const created = await http.post<{ employeeId: string }>(
      '/odata/v4/clients/Employees',
      payload,
      authConfig,
    );
    expect(created.status).toBe(201);
    expect(created.data.employeeId).toMatch(/^COMP001[A-F0-9][0-9]{6}$/);

    const second = await http.post<{ employeeId: string }>(
      '/odata/v4/clients/Employees',
      {
        ...payload,
        email: 'john.doe@example.com',
        firstName: 'John',
        lastName: 'Smith',
      },
      authConfig,
    );
    expect(second.status).toBe(201);
    expect(second.data.employeeId).not.toBe(created.data.employeeId);
    expect(second.data.employeeId).toMatch(/^COMP001[A-F0-9][0-9]{6}$/);
  });

  it('rejects cost center assignments across clients', async () => {
    const employee = await http.post<{ ID: string }>(
      '/odata/v4/clients/Employees',
      {
        firstName: 'Lara',
        lastName: 'Croft',
        email: 'lara.croft@example.com',
        entryDate: '2024-02-01',
        client_ID: CLIENT_ID,
      },
      authConfig,
    );
    expect(employee.status).toBe(201);

    const invalidStatus = await captureErrorStatus(
      http.post(
        '/odata/v4/clients/CostCenters',
        {
          code: 'cc-001',
          name: 'Operations',
          client_ID: BETA_CLIENT_ID,
          responsible_ID: employee.data.ID,
        },
        authConfig,
      ),
    );

    expect(invalidStatus).toBeGreaterThanOrEqual(400);
  });

  it('enforces ETag concurrency control on employees', async () => {
    const createResponse = await http.post<Record<string, any>>(
      '/odata/v4/clients/Employees',
      {
        firstName: 'Erica',
        lastName: 'Miller',
        email: 'erica.miller@example.com',
        entryDate: '2024-05-01',
        client_ID: CLIENT_ID,
      },
      authConfig,
    );
    expect(createResponse.status).toBe(201);

    const employeeId = (createResponse.data as Record<string, any>).ID as string;
    expect(typeof employeeId).toBe('string');

    const fetched = await http.get<Record<string, any>>(
      `/odata/v4/clients/Employees(${employeeId})`,
      authConfig,
    );
    expect(fetched.status).toBe(200);

    const initialModifiedAt = (fetched.data as Record<string, any>).modifiedAt as string | undefined;
    expect(typeof initialModifiedAt).toBe('string');

    const etag = `"${initialModifiedAt}"`;

    const firstUpdate = await http.patch(
      `/odata/v4/clients/Employees(${employeeId})`,
      { location: 'Berlin' },
      {
        ...authConfig,
        headers: {
          ...authConfig.headers,
          'If-Match': etag,
        },
      },
    );
    expect(firstUpdate.status).toBe(200);

    const conflictStatus = await captureErrorStatus(
      http.patch(
        `/odata/v4/clients/Employees(${employeeId})`,
        { positionLevel: 'L2' },
        {
          ...authConfig,
          headers: {
            ...authConfig.headers,
            'If-Match': etag,
          },
        },
      ),
    );

    expect(conflictStatus).toBe(412);
  });
});


describe('ClientService authorization', () => {
  let service: any;

  const createUser = ({
    id,
    roles,
    companyCodes,
  }: {
    id: string;
    roles: string[];
    companyCodes: string[];
  }) =>
    (cds as any).User({
      id,
      roles,
      attr: { companyCodes, CompanyCode: companyCodes },
    });

  const runAs = async <T>(
    userOptions: { id: string; roles: string[]; companyCodes: string[] },
    handler: (tx: any) => Promise<T>,
  ): Promise<T> => {
    const user = createUser(userOptions);
    return service.tx({ user }, handler);
  };

  beforeAll(async () => {
    service = await cds.connect.to('ClientService');
  });

  it('filters clients by company codes for HR viewer', async () => {
    const clients = await runAs(
      { id: 'viewer', roles: ['HRViewer'], companyCodes: ['COMP-001'] },
      async (tx) =>
        tx.run(
          SELECT.from(tx.entities.Clients).columns('companyId'),
        ),
    );

    const companyIds = (Array.isArray(clients) ? clients : []).map((client: any) => client.companyId);
    expect(companyIds).toContain('COMP-001');
    expect(companyIds).not.toContain('COMP-002');
  });

  it('allows HR admin to access all clients', async () => {
    const clients = await runAs(
      { id: 'admin', roles: ['HRAdmin'], companyCodes: [] },
      async (tx) =>
        tx.run(
          SELECT.from(tx.entities.Clients).columns('companyId'),
        ),
    );

    const companyIds = (Array.isArray(clients) ? clients : []).map((client: any) => client.companyId);
    expect(companyIds).toEqual(expect.arrayContaining(['COMP-001', 'COMP-002']));
  });

  it('accepts IAS CompanyCode attributes exposed via attr function', async () => {
    const user = (cds as any).User({
      id: 'ias-editor-fn',
      roles: ['HREditor'],
      attr(name: string) {
        if (name === 'CompanyCode') {
          return ' comp-002 ';
        }
        return undefined;
      },
    });

    await expect(
      service.tx({ user }, (tx: any) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Ias',
            lastName: 'Function',
            email: 'ias.function@example.com',
            entryDate: '2024-05-01',
            client_ID: BETA_CLIENT_ID,
          }),
        ),
      ),
    ).resolves.not.toThrow();

    await expect(
      service.tx({ user }, (tx: any) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Ias',
            lastName: 'BlockedFn',
            email: 'ias.blocked.fn@example.com',
            entryDate: '2024-05-02',
            client_ID: CLIENT_ID,
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Forbidden') });
  });

  it('accepts IAS CompanyCode attributes provided as array values', async () => {
    const user = (cds as any).User({
      id: 'ias-editor-array',
      roles: ['HREditor'],
      attr: { CompanyCode: ['comp-001'] },
    });

    await expect(
      service.tx({ user }, (tx: any) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Ias',
            lastName: 'Array',
            email: 'ias.array@example.com',
            entryDate: '2024-06-01',
            client_ID: CLIENT_ID,
          }),
        ),
      ),
    ).resolves.not.toThrow();

    await expect(
      service.tx({ user }, (tx: any) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Ias',
            lastName: 'BlockedArray',
            email: 'ias.blocked.array@example.com',
            entryDate: '2024-06-02',
            client_ID: BETA_CLIENT_ID,
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Forbidden') });
  });

  const expectCompanyRestriction = async (companyCodes: string[]) =>
    runAs(
      { id: 'editor', roles: ['HREditor'], companyCodes },
      async (tx) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Unauthorized',
            lastName: 'User',
            email: 'unauth@example.com',
            entryDate: '2024-03-01',
            client_ID: BETA_CLIENT_ID,
          }),
        ),
    ).then(
      () => {
        throw new Error('Expected authorization failure');
      },
      (error) => {
        const status = (error as any).statusCode ?? (error as any).code;
        expect([403, '403']).toContain(status);
        expect((error as Error).message).toContain('Forbidden: company code not assigned');
      },
    );

  it('blocks HR editor writes outside assigned company codes', async () => {
    await expectCompanyRestriction(['COMP-001']);
  });

  it('blocks HR editor writes when assigned invalid company codes', async () => {
    await expectCompanyRestriction(['NOT-REAL']);
  });

  it('blocks HR editor writes when assigned whitespace company codes', async () => {
    await expectCompanyRestriction(['   ']);
  });
});


describe('Employee business rules', () => {
  let service: any;

  const createUser = ({
    id,
    roles,
    companyCodes,
  }: {
    id: string;
    roles: string[];
    companyCodes: string[];
  }) =>
    (cds as any).User({
      id,
      roles,
      attr: { companyCodes, CompanyCode: companyCodes },
    });

  const adminContext = { id: 'rules-admin', roles: ['HRAdmin'], companyCodes: [] as string[] };

  const runAsAdmin = async <T>(handler: (tx: any) => Promise<T>): Promise<T> => {
    const user = createUser(adminContext);
    return service.tx({ user }, handler);
  };

  const createdCostCenterCodes: string[] = [];
  const createdEmployeeEmails: string[] = [];
  const createdClientIds: string[] = [];

  const createEmployeeRecord = async (
    tx: any,
    overrides: Record<string, unknown> = {},
  ): Promise<{
    ID: string;
    email: string;
    employeeId: string;
    modifiedAt: string;
    manager_ID?: string;
    costCenter_ID?: string;
  }> => {
    const email =
      typeof overrides.email === 'string' ? (overrides.email as string) : `validation+${randomUUID()}@example.com`;
    const entry = {
      firstName: 'Test',
      lastName: 'Employee',
      email,
      entryDate: '2024-01-01',
      client_ID: overrides.client_ID ?? CLIENT_ID,
      ...overrides,
    };

    await tx.run(INSERT.into(tx.entities.Employees).entries(entry));
    createdEmployeeEmails.push(email);

    const persisted = (await tx.run(
      SELECT.one
        .from(tx.entities.Employees)
        .columns('ID', 'email', 'employeeId', 'modifiedAt', 'manager_ID', 'costCenter_ID', 'client_ID')
        .where({ email }),
    )) as any;

    return persisted;
  };

  const createCostCenterRecord = async (
    tx: any,
    options: { clientId?: string; responsibleId: string; code?: string; name?: string },
  ): Promise<{ ID: string; code: string }> => {
    const code = options.code ?? `CC-${randomUUID().slice(0, 8)}`;
    await tx.run(
      INSERT.into(tx.entities.CostCenters).entries({
        code,
        name: options.name ?? 'Validation Cost Center',
        client_ID: options.clientId ?? CLIENT_ID,
        responsible_ID: options.responsibleId,
      }),
    );

    const normalizedCode = code.trim().toUpperCase();
    createdCostCenterCodes.push(normalizedCode);

    const persisted = (await tx.run(
      SELECT.one.from(tx.entities.CostCenters).columns('ID', 'code').where({ code: normalizedCode }),
    )) as any;

    return persisted;
  };

  const createClientRecord = async (
    tx: any,
    options: { companyId: string; countryCode?: string; name?: string },
  ): Promise<{ ID: string; companyId: string }> => {
    const clientId = randomUUID();

    await tx.run(
      INSERT.into(tx.entities.Clients).entries({
        ID: clientId,
        companyId: options.companyId,
        name: options.name ?? `Client ${options.companyId}`,
        country_code: options.countryCode ?? 'DE',
      }),
    );

    createdClientIds.push(clientId);

    return { ID: clientId, companyId: options.companyId };
  };

  beforeAll(async () => {
    service = await cds.connect.to('ClientService');
  });

  afterEach(async () => {
    if (!service) {
      return;
    }

    if (!createdCostCenterCodes.length && !createdEmployeeEmails.length && !createdClientIds.length) {
      return;
    }

    if (createdCostCenterCodes.length) {
      const costCenterCodes = createdCostCenterCodes.splice(0, createdCostCenterCodes.length);
      await db.run(DELETE.from('clientmgmt.CostCenters').where({ code: { in: costCenterCodes } }));
    }

    if (createdEmployeeEmails.length) {
      const emails = createdEmployeeEmails.splice(0, createdEmployeeEmails.length);
      await db.run(DELETE.from('clientmgmt.Employees').where({ email: { in: emails } }));
    }

    if (createdClientIds.length) {
      const clientIds = createdClientIds.splice(0, createdClientIds.length);
      await db.run(DELETE.from('clientmgmt.EmployeeIdCounters').where({ client_ID: { in: clientIds } }));
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: { in: clientIds } }));
    }
  });

  it('requires entry date on creation', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Missing',
            lastName: 'Entry',
            email: `validation+${randomUUID()}@example.com`,
            client_ID: CLIENT_ID,
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Entry date is required') });
  });

  it('requires exit dates to be on or after the entry date', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Timing',
            lastName: 'Error',
            email: `validation+${randomUUID()}@example.com`,
            entryDate: '2024-02-01',
            exitDate: '2024-01-01',
            client_ID: CLIENT_ID,
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Exit date must be on or after entry date.') });
  });

  it('requires an exit date when marking an employee inactive', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Inactive',
            lastName: 'WithoutExit',
            email: `validation+${randomUUID()}@example.com`,
            entryDate: '2024-01-01',
            status: 'inactive',
            client_ID: CLIENT_ID,
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Inactive employees must have an exit date.') });
  });

  it('requires inactive status when an exit date is supplied', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Active',
            lastName: 'WithExit',
            email: `validation+${randomUUID()}@example.com`,
            entryDate: '2024-01-01',
            exitDate: '2024-05-01',
            client_ID: CLIENT_ID,
          }),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Employees with an exit date must have status set to inactive.'),
    });
  });

  it('validates exit dates against the persisted entry date during updates', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx);

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ exitDate: '2023-12-31', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Exit date must be on or after entry date.') });
  });

  it('requires exit dates when setting status to inactive on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx);

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ status: 'inactive', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Inactive employees must have an exit date.') });
  });

  it('requires inactive status when assigning an exit date on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx);

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ exitDate: '2024-05-01', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Employees with an exit date must have status set to inactive.'),
    });
  });

  it('defaults the manager to the cost center responsible during creation', async () => {
    await runAsAdmin(async (tx) => {
      const responsible = await createEmployeeRecord(tx);
      const costCenter = await createCostCenterRecord(tx, { responsibleId: responsible.ID });

      const employee = await createEmployeeRecord(tx, { costCenter_ID: costCenter.ID });

      const refreshed = (await tx.run(
        SELECT.one.from(tx.entities.Employees).columns('manager_ID').where({ ID: employee.ID }),
      )) as any;

      expect(refreshed.manager_ID).toBe(responsible.ID);
    });
  });

  it('rejects mismatched managers when creating employees with a cost center', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const responsible = await createEmployeeRecord(tx);
        const alternate = await createEmployeeRecord(tx, { email: `validation+${randomUUID()}@example.com` });
        const costCenter = await createCostCenterRecord(tx, { responsibleId: responsible.ID });

        await tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Mismatch',
            lastName: 'Manager',
            email: `validation+${randomUUID()}@example.com`,
            entryDate: '2024-01-01',
            client_ID: CLIENT_ID,
            costCenter_ID: costCenter.ID,
            manager_ID: alternate.ID,
          }),
        );
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Employees assigned to a cost center must be managed by the responsible employee.'),
    });
  });

  it('rejects assigning a different manager while a cost center is linked', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const responsible = await createEmployeeRecord(tx);
        const alternate = await createEmployeeRecord(tx, { email: `validation+${randomUUID()}@example.com` });
        const costCenter = await createCostCenterRecord(tx, { responsibleId: responsible.ID });
        const employee = await createEmployeeRecord(tx, { costCenter_ID: costCenter.ID });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ manager_ID: alternate.ID, modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Employees assigned to a cost center must be managed by the responsible employee.'),
    });
  });

  it('updates the manager to match the new cost center responsible when the assignment changes', async () => {
    await runAsAdmin(async (tx) => {
      const responsibleA = await createEmployeeRecord(tx);
      const costCenterA = await createCostCenterRecord(tx, { responsibleId: responsibleA.ID });

      const responsibleB = await createEmployeeRecord(tx, { email: `validation+${randomUUID()}@example.com` });
      const costCenterB = await createCostCenterRecord(tx, {
        responsibleId: responsibleB.ID,
        code: `CC-${randomUUID().slice(0, 8)}`,
      });

      const employee = await createEmployeeRecord(tx, { costCenter_ID: costCenterA.ID });

      await tx.run(
        UPDATE(tx.entities.Employees)
          .set({ costCenter_ID: costCenterB.ID, modifiedAt: employee.modifiedAt })
          .where({ ID: employee.ID }),
      );

      const refreshed = (await tx.run(
        SELECT.one
          .from(tx.entities.Employees)
          .columns('manager_ID', 'costCenter_ID')
          .where({ ID: employee.ID }),
      )) as any;

      expect(refreshed.manager_ID).toBe(responsibleB.ID);
      expect(refreshed.costCenter_ID).toBe(costCenterB.ID);
    });
  });

  it('rejects clearing the manager while a cost center remains assigned', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const responsible = await createEmployeeRecord(tx);
        const costCenter = await createCostCenterRecord(tx, { responsibleId: responsible.ID });
        const employee = await createEmployeeRecord(tx, { costCenter_ID: costCenter.ID });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ manager_ID: null, modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({
      message: expect.stringContaining('Employees assigned to a cost center must be managed by the responsible employee.'),
    });
  });

  it('generates sanitized employee identifiers for company codes with symbols', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'ac-me 123' });
      const employee = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId).toMatch(/^ACME123[A-F0-9][0-9]{6}$/);
      expect(employee.employeeId).toHaveLength(14);
    });
  });

  it('truncates long company identifiers when building employee IDs', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'VeryLongCompanyCode' });
      const employee = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId).toMatch(/^VERYLONG[0-9]{6}$/);
      expect(employee.employeeId).toHaveLength(14);
    });
  });

  it('respects existing counter values when generating new employee IDs', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'CounterCo' });

      await db.run(INSERT.into('clientmgmt.EmployeeIdCounters').entries({ client_ID: client.ID, lastCounter: 5 }));

      const employee = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId.endsWith('000006')).toBe(true);
    });
  });

  it('skips existing employee identifiers to preserve uniqueness', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'SkipCo' });

      const first = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      const prefix = first.employeeId.slice(0, first.employeeId.length - 6);

      await createEmployeeRecord(tx, {
        client_ID: client.ID,
        email: `validation+${randomUUID()}@example.com`,
        employeeId: `${prefix}000002`,
      });

      const third = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(third.employeeId).toBe(`${prefix}000003`);
    });
  });
});



describe('Employee notification outbox', () => {
  let service: any;

  const createUser = ({
    id,
    roles,
    companyCodes,
  }: {
    id: string;
    roles: string[];
    companyCodes: string[];
  }) =>
    (cds as any).User({
      id,
      roles,
      attr: { companyCodes, CompanyCode: companyCodes },
    });

  const runAs = async <T>(
    userOptions: { id: string; roles: string[]; companyCodes: string[] },
    handler: (tx: any) => Promise<T>,
  ): Promise<T> => {
    const user = createUser(userOptions);
    return service.tx({ user }, handler);
  };

  beforeAll(async () => {
    service = await cds.connect.to('ClientService');
  });

  it('writes an outbox entry after employee creation when endpoint configured', async () => {
    process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT = 'https://example.org/employees';

    await runAs(
      { id: 'editor', roles: ['HREditor'], companyCodes: ['COMP-001'] },
      async (tx) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            firstName: 'Queue',
            lastName: 'Tester',
            email: 'queue.tester@example.com',
            entryDate: '2024-04-01',
            client_ID: CLIENT_ID,
          }),
        ),
    );

    const entry = (await db.run(
      SELECT.one
        .from('clientmgmt.EmployeeNotificationOutbox')
        .where({ endpoint: 'https://example.org/employees' }),
    )) as any;

    expect(entry).toBeDefined();
    expect(entry.eventType).toBe('EMPLOYEE_CREATED');
    expect(entry.status).toBe('PENDING');

    const payload = JSON.parse(entry.payload ?? '{}');
    expect(payload).toMatchObject({
      event: 'EMPLOYEE_CREATED',
      clientCompanyId: 'COMP-001',
    });
  });

  it('marks outbox entries as completed when downstream succeeds', async () => {
    const entryId = randomUUID();
    await db.run(
      INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries({
        ID: entryId,
        eventType: 'EMPLOYEE_CREATED',
        endpoint: 'https://example.org/success',
        payload: JSON.stringify({ ok: true }),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(Date.now() - 1000),
      }),
    );

    process.env.THIRD_PARTY_EMPLOYEE_SECRET = 'super-secret';

    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    } as any);

    await processOutbox();

    const updated = (await db.run(
      SELECT.one.from('clientmgmt.EmployeeNotificationOutbox').where({ ID: entryId }),
    )) as any;

    expect(updated.status).toBe('COMPLETED');
    expect(updated.deliveredAt).toBeTruthy();
    expect(updated.lastError).toBeNull();
    expect(mockedFetch).toHaveBeenCalledWith(
      'https://example.org/success',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'content-type': 'application/json',
          'x-signature-sha256': createHmac('sha256', 'super-secret').update(JSON.stringify({ ok: true })).digest('hex'),
        }),
      }),
    );
  });

  it('aborts hanging outbox deliveries and schedules a retry', async () => {
    jest.useFakeTimers();

    const baseTime = Date.now();
    jest.setSystemTime(baseTime);

    const entryId = randomUUID();
    await db.run(
      INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries({
        ID: entryId,
        eventType: 'EMPLOYEE_CREATED',
        endpoint: 'https://example.org/hang',
        payload: JSON.stringify({ ok: true }),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(baseTime - 1000),
      }),
    );

    mockedFetch.mockImplementationOnce((_url, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        const signal = init?.signal as AbortSignal | undefined;
        signal?.addEventListener('abort', () => {
          reject(new Error('aborted'));
        });
      }),
    );

    process.env.THIRD_PARTY_EMPLOYEE_TIMEOUT_MS = '10';
    const processing = processOutbox();

    if (typeof (jest as any).advanceTimersByTimeAsync === 'function') {
      await (jest as any).advanceTimersByTimeAsync(1000);
    } else {
      jest.advanceTimersByTime(1000);
    }

    await processing;

    const updated = (await db.run(
      SELECT.one.from('clientmgmt.EmployeeNotificationOutbox').where({ ID: entryId }),
    )) as any;

    expect(updated.status).toBe('PENDING');
    expect(updated.attempts).toBe(1);
    expect(new Date(updated.nextAttemptAt).getTime()).toBeGreaterThan(baseTime);
    expect(String(updated.lastError)).toContain('aborted');

    const fetchOptions = mockedFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(fetchOptions?.signal).toBeDefined();

    delete process.env.THIRD_PARTY_EMPLOYEE_TIMEOUT_MS;
    jest.useRealTimers();
  });

  it('retries with exponential backoff and marks entry as failed after max attempts', async () => {
    jest.useFakeTimers();
    const baseTime = new Date('2024-01-01T00:00:00Z').getTime();
    jest.setSystemTime(baseTime);

    const entryId = randomUUID();
    await db.run(
      INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries({
        ID: entryId,
        eventType: 'EMPLOYEE_CREATED',
        endpoint: 'https://example.org/fail',
        payload: JSON.stringify({ ok: false }),
        status: 'PENDING',
        attempts: 0,
        nextAttemptAt: new Date(baseTime),
      }),
    );

    mockedFetch.mockRejectedValue(new Error('network down'));

    let currentTime = baseTime;
    for (let attempt = 1; attempt <= 6; attempt += 1) {
      jest.setSystemTime(currentTime);
      await processOutbox();

      const entry = (await db.run(
        SELECT.one.from('clientmgmt.EmployeeNotificationOutbox').where({ ID: entryId }),
      )) as any;

      expect(entry.attempts).toBe(attempt);

      if (attempt < 6) {
        expect(entry.status).toBe('PENDING');
        const expectedDelay = Math.pow(2, attempt - 1) * 5000;
        expect(new Date(entry.nextAttemptAt).getTime()).toBe(currentTime + expectedDelay);
        currentTime = currentTime + expectedDelay + 1;
      } else {
        expect(entry.status).toBe('FAILED');
        expect(entry.nextAttemptAt).toBeNull();
        expect(entry.lastError).toContain('network down');
      }
    }

    jest.useRealTimers();
    expect(mockedFetch).toHaveBeenCalledTimes(6);
  });

  it('removes completed and failed entries that exceed the retention window', async () => {
    const completedId = randomUUID();
    const failedId = randomUUID();

    await db.run(
      INSERT.into('clientmgmt.EmployeeNotificationOutbox').entries([
        {
          ID: completedId,
          eventType: 'EMPLOYEE_CREATED',
          endpoint: 'https://example.org/cleanup',
          payload: JSON.stringify({ ok: true }),
          status: 'COMPLETED',
          attempts: 1,
          nextAttemptAt: null,
        },
        {
          ID: failedId,
          eventType: 'EMPLOYEE_CREATED',
          endpoint: 'https://example.org/cleanup',
          payload: JSON.stringify({ ok: false }),
          status: 'FAILED',
          attempts: 6,
          nextAttemptAt: null,
        },
      ] as any),
    );

    const cutoff = new Date(Date.now() - 8 * 60 * 60 * 1000);
    await db.run(
      UPDATE('clientmgmt.EmployeeNotificationOutbox' as any)
        .set({ modifiedAt: cutoff })
        .where({ ID: { in: [completedId, failedId] } }),
    );

    process.env.OUTBOX_RETENTION_HOURS = '1';
    await cleanupOutbox();

    const remaining = await db.run(
      SELECT.from('clientmgmt.EmployeeNotificationOutbox').where({ ID: { in: [completedId, failedId] } }),
    );

    expect(Array.isArray(remaining) ? remaining : []).toHaveLength(0);
  });
});
