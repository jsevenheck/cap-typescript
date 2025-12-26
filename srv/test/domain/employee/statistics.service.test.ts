import type { Transaction } from '@sap/cds';

import { getEmployeeStatistics } from '../../../domain/employee/services/statistics.service';

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
    interface MockTransaction {
      tx: Transaction;
      runFn: jest.Mock;
    }

    const createMockTransaction = (results: unknown[]): MockTransaction => {
      let callIndex = 0;
      const runFn = jest.fn().mockImplementation(() => {
        const result = results[callIndex] || [{ count: 0 }];
        callIndex++;
        return Promise.resolve(result);
      });
      return {
        tx: { run: runFn } as unknown as Transaction,
        runFn,
      };
    };

    it('should return statistics with all zeros when no employees exist', async () => {
      const emptyResults = Array(8).fill([{ count: 0 }]);
      const { tx } = createMockTransaction(emptyResults);

      const stats = await getEmployeeStatistics(tx);

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
      const { tx } = createMockTransaction(results);

      const stats = await getEmployeeStatistics(tx);

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
      const { tx, runFn } = createMockTransaction(results);
      const clientId = 'test-client-123';

      const stats = await getEmployeeStatistics(tx, clientId);

      // Verify that run was called 8 times (once for each statistic)
      expect(runFn).toHaveBeenCalledTimes(8);
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
      const { tx } = createMockTransaction(results);

      const stats = await getEmployeeStatistics(tx);

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
      const { tx } = createMockTransaction(results);

      const stats = await getEmployeeStatistics(tx);

      expect(stats.totalEmployees).toBe(0);
      expect(stats.activeEmployees).toBe(15);
      expect(stats.inactiveEmployees).toBe(0);
      expect(stats.internalEmployees).toBe(0);
      expect(stats.externalEmployees).toBe(5);
      expect(stats.upcomingExits).toBe(0);
    });

    it('should run all queries in parallel', async () => {
      const results = Array(8).fill([{ count: 1 }]);
      const { tx, runFn } = createMockTransaction(results);

      const startTime = Date.now();
      await getEmployeeStatistics(tx);
      const endTime = Date.now();

      // All 8 queries should be called
      expect(runFn).toHaveBeenCalledTimes(8);
      // Execution should be fast (parallel) - less than 100ms for mock calls
      expect(endTime - startTime).toBeLessThan(100);
    });
  });
});
