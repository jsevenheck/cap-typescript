import type { Transaction } from '@sap/cds';

import { anonymizeFormerEmployees } from '../../../domain/employee/services/retention.service';
import type { UserContext } from '../../../shared/utils/auth';

// Mock the cds module
jest.mock('@sap/cds', () => ({
  ql: {
    SELECT: {
      from: jest.fn().mockReturnThis(),
      columns: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    },
    UPDATE: jest.fn().mockImplementation(() => ({
      set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
    })),
  },
}));

// Mock the repository functions
jest.mock('../../../domain/employee/repository/employee.repo', () => ({
  listEmployeesForAnonymization: jest.fn(),
  anonymizeEmployeeRecord: jest.fn(),
}));

// Mock the logger
jest.mock('../../../shared/utils/logger', () => ({
  getLogger: jest.fn().mockReturnValue({
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  }),
}));

import {
  listEmployeesForAnonymization,
  anonymizeEmployeeRecord,
} from '../../../domain/employee/repository/employee.repo';

describe('RetentionService', () => {
  describe('anonymizeFormerEmployees', () => {
    const mockTx = { run: jest.fn() } as unknown as Transaction;

    const createAdminUser = (): UserContext => ({
      roles: new Set(['HRAdmin']),
      attributes: {},
    });

    const createEditorUser = (companyCodes: string[]): UserContext => ({
      roles: new Set(['HREditor']),
      attributes: {
        CompanyCode: companyCodes,
        companyCodes: companyCodes,
      },
    });

    beforeEach(() => {
      jest.clearAllMocks();
      // Reset environment variable
      delete process.env.ANONYMIZATION_BATCH_SIZE;
    });

    it('should throw error when before parameter is missing', async () => {
      const user = createAdminUser();

      await expect(anonymizeFormerEmployees(mockTx, user, undefined)).rejects.toThrow(
        'Parameter "before" must be a valid date.'
      );
    });

    it('should throw error when before parameter is invalid date', async () => {
      const user = createAdminUser();

      await expect(anonymizeFormerEmployees(mockTx, user, 'not-a-date')).rejects.toThrow(
        'Parameter "before" must be a valid date.'
      );
    });

    it('should return 0 when no employees match the criteria', async () => {
      const user = createAdminUser();
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce([]);

      const result = await anonymizeFormerEmployees(mockTx, user, '2024-01-01');

      expect(result).toBe(0);
      expect(anonymizeEmployeeRecord).not.toHaveBeenCalled();
    });

    it('should anonymize matching employees for admin user', async () => {
      const user = createAdminUser();
      const employees = [
        { ID: 'emp-1', employeeId: 'EMP001' },
        { ID: 'emp-2', employeeId: 'EMP002' },
      ];
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce(employees);
      (anonymizeEmployeeRecord as jest.Mock).mockResolvedValue(undefined);

      const result = await anonymizeFormerEmployees(mockTx, user, '2024-06-01');

      expect(result).toBe(2);
      expect(anonymizeEmployeeRecord).toHaveBeenCalledTimes(2);
      expect(anonymizeEmployeeRecord).toHaveBeenCalledWith(
        mockTx,
        'emp-1',
        expect.stringContaining('@example.invalid'),
        'ANONYMIZED'
      );
      expect(anonymizeEmployeeRecord).toHaveBeenCalledWith(
        mockTx,
        'emp-2',
        expect.stringContaining('@example.invalid'),
        'ANONYMIZED'
      );
    });

    it('should anonymize employees filtered by company code for non-admin user', async () => {
      const user = createEditorUser(['1010']);
      const employees = [{ ID: 'emp-1', employeeId: '1010-0001' }];
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce(employees);
      (anonymizeEmployeeRecord as jest.Mock).mockResolvedValue(undefined);

      const result = await anonymizeFormerEmployees(mockTx, user, '2024-06-01');

      expect(result).toBe(1);
      expect(listEmployeesForAnonymization).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          'client.companyId': { in: ['1010'] },
        })
      );
    });

    it('should throw error when non-admin user has no company codes', async () => {
      const user: UserContext = {
        roles: new Set(['HREditor']),
        attributes: {},
      };

      await expect(anonymizeFormerEmployees(mockTx, user, '2024-01-01')).rejects.toThrow(
        'User is not authorized for any company.'
      );
    });

    it('should accept Date object as before parameter', async () => {
      const user = createAdminUser();
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce([]);

      const result = await anonymizeFormerEmployees(mockTx, user, new Date('2024-06-01'));

      expect(result).toBe(0);
      expect(listEmployeesForAnonymization).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          exitDate: { '<': '2024-06-01' },
        })
      );
    });

    it('should handle large batch of employees', async () => {
      const user = createAdminUser();
      // Create 150 employees to test batching (default batch size is 100)
      const employees = Array.from({ length: 150 }, (_, i) => ({
        ID: `emp-${i}`,
        employeeId: `EMP${String(i).padStart(3, '0')}`,
      }));
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce(employees);
      (anonymizeEmployeeRecord as jest.Mock).mockResolvedValue(undefined);

      const result = await anonymizeFormerEmployees(mockTx, user, '2024-06-01');

      expect(result).toBe(150);
      expect(anonymizeEmployeeRecord).toHaveBeenCalledTimes(150);
    });

    it('should use custom batch size from environment variable', async () => {
      process.env.ANONYMIZATION_BATCH_SIZE = '50';
      const user = createAdminUser();
      const employees = Array.from({ length: 100 }, (_, i) => ({
        ID: `emp-${i}`,
        employeeId: `EMP${String(i).padStart(3, '0')}`,
      }));
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce(employees);
      (anonymizeEmployeeRecord as jest.Mock).mockResolvedValue(undefined);

      const result = await anonymizeFormerEmployees(mockTx, user, '2024-06-01');

      expect(result).toBe(100);
      expect(anonymizeEmployeeRecord).toHaveBeenCalledTimes(100);
    });

    it('should generate proper anonymized email addresses', async () => {
      const user = createAdminUser();
      const employees = [
        { ID: 'emp-1', employeeId: 'EMP001' },
        { ID: 'emp-2', employeeId: undefined },
      ];
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce(employees);
      (anonymizeEmployeeRecord as jest.Mock).mockResolvedValue(undefined);

      await anonymizeFormerEmployees(mockTx, user, '2024-06-01');

      expect(anonymizeEmployeeRecord).toHaveBeenCalledWith(
        mockTx,
        'emp-1',
        expect.stringMatching(/^anonymized-emp001@example\.invalid$/i),
        'ANONYMIZED'
      );
      expect(anonymizeEmployeeRecord).toHaveBeenCalledWith(
        mockTx,
        'emp-2',
        'anonymized@example.invalid',
        'ANONYMIZED'
      );
    });

    it('should normalize company codes from user attributes', async () => {
      const user: UserContext = {
        roles: new Set(['HREditor']),
        attributes: {
          CompanyCode: ['  1010  ', '1020'],
        },
      };
      (listEmployeesForAnonymization as jest.Mock).mockResolvedValueOnce([]);

      await anonymizeFormerEmployees(mockTx, user, '2024-06-01');

      expect(listEmployeesForAnonymization).toHaveBeenCalledWith(
        mockTx,
        expect.objectContaining({
          'client.companyId': { in: expect.arrayContaining(['1010', '1020']) },
        })
      );
    });
  });
});
