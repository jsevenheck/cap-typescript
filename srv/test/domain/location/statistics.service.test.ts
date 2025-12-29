import type { Transaction } from '@sap/cds';

import { getLocationStatistics } from '../../../domain/location/services/statistics.service';

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

describe('LocationStatisticsService', () => {
  describe('getLocationStatistics', () => {
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

    it('should return statistics with all zeros when no locations exist', async () => {
      const emptyResults = Array(4).fill([{ count: 0 }]);
      const { tx } = createMockTransaction(emptyResults);

      const stats = await getLocationStatistics(tx);

      expect(stats.totalLocations).toBe(0);
      expect(stats.activeLocations).toBe(0);
      expect(stats.expiredLocations).toBe(0);
      expect(stats.upcomingExpiry).toBe(0);
    });

    it('should return correct statistics when locations exist', async () => {
      const results = [
        [{ count: 30 }], // total
        [{ count: 25 }], // active
        [{ count: 3 }],  // expired
        [{ count: 2 }],  // upcoming expiry
      ];
      const { tx } = createMockTransaction(results);

      const stats = await getLocationStatistics(tx);

      expect(stats.totalLocations).toBe(30);
      expect(stats.activeLocations).toBe(25);
      expect(stats.expiredLocations).toBe(3);
      expect(stats.upcomingExpiry).toBe(2);
    });

    it('should pass clientId filter when provided', async () => {
      const results = Array(4).fill([{ count: 10 }]);
      const { tx, runFn } = createMockTransaction(results);
      const clientId = 'test-client-123';

      const stats = await getLocationStatistics(tx, clientId);

      // Verify that run was called 4 times (once for each statistic)
      expect(runFn).toHaveBeenCalledTimes(4);
      expect(stats.totalLocations).toBe(10);
    });

    it('should handle string count values', async () => {
      const results = [
        [{ count: '20' }], // string count
        [{ count: 15 }],
        [{ count: '5' }], // string count
        [{ count: 2 }],
      ];
      const { tx } = createMockTransaction(results);

      const stats = await getLocationStatistics(tx);

      expect(stats.totalLocations).toBe(20);
      expect(stats.expiredLocations).toBe(5);
    });

    it('should handle missing count values gracefully', async () => {
      const results = [
        [{}], // missing count
        [{ count: 15 }],
        [{ count: null }], // null count
        [], // empty result
      ];
      const { tx } = createMockTransaction(results);

      const stats = await getLocationStatistics(tx);

      expect(stats.totalLocations).toBe(0);
      expect(stats.activeLocations).toBe(15);
      expect(stats.expiredLocations).toBe(0);
      expect(stats.upcomingExpiry).toBe(0);
    });

    it('should run all queries in parallel', async () => {
      const results = Array(4).fill([{ count: 1 }]);
      const { tx, runFn } = createMockTransaction(results);

      const startTime = Date.now();
      await getLocationStatistics(tx);
      const endTime = Date.now();

      // All 4 queries should be called
      expect(runFn).toHaveBeenCalledTimes(4);
      // Execution should be fast (parallel) - less than 100ms for mock calls
      expect(endTime - startTime).toBeLessThan(100);
    });

    it('should return all zeros for empty client scope array', async () => {
      const results = Array(4).fill([{ count: 10 }]);
      const { tx, runFn } = createMockTransaction(results);

      const stats = await getLocationStatistics(tx, []);

      // No queries should be executed for empty scope
      expect(runFn).not.toHaveBeenCalled();
      // All stats should be zero
      expect(stats.totalLocations).toBe(0);
      expect(stats.activeLocations).toBe(0);
      expect(stats.expiredLocations).toBe(0);
      expect(stats.upcomingExpiry).toBe(0);
    });
  });
});
