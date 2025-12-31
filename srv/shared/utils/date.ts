/** Utility helpers for parsing and normalising date values. */

/**
 * Calculate the date N days ago from today in ISO format (YYYY-MM-DD).
 */
export const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

/**
 * Calculate the date N days from today in ISO format (YYYY-MM-DD).
 */
export const daysFromNow = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

/**
 * Get today's date in ISO format (YYYY-MM-DD).
 */
export const today = (): string => {
  return new Date().toISOString().split('T')[0];
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
