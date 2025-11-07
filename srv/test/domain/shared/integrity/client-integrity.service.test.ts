import type { Transaction } from '@sap/cds';
import {
  enforceCostCenterRelations,
  enforceEmployeeRelations,
} from '../../../../domain/shared/integrity/client-integrity.service';
import type { CostCenterEntity, EmployeeEntity } from '../../../../shared/types/models';

// Mock dependencies
jest.mock('@sap/cds', () => {
  const actual = jest.requireActual('@sap/cds');
  return {
    __esModule: true,
    ...actual,
    default: {
      ...actual.default,
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

describe('Client Integrity Service', () => {
  let mockTransaction: Transaction;

  beforeEach(() => {
    jest.clearAllMocks();

    mockTransaction = {
      run: jest.fn(),
    } as unknown as Transaction;
  });

  describe('enforceCostCenterRelations', () => {
    it('should validate when all relations are correct', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        {
          ID: 'cc-1',
          client_ID: 'client-1',
          responsible_ID: 'emp-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([{ ID: 'emp-1', client_ID: 'client-1' }]); // Employee exists and belongs to client

      await expect(enforceCostCenterRelations(mockTransaction, costCenters)).resolves.not.toThrow();
    });

    it('should reject when referenced client does not exist', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        {
          ID: 'cc-1',
          client_ID: 'client-1',
        },
      ];

      (mockTransaction.run as jest.Mock).mockResolvedValueOnce([]); // Client doesn't exist

      await expect(enforceCostCenterRelations(mockTransaction, costCenters)).rejects.toThrow('do not exist');
    });

    it('should reject when responsible employee does not exist', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        {
          ID: 'cc-1',
          client_ID: 'client-1',
          responsible_ID: 'emp-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([]); // Employee doesn't exist

      await expect(enforceCostCenterRelations(mockTransaction, costCenters)).rejects.toThrow('does not exist');
    });

    it('should reject when responsible employee belongs to different client', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        {
          ID: 'cc-1',
          client_ID: 'client-1',
          responsible_ID: 'emp-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([{ ID: 'emp-1', client_ID: 'client-2' }]); // Employee belongs to different client

      await expect(enforceCostCenterRelations(mockTransaction, costCenters)).rejects.toThrow('does not belong to client');
    });

    it('should skip validation for empty array', async () => {
      await expect(enforceCostCenterRelations(mockTransaction, [])).resolves.not.toThrow();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockTransaction.run).not.toHaveBeenCalled();
    });

    it('should validate only client when no responsible is set', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        {
          ID: 'cc-1',
          client_ID: 'client-1',
        },
      ];

      (mockTransaction.run as jest.Mock).mockResolvedValueOnce([{ ID: 'client-1' }]);

      await expect(enforceCostCenterRelations(mockTransaction, costCenters)).resolves.not.toThrow();
    });

    it('should handle multiple cost centers', async () => {
      const costCenters: Partial<CostCenterEntity>[] = [
        { ID: 'cc-1', client_ID: 'client-1', responsible_ID: 'emp-1' },
        { ID: 'cc-2', client_ID: 'client-2', responsible_ID: 'emp-2' },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }, { ID: 'client-2' }]) // Both clients exist
        .mockResolvedValueOnce([
          { ID: 'emp-1', client_ID: 'client-1' },
          { ID: 'emp-2', client_ID: 'client-2' },
        ]); // Both employees exist and belong to correct clients

      await expect(enforceCostCenterRelations(mockTransaction, costCenters)).resolves.not.toThrow();
    });
  });

  describe('enforceEmployeeRelations', () => {
    it('should validate when all relations are correct', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
          manager_ID: 'mgr-1',
          costCenter_ID: 'cc-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([{ ID: 'mgr-1', client_ID: 'client-1' }]) // Manager exists and belongs to client
        .mockResolvedValueOnce([{ ID: 'cc-1', client_ID: 'client-1' }]); // Cost center exists and belongs to client

      await expect(enforceEmployeeRelations(mockTransaction, employees)).resolves.not.toThrow();
    });

    it('should reject when referenced client does not exist', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
        },
      ];

      (mockTransaction.run as jest.Mock).mockResolvedValueOnce([]); // Client doesn't exist

      await expect(enforceEmployeeRelations(mockTransaction, employees)).rejects.toThrow('do not exist');
    });

    it('should reject when manager does not exist', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
          manager_ID: 'mgr-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([]); // Manager doesn't exist

      await expect(enforceEmployeeRelations(mockTransaction, employees)).rejects.toThrow('does not exist');
    });

    it('should reject when manager belongs to different client', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
          manager_ID: 'mgr-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([{ ID: 'mgr-1', client_ID: 'client-2' }]); // Manager belongs to different client

      await expect(enforceEmployeeRelations(mockTransaction, employees)).rejects.toThrow('does not belong to client');
    });

    it('should reject when cost center does not exist', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
          costCenter_ID: 'cc-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([]); // Cost center doesn't exist

      await expect(enforceEmployeeRelations(mockTransaction, employees)).rejects.toThrow('does not exist');
    });

    it('should reject when cost center belongs to different client', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
          costCenter_ID: 'cc-1',
        },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }]) // Client exists
        .mockResolvedValueOnce([{ ID: 'cc-1', client_ID: 'client-2' }]); // Cost center belongs to different client

      await expect(enforceEmployeeRelations(mockTransaction, employees)).rejects.toThrow('does not belong to client');
    });

    it('should skip validation for empty array', async () => {
      await expect(enforceEmployeeRelations(mockTransaction, [])).resolves.not.toThrow();
      // eslint-disable-next-line @typescript-eslint/unbound-method
      expect(mockTransaction.run).not.toHaveBeenCalled();
    });

    it('should validate only client when no manager or cost center is set', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        {
          ID: 'emp-1',
          client_ID: 'client-1',
        },
      ];

      (mockTransaction.run as jest.Mock).mockResolvedValueOnce([{ ID: 'client-1' }]);

      await expect(enforceEmployeeRelations(mockTransaction, employees)).resolves.not.toThrow();
    });

    it('should handle multiple employees', async () => {
      const employees: Partial<EmployeeEntity>[] = [
        { ID: 'emp-1', client_ID: 'client-1', manager_ID: 'mgr-1' },
        { ID: 'emp-2', client_ID: 'client-2', costCenter_ID: 'cc-2' },
      ];

      (mockTransaction.run as jest.Mock)
        .mockResolvedValueOnce([{ ID: 'client-1' }, { ID: 'client-2' }]) // Both clients exist
        .mockResolvedValueOnce([{ ID: 'mgr-1', client_ID: 'client-1' }]) // Manager exists
        .mockResolvedValueOnce([{ ID: 'cc-2', client_ID: 'client-2' }]); // Cost center exists

      await expect(enforceEmployeeRelations(mockTransaction, employees)).resolves.not.toThrow();
    });
  });
});
