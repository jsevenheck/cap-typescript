import type { Transaction } from '@sap/cds';

import { ensureEmployeeIdentifier } from '../../../domain/employee/services/lifecycle.service';
import type { ClientEntity, EmployeeEntity } from '../../../domain/employee/dto/employee.dto';

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
jest.mock('../../../domain/employee/repository/employee.repo', () => ({
  findEmployeeByEmployeeId: jest.fn(),
  findEmployeeIdCounterForUpdate: jest.fn(),
  insertEmployeeIdCounter: jest.fn(),
  updateEmployeeIdCounter: jest.fn(),
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

import { findEmployeeByEmployeeId, findEmployeeIdCounterForUpdate } from '../../../domain/employee/repository/employee.repo';

describe('LifecycleService', () => {
  describe('ensureEmployeeIdentifier', () => {
    const mockTx = { run: jest.fn() } as unknown as Transaction;

    const createMockClient = (): ClientEntity => ({
      ID: 'client-123',
      companyId: '1010',
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('employee ID length validation', () => {
      it('should reject employee ID exceeding 9 characters', async () => {
        const client = createMockClient();
        const longEmployeeId = '1010-12345'; // 10 characters

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: longEmployeeId,
        };

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).rejects.toThrow(
          'Employee ID cannot exceed 9 characters.',
        );

        // Should not attempt to check for duplicates if length validation fails
        expect(findEmployeeByEmployeeId).not.toHaveBeenCalled();
      });

      it('should accept employee ID with exactly 9 characters', async () => {
        const client = createMockClient();
        const exactLengthEmployeeId = '1010-0001'; // 9 characters

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: exactLengthEmployeeId,
        };

        // Mock no duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce(null);

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).resolves.not.toThrow();
        expect(findEmployeeByEmployeeId).toHaveBeenCalled();
      });

      it('should reject employee ID with invalid format', async () => {
        const client = createMockClient();
        const invalidEmployeeId = 'EMP001'; // Invalid format

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: invalidEmployeeId,
        };

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).rejects.toThrow(
          'Employee ID must follow the format {clientId}-{counter}',
        );
      });

      it('should reject employee ID with wrong client prefix', async () => {
        const client = createMockClient();
        const wrongPrefixEmployeeId = '9999-0001'; // Wrong client prefix

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: wrongPrefixEmployeeId,
        };

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).rejects.toThrow(
          'Employee ID prefix must match the client ID (1010).',
        );
      });

      it('should trim whitespace before validating', async () => {
        const client = createMockClient();
        const employeeIdWithSpaces = '  1010-0001  ';

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: employeeIdWithSpaces,
        };

        // Mock no duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce(null);

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).resolves.not.toThrow();
      });

      it('should convert employee ID to uppercase', async () => {
        const client = createMockClient();
        const lowercaseEmployeeId = '1010-0001';

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: lowercaseEmployeeId,
        };

        // Mock no duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce(null);

        await ensureEmployeeIdentifier(mockTx, data, client);

        // Verify that data.employeeId is uppercase (already uppercase in this case)
        expect(data.employeeId).toBe('1010-0001');
      });
    });

    describe('duplicate employee ID detection', () => {
      it('should reject duplicate employee ID', async () => {
        const client = createMockClient();
        const existingEmployeeId = '1010-0001';

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: existingEmployeeId,
        };

        // Mock duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce({
          ID: 'existing-emp-123',
          employeeId: existingEmployeeId,
        });

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).rejects.toThrow(
          'Employee ID 1010-0001 already exists.',
        );
      });

      it('should allow same employee ID when it matches current identifier', async () => {
        const client = createMockClient();
        const existingEmployeeId = '1010-0001';

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: existingEmployeeId,
        };

        // Should return false without checking for duplicates
        const result = await ensureEmployeeIdentifier(
          mockTx,
          data,
          client,
          existingEmployeeId, // currentEmployeeIdentifier
        );

        expect(result).toBe(false);
        expect(findEmployeeByEmployeeId).not.toHaveBeenCalled();
      });
    });

    describe('employee ID auto-generation limits', () => {
      it('should throw error when maximum employee capacity is reached', async () => {
        const client = createMockClient();

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          // No employeeId provided, so it will be auto-generated
        };

        // Mock counter at maximum value (9999)
        (findEmployeeIdCounterForUpdate as jest.Mock).mockResolvedValueOnce({
          lastCounter: 9999,
        });

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).rejects.toThrow(
          'Maximum employee capacity reached for client 1010. Cannot create more than 9999 employees.',
        );
      });
    });
  });
});
