jest.mock('node-fetch', () => ({ __esModule: true, default: jest.fn() }));

import path from 'node:path';
import { createHmac, randomUUID } from 'node:crypto';
import cds from '@sap/cds';
import fetch from 'node-fetch';

import { processOutbox } from '../server';

const cap = cds.test(path.join(__dirname, '..'));
const encoded = Buffer.from('dev:dev').toString('base64');
const authConfig = {
  auth: { username: 'dev', password: 'dev' },
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Basic ${encoded}`,
    'x-cds-roles': 'ClientViewer ClientEditor HRViewer HREditor HRAdmin',
  },
} as const;

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
const { SELECT, INSERT } = cds.ql;
const DELETE = (cds.ql as any).DELETE as typeof SELECT;

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
    expect(created.data.employeeId).toMatch(/^COMP-001-\d{4}$/);

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
  }) => (cds as any).User({ id, roles, attr: { companyCodes } });

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

  it('blocks HR editor writes outside assigned company codes', async () => {
    await runAs(
      { id: 'editor', roles: ['HREditor'], companyCodes: ['COMP-001'] },
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
  }) => (cds as any).User({ id, roles, attr: { companyCodes } });

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

  it('marks outbox entries as delivered when downstream succeeds', async () => {
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

    expect(updated.status).toBe('DELIVERED');
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
});
