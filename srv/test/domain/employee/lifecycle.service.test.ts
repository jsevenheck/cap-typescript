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

import { findEmployeeByEmployeeId } from '../../../domain/employee/repository/employee.repo';

describe('LifecycleService', () => {
  describe('ensureEmployeeIdentifier', () => {
    const mockTx = { run: jest.fn() } as unknown as Transaction;

    const createMockClient = (): ClientEntity => ({
      ID: 'client-123',
      companyId: 'COMP-001',
    });

    beforeEach(() => {
      jest.clearAllMocks();
    });

    describe('employee ID length validation', () => {
      it('should reject employee ID exceeding 60 characters', async () => {
        const client = createMockClient();
        const longEmployeeId = 'A'.repeat(61); // 61 characters

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: longEmployeeId,
        };

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).rejects.toThrow(
          'Employee ID cannot exceed 60 characters.',
        );

        // Should not attempt to check for duplicates if length validation fails
        expect(findEmployeeByEmployeeId).not.toHaveBeenCalled();
      });

      it('should accept employee ID with exactly 60 characters', async () => {
        const client = createMockClient();
        const exactLengthEmployeeId = 'A'.repeat(60); // 60 characters

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: exactLengthEmployeeId,
        };

        // Mock no duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce(null);

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).resolves.not.toThrow();
        expect(findEmployeeByEmployeeId).toHaveBeenCalled();
      });

      it('should accept employee ID with less than 60 characters', async () => {
        const client = createMockClient();
        const shortEmployeeId = 'EMP001';

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: shortEmployeeId,
        };

        // Mock no duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce(null);

        await expect(ensureEmployeeIdentifier(mockTx, data, client)).resolves.not.toThrow();
        expect(findEmployeeByEmployeeId).toHaveBeenCalled();
      });

      it('should trim whitespace before validating length', async () => {
        const client = createMockClient();
        // 59 chars with leading/trailing spaces, trimmed should be 57 chars
        const employeeIdWithSpaces = '  ' + 'A'.repeat(57) + '  ';

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
        const lowercaseEmployeeId = 'emp001lowercase';

        const data: Partial<EmployeeEntity> = {
          client_ID: client.ID,
          employeeId: lowercaseEmployeeId,
        };

        // Mock no duplicate found
        (findEmployeeByEmployeeId as jest.Mock).mockResolvedValueOnce(null);

        await ensureEmployeeIdentifier(mockTx, data, client);

        // Verify that data.employeeId is now uppercase
        expect(data.employeeId).toBe('EMP001LOWERCASE');
      });
    });

    describe('duplicate employee ID detection', () => {
      it('should reject duplicate employee ID', async () => {
        const client = createMockClient();
        const existingEmployeeId = 'EMP001';

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
          'Employee ID EMP001 already exists.',
        );
      });

      it('should allow same employee ID when it matches current identifier', async () => {
        const client = createMockClient();
        const existingEmployeeId = 'EMP001';

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
  });
});
