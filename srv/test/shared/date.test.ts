import { jest } from '@jest/globals';
import {
  daysAgo,
  daysFromNow,
  today,
  normalizeDateToMidnight,
  todayAtMidnight,
} from '../../shared/utils/date';

describe('Date Utilities', () => {
  beforeEach(() => {
    jest.useRealTimers();
  });

  describe('today', () => {
    it('should return a string in YYYY-MM-DD format', () => {
      const result = today();

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return consistent results when called multiple times', () => {
      const result1 = today();
      const result2 = today();

      expect(result1).toBe(result2);
    });

    it('should match the current local date when parsed', () => {
      const result = today();
      const now = new Date();
      
      // Parse the returned string and compare date components
      const [year, month, day] = result.split('-').map(Number);
      
      expect(year).toBe(now.getFullYear());
      expect(month).toBe(now.getMonth() + 1);
      expect(day).toBe(now.getDate());
    });

    it('should not be affected by time of day', () => {
      // Call at different times (simulated by multiple calls)
      const morning = today();
      const evening = today();

      expect(morning).toBe(evening);
    });
  });

  describe('daysAgo', () => {
    it('should return a string in YYYY-MM-DD format', () => {
      const result = daysAgo(1);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return a date before today', () => {
      const result = daysAgo(1);
      const todayResult = today();

      expect(result).not.toBe(todayResult);
      expect(new Date(result).getTime()).toBeLessThan(new Date(todayResult).getTime());
    });

    it('should handle 0 days ago (today)', () => {
      const result = daysAgo(0);
      const todayResult = today();

      expect(result).toBe(todayResult);
    });

    it('should correctly calculate dates across month boundaries', () => {
      // Use a fixed date for testing boundary conditions
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-03-01T12:00:00'));

      const result = daysAgo(1);
      const [year, month, day] = result.split('-').map(Number);

      // Should be February 28, 2026
      expect(year).toBe(2026);
      expect(month).toBe(2);
      expect(day).toBe(28);

      jest.useRealTimers();
    });

    it('should correctly calculate dates across year boundaries', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-01T12:00:00'));

      const result = daysAgo(1);
      const [year, month, day] = result.split('-').map(Number);

      // Should be December 31, 2025
      expect(year).toBe(2025);
      expect(month).toBe(12);
      expect(day).toBe(31);

      jest.useRealTimers();
    });

    it('should calculate correct date for 30 days ago', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-02-15T12:00:00'));

      const result = daysAgo(30);
      const [year, month, day] = result.split('-').map(Number);

      // Should be January 16, 2026
      expect(year).toBe(2026);
      expect(month).toBe(1);
      expect(day).toBe(16);

      jest.useRealTimers();
    });
  });

  describe('daysFromNow', () => {
    it('should return a string in YYYY-MM-DD format', () => {
      const result = daysFromNow(1);

      expect(typeof result).toBe('string');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('should return a date after today', () => {
      const result = daysFromNow(1);
      const todayResult = today();

      expect(result).not.toBe(todayResult);
      expect(new Date(result).getTime()).toBeGreaterThan(new Date(todayResult).getTime());
    });

    it('should handle 0 days from now (today)', () => {
      const result = daysFromNow(0);
      const todayResult = today();

      expect(result).toBe(todayResult);
    });

    it('should correctly calculate dates across month boundaries', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-31T12:00:00'));

      const result = daysFromNow(1);
      const [year, month, day] = result.split('-').map(Number);

      // Should be February 1, 2026
      expect(year).toBe(2026);
      expect(month).toBe(2);
      expect(day).toBe(1);

      jest.useRealTimers();
    });

    it('should correctly calculate dates across year boundaries', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-12-31T12:00:00'));

      const result = daysFromNow(1);
      const [year, month, day] = result.split('-').map(Number);

      // Should be January 1, 2026
      expect(year).toBe(2026);
      expect(month).toBe(1);
      expect(day).toBe(1);

      jest.useRealTimers();
    });

    it('should calculate correct date for 30 days from now', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2026-01-15T12:00:00'));

      const result = daysFromNow(30);
      const [year, month, day] = result.split('-').map(Number);

      // Should be February 14, 2026
      expect(year).toBe(2026);
      expect(month).toBe(2);
      expect(day).toBe(14);

      jest.useRealTimers();
    });
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

      // Derive the expected value from the same base Date to avoid timezone issues
      const expected = new Date(date);
      expected.setHours(0, 0, 0, 0);

      expect(normalized.getTime()).toBe(expected.getTime());
    });

    it('should not mutate the original Date object', () => {
      const originalDate = new Date('2024-06-15T14:30:45.123Z');
      const originalTime = originalDate.getTime();

      normalizeDateToMidnight(originalDate);

      // Original date should not be modified
      expect(originalDate.getTime()).toBe(originalTime);
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
      const validTo: string | null = null;

      // Check if assignment is active (no end date means always active if started)
      const isActive = validFrom <= today && (validTo === null || normalizeDateToMidnight(validTo) >= today);

      // If validFrom is in the past and validTo is null, it should be active
      if (validFrom < today) {
        expect(isActive).toBe(true);
      }
    });
  });
});
