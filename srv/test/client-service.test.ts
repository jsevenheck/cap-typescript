import path from 'node:path';
import cds from '@sap/cds';

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
  get: <T = unknown>(url: string, config?: Record<string, unknown>) => Promise<{ status: number; data: T }>;
  post: <T = unknown>(
    url: string,
    data?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<{ status: number; data: T }>;
};
const { expect } = cap;


const CLIENT_ID = '11111111-1111-1111-1111-111111111111';

describe('ClientService (HTTP)', () => {
  it('serves seeded clients', async () => {
    const { status, data } = await http.get<{ value: Array<{ companyId: string; name: string }> }>(
      '/odata/v4/clients/Clients?$select=companyId,name',
      authConfig,
    );
    expect(status).to.equal(200);
    const clients = (Array.isArray((data as any).value) ? (data as any).value : data) as Array<{
      companyId: string;
      name: string;
    }>;
    const hasAlpha = clients.some(
      (client) => client.companyId === 'COMP-001' && client.name === 'Alpha Industries',
    );
    expect(hasAlpha).to.equal(true);
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
    expect(created.status).to.equal(201);
    expect(created.data.employeeId).to.match(/^COMP-001-\d{4}$/);

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
    expect(second.status).to.equal(201);
    expect(second.data.employeeId).to.not.equal(created.data.employeeId);
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
    expect(employee.status).to.equal(201);

    let invalidCostCenterStatus = 0;
    try {
      await http.post(
        '/odata/v4/clients/CostCenters',
        {
          code: 'cc-001',
          name: 'Operations',
          client_ID: '22222222-2222-2222-2222-222222222222',
          responsible_ID: employee.data.ID,
        },
        authConfig,
      );
    } catch (error: unknown) {
      if (error && typeof error === 'object' && 'response' in error) {
        const response = (error as { response?: { status?: number } }).response;
        invalidCostCenterStatus = response?.status ?? 0;
      }
    }
    expect(invalidCostCenterStatus).to.be.greaterThanOrEqual(400);
  });
});
