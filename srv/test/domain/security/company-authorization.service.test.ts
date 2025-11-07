import type { Request } from '@sap/cds';

jest.mock('@sap/cds', () => {
  const transaction = jest.fn(() => ({}) as unknown);
  return {
    __esModule: true,
    default: { transaction },
    transaction,
  };
});

jest.mock('../../../domain/client/repository/client.repo', () => ({
  findClientById: jest.fn(),
}));

jest.mock('../../../domain/cost-center/repository/cost-center.repo', () => ({
  findCostCenterById: jest.fn(),
}));

jest.mock('../../../domain/employee/repository/employee.repo', () => ({
  findEmployeeById: jest.fn(),
}));

import { findClientById } from '../../../domain/client/repository/client.repo';
import { findCostCenterById } from '../../../domain/cost-center/repository/cost-center.repo';
import { findEmployeeById } from '../../../domain/employee/repository/employee.repo';
import {
  enforceClientCompany,
  enforceCostCenterCompany,
  enforceEmployeeCompany,
} from '../../../domain/shared/security/company-authorization.service';

const mockFindClientById = findClientById as jest.MockedFunction<typeof findClientById>;
const mockFindCostCenterById = findCostCenterById as jest.MockedFunction<typeof findCostCenterById>;
const mockFindEmployeeById = findEmployeeById as jest.MockedFunction<typeof findEmployeeById>;

const createRequest = (user: unknown): Request => ({ user } as unknown as Request);

const createUser = (roles: string[] = [], attributes: Record<string, string[] | string> = {}) => ({
  is: (role: string) => roles.includes(role),
  attr: (name: string) => attributes[name],
});

describe('company-authorization.service', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe('enforceClientCompany', () => {
    it('allows users with matching company assignment', async () => {
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-001'] });
      const req = createRequest(user);

      await expect(
        enforceClientCompany(req, [
          { companyId: 'comp-001' },
          { companyId: 'COMP-001' },
        ]),
      ).resolves.toBeUndefined();
      expect(mockFindClientById).not.toHaveBeenCalled();
    });

    it('loads existing clients when company is absent', async () => {
      mockFindClientById.mockResolvedValueOnce({ ID: 'CLIENT-1', companyId: 'COMP-002' } as any);
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-002'] });
      const req = createRequest(user);

      await expect(enforceClientCompany(req, [{ ID: 'CLIENT-1' }])).resolves.toBeUndefined();
      expect(mockFindClientById).toHaveBeenCalledTimes(1);
      const clientCall = mockFindClientById.mock.calls[0];
      expect(clientCall[1]).toBe('CLIENT-1');
      expect(clientCall[2]).toEqual(['ID', 'companyId']);
    });

    it('rejects users without company assignments', async () => {
      const user = createUser(['HRViewer'], {});
      const req = createRequest(user);

      await expect(enforceClientCompany(req, [{ companyId: 'COMP-001' }])).rejects.toMatchObject({
        code: 'UNAUTHORIZED_COMPANY',
      });
    });

    it('rejects when user lacks authorization for the company', async () => {
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-999'] });
      const req = createRequest(user);

      await expect(enforceClientCompany(req, [{ companyId: 'COMP-001' }])).rejects.toMatchObject({
        code: 'UNAUTHORIZED_COMPANY',
      });
    });

    it('bypasses authorization for HR administrators', async () => {
      const user = createUser(['HRAdmin'], {});
      const req = createRequest(user);

      await expect(enforceClientCompany(req, [{ companyId: 'COMP-001' }])).resolves.toBeUndefined();
      expect(mockFindClientById).not.toHaveBeenCalled();
    });
  });

  describe('enforceCostCenterCompany', () => {
    it('validates client association for cost centers', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      mockFindCostCenterById.mockResolvedValue({ ID: 'COST-2', client_ID: 'CLIENT-1' } as any);
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-001'] });
      const req = createRequest(user);

      await expect(
        enforceCostCenterCompany(req, [
          { client_ID: 'CLIENT-1' },
          { ID: 'COST-2' },
        ]),
      ).resolves.toBeUndefined();
    });

    it('loads existing cost centers when client is missing', async () => {
      mockFindCostCenterById.mockResolvedValueOnce({ ID: 'COST-1', client_ID: 'CLIENT-1' } as any);
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-001' } as any);
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-001'] });
      const req = createRequest(user);

      await expect(enforceCostCenterCompany(req, [{ ID: 'COST-1' }])).resolves.toBeUndefined();
      expect(mockFindCostCenterById).toHaveBeenCalledTimes(1);
      const costCenterCall = mockFindCostCenterById.mock.calls[0];
      expect(costCenterCall[1]).toBe('COST-1');
      expect(costCenterCall[2]).toEqual(['ID', 'client_ID']);
    });

    it('throws when cost center belongs to unauthorized company', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-002' } as any);
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-001'] });
      const req = createRequest(user);

      await expect(enforceCostCenterCompany(req, [{ client_ID: 'CLIENT-1' }])).rejects.toMatchObject({
        code: 'UNAUTHORIZED_COMPANY',
      });
    });
  });

  describe('enforceEmployeeCompany', () => {
    it('allows employees assigned to authorized clients', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-003' } as any);
      mockFindEmployeeById.mockResolvedValue({ ID: 'EMP-2', client_ID: 'CLIENT-1' } as any);
      const user = createUser(['HREditor'], { CompanyCode: ['COMP-003'] });
      const req = createRequest(user);

      await expect(
        enforceEmployeeCompany(req, [
          { client_ID: 'CLIENT-1' },
          { ID: 'EMP-2' },
        ]),
      ).resolves.toBeUndefined();
    });

    it('derives client from existing employee when not provided', async () => {
      mockFindEmployeeById.mockResolvedValueOnce({ ID: 'EMP-1', client_ID: 'CLIENT-5' } as any);
      mockFindClientById.mockResolvedValueOnce({ ID: 'CLIENT-5', companyId: 'COMP-005' } as any);
      const user = createUser(['HREditor'], { CompanyCode: ['COMP-005'] });
      const req = createRequest(user);

      await expect(enforceEmployeeCompany(req, [{ ID: 'EMP-1' }])).resolves.toBeUndefined();
    });

    it('uses cost center association when employee client is missing', async () => {
      mockFindCostCenterById.mockResolvedValueOnce({ ID: 'COST-7', client_ID: 'CLIENT-9' } as any);
      mockFindClientById.mockResolvedValueOnce({ ID: 'CLIENT-9', companyId: 'COMP-009' } as any);
      const user = createUser(['HREditor'], { CompanyCode: ['COMP-009'] });
      const req = createRequest(user);

      await expect(enforceEmployeeCompany(req, [{ costCenter_ID: 'COST-7' }])).resolves.toBeUndefined();
    });

    it('rejects unauthorized employees', async () => {
      mockFindClientById.mockResolvedValue({ ID: 'CLIENT-1', companyId: 'COMP-010' } as any);
      const user = createUser(['HRViewer'], { CompanyCode: ['COMP-011'] });
      const req = createRequest(user);

      await expect(enforceEmployeeCompany(req, [{ client_ID: 'CLIENT-1' }])).rejects.toMatchObject({
        code: 'UNAUTHORIZED_COMPANY',
      });
    });
  });
});
