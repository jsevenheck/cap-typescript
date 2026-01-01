import path from 'node:path';
import cds from '@sap/cds';
import { getDestination, isHttpDestination } from '@sap-cloud-sdk/connectivity';

import { EmployeeThirdPartyNotifier } from '../../../infrastructure/api/third-party/employee-notifier';
import { postEmployeeNotification } from '../../../infrastructure/api/third-party/employee.client';

jest.mock('@sap-cloud-sdk/connectivity', () => ({
  __esModule: true,
  getDestination: jest.fn(),
  isHttpDestination: jest.fn(),
}));

jest.mock('../../../infrastructure/api/third-party/employee.client', () => ({
  __esModule: true,
  postEmployeeNotification: jest.fn(),
}));

cds.test(path.join(__dirname, '..', '..', '..'));

const mockGetDestination = getDestination as unknown as jest.Mock;
const mockIsHttpDestination = isHttpDestination as unknown as jest.Mock;
const mockPostEmployeeNotification = postEmployeeNotification as unknown as jest.Mock;

describe('EmployeeThirdPartyNotifier', () => {
  let db: any;
  const destinationName = 'employee-service-destination';

  beforeAll(async () => {
    db = await cds.connect.to('db');
    try {
      await (cds as any).deploy(path.join(__dirname, '..', '..', '..')).to(db);
    } catch (error) {
      console.log('Database deployment info:', error);
    }
  });

  beforeEach(() => {
    mockGetDestination.mockReset();
    mockIsHttpDestination.mockReset();
    mockPostEmployeeNotification.mockReset();
    process.env.EMPLOYEE_CREATED_DESTINATION = destinationName;
  });

  afterEach(() => {
    delete process.env.EMPLOYEE_CREATED_DESTINATION;
    delete process.env.THIRD_PARTY_EMPLOYEE_SECRET;
  });

  it('groups employees by client while using a single service destination', async () => {
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
          employeeId: '1010-0001',
          firstName: 'Alice',
          lastName: 'Anderson',
          email: 'alice@example.com',
        },
        {
          ID: 'emp-2',
          client_ID: '22222222-2222-2222-2222-222222222222',
          employeeId: '1020-0001',
          firstName: 'Bob',
          lastName: 'Baker',
          email: 'bob@example.com',
        },
      ],
    );

    expect(notification.eventType).toBe('EMPLOYEE_CREATED');
    expect(notification.payloadsByDestination.size).toBe(1);

    const destinationPayloads = notification.payloadsByDestination.get(destinationName);

    expect(destinationPayloads).toBeDefined();
    expect(destinationPayloads?.length).toBe(2);

    expect(destinationPayloads?.[0].body).toMatchObject({
      client: expect.objectContaining({ companyId: '1010' }),
      employees: [expect.objectContaining({ employeeId: '1010-0001' })],
    });

    expect(destinationPayloads?.[1].body).toMatchObject({
      client: expect.objectContaining({ companyId: '1020' }),
      employees: [expect.objectContaining({ employeeId: '1020-0001' })],
    });
  });

  it('dispatches notifications through configured destinations with signing secret', async () => {
    mockGetDestination.mockResolvedValue({
      name: destinationName,
      url: 'https://alpha.example.com/webhook',
      authentication: 'NoAuthentication',
    });
    mockIsHttpDestination.mockReturnValue(true);

    const notifier = new EmployeeThirdPartyNotifier();
    process.env.EMPLOYEE_CREATED_DESTINATION = destinationName;
    process.env.THIRD_PARTY_EMPLOYEE_SECRET = 'super-secret';

    const payload = {
      eventType: 'EMPLOYEE_CREATED',
      payloadsByDestination: new Map([
        [
          destinationName,
          [
            {
              body: {
                eventType: 'EMPLOYEE_CREATED',
                client: { id: 'client-1', companyId: '1010' },
                employees: [{ employeeId: '1010-0100' }],
              },
            },
          ],
        ],
      ]),
    };

    await notifier.dispatch(payload);

    expect(mockGetDestination).toHaveBeenCalledWith({ destinationName });
    expect(mockIsHttpDestination).toHaveBeenCalled();
    expect(mockPostEmployeeNotification).toHaveBeenCalledTimes(1);

    const [{ destination, payload: body, secret }] = mockPostEmployeeNotification.mock.calls[0];
    expect(destination.name).toBe(destinationName);
    expect(body).toContain('1010-0100');
    expect(secret).toBe('super-secret');
  });
});
