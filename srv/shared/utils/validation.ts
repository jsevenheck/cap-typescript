/**
 * Validation Utilities
 *
 * Common validation functions for data integrity checks
 */

/**
 * Validates email format using RFC 5322 simplified pattern
 *
 * @param email - Email address to validate
 * @returns true if valid email format, false otherwise
 */
export const isValidEmail = (email: string): boolean => {
  if (!email || typeof email !== 'string') {
    return false;
  }

  // Simplified RFC 5322 email pattern
  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailPattern.test(email.trim());
};

/**
 * Validates URL format (http or https)
 *
 * @param url - URL to validate
 * @returns true if valid URL format, false otherwise
 */
export const isValidUrl = (url: string): boolean => {
  if (!url || typeof url !== 'string') {
    return false;
  }

  try {
    const parsedUrl = new URL(url);
    return parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:';
  } catch {
    return false;
  }
};

/**
 * Validates if value is a valid date
 *
 * @param date - Date value to validate (string, Date object, or number)
 * @returns true if valid date, false otherwise
 */
export const isValidDate = (date: unknown): boolean => {
  if (!date) {
    return false;
  }

  const dateObj = date instanceof Date ? date : new Date(date as string | number);
  return dateObj instanceof Date && !isNaN(dateObj.getTime());
};

/**
 * Checks if a date is within a specified range
 *
 * @param date - Date to check
 * @param min - Minimum date (inclusive)
 * @param max - Maximum date (inclusive)
 * @returns true if date is within range, false otherwise
 */
export const isInDateRange = (date: Date, min: Date, max: Date): boolean => {
  if (!isValidDate(date) || !isValidDate(min) || !isValidDate(max)) {
    return false;
  }

  const timestamp = date.getTime();
  return timestamp >= min.getTime() && timestamp <= max.getTime();
};

/**
 * Validates if string is non-empty after trimming
 *
 * @param value - String to validate
 * @returns true if non-empty string, false otherwise
 */
export const isNonEmptyString = (value: unknown): value is string => {
  return typeof value === 'string' && value.trim().length > 0;
};

/**
 * Validates if value is a positive number
 *
 * @param value - Value to validate
 * @returns true if positive number, false otherwise
 */
export const isPositiveNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
};

/**
 * Validates if value is a non-negative number (>= 0)
 *
 * @param value - Value to validate
 * @returns true if non-negative number, false otherwise
 */
export const isNonNegativeNumber = (value: unknown): value is number => {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
};

/**
 * Validates UUID v4 format
 *
 * @param uuid - UUID string to validate
 * @returns true if valid UUID v4, false otherwise
 */
export const isValidUUID = (uuid: string): boolean => {
  if (!uuid || typeof uuid !== 'string') {
    return false;
  }

  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidPattern.test(uuid);
};

/**
 * Validates string length is within range
 *
 * @param value - String to validate
 * @param minLength - Minimum length (inclusive)
 * @param maxLength - Maximum length (inclusive)
 * @returns true if length is within range, false otherwise
 */
export const isValidLength = (value: string, minLength: number, maxLength: number): boolean => {
  if (!value || typeof value !== 'string') {
    return false;
  }

  const length = value.trim().length;
  return length >= minLength && length <= maxLength;
};

/**
 * Validates if value matches a regex pattern
 *
 * @param value - String to validate
 * @param pattern - Regular expression pattern
 * @returns true if value matches pattern, false otherwise
 */
export const matchesPattern = (value: string, pattern: RegExp): boolean => {
  if (!value || typeof value !== 'string') {
    return false;
  }

  return pattern.test(value);
};
