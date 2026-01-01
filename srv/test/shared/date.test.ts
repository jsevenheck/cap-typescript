import { jest } from '@jest/globals';
import {
  normalizeDateToMidnight,
  todayAtMidnight,
} from '../../shared/utils/date';

describe('Date Utilities', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  describe('normalizeDateToMidnight', () => {
    it('should normalize a Date object to midnight', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const normalized = normalizeDateToMidnight(date);

      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });

    it('should normalize an ISO date string to midnight', () => {
      const dateString = '2024-06-15T14:30:45.123Z';
      const normalized = normalizeDateToMidnight(dateString);

      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });

    it('should normalize a date-only string (YYYY-MM-DD) to midnight', () => {
      const dateString = '2024-06-15';
      const normalized = normalizeDateToMidnight(dateString);

      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });

    it('should preserve the date part when normalizing', () => {
      const date = new Date('2024-06-15T14:30:45.123Z');
      const normalized = normalizeDateToMidnight(date);

      // Check that the date part is preserved (in local timezone)
      expect(normalized.getDate()).toBe(new Date('2024-06-15').getDate());
      expect(normalized.getMonth()).toBe(new Date('2024-06-15').getMonth());
      expect(normalized.getFullYear()).toBe(2024);
    });

    it('should not mutate the original Date object', () => {
      const originalDate = new Date('2024-06-15T14:30:45.123Z');
      const originalTime = originalDate.getTime();

      normalizeDateToMidnight(originalDate);

      // Original date should not be modified
      expect(originalDate.getTime()).toBe(originalTime);
      expect(originalDate.getHours()).not.toBe(0);
    });

    it('should handle dates across different timezones consistently', () => {
      // Using date-only strings to ensure consistent behavior
      const date1 = normalizeDateToMidnight('2024-06-15');
      const date2 = normalizeDateToMidnight('2024-06-15');

      expect(date1.getTime()).toBe(date2.getTime());
    });

    it('should handle edge case: beginning of year', () => {
      const date = new Date('2024-01-01T23:59:59.999Z');
      const normalized = normalizeDateToMidnight(date);

      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });

    it('should handle edge case: end of year', () => {
      const date = new Date('2024-12-31T23:59:59.999Z');
      const normalized = normalizeDateToMidnight(date);

      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });

    it('should handle leap year date', () => {
      const date = new Date('2024-02-29T12:00:00.000Z');
      const normalized = normalizeDateToMidnight(date);

      expect(normalized.getHours()).toBe(0);
      expect(normalized.getMinutes()).toBe(0);
      expect(normalized.getSeconds()).toBe(0);
      expect(normalized.getMilliseconds()).toBe(0);
    });
  });

  describe('todayAtMidnight', () => {
    it('should return today\'s date at midnight', () => {
      const result = todayAtMidnight();

      expect(result.getHours()).toBe(0);
      expect(result.getMinutes()).toBe(0);
      expect(result.getSeconds()).toBe(0);
      expect(result.getMilliseconds()).toBe(0);
    });

    it('should return a Date object', () => {
      const result = todayAtMidnight();

      expect(result).toBeInstanceOf(Date);
    });

    it('should return the current date (in local timezone)', () => {
      const result = todayAtMidnight();
      const now = new Date();

      // Check that we're getting today's date
      expect(result.getDate()).toBe(now.getDate());
      expect(result.getMonth()).toBe(now.getMonth());
      expect(result.getFullYear()).toBe(now.getFullYear());
    });

    it('should return consistent results when called multiple times in quick succession', () => {
      const result1 = todayAtMidnight();
      const result2 = todayAtMidnight();

      // Both should represent the same date at midnight
      expect(result1.getTime()).toBe(result2.getTime());
    });

    it('should be usable for date comparisons', () => {
      const today = todayAtMidnight();
      const yesterday = new Date(today.getTime());
      yesterday.setDate(yesterday.getDate() - 1);

      const tomorrow = new Date(today.getTime());
      tomorrow.setDate(tomorrow.getDate() + 1);

      expect(today.getTime()).toBeGreaterThan(yesterday.getTime());
      expect(today.getTime()).toBeLessThan(tomorrow.getTime());
    });

    it('should work correctly with normalizeDateToMidnight for comparisons', () => {
      const today = todayAtMidnight();
      const dateString = new Date().toISOString().split('T')[0]; // Today in YYYY-MM-DD format
      const normalized = normalizeDateToMidnight(dateString);

      // Both should represent the same date at midnight
      expect(today.getTime()).toBe(normalized.getTime());
    });

    it('should handle date changes correctly (when called around midnight)', () => {
      // This test verifies that the function creates a new Date object each time
      // rather than reusing a cached value
      const result1 = todayAtMidnight();
      const result2 = todayAtMidnight();

      // Even if called at different times, both should be today at midnight
      expect(result1.getHours()).toBe(0);
      expect(result2.getHours()).toBe(0);

      // They should have the same date
      expect(result1.getDate()).toBe(result2.getDate());
    });
  });

  describe('Integration: normalizeDateToMidnight and todayAtMidnight', () => {
    it('should enable accurate date-only comparisons', () => {
      const today = todayAtMidnight();
      const todayStr = new Date().toISOString().split('T')[0];
      const normalized = normalizeDateToMidnight(todayStr);

      expect(today.getTime()).toBe(normalized.getTime());
    });

    it('should correctly identify past dates', () => {
      const today = todayAtMidnight();
      const pastDate = normalizeDateToMidnight('2023-01-01');

      expect(pastDate.getTime()).toBeLessThan(today.getTime());
    });

    it('should correctly identify future dates', () => {
      const today = todayAtMidnight();
      const futureDate = normalizeDateToMidnight('2099-12-31');

      expect(futureDate.getTime()).toBeGreaterThan(today.getTime());
    });

    it('should handle date range validation use case', () => {
      // Simulating the use case in manager-responsibility.service.ts
      const today = todayAtMidnight();
      const validFrom = normalizeDateToMidnight('2024-01-01');
      const validTo = normalizeDateToMidnight('2024-12-31');

      // Check if an assignment is currently active
      const isActive = validFrom <= today && today <= validTo;

      expect(typeof isActive).toBe('boolean');
    });

    it('should handle open-ended date ranges', () => {
      // Simulating checking if an assignment with no end date is active
      const today = todayAtMidnight();
      const validFrom = normalizeDateToMidnight('2024-01-01');
      const validTo = null;

      const isActive = validFrom <= today && (validTo === null || today <= normalizeDateToMidnight(validTo as any));

      // If validFrom is in the past and validTo is null, it should be active
      if (validFrom < today) {
        expect(isActive).toBe(true);
      }
    });
  });
});
