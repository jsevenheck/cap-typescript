import type { Request } from '@sap/cds';
import {
  enforceClientCompany,
  enforceCostCenterCompany,
  enforceEmployeeCompany,
} from '../../../../domain/shared/security/company-authorization.service';
import type { ClientEntity, CostCenterEntity, EmployeeEntity } from '../../../../shared/types/models';

// Mock dependencies
jest.mock('@sap/cds', () => {
  const actual = jest.requireActual('@sap/cds');
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual.default,
      transaction: jest.fn(),
      ql: {
        SELECT: {
          from: jest.fn(() => ({
            columns: jest.fn(() => ({
              where: jest.fn(() => ({})),
            })),
          })),
        },
      },
    },
  };
});

interface RequestWithUser extends Request {
  user?: any;
}

describe('Company Authorization Service', () => {
  let mockRequest: RequestWithUser;
  let mockTransaction: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTransaction = {
      run: jest.fn(),
    };

    mockRequest = {
      user: {
        is: jest.fn(),
        attr: jest.fn(),
      },
      data: {},
    } as RequestWithUser;

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const cds = require('@sap/cds').default;
    cds.transaction = jest.fn().mockReturnValue(mockTransaction);
  });

  describe('enforceClientCompany', () => {
    it('should allow HRAdmin to access any company', async () => {
      (mockRequest.user as any).is = jest.fn((role: string) => role === 'HRAdmin');
      (mockRequest.user as any).attr = jest.fn().mockReturnValue([]);

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1', companyId: 'ACME' },
        { ID: 'client-2', companyId: 'GLOBEX' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).resolves.not.toThrow();
    });

    it('should allow authorized user to access their company', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1', companyId: 'ACME' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).resolves.not.toThrow();
    });

    it('should reject unauthorized user accessing another company', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1', companyId: 'GLOBEX' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).rejects.toThrow('not authorized');
    });

    it('should reject user with no company assignments', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn().mockReturnValue([]);

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1', companyId: 'ACME' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).rejects.toThrow('not authorized');
    });

    it('should handle multiple clients with mixed authorization', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1', companyId: 'ACME' },
        { ID: 'client-2', companyId: 'GLOBEX' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).rejects.toThrow('GLOBEX');
    });

    it('should skip validation for empty array', async () => {
      await expect(enforceClientCompany(mockRequest, [])).resolves.not.toThrow();
    });

    it('should handle clients without companyId', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).resolves.not.toThrow();
    });

    it('should allow users with multiple company assignments', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME', 'GLOBEX'];
        }
        return [];
      });

      const clients: Partial<ClientEntity>[] = [
        { ID: 'client-1', companyId: 'ACME' },
        { ID: 'client-2', companyId: 'GLOBEX' },
      ];

      await expect(enforceClientCompany(mockRequest, clients)).resolves.not.toThrow();
    });
  });

  describe('enforceCostCenterCompany', () => {
    it('should allow HRAdmin to access any cost center', async () => {
      (mockRequest.user as any).is = jest.fn((role: string) => role === 'HRAdmin');
      (mockRequest.user as any).attr = jest.fn().mockReturnValue([]);

      const costCenters: Partial<CostCenterEntity>[] = [
        { ID: 'cc-1', client_ID: 'client-1' },
      ];

      mockTransaction.run.mockResolvedValue([
        { ID: 'client-1', companyId: 'ACME' },
      ]);

      await expect(enforceCostCenterCompany(mockRequest, costCenters)).resolves.not.toThrow();
    });

    it('should allow authorized user to access cost centers from their company', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const costCenters: Partial<CostCenterEntity>[] = [
        { ID: 'cc-1', client_ID: 'client-1' },
      ];

      mockTransaction.run.mockResolvedValue([
        { ID: 'client-1', companyId: 'ACME' },
      ]);

      await expect(enforceCostCenterCompany(mockRequest, costCenters)).resolves.not.toThrow();
    });

    it('should reject unauthorized user accessing cost centers from another company', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const costCenters: Partial<CostCenterEntity>[] = [
        { ID: 'cc-1', client_ID: 'client-1' },
      ];

      mockTransaction.run.mockResolvedValue([
        { ID: 'client-1', companyId: 'GLOBEX' },
      ]);

      await expect(enforceCostCenterCompany(mockRequest, costCenters)).rejects.toThrow('not authorized');
    });

    it('should skip validation for empty array', async () => {
      await expect(enforceCostCenterCompany(mockRequest, [])).resolves.not.toThrow();
    });

    it('should skip validation when no client IDs present', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        { ID: 'cc-1' },
      ];

      await expect(enforceCostCenterCompany(mockRequest, costCenters)).resolves.not.toThrow();
      expect(mockTransaction.run).not.toHaveBeenCalled();
    });
  });

  describe('enforceEmployeeCompany', () => {
    it('should allow HRAdmin to access any employee', async () => {
      (mockRequest.user as any).is = jest.fn((role: string) => role === 'HRAdmin');
      (mockRequest.user as any).attr = jest.fn().mockReturnValue([]);

      const employees: Partial<EmployeeEntity>[] = [
        { ID: 'emp-1', client_ID: 'client-1' },
      ];

      mockTransaction.run.mockResolvedValue([
        { ID: 'client-1', companyId: 'ACME' },
      ]);

      await expect(enforceEmployeeCompany(mockRequest, employees)).resolves.not.toThrow();
    });

    it('should allow authorized user to access employees from their company', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const employees: Partial<EmployeeEntity>[] = [
        { ID: 'emp-1', client_ID: 'client-1' },
      ];

      mockTransaction.run.mockResolvedValue([
        { ID: 'client-1', companyId: 'ACME' },
      ]);

      await expect(enforceEmployeeCompany(mockRequest, employees)).resolves.not.toThrow();
    });

    it('should reject unauthorized user accessing employees from another company', async () => {
      (mockRequest.user as any).is = jest.fn(() => false);
      (mockRequest.user as any).attr = jest.fn((name: string) => {
        if (name === 'CompanyCode' || name === 'companyCodes') {
          return ['ACME'];
        }
        return [];
      });

      const employees: Partial<EmployeeEntity>[] = [
        { ID: 'emp-1', client_ID: 'client-1' },
      ];

      mockTransaction.run.mockResolvedValue([
        { ID: 'client-1', companyId: 'GLOBEX' },
      ]);

      await expect(enforceEmployeeCompany(mockRequest, employees)).rejects.toThrow('not authorized');
    });

    it('should skip validation for empty array', async () => {
      await expect(enforceEmployeeCompany(mockRequest, [])).resolves.not.toThrow();
    });

    it('should skip validation when no client IDs present', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        { ID: 'emp-1' },
      ];

      await expect(enforceEmployeeCompany(mockRequest, employees)).resolves.not.toThrow();
      expect(mockTransaction.run).not.toHaveBeenCalled();
    });
  });
});
