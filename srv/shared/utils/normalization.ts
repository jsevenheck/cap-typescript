/** Shared normalization helpers for domain data. */
/** Normalizes company identifiers to uppercase without leading/trailing whitespace. */
export const normalizeCompanyId = (value?: string | null): string | undefined =>
  value?.trim().toUpperCase() || undefined;

/** Normalizes arbitrary identifiers by trimming whitespace. */
export const normalizeIdentifier = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
};

/** Lower-case normalization for comparison operations. */
export const normalizeForComparison = (value: unknown): string | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : undefined;
};

/** Returns true if both identifiers normalize to the same comparable value. */
export const identifiersMatch = (a: unknown, b: unknown): boolean =>
  normalizeForComparison(a) === normalizeForComparison(b);

/** Removes special characters and uppercases a value to build identifier prefixes. */
export const sanitizeIdentifier = (value: string): string => value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();

/** Ensures cost center codes use uppercase without whitespace. */
export const normalizeCostCenterCode = (value?: string | null): string | undefined =>
  value?.trim().toUpperCase() || undefined;

export const isInactiveStatus = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().toLowerCase() === 'inactive';

export const deriveCountryCodeFromCompanyId = (companyId?: string | null): string | undefined => {
  const normalized = normalizeCompanyId(companyId ?? undefined);
  if (!normalized) {
    return undefined;
  }

  // Strategy 1: Check if first 2 characters form a valid country code
  const firstTwoChars = normalized.slice(0, 2);
  if (isValidCountryCode(firstTwoChars)) {
    return firstTwoChars;
  }

  // Strategy 2: Look for a 2-letter country code after a delimiter
  const match = normalized.match(/(?:^|[-_\s])([A-Z]{2})(?=[-_\s]|$)/);
  if (match && isValidCountryCode(match[1])) {
    return match[1];
  }

  // Strategy 3: Fallback to first 2-letter sequence not surrounded by letters
  const fallbackMatch = normalized.match(/(?:^|[^A-Z])([A-Z]{2})(?=[^A-Z]|$)/);
  return fallbackMatch && isValidCountryCode(fallbackMatch[1]) ? fallbackMatch[1] : undefined;
};

export const isValidCountryCode = (value: string): boolean => /^[A-Z]{2}$/.test(value);
