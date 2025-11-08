jest.mock('axios', () => ({
  __esModule: true,
  default: {
    create: jest.fn(),
  },
}));

import path from 'node:path';
import cds from '@sap/cds';
import axios from 'axios';

import { EmployeeThirdPartyNotifier } from '../../../infrastructure/api/third-party/employee-notifier';

cds.test(path.join(__dirname, '..', '..', '..'));
const mockedAxios = axios as unknown as { create: jest.Mock };

const buildMockClient = (postImpl?: jest.Mock): { post: jest.Mock } => {
  const post = postImpl ?? jest.fn().mockResolvedValue({ status: 200 });
  mockedAxios.create.mockReturnValue({ post } as any);
  return { post };
};

describe('EmployeeThirdPartyNotifier', () => {
  let db: any;

  beforeAll(async () => {
    db = await cds.connect.to('db');
    try {
      await (cds as any).deploy(path.join(__dirname, '..', '..', '..')).to(db);
    } catch (error) {
      console.log('Database deployment info:', error);
    }
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.THIRD_PARTY_EMPLOYEE_SECRET;
  });

  it('groups employees by client endpoint when preparing notifications', async () => {
    const notifier = new EmployeeThirdPartyNotifier(db);

    const notification = await notifier.prepareEmployeesCreated(
      [
        { ID: 'req-1', client_ID: '11111111-1111-1111-1111-111111111111' },
        { ID: 'req-2', client_ID: '22222222-2222-2222-2222-222222222222' },
      ],
      [
        {
          ID: 'emp-1',
          client_ID: '11111111-1111-1111-1111-111111111111',
          employeeId: 'EMP-001',
          firstName: 'Alice',
          lastName: 'Anderson',
          email: 'alice@example.com',
        },
        {
          ID: 'emp-2',
          client_ID: '22222222-2222-2222-2222-222222222222',
          employeeId: 'EMP-002',
          firstName: 'Bob',
          lastName: 'Baker',
          email: 'bob@example.com',
        },
      ],
    );

    expect(notification.eventType).toBe('EMPLOYEE_CREATED');
    expect(notification.payloadsByEndpoint.size).toBe(2);

    const alpha = notification.payloadsByEndpoint.get('https://alpha.example.com/webhook');
    const beta = notification.payloadsByEndpoint.get('https://beta.example.com/webhook');

    expect(alpha).toBeDefined();
    expect(beta).toBeDefined();

    expect(alpha?.[0].body).toMatchObject({
      client: expect.objectContaining({ companyId: 'COMP-001' }),
      employees: [expect.objectContaining({ employeeId: 'EMP-001' })],
    });

    expect(beta?.[0].body).toMatchObject({
      client: expect.objectContaining({ companyId: 'COMP-002' }),
      employees: [expect.objectContaining({ employeeId: 'EMP-002' })],
    });
  });

  it('dispatches notifications with HMAC signatures and retries on failure', async () => {
    const mockPost = jest
      .fn()
      .mockRejectedValueOnce(new Error('transient error'))
      .mockResolvedValue({ status: 200 });
    buildMockClient(mockPost);

    const notifier = new EmployeeThirdPartyNotifier();
    process.env.THIRD_PARTY_EMPLOYEE_SECRET = 'super-secret';

    const payload = {
      eventType: 'EMPLOYEE_CREATED',
      payloadsByEndpoint: new Map([
        [
          'https://example.com/webhook',
          [
            {
              body: {
                eventType: 'EMPLOYEE_CREATED',
                client: { id: 'client-1', companyId: 'COMP-001' },
                employees: [{ employeeId: 'EMP-100' }],
              },
            },
          ],
        ],
      ]),
    };

    await notifier.dispatch(payload);

    expect(mockPost).toHaveBeenCalledTimes(2);
    const [endpoint, body, options] = mockPost.mock.calls[0];
    expect(endpoint).toBe('https://example.com/webhook');
    expect(body).toMatchObject({
      eventType: 'EMPLOYEE_CREATED',
      employees: [expect.objectContaining({ employeeId: 'EMP-100' })],
    });
    expect(options?.headers?.['x-signature-sha256']).toBeDefined();
  });
});
