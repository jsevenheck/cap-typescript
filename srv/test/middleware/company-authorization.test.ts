import cds, { Request } from '@sap/cds';
import { CompanyAuthorization } from '../../middleware/company-authorization';
import * as AuthUtils from '../../shared/utils/auth';

// Mock cds.tx and cds.transaction manually
// Note: Using direct assignment instead of jest.mock() to avoid Jest hoisting issues
// with variables defined outside the factory function. The production code uses cds.tx,
// and cds.transaction is an alias that we mock for completeness.
const mockRun = jest.fn();
const mockTransaction = { run: mockRun };
const mockTx = jest.fn(() => mockTransaction);

// Replace the actual functions with mocks
(cds as any).tx = mockTx;
(cds as any).transaction = mockTx;

describe('CompanyAuthorization', () => {
  let req: Request;
  let userContext: any;

  beforeEach(() => {
    jest.clearAllMocks();
    userContext = {
      roles: new Set(['HREditor']),
      attr: {
        CompanyCode: ['1010'],
        companyCodes: ['1010'],
      },
    };
    req = {
      user: {
        id: 'test-user',
        is: (role: string) => userContext.roles.has(role),
        attr: userContext.attr,
      },
      data: {},
    } as unknown as Request;

    jest.spyOn(AuthUtils, 'buildUserContext').mockReturnValue(userContext);
    jest.spyOn(AuthUtils, 'userHasRole').mockImplementation((_, role) => userContext.roles.has(role));
    jest.spyOn(AuthUtils, 'collectAttributeValues').mockReturnValue(['1010']);
  });

  it('should skip validation for HRAdmin', async () => {
    userContext.roles.add('HRAdmin');
    const auth = new CompanyAuthorization(req);
    const shouldSkip = auth.shouldSkip();
    expect(shouldSkip).toBe(true);
  });

  it('should validate client creation with allowed company', async () => {
    const clients = [{ companyId: '1010', name: 'Test Client' }];
    const auth = new CompanyAuthorization(req);
    await expect(auth.validateClientAccess(clients)).resolves.not.toThrow();
  });

  it('should throw error for client creation with forbidden company', async () => {
    const clients = [{ companyId: '9999', name: 'Forbidden Client' }];
    const auth = new CompanyAuthorization(req);
    await expect(auth.validateClientAccess(clients)).rejects.toThrow('Forbidden');
  });

  it('should throw error if client creation is missing companyId', async () => {
    const clients = [{ name: 'Missing Company' }];
    const auth = new CompanyAuthorization(req);
    await expect(auth.validateClientAccess(clients)).rejects.toThrow('Client must provide a companyId');
  });

  it('should validate employee update with existing client check', async () => {
    const employees = [{ ID: 'emp-123', firstName: 'John' }];
    // Mock finding existing employee
    mockRun.mockResolvedValueOnce([{ ID: 'emp-123', client_ID: 'client-1' }]);
    // Mock finding existing client
    mockRun.mockResolvedValueOnce([{ ID: 'client-1', companyId: '1010' }]);

    const auth = new CompanyAuthorization(req);
    await expect(auth.validateEmployeeAccess(employees)).resolves.not.toThrow();
  });
});
