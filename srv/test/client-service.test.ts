jest.mock('node-fetch', () => jest.fn());

import path from 'node:path';
import { randomUUID } from 'node:crypto';
import cds from '@sap/cds';
import fetch from 'node-fetch';
import { deliverNewEmployeeNotification } from '../notification-service';

const cap = cds.test(path.join(__dirname, '..'));
const encoded = Buffer.from('dev:dev').toString('base64');
const authConfig = {
  auth: { username: 'dev', password: 'dev' },
  headers: {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    Authorization: `Basic ${encoded}`,
    'x-cds-roles': 'ClientViewer ClientEditor',
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
const mockedFetch = fetch as unknown as jest.MockedFunction<typeof fetch>;
const { SELECT, INSERT } = cds.ql;

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

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const BETA_CLIENT_ID = '22222222-2222-2222-2222-222222222222';

afterEach(() => {
  mockedFetch.mockReset();
  delete process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT;
  delete process.env.THIRD_PARTY_EMPLOYEE_SECRET;
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

  it('enforces ETag concurrency control on clients', async () => {
    const uniqueCompany = `ETG-${randomUUID().slice(0, 8).toUpperCase()}`;
    const createResponse = await http.post<Record<string, any>>(
      '/odata/v4/clients/Clients',
      {
        companyId: uniqueCompany,
        name: 'ETag Test Client',
        country_code: 'DE',
      },
      authConfig,
    );
    expect(createResponse.status).toBe(201);

    const created = createResponse.data ?? {};
    const createdId =
      (created as Record<string, unknown>).ID ||
      (created as Record<string, unknown>).Id ||
      (created as Record<string, unknown>).id;
    expect(typeof createdId).toBe('string');

    const fetched = await http.get<Record<string, any>>(
      `/odata/v4/clients/Clients(${createdId})`,
      authConfig,
    );
    expect(fetched.status).toBe(200);
    const initialModifiedAt = (fetched.data as Record<string, unknown>).modifiedAt as string | undefined;
    expect(typeof initialModifiedAt).toBe('string');
    expect(initialModifiedAt).toBeTruthy();

    const fetchedEtag = `"${initialModifiedAt}"`;

    const missingStatus = await captureErrorStatus(
      http.patch(
        `/odata/v4/clients/Clients(${createdId})`,
        { name: 'ETag Test Client Missing Header' },
        authConfig,
      ),
    );
    expect(missingStatus).toBe(428);

    const invalidStatus = await captureErrorStatus(
      http.patch(
        `/odata/v4/clients/Clients(${createdId})`,
        { name: 'ETag Test Client Invalid Attempt' },
        {
          ...authConfig,
          headers: {
            ...authConfig.headers,
            'If-Match': '"invalid-etag"',
          },
        },
      ),
    );
    expect(invalidStatus).toBe(412);

    const updateResponse = await http.patch(
      `/odata/v4/clients/Clients(${createdId})`,
      { name: 'ETag Test Client Updated' },
      {
        ...authConfig,
        headers: {
          ...authConfig.headers,
          'If-Match': fetchedEtag,
        },
      },
    );
    expect(updateResponse.status).toBe(200);
  });
});


describe('ClientService (authorization & queue)', () => {
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
        expect((error as Error).message).toContain('Not authorized for company COMP-002');
      },
    );
  });

  it('queues notifications for new employees', async () => {
    const queuedEmit = jest.fn().mockResolvedValue(undefined);
    const queuedSpy = jest.spyOn(cds as any, 'queued').mockReturnValue({ emit: queuedEmit } as any);
    const connectSpy = jest.spyOn(cds.connect as any, 'to').mockResolvedValue({});

    try {
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

      expect(connectSpy).toHaveBeenCalledWith('NotificationService');
      expect(queuedEmit).toHaveBeenCalledTimes(1);
      expect(queuedEmit).toHaveBeenCalledWith(
        'NotifyNewEmployee',
        expect.objectContaining({
          clientCompanyId: 'COMP-001',
          employeeId: expect.any(String),
        }),
      );
    } finally {
      queuedSpy.mockRestore();
      connectSpy.mockRestore();
    }
  });
});

describe('NotificationService', () => {
  const endpoint = 'https://example.org/employees';

  it('throws to trigger retry on downstream failure', async () => {
    process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT = endpoint;
    mockedFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'unavailable',
    } as any);

    await expect(
      deliverNewEmployeeNotification({ employeeId: 'EMP-FAIL' }),
    ).rejects.toThrow(/503/);
  });

  it('delivers successfully when downstream responds ok', async () => {
    process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT = endpoint;
    mockedFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => '',
    } as any);

    await expect(
      deliverNewEmployeeNotification({ employeeId: 'EMP-OK' }),
    ).resolves.toBeUndefined();
    expect(mockedFetch).toHaveBeenCalledWith(
      endpoint,
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
