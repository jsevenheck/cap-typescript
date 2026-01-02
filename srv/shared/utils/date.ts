/** Utility helpers for parsing and normalising date values. */

/**
 * Formats a Date object to ISO date string (YYYY-MM-DD) using local timezone.
 * @param date - Date object to format
 * @returns ISO date string in YYYY-MM-DD format
 */
const formatDateToISOString = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Calculate the date N days ago from today in ISO format (YYYY-MM-DD).
 * Uses local timezone to avoid date shifts when converting to/from UTC.
 */
export const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return formatDateToISOString(date);
};

/**
 * Calculate the date N days from today in ISO format (YYYY-MM-DD).
 * Uses local timezone to avoid date shifts when converting to/from UTC.
 */
export const daysFromNow = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatDateToISOString(date);
};

/**
 * Get today's date in ISO format (YYYY-MM-DD).
 * Uses local timezone to avoid date shifts when converting to/from UTC.
 */
export const today = (): string => {
  return formatDateToISOString(new Date());
};

/** Converts a variety of input types into a valid Date or undefined. */
export const toDateValue = (value: unknown): Date | undefined => {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? undefined : value;
  }

  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed;
  }

  return undefined;
};

/**
 * Validates that validFrom is before validTo for date range fields.
 * Throws an error if validation fails.
 *
 * @param validFrom - The start date of the range
 * @param validTo - The end date of the range (optional)
 * @param entityName - Name of the entity for error messaging
 * @throws {Error} If validFrom >= validTo
 */
export const validateDateRange = (
  validFrom: unknown,
  validTo: unknown,
  entityName: string = 'entity',
): void => {
  // If validTo is not provided, validation passes
  if (validTo === null || validTo === undefined) {
    return;
  }

  const fromDate = toDateValue(validFrom);
  const toDate = toDateValue(validTo);

  // If either date is invalid, let other validation catch it
  if (!fromDate || !toDate) {
    return;
  }

  // Validate that validFrom <= validTo (same-day validity is allowed)
  if (fromDate > toDate) {
    throw new Error(
      `Invalid date range for ${entityName}: validFrom must be on or before validTo (validFrom: ${fromDate.toISOString()}, validTo: ${toDate.toISOString()})`,
    );
  }
};

/**
 * Normalize a Date object to midnight (00:00:00.000) in local timezone.
 * Useful for date-only comparisons to avoid time-of-day issues.
 *
 * @param date - Date object or ISO date string to normalize
 * @returns Normalized Date object at midnight
 */
export const normalizeDateToMidnight = (date: Date | string): Date => {
  const d = typeof date === 'string' ? new Date(date) : new Date(date.getTime());
  d.setHours(0, 0, 0, 0);
  return d;
};

/**
 * Get today's date normalized to midnight in local timezone.
 * Use for date-only business logic comparisons.
 *
 * @returns Today's date at midnight
 */
export const todayAtMidnight = (): Date => {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
};
