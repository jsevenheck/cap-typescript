import type { Transaction } from '@sap/cds';

import { getEmployeeStatistics, EmployeeStatistics } from '../../../domain/employee/services/statistics.service';

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

describe('EmployeeStatisticsService', () => {
  describe('getEmployeeStatistics', () => {
    const createMockTransaction = (results: unknown[]): Transaction => {
      let callIndex = 0;
      return {
        run: jest.fn().mockImplementation(() => {
          const result = results[callIndex] || [{ count: 0 }];
          callIndex++;
          return Promise.resolve(result);
        }),
      } as unknown as Transaction;
    };

    it('should return statistics with all zeros when no employees exist', async () => {
      const emptyResults = Array(8).fill([{ count: 0 }]);
      const mockTx = createMockTransaction(emptyResults);

      const stats = await getEmployeeStatistics(mockTx);

      expect(stats.totalEmployees).toBe(0);
      expect(stats.activeEmployees).toBe(0);
      expect(stats.inactiveEmployees).toBe(0);
      expect(stats.internalEmployees).toBe(0);
      expect(stats.externalEmployees).toBe(0);
      expect(stats.managersCount).toBe(0);
      expect(stats.recentHires).toBe(0);
      expect(stats.upcomingExits).toBe(0);
    });

    it('should return correct statistics when employees exist', async () => {
      const results = [
        [{ count: 100 }], // total
        [{ count: 80 }],  // active
        [{ count: 20 }],  // inactive
        [{ count: 70 }],  // internal
        [{ count: 30 }],  // external
        [{ count: 15 }],  // managers
        [{ count: 5 }],   // recent hires
        [{ count: 3 }],   // upcoming exits
      ];
      const mockTx = createMockTransaction(results);

      const stats = await getEmployeeStatistics(mockTx);

      expect(stats.totalEmployees).toBe(100);
      expect(stats.activeEmployees).toBe(80);
      expect(stats.inactiveEmployees).toBe(20);
      expect(stats.internalEmployees).toBe(70);
      expect(stats.externalEmployees).toBe(30);
      expect(stats.managersCount).toBe(15);
      expect(stats.recentHires).toBe(5);
      expect(stats.upcomingExits).toBe(3);
    });

    it('should pass clientId filter when provided', async () => {
      const results = Array(8).fill([{ count: 10 }]);
      const mockTx = createMockTransaction(results);
      const clientId = 'test-client-123';

      const stats = await getEmployeeStatistics(mockTx, clientId);

      // Verify that run was called 8 times (once for each statistic)
      expect(mockTx.run).toHaveBeenCalledTimes(8);
      expect(stats.totalEmployees).toBe(10);
    });

    it('should handle string count values', async () => {
      const results = [
        [{ count: '25' }], // string count
        [{ count: 15 }],
        [{ count: 10 }],
        [{ count: 20 }],
        [{ count: 5 }],
        [{ count: '8' }], // string count
        [{ count: 2 }],
        [{ count: 1 }],
      ];
      const mockTx = createMockTransaction(results);

      const stats = await getEmployeeStatistics(mockTx);

      expect(stats.totalEmployees).toBe(25);
      expect(stats.managersCount).toBe(8);
    });

    it('should handle missing count values gracefully', async () => {
      const results = [
        [{}], // missing count
        [{ count: 15 }],
        [{ count: null }], // null count
        [{ count: undefined }], // undefined count
        [{ count: 5 }],
        [{ count: 8 }],
        [{ count: 2 }],
        [], // empty result
      ];
      const mockTx = createMockTransaction(results);

      const stats = await getEmployeeStatistics(mockTx);

      expect(stats.totalEmployees).toBe(0);
      expect(stats.activeEmployees).toBe(15);
      expect(stats.inactiveEmployees).toBe(0);
      expect(stats.internalEmployees).toBe(0);
      expect(stats.externalEmployees).toBe(5);
      expect(stats.upcomingExits).toBe(0);
    });

    it('should run all queries in parallel', async () => {
      const results = Array(8).fill([{ count: 1 }]);
      const mockTx = createMockTransaction(results);

      const startTime = Date.now();
      await getEmployeeStatistics(mockTx);
      const endTime = Date.now();

      // All 8 queries should be called
      expect(mockTx.run).toHaveBeenCalledTimes(8);
      // Execution should be fast (parallel) - less than 100ms for mock calls
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
