jest.mock('@sap-cloud-sdk/connectivity', () => ({ __esModule: true, getDestination: jest.fn() }));
jest.mock('@sap-cloud-sdk/http-client', () => ({ __esModule: true, executeHttpRequest: jest.fn() }));

import path from 'node:path';
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

const DELETE = (cds.ql as any).DELETE as any;

const CLIENT_ID = '11111111-1111-1111-1111-111111111111';
const BETA_CLIENT_ID = '22222222-2222-2222-2222-222222222222';

let db: any;

beforeAll(async () => {
  db = await cds.connect.to('db');

  // Deploy the database schema and seed data
  try {
    await (cds as any).deploy(path.join(__dirname, '..', '..', '..')).to(db);
  } catch (error) {
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

const captureErrorMessage = async (promise: Promise<unknown>): Promise<string> => {
  try {
    await promise;
    return '';
  } catch (error: unknown) {
    if (error && typeof error === 'object') {
      const errObj = error as any;
      if ('response' in errObj && errObj.response?.data?.error?.message) {
        return errObj.response.data.error.message;
      }
      if ('message' in errObj) {
        return errObj.message;
      }
    }
    return String(error);
  }
};

afterEach(async () => {
  // Clean up test data created during tests
  if (db) {
    await db.run(DELETE.from('clientmgmt.Employees').where({ email: { like: '%test-integrity%' } }));
    await db.run(DELETE.from('clientmgmt.CostCenters').where({ name: { like: '%Test Integrity%' } }));
  }
});

describe('Client Integrity Validation', () => {
  describe('Employee Manager Validation', () => {
    it('should allow creating employee with manager from same client', async () => {
      // First, create a manager in CLIENT_ID
      const managerPayload = {
        firstName: 'Manager',
        lastName: 'Test',
        email: 'manager-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
      };

      const managerResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        managerPayload,
        authConfig,
      );
      expect(managerResponse.status).toBe(201);
      const managerId = managerResponse.data.ID;

      // Create an employee with the manager from the same client
      const employeePayload = {
        firstName: 'Employee',
        lastName: 'Test',
        email: 'employee-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
        manager_ID: managerId,
      };

      const employeeResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        employeePayload,
        authConfig,
      );
      expect(employeeResponse.status).toBe(201);
      expect(employeeResponse.data.ID).toBeDefined();
    });

    it('should reject creating employee with manager from different client', async () => {
      // First, create a manager in BETA_CLIENT_ID
      const managerPayload = {
        firstName: 'Manager',
        lastName: 'Beta',
        email: 'manager-beta-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: BETA_CLIENT_ID,
      };

      const managerResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        managerPayload,
        authConfig,
      );
      expect(managerResponse.status).toBe(201);
      const managerId = managerResponse.data.ID;

      // Try to create an employee in CLIENT_ID with manager from BETA_CLIENT_ID
      const employeePayload = {
        firstName: 'Employee',
        lastName: 'Alpha',
        email: 'employee-alpha-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
        manager_ID: managerId,
      };

      const status = await captureErrorStatus(
        http.post('/odata/v4/clients/Employees', employeePayload, authConfig),
      );
      expect(status).toBe(400);

      const errorMessage = await captureErrorMessage(
        http.post('/odata/v4/clients/Employees', employeePayload, authConfig),
      );
      expect(errorMessage).toContain('Manager must belong to the same client');
    });

    it('should reject updating employee with manager from different client', async () => {
      // Create employee in CLIENT_ID
      const employeePayload = {
        firstName: 'Employee',
        lastName: 'UpdateTest',
        email: 'employee-update-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
      };

      const employeeResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        employeePayload,
        authConfig,
      );
      expect(employeeResponse.status).toBe(201);
      const employeeId = employeeResponse.data.ID;

      // Create manager in different client
      const managerPayload = {
        firstName: 'Manager',
        lastName: 'WrongClient',
        email: 'manager-wrong-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: BETA_CLIENT_ID,
      };

      const managerResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        managerPayload,
        authConfig,
      );
      expect(managerResponse.status).toBe(201);
      const managerId = managerResponse.data.ID;

      // Try to update employee with manager from different client
      const status = await captureErrorStatus(
        http.patch(`/odata/v4/clients/Employees(${employeeId})`, { manager_ID: managerId }, authConfig),
      );
      expect(status).toBe(400);

      const errorMessage = await captureErrorMessage(
        http.patch(`/odata/v4/clients/Employees(${employeeId})`, { manager_ID: managerId }, authConfig),
      );
      expect(errorMessage).toContain('Manager must belong to the same client');
    });

    it('should allow removing manager by setting to null', async () => {
      // Create manager and employee
      const managerPayload = {
        firstName: 'Manager',
        lastName: 'Removable',
        email: 'manager-removable-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
      };

      const managerResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        managerPayload,
        authConfig,
      );
      const managerId = managerResponse.data.ID;

      const employeePayload = {
        firstName: 'Employee',
        lastName: 'WithManager',
        email: 'employee-with-manager-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
        manager_ID: managerId,
      };

      const employeeResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        employeePayload,
        authConfig,
      );
      const employeeId = employeeResponse.data.ID;

      // Remove manager
      const updateResponse = await http.patch(
        `/odata/v4/clients/Employees(${employeeId})`,
        { manager_ID: null },
        authConfig,
      );
      expect(updateResponse.status).toBe(200);
    });
  });

  describe('Employee Cost Center Validation', () => {
    it('should allow creating employee with cost center from same client', async () => {
      // First, create a responsible employee
      const responsiblePayload = {
        firstName: 'Responsible',
        lastName: 'Test',
        email: 'responsible-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
      };

      const responsibleResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        responsiblePayload,
        authConfig,
      );
      const responsibleId = responsibleResponse.data.ID;

      // Create cost center
      const costCenterPayload = {
        code: 'CC-TEST-INT-001',
        name: 'Test Integrity Cost Center',
        client_ID: CLIENT_ID,
        responsible_ID: responsibleId,
      };

      const costCenterResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/CostCenters',
        costCenterPayload,
        authConfig,
      );
      const costCenterId = costCenterResponse.data.ID;

      // Create employee with cost center from same client
      const employeePayload = {
        firstName: 'Employee',
        lastName: 'CostCenter',
        email: 'employee-costcenter-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
        costCenter_ID: costCenterId,
      };

      const employeeResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        employeePayload,
        authConfig,
      );
      expect(employeeResponse.status).toBe(201);
    });

    it('should reject creating employee with cost center from different client', async () => {
      // Create responsible employee in BETA_CLIENT_ID
      const responsiblePayload = {
        firstName: 'Responsible',
        lastName: 'Beta',
        email: 'responsible-beta-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: BETA_CLIENT_ID,
      };

      const responsibleResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        responsiblePayload,
        authConfig,
      );
      const responsibleId = responsibleResponse.data.ID;

      // Create cost center in BETA_CLIENT_ID
      const costCenterPayload = {
        code: 'CC-BETA-TEST-INT',
        name: 'Test Integrity Beta Cost Center',
        client_ID: BETA_CLIENT_ID,
        responsible_ID: responsibleId,
      };

      const costCenterResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/CostCenters',
        costCenterPayload,
        authConfig,
      );
      const costCenterId = costCenterResponse.data.ID;

      // Try to create employee in CLIENT_ID with cost center from BETA_CLIENT_ID
      const employeePayload = {
        firstName: 'Employee',
        lastName: 'WrongCC',
        email: 'employee-wrongcc-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
        costCenter_ID: costCenterId,
      };

      const status = await captureErrorStatus(
        http.post('/odata/v4/clients/Employees', employeePayload, authConfig),
      );
      expect(status).toBe(400);

      const errorMessage = await captureErrorMessage(
        http.post('/odata/v4/clients/Employees', employeePayload, authConfig),
      );
      expect(errorMessage).toContain('Cost center must belong to the same client');
    });
  });

  describe('Cost Center Responsible Employee Validation', () => {
    it('should allow creating cost center with responsible employee from same client', async () => {
      // Create responsible employee
      const responsiblePayload = {
        firstName: 'Responsible',
        lastName: 'SameClient',
        email: 'responsible-sameclient-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: CLIENT_ID,
      };

      const responsibleResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        responsiblePayload,
        authConfig,
      );
      const responsibleId = responsibleResponse.data.ID;

      // Create cost center with responsible from same client
      const costCenterPayload = {
        code: 'CC-SAME-CLIENT',
        name: 'Test Same Client Cost Center',
        client_ID: CLIENT_ID,
        responsible_ID: responsibleId,
      };

      const costCenterResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/CostCenters',
        costCenterPayload,
        authConfig,
      );
      expect(costCenterResponse.status).toBe(201);
    });

    it('should reject creating cost center with responsible employee from different client', async () => {
      // Create responsible employee in BETA_CLIENT_ID
      const responsiblePayload = {
        firstName: 'Responsible',
        lastName: 'DifferentClient',
        email: 'responsible-different-test-integrity@example.com',
        entryDate: '2024-01-01',
        client_ID: BETA_CLIENT_ID,
      };

      const responsibleResponse = await http.post<{ ID: string }>(
        '/odata/v4/clients/Employees',
        responsiblePayload,
        authConfig,
      );
      const responsibleId = responsibleResponse.data.ID;

      // Try to create cost center in CLIENT_ID with responsible from BETA_CLIENT_ID
      const costCenterPayload = {
        code: 'CC-DIFF-CLIENT',
        name: 'Test Different Client Cost Center',
        client_ID: CLIENT_ID,
        responsible_ID: responsibleId,
      };

      const status = await captureErrorStatus(
        http.post('/odata/v4/clients/CostCenters', costCenterPayload, authConfig),
      );
      expect(status).toBe(400);

      const errorMessage = await captureErrorMessage(
        http.post('/odata/v4/clients/CostCenters', costCenterPayload, authConfig),
      );
      expect(errorMessage).toContain('Responsible employee must belong to the same client');
    });
  });
});
