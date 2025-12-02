
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import cds from '@sap/cds';

// Use cds.test() to start server and auto-deploy database with test data
const cap = cds.test(path.join(__dirname, '..', '..', '..'));
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

const { SELECT } = cds.ql;
const INSERT = (cds.ql as any).INSERT as any;
const DELETE = (cds.ql as any).DELETE as any;
const UPDATE = (cds.ql as any).UPDATE as any;

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const BETA_CLIENT_ID = '22222222-2222-2222-2222-222222222222';
const ALPHA_LOCATION_ID = 'aaaa1111-1111-1111-1111-111111111111';
const BETA_LOCATION_ID = 'aaaa2222-2222-2222-2222-222222222222';
const TEST_TENANT = process.env.CDS_DEFAULT_TENANT ?? 't0';

let db: any;

beforeAll(async () => {
  db = await cds.connect.to('db');

  // Deploy the database schema and seed data
  // This ensures all tables are created before tests run
  try {
    await (cds as any).deploy(path.join(__dirname, '..', '..', '..')).to(db);
  } catch (error) {
    // If deployment fails, it might already be deployed, continue
    console.log('Database deployment info:', error);
  }
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
  jest.clearAllMocks();
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
      location_ID: ALPHA_LOCATION_ID,
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
        location_ID: ALPHA_LOCATION_ID,
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
        location_ID: ALPHA_LOCATION_ID,
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
      { positionLevel: 'L1' },
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

  it('accepts modifiedAt payload fallback when If-Match header is absent', async () => {
    const createResponse = await http.post<Record<string, any>>(
      '/odata/v4/clients/Employees',
      {
        firstName: 'Payload',
        lastName: 'Concurrency',
        email: 'payload.concurrency@example.com',
        entryDate: '2024-07-01',
        client_ID: CLIENT_ID,
        location_ID: ALPHA_LOCATION_ID,
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

    const updateResponse = await http.patch<Record<string, any>>(
      `/odata/v4/clients/Employees(${employeeId})`,
      { positionLevel: 'L2', modifiedAt: initialModifiedAt },
      authConfig,
    );

    expect(updateResponse.status).toBe(200);
    const updatedModifiedAt = (updateResponse.data as Record<string, any>).modifiedAt as string | undefined;
    expect(typeof updatedModifiedAt).toBe('string');
    expect(updatedModifiedAt).not.toBe(initialModifiedAt);
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
            tenant: TEST_TENANT,
            firstName: 'Ias',
            lastName: 'Function',
            email: 'ias.function@example.com',
            entryDate: '2024-05-01',
            client_ID: BETA_CLIENT_ID,
            location_ID: BETA_LOCATION_ID,
          }),
        ),
      ),
    ).resolves.not.toThrow();

    await expect(
      service.tx({ user }, (tx: any) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            tenant: TEST_TENANT,
            firstName: 'Ias',
            lastName: 'BlockedFn',
            email: 'ias.blocked.fn@example.com',
            entryDate: '2024-05-02',
            client_ID: CLIENT_ID,
            location_ID: ALPHA_LOCATION_ID,
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
            tenant: TEST_TENANT,
            firstName: 'Ias',
            lastName: 'Array',
            email: 'ias.array@example.com',
            entryDate: '2024-06-01',
            client_ID: CLIENT_ID,
            location_ID: ALPHA_LOCATION_ID,
          }),
        ),
      ),
    ).resolves.not.toThrow();

    await expect(
      service.tx({ user }, (tx: any) =>
        tx.run(
          INSERT.into(tx.entities.Employees).entries({
            tenant: TEST_TENANT,
            firstName: 'Ias',
            lastName: 'BlockedArray',
            email: 'ias.blocked.array@example.com',
            entryDate: '2024-06-02',
            client_ID: BETA_CLIENT_ID,
            location_ID: BETA_LOCATION_ID,
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
            tenant: TEST_TENANT,
            firstName: 'Unauthorized',
            lastName: 'User',
            email: 'unauth@example.com',
            entryDate: '2024-03-01',
            client_ID: BETA_CLIENT_ID,
            location_ID: BETA_LOCATION_ID,
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


describe('Client name validation', () => {
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

  const adminContext = { id: 'client-admin', roles: ['HRAdmin'], companyCodes: [] as string[] };

  const runAsAdmin = async <T>(handler: (tx: any) => Promise<T>): Promise<T> => {
    const user = createUser(adminContext);
    return service.tx({ user }, handler);
  };

  beforeAll(async () => {
    service = await cds.connect.to('ClientService');
  });

  it('rejects creating a client with empty name', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            companyId: 'TEST-001',
            name: '',
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Client name must not be empty') });
  });

  it('rejects creating a client with whitespace-only name', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            companyId: 'TEST-002',
            name: '   ',
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Client name must not be empty') });
  });

  it('rejects creating a client without name', async () => {
    await expect(
      runAsAdmin((tx) =>
        tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            companyId: 'TEST-003',
          }),
        ),
      ),
    ).rejects.toMatchObject({ message: expect.stringContaining('Client name must not be empty') });
  });

  it('accepts creating a client with valid name', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-004',
            name: 'Valid Client Name',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('name').where({ ID: clientId }),
        );

        expect(created.name).toBe('Valid Client Name');
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
  });

  it('trims whitespace from client name on create', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-005',
            name: '  Trimmed Name  ',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('name').where({ ID: clientId }),
        );

        expect(created.name).toBe('Trimmed Name');
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
  });

  it('rejects updating a client with empty name', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-006',
            name: 'Original Name',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('modifiedAt').where({ ID: clientId }),
        );

        await expect(
          tx.run(
            UPDATE(tx.entities.Clients)
              .set({ name: '', modifiedAt: created.modifiedAt })
              .where({ ID: clientId }),
          ),
        ).rejects.toMatchObject({ message: expect.stringContaining('Client name must not be empty') });
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
  });

  it('rejects updating a client with whitespace-only name', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-007',
            name: 'Original Name',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('modifiedAt').where({ ID: clientId }),
        );

        await expect(
          tx.run(
            UPDATE(tx.entities.Clients)
              .set({ name: '   ', modifiedAt: created.modifiedAt })
              .where({ ID: clientId }),
          ),
        ).rejects.toMatchObject({ message: expect.stringContaining('Client name must not be empty') });
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
  });

  it('rejects updating a client with null name', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-007B',
            name: 'Original Name',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('modifiedAt').where({ ID: clientId }),
        );

        await expect(
          tx.run(
            UPDATE(tx.entities.Clients)
              .set({ name: null, modifiedAt: created.modifiedAt })
              .where({ ID: clientId }),
          ),
        ).rejects.toMatchObject({ message: expect.stringContaining('Client name must not be empty') });
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
  });

  it('allows updating a client without changing name', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-008',
            name: 'Original Name',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('modifiedAt', 'name').where({ ID: clientId }),
        );

        await tx.run(
          UPDATE(tx.entities.Clients).set({ name: 'Original Name', modifiedAt: created.modifiedAt }).where({ ID: clientId }),
        );

        const updated = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('name').where({ ID: clientId }),
        );

        expect(updated.name).toBe('Original Name');
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
  });

  it('allows updating a client with valid new name', async () => {
    const clientId = randomUUID();
    try {
      await runAsAdmin(async (tx) => {
        await tx.run(
          INSERT.into(tx.entities.Clients).entries({
            tenant: TEST_TENANT,
            ID: clientId,
            companyId: 'TEST-009',
            name: 'Original Name',
          }),
        );

        const created = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('modifiedAt').where({ ID: clientId }),
        );

        await tx.run(
          UPDATE(tx.entities.Clients)
            .set({ name: 'Updated Name', modifiedAt: created.modifiedAt })
            .where({ ID: clientId }),
        );

        const updated = await tx.run(
          SELECT.one.from(tx.entities.Clients).columns('name').where({ ID: clientId }),
        );

        expect(updated.name).toBe('Updated Name');
      });
    } finally {
      await db.run(DELETE.from('clientmgmt.Clients').where({ ID: clientId }));
    }
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
    const clientId = overrides.client_ID ?? CLIENT_ID;
    const locationId = overrides.location_ID ?? (clientId === BETA_CLIENT_ID ? BETA_LOCATION_ID : ALPHA_LOCATION_ID);
    const entry = {
      firstName: 'Test',
      lastName: 'Employee',
      email,
      entryDate: '2024-01-01',
      client_ID: clientId,
      location_ID: locationId,
      tenant: TEST_TENANT,
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
        tenant: TEST_TENANT,
        code,
        name: options.name ?? 'Validation Cost Center',
        client_ID: options.clientId ?? CLIENT_ID,
        responsible_ID: options.responsibleId,
        validFrom: '2025-01-01',
        validTo: null,
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
    options: { companyId: string; name?: string },
  ): Promise<{ ID: string; companyId: string }> => {
    const clientId = randomUUID();

    await tx.run(
      INSERT.into(tx.entities.Clients).entries({
        tenant: TEST_TENANT,
        ID: clientId,
        companyId: options.companyId,
        name: options.name ?? `Client ${options.companyId}`,
      }),
    );

    createdClientIds.push(clientId);

    return { ID: clientId, companyId: options.companyId };
  };

  const createLocationRecord = async (
    tx: any,
    options: { clientId: string; city?: string; countryCode?: string },
  ): Promise<{ ID: string }> => {
    const locationId = randomUUID();

    await tx.run(
      INSERT.into(tx.entities.Locations).entries({
        tenant: TEST_TENANT,
        ID: locationId,
        city: options.city ?? 'Test City',
        country_code: options.countryCode ?? 'DE',
        zipCode: '12345',
        street: '123 Test Street',
        validFrom: '2024-01-01',
        client_ID: options.clientId,
      }),
    );

    return { ID: locationId };
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
            tenant: TEST_TENANT,
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
            tenant: TEST_TENANT,
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
            tenant: TEST_TENANT,
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
            tenant: TEST_TENANT,
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
            tenant: TEST_TENANT,
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
      const location = await createLocationRecord(tx, { clientId: client.ID });
      const employee = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        location_ID: location.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId).toMatch(/^ACME123[A-F0-9][0-9]{6}$/);
      expect(employee.employeeId).toHaveLength(14);
    });
  });

  it('truncates long company identifiers when building employee IDs', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'VeryLongCompanyCode' });
      const location = await createLocationRecord(tx, { clientId: client.ID });
      const employee = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        location_ID: location.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId).toMatch(/^VERYLONG[0-9]{6}$/);
      expect(employee.employeeId).toHaveLength(14);
    });
  });

  it('respects existing counter values when generating new employee IDs', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'CounterCo' });
      const location = await createLocationRecord(tx, { clientId: client.ID });

      await db.run(
        INSERT.into('clientmgmt.EmployeeIdCounters').entries({
          client_ID: client.ID,
          lastCounter: 5,
          tenant: TEST_TENANT,
        }),
      );

      const employee = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        location_ID: location.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId.endsWith('000006')).toBe(true);
    });
  });

  it('skips existing employee identifiers to preserve uniqueness', async () => {
    await runAsAdmin(async (tx) => {
      const client = await createClientRecord(tx, { companyId: 'SkipCo' });
      const location = await createLocationRecord(tx, { clientId: client.ID });

      const first = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        location_ID: location.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      const prefix = first.employeeId.slice(0, first.employeeId.length - 6);

      await createEmployeeRecord(tx, {
        client_ID: client.ID,
        location_ID: location.ID,
        email: `validation+${randomUUID()}@example.com`,
        employeeId: `${prefix}000002`,
      });

      const third = await createEmployeeRecord(tx, {
        client_ID: client.ID,
        location_ID: location.ID,
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(third.employeeId).toBe(`${prefix}000003`);
    });
  });

  it('anonymizes former employees before the provided cutoff date', async () => {
    const creation = await http.post<Record<string, any>>(
      '/odata/v4/clients/Employees',
      {
        firstName: 'Former',
        lastName: 'Employee',
        email: 'former.employee@example.com',
        entryDate: '2020-01-01',
        exitDate: '2023-01-15',
        status: 'inactive',
        location_ID: ALPHA_LOCATION_ID,
        positionLevel: 'L3',
        client_ID: CLIENT_ID,
      },
      authConfig,
    );

    expect(creation.status).toBe(201);
    const employeeId = (creation.data as Record<string, any>).ID as string | undefined;
    expect(typeof employeeId).toBe('string');

    try {
      const actionResponse = await http.post<{ value: number }>(
        '/odata/v4/clients/anonymizeFormerEmployees',
        { before: '2024-01-01' },
        authConfig,
      );

      expect(actionResponse.status).toBe(200);
      expect(actionResponse.data).toEqual({ value: 1 });

      const fetched = await http.get<Record<string, any>>(
        `/odata/v4/clients/Employees(${employeeId})`,
        authConfig,
      );

      expect(fetched.status).toBe(200);
      expect(fetched.data.firstName).toBe('ANONYMIZED');
      expect(fetched.data.lastName).toBe('ANONYMIZED');
      expect(fetched.data.email).toMatch(/^anonymized-/);
      expect(fetched.data.positionLevel).toBeNull();
      expect(fetched.data.status).toBe('inactive');
    } finally {
      if (employeeId) {
        await db.run(DELETE.from('clientmgmt.Employees').where({ ID: employeeId }));
      }
    }
  });

  it('rejects anonymization requests with invalid cutoff dates', async () => {
    const status = await captureErrorStatus(
      http.post(
        '/odata/v4/clients/anonymizeFormerEmployees',
        { before: 'not-a-date' },
        authConfig,
      ),
    );

    expect(status).toBe(400);
  });

  it('returns zero when no employees require anonymization', async () => {
    const response = await http.post<{ value: number }>(
      '/odata/v4/clients/anonymizeFormerEmployees',
      { before: '1990-01-01' },
      authConfig,
    );

    expect(response.status).toBe(200);
    expect(response.data).toEqual({ value: 0 });
  });

  it('rejects modifying employeeId on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx, {
          employeeId: 'CUSTOM123456',
        });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ employeeId: 'DIFFERENT456', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Employee ID cannot be modified') });
  });

  it('rejects modifying employeeId with different case on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx, {
          employeeId: 'CUSTOM123456',
        });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ employeeId: 'custom123457', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Employee ID cannot be modified') });
  });

  it('rejects clearing employeeId with null on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx, {
          employeeId: 'CUSTOM123456',
        });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ employeeId: null, modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Employee ID cannot be modified') });
  });

  it('rejects clearing employeeId with empty string on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx, {
          employeeId: 'CUSTOM123456',
        });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ employeeId: '', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Employee ID cannot be modified') });
  });

  it('rejects clearing employeeId with whitespace on update', async () => {
    await expect(
      runAsAdmin(async (tx) => {
        const employee = await createEmployeeRecord(tx, {
          employeeId: 'CUSTOM123456',
        });

        await tx.run(
          UPDATE(tx.entities.Employees)
            .set({ employeeId: '   ', modifiedAt: employee.modifiedAt })
            .where({ ID: employee.ID }),
        );
      }),
    ).rejects.toMatchObject({ message: expect.stringContaining('Employee ID cannot be modified') });
  });

  it('allows updating employee without changing employeeId', async () => {
    await runAsAdmin(async (tx) => {
      const employee = await createEmployeeRecord(tx, {
        employeeId: 'CUSTOM123456',
      });

      await tx.run(
        UPDATE(tx.entities.Employees)
          .set({ firstName: 'Updated', modifiedAt: employee.modifiedAt })
          .where({ ID: employee.ID }),
      );

      const updated = await tx.run(
        SELECT.one.from(tx.entities.Employees).columns('firstName', 'employeeId').where({ ID: employee.ID }),
      );

      expect(updated.firstName).toBe('Updated');
      expect(updated.employeeId).toBe('CUSTOM123456');
    });
  });

  it('allows updating employee with same employeeId (case-insensitive)', async () => {
    await runAsAdmin(async (tx) => {
      const employee = await createEmployeeRecord(tx, {
        employeeId: 'CUSTOM123456',
      });

      await tx.run(
        UPDATE(tx.entities.Employees)
          .set({ employeeId: 'CUSTOM123456', firstName: 'Updated', modifiedAt: employee.modifiedAt })
          .where({ ID: employee.ID }),
      );

      const updated = await tx.run(
        SELECT.one.from(tx.entities.Employees).columns('firstName', 'employeeId').where({ ID: employee.ID }),
      );

      expect(updated.firstName).toBe('Updated');
      expect(updated.employeeId).toBe('CUSTOM123456');
    });
  });

  it('allows specifying employeeId on create', async () => {
    await runAsAdmin(async (tx) => {
      const employee = await createEmployeeRecord(tx, {
        employeeId: 'CREATE123456',
        email: `validation+${randomUUID()}@example.com`,
      });

      expect(employee.employeeId).toBe('CREATE123456');
    });
  });
});



