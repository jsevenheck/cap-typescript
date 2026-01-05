import { sanitizeString, isValidUUID, isValidISODate } from '../../middleware/inputValidation';

describe('inputValidation utility functions', () => {
  describe('sanitizeString', () => {
    it('should remove control characters from string', () => {
      const input = 'Hello\x00World\x1F';
      const result = sanitizeString(input);
      expect(result).toBe('HelloWorld');
    });

    it('should remove angle brackets from string', () => {
      const input = '<script>alert("xss")</script>';
      const result = sanitizeString(input);
      expect(result).toBe('scriptalert("xss")/script');
    });

    it('should trim whitespace', () => {
      const input = '  Hello World  ';
      const result = sanitizeString(input);
      expect(result).toBe('Hello World');
    });

    it('should handle empty string', () => {
      const result = sanitizeString('');
      expect(result).toBe('');
    });

    it('should handle null input', () => {
      const result = sanitizeString(null as unknown as string);
      expect(result).toBe('');
    });

    it('should handle undefined input', () => {
      const result = sanitizeString(undefined as unknown as string);
      expect(result).toBe('');
    });

    it('should handle non-string input', () => {
      const result = sanitizeString(123 as unknown as string);
      expect(result).toBe('');
    });

    it('should remove multiple control characters and angle brackets', () => {
      const input = '<div>\x00\x1F<script>alert(1)</script></div>';
      const result = sanitizeString(input);
      expect(result).toBe('divscriptalert(1)/script/div');
    });

    it('should preserve normal text', () => {
      const input = 'Hello World 123 !@#$%';
      const result = sanitizeString(input);
      expect(result).toBe('Hello World 123 !@#$%');
    });

    it('should handle strings with only control characters', () => {
      const input = '\x00\x01\x02\x1F';
      const result = sanitizeString(input);
      expect(result).toBe('');
    });
  });

  describe('isValidUUID', () => {
    it('should validate correct UUIDv1', () => {
      const uuid = '550e8400-e29b-11d4-a716-446655440000';
      expect(isValidUUID(uuid)).toBe(true);
    });

    it('should validate correct UUIDv4', () => {
      const uuid = '123e4567-e89b-42d3-a456-426614174000';
      expect(isValidUUID(uuid)).toBe(true);
    });

    it('should validate correct UUIDv5', () => {
      const uuid = '886313e1-3b8a-5372-9b90-0c9aee199e5d';
      expect(isValidUUID(uuid)).toBe(true);
    });

    it('should reject invalid UUID format', () => {
      const uuid = 'not-a-uuid';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should reject UUID with wrong length', () => {
      const uuid = '550e8400-e29b-11d4-a716-44665544000';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should reject UUID with missing hyphens', () => {
      const uuid = '550e8400e29b11d4a716446655440000';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should reject UUID with invalid characters', () => {
      const uuid = '550e8400-e29b-11d4-a716-44665544000g';
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidUUID('')).toBe(false);
    });

    it('should reject UUID with wrong version digit', () => {
      const uuid = '550e8400-e29b-61d4-a716-446655440000'; // version 6 doesn't exist in standard
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should reject UUID with wrong variant', () => {
      const uuid = '550e8400-e29b-41d4-c716-446655440000'; // variant 'c' is invalid
      expect(isValidUUID(uuid)).toBe(false);
    });

    it('should handle case insensitive validation', () => {
      const uuid = '550E8400-E29B-41D3-A716-446655440000';
      expect(isValidUUID(uuid)).toBe(true);
    });
  });

  describe('isValidISODate', () => {
    it('should validate correct ISO date', () => {
      const date = '2024-01-15';
      expect(isValidISODate(date)).toBe(true);
    });

    it('should validate correct ISO datetime', () => {
      const date = '2024-01-15T10:30:00Z';
      expect(isValidISODate(date)).toBe(true);
    });

    it('should validate correct ISO datetime with milliseconds', () => {
      const date = '2024-01-15T10:30:00.123Z';
      expect(isValidISODate(date)).toBe(true);
    });

    it('should validate correct ISO datetime with timezone', () => {
      const date = '2024-01-15T10:30:00+01:00';
      expect(isValidISODate(date)).toBe(true);
    });

    it('should reject invalid month (13)', () => {
      const date = '2024-13-15';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should reject invalid month (0)', () => {
      const date = '2024-00-15';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should reject invalid day (32)', () => {
      const date = '2024-01-32';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should reject invalid day (0)', () => {
      const date = '2024-01-00';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should reject February 30', () => {
      const date = '2024-02-30';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should accept February 29 in leap year', () => {
      const date = '2024-02-29';
      expect(isValidISODate(date)).toBe(true);
    });

    it('should reject February 29 in non-leap year', () => {
      const date = '2023-02-29';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should validate correct days for 30-day months', () => {
      expect(isValidISODate('2024-04-30')).toBe(true);
      expect(isValidISODate('2024-06-30')).toBe(true);
      expect(isValidISODate('2024-09-30')).toBe(true);
      expect(isValidISODate('2024-11-30')).toBe(true);
    });

    it('should reject day 31 for 30-day months', () => {
      expect(isValidISODate('2024-04-31')).toBe(false);
      expect(isValidISODate('2024-06-31')).toBe(false);
      expect(isValidISODate('2024-09-31')).toBe(false);
      expect(isValidISODate('2024-11-31')).toBe(false);
    });

    it('should validate correct days for 31-day months', () => {
      expect(isValidISODate('2024-01-31')).toBe(true);
      expect(isValidISODate('2024-03-31')).toBe(true);
      expect(isValidISODate('2024-05-31')).toBe(true);
      expect(isValidISODate('2024-07-31')).toBe(true);
      expect(isValidISODate('2024-08-31')).toBe(true);
      expect(isValidISODate('2024-10-31')).toBe(true);
      expect(isValidISODate('2024-12-31')).toBe(true);
    });

    it('should reject invalid date format', () => {
      const date = '15-01-2024';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should reject empty string', () => {
      expect(isValidISODate('')).toBe(false);
    });

    it('should reject null', () => {
      expect(isValidISODate(null as unknown as string)).toBe(false);
    });

    it('should reject undefined', () => {
      expect(isValidISODate(undefined as unknown as string)).toBe(false);
    });

    it('should reject non-string', () => {
      expect(isValidISODate(123 as unknown as string)).toBe(false);
    });

    it('should reject malformed date string', () => {
      const date = '2024-1-5';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should reject date with letters', () => {
      const date = '2024-AB-15';
      expect(isValidISODate(date)).toBe(false);
    });

    it('should handle century year leap years correctly', () => {
      // 2000 is a leap year (divisible by 400)
      expect(isValidISODate('2000-02-29')).toBe(true);
      // 1900 is not a leap year (divisible by 100 but not 400)
      expect(isValidISODate('1900-02-29')).toBe(false);
      // 2100 is not a leap year
      expect(isValidISODate('2100-02-29')).toBe(false);
    });

    it('should validate edge case year 1', () => {
      expect(isValidISODate('0001-01-01')).toBe(true);
    });

    it('should validate future dates', () => {
      expect(isValidISODate('9999-12-31')).toBe(true);
    });
  });
});
