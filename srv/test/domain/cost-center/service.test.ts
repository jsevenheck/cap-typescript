import type { Transaction } from '@sap/cds';

import { prepareCostCenterUpsert, validateCostCenterDeletion } from '../../../domain/cost-center/services/service';
import type { UserContext } from '../../../shared/utils/auth';

// Mock the cds module
jest.mock('@sap/cds', () => ({
  ql: {
    SELECT: {
      from: jest.fn().mockReturnThis(),
      columns: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    },
  },
}));

// Mock the repository functions
jest.mock('../../../domain/cost-center/repository/cost-center.repo', () => ({
  findClientById: jest.fn(),
  findCostCenterById: jest.fn(),
  findCostCenterByCode: jest.fn(),
  findEmployeeById: jest.fn(),
  findEmployeesByCostCenter: jest.fn(),
  selectColumns: jest.fn((cols) => cols),
  hasRequiredFields: jest.fn(() => true),
  isRecord: jest.fn(() => true),
  projectEntity: jest.fn((record) => record),
}));

// Mock the concurrency module
jest.mock('../../../shared/utils/concurrency', () => ({
  ensureOptimisticConcurrency: jest.fn().mockResolvedValue(undefined),
}));

// Mock the authorization function
jest.mock('../../../domain/client/services/lifecycle.service', () => ({
  ensureUserAuthorizedForCompany: jest.fn(),
}));

import {
  findClientById,
  findCostCenterById,
  findCostCenterByCode,
  findEmployeeById,
  findEmployeesByCostCenter,
} from '../../../domain/cost-center/repository/cost-center.repo';
import { ensureUserAuthorizedForCompany } from '../../../domain/client/services/lifecycle.service';

describe('CostCenterService', () => {
  const mockTx = { run: jest.fn() } as unknown as Transaction;

  const createAdminUser = (): UserContext => ({
    roles: new Set(['HRAdmin']),
    attributes: {},
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (mockTx.run as jest.Mock).mockResolvedValue([]);
  });

  describe('prepareCostCenterUpsert', () => {
    const mockClient = { ID: 'client-1', companyId: 'COMP-001' };
    const mockEmployee = { ID: 'emp-1', client_ID: 'client-1' };

    beforeEach(() => {
      (findClientById as jest.Mock).mockResolvedValue(mockClient);
      (findEmployeeById as jest.Mock).mockResolvedValue(mockEmployee);
      (findCostCenterByCode as jest.Mock).mockResolvedValue(null);
    });

    it('should throw error when request data is missing client_ID for CREATE', async () => {
      const user = createAdminUser();

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: { code: 'CC-001', name: 'Test CC' },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Client reference is required.');
    });

    it('should throw error when responsible_ID is missing', async () => {
      const user = createAdminUser();

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: { code: 'CC-001', name: 'Test CC', client_ID: 'client-1' },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Responsible employee is required.');
    });

    it('should throw error when responsible employee does not exist', async () => {
      const user = createAdminUser();
      (findEmployeeById as jest.Mock).mockResolvedValue(null);

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: {
            code: 'CC-001',
            name: 'Test CC',
            client_ID: 'client-1',
            responsible_ID: 'emp-999',
            validFrom: '2024-01-01',
          },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Responsible employee emp-999 not found.');
    });

    it('should throw error when responsible employee belongs to different client', async () => {
      const user = createAdminUser();
      (findEmployeeById as jest.Mock).mockResolvedValue({ ID: 'emp-1', client_ID: 'client-2' });

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: {
            code: 'CC-001',
            name: 'Test CC',
            client_ID: 'client-1',
            responsible_ID: 'emp-1',
            validFrom: '2024-01-01',
          },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Responsible employee must belong to the same client.');
    });

    it('should throw error when cost center code already exists for client', async () => {
      const user = createAdminUser();
      (findCostCenterByCode as jest.Mock).mockResolvedValue({ ID: 'existing-cc' });

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: {
            code: 'CC-001',
            name: 'Test CC',
            client_ID: 'client-1',
            responsible_ID: 'emp-1',
            validFrom: '2024-01-01',
          },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Cost center code CC-001 already exists for this client.');
    });

    it('should throw error when validFrom is missing', async () => {
      const user = createAdminUser();

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: {
            code: 'CC-001',
            name: 'Test CC',
            client_ID: 'client-1',
            responsible_ID: 'emp-1',
          },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('validFrom is required.');
    });

    it('should throw error when validFrom is after validTo', async () => {
      const user = createAdminUser();

      await expect(
        prepareCostCenterUpsert({
          event: 'CREATE',
          data: {
            code: 'CC-001',
            name: 'Test CC',
            client_ID: 'client-1',
            responsible_ID: 'emp-1',
            validFrom: '2024-12-01',
            validTo: '2024-01-01',
          },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('validFrom must be less than or equal to validTo.');
    });

    it('should successfully prepare cost center upsert for CREATE', async () => {
      const user = createAdminUser();

      const result = await prepareCostCenterUpsert({
        event: 'CREATE',
        data: {
          code: 'CC-001',
          name: 'Test CC',
          client_ID: 'client-1',
          responsible_ID: 'emp-1',
          validFrom: '2024-01-01',
          validTo: '2024-12-31',
        },
        tx: mockTx,
        user,
      });

      expect(result).toHaveProperty('updates');
      expect(result).toHaveProperty('client');
      expect(result.updates.client_ID).toBe('client-1');
      expect(result.updates.responsible_ID).toBe('emp-1');
      expect(ensureUserAuthorizedForCompany).toHaveBeenCalledWith(user, 'COMP-001');
    });

    it('should normalize cost center code to uppercase', async () => {
      const user = createAdminUser();

      const result = await prepareCostCenterUpsert({
        event: 'CREATE',
        data: {
          code: 'cc-001',
          name: 'Test CC',
          client_ID: 'client-1',
          responsible_ID: 'emp-1',
          validFrom: '2024-01-01',
        },
        tx: mockTx,
        user,
      });

      expect(result.updates.code).toBe('CC-001');
    });

    it('should throw error for UPDATE without targetId', async () => {
      const user = createAdminUser();

      await expect(
        prepareCostCenterUpsert({
          event: 'UPDATE',
          data: { name: 'Updated CC' },
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Cost center identifier is required.');
    });

    it('should throw error for UPDATE when cost center not found', async () => {
      const user = createAdminUser();
      (findCostCenterById as jest.Mock).mockResolvedValue(null);

      await expect(
        prepareCostCenterUpsert({
          event: 'UPDATE',
          data: { name: 'Updated CC' },
          targetId: 'cc-999',
          tx: mockTx,
          user,
        })
      ).rejects.toThrow('Cost center cc-999 not found.');
    });

    it('should successfully prepare cost center upsert for UPDATE', async () => {
      const user = createAdminUser();
      const existingCostCenter = {
        ID: 'cc-1',
        client_ID: 'client-1',
        responsible_ID: 'emp-1',
        validFrom: '2024-01-01',
        validTo: null,
      };
      (findCostCenterById as jest.Mock).mockResolvedValue(existingCostCenter);

      const result = await prepareCostCenterUpsert({
        event: 'UPDATE',
        data: { name: 'Updated CC' },
        targetId: 'cc-1',
        tx: mockTx,
        user,
      });

      expect(result).toHaveProperty('updates');
      expect(result).toHaveProperty('client');
      expect(ensureUserAuthorizedForCompany).toHaveBeenCalledWith(user, 'COMP-001');
    });
  });

  describe('validateCostCenterDeletion', () => {
    const mockClient = { ID: 'client-1', companyId: 'COMP-001' };
    const mockCostCenter = { ID: 'cc-1', client_ID: 'client-1' };

    beforeEach(() => {
      (findClientById as jest.Mock).mockResolvedValue(mockClient);
      (findCostCenterById as jest.Mock).mockResolvedValue(mockCostCenter);
      (findEmployeesByCostCenter as jest.Mock).mockResolvedValue(0);
      (mockTx.run as jest.Mock).mockResolvedValue([{ count: 0 }]);
    });

    it('should throw error when cost center not found', async () => {
      const user = createAdminUser();
      (findCostCenterById as jest.Mock).mockResolvedValue(null);

      await expect(
        validateCostCenterDeletion({
          targetId: 'cc-999',
          tx: mockTx,
          user,
          concurrency: { hasHttpHeaders: false },
        })
      ).rejects.toThrow('Cost center cc-999 not found.');
    });

    it('should throw error when employees are assigned to cost center', async () => {
      const user = createAdminUser();
      (findEmployeesByCostCenter as jest.Mock).mockResolvedValue(5);

      await expect(
        validateCostCenterDeletion({
          targetId: 'cc-1',
          tx: mockTx,
          user,
          concurrency: { hasHttpHeaders: false },
        })
      ).rejects.toThrow('Cannot delete cost center: 5 employee(s) are still assigned to it.');
    });

    it('should throw error when assignments exist for cost center', async () => {
      const user = createAdminUser();
      (mockTx.run as jest.Mock).mockResolvedValue([{ count: 3 }]);

      await expect(
        validateCostCenterDeletion({
          targetId: 'cc-1',
          tx: mockTx,
          user,
          concurrency: { hasHttpHeaders: false },
        })
      ).rejects.toThrow('Cannot delete cost center: 3 assignment record(s) exist. This would result in loss of historical data.');
    });

    it('should successfully validate deletion when no dependencies exist', async () => {
      const user = createAdminUser();

      await expect(
        validateCostCenterDeletion({
          targetId: 'cc-1',
          tx: mockTx,
          user,
          concurrency: { hasHttpHeaders: false },
        })
      ).resolves.toBeUndefined();

      expect(ensureUserAuthorizedForCompany).toHaveBeenCalledWith(user, 'COMP-001');
    });
  });
});
