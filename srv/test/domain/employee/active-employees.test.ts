import express from 'express';
import request from 'supertest';
import cds from '@sap/cds';

import activeEmployeesHandler from '../../../domain/employee/handlers/active-employees.read';
import apiKeyMiddleware, { loadApiKey } from '../../../middleware/apiKey';

describe('GET /api/employees/active', () => {
  const originalApiKey = process.env.EMPLOYEE_EXPORT_API_KEY;
  const cdsAny = cds as any;
  const originalModel = cdsAny.model;
  const originalRun = cdsAny.run;
  const originalTx = cdsAny.tx;
  const originalContext = cdsAny.context;

  const buildApp = () => {
    const app = express();
    app.get('/api/employees/active', apiKeyMiddleware, activeEmployeesHandler);
    return app;
  };

  beforeEach(async () => {
    process.env.EMPLOYEE_EXPORT_API_KEY = 'test-key';
    await loadApiKey(); // Reload cached API key from environment
    cdsAny.model = originalModel;
    cdsAny.run = originalRun;
    cdsAny.tx = originalTx;
    cdsAny.context = originalContext;
  });

  afterEach(() => {
    cdsAny.model = originalModel;
    cdsAny.run = originalRun;
    cdsAny.tx = originalTx;
    cdsAny.context = originalContext;
  });

  afterAll(() => {
    process.env.EMPLOYEE_EXPORT_API_KEY = originalApiKey;
    cdsAny.model = originalModel;
    cdsAny.run = originalRun;
    cdsAny.tx = originalTx;
    cdsAny.context = originalContext;
  });

  it('responds with 401 when the API key is missing', async () => {
    const app = buildApp();

    await request(app)
      .get('/api/employees/active')
      .expect(401)
      .expect({ error: 'invalid_api_key' });
  });

  it('returns active employees when a valid API key is supplied', async () => {
    const app = buildApp();

    const employeesDefinition = { elements: { entryDate: {}, exitDate: {}, status: {} } };
    cdsAny.model = {
      definitions: {
        'ClientService.Employees': employeesDefinition,
      },
    };

    const runSpy = jest.fn().mockResolvedValue([
      {
        ID: '11111111-1111-1111-1111-111111111111',
        employeeId: 'E-0001',
        firstName: 'Alice',
        lastName: 'Doe',
        email: 'alice@example.com',
        entryDate: '2021-01-01',
        exitDate: null,
        status: 'active',
        costCenter: {
          ID: '22222222-2222-2222-2222-222222222222',
          code: '1000',
          name: 'Sales',
        },
        manager: {
          ID: '33333333-3333-3333-3333-333333333333',
          employeeId: 'M-0001',
          firstName: 'Bob',
          lastName: 'Boss',
          email: 'bob@example.com',
        },
      },
    ]);
    cdsAny.tx = jest.fn().mockReturnValue({ run: runSpy });
    cdsAny.context = { tenant: 't1' };

    await request(app)
      .get('/api/employees/active')
      .set('x-api-key', 'test-key')
      .set('x-tenant-id', 't1')
      .set('x-client-id', 'client-123')
      .expect(200)
      .expect([
        {
          ID: '11111111-1111-1111-1111-111111111111',
          externalId: 'E-0001',
          firstName: 'Alice',
          lastName: 'Doe',
          email: 'alice@example.com',
          hireDate: '2021-01-01',
          terminationDate: null,
          costCenter: {
            ID: '22222222-2222-2222-2222-222222222222',
            code: '1000',
            name: 'Sales',
          },
          manager: {
            ID: '33333333-3333-3333-3333-333333333333',
            externalId: 'M-0001',
            firstName: 'Bob',
            lastName: 'Boss',
            email: 'bob@example.com',
          },
        },
      ]);
    expect(runSpy).toHaveBeenCalledTimes(1);
    expect(cdsAny.tx).toHaveBeenCalledWith({ tenant: 't1' });
  });

  it('returns 403 when tenant is missing or mismatched', async () => {
    const app = buildApp();

    cdsAny.model = {
      definitions: {
        'ClientService.Employees': { elements: { entryDate: {}, exitDate: {} } },
      },
    };

    cdsAny.context = { tenant: 'tenant-a' };
    cdsAny.tx = jest.fn().mockReturnValue({ run: jest.fn() });

    await request(app)
      .get('/api/employees/active')
      .set('x-api-key', 'test-key')
      .set('x-tenant-id', 'tenant-b')
      .set('x-client-id', 'client-123')
      .expect(403)
      .expect({ error: 'forbidden', message: 'Tenant mismatch detected for the request.' });
  });

  it('rejects requests without company context', async () => {
    const app = buildApp();

    cdsAny.model = {
      definitions: {
        'ClientService.Employees': { elements: { entryDate: {}, exitDate: {} } },
      },
    };

    cdsAny.context = { tenant: 'tenant-a' };
    cdsAny.tx = jest.fn().mockReturnValue({ run: jest.fn() });

    await request(app)
      .get('/api/employees/active')
      .set('x-api-key', 'test-key')
      .set('x-tenant-id', 'tenant-a')
      .expect(403)
      .expect({ error: 'forbidden', message: 'Company context is required to fetch employees.' });
  });
});
