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

/** Valid ISO 3166-1 alpha-2 country codes */
const VALID_COUNTRY_CODES = new Set([
  'AF', 'AL', 'DZ', 'AS', 'AD', 'AO', 'AI', 'AQ', 'AG', 'AR', 'AM', 'AW', 'AU', 'AT', 'AZ',
  'BS', 'BH', 'BD', 'BB', 'BY', 'BE', 'BZ', 'BJ', 'BM', 'BT', 'BO', 'BQ', 'BA', 'BW', 'BV',
  'BR', 'IO', 'BN', 'BG', 'BF', 'BI', 'CV', 'KH', 'CM', 'CA', 'KY', 'CF', 'TD', 'CL', 'CN',
  'CX', 'CC', 'CO', 'KM', 'CG', 'CD', 'CK', 'CR', 'HR', 'CU', 'CW', 'CY', 'CZ', 'CI', 'DK',
  'DJ', 'DM', 'DO', 'EC', 'EG', 'SV', 'GQ', 'ER', 'EE', 'SZ', 'ET', 'FK', 'FO', 'FJ', 'FI',
  'FR', 'GF', 'PF', 'TF', 'GA', 'GM', 'GE', 'DE', 'GH', 'GI', 'GR', 'GL', 'GD', 'GP', 'GU',
  'GT', 'GG', 'GN', 'GW', 'GY', 'HT', 'HM', 'VA', 'HN', 'HK', 'HU', 'IS', 'IN', 'ID', 'IR',
  'IQ', 'IE', 'IM', 'IL', 'IT', 'JM', 'JP', 'JE', 'JO', 'KZ', 'KE', 'KI', 'KP', 'KR', 'KW',
  'KG', 'LA', 'LV', 'LB', 'LS', 'LR', 'LY', 'LI', 'LT', 'LU', 'MO', 'MG', 'MW', 'MY', 'MV',
  'ML', 'MT', 'MH', 'MQ', 'MR', 'MU', 'YT', 'MX', 'FM', 'MD', 'MC', 'MN', 'ME', 'MS', 'MA',
  'MZ', 'MM', 'NA', 'NR', 'NP', 'NL', 'NC', 'NZ', 'NI', 'NE', 'NG', 'NU', 'NF', 'MK', 'MP',
  'NO', 'OM', 'PK', 'PW', 'PS', 'PA', 'PG', 'PY', 'PE', 'PH', 'PN', 'PL', 'PT', 'PR', 'QA',
  'RO', 'RU', 'RW', 'RE', 'BL', 'SH', 'KN', 'LC', 'MF', 'PM', 'VC', 'WS', 'SM', 'ST', 'SA',
  'SN', 'RS', 'SC', 'SL', 'SG', 'SX', 'SK', 'SI', 'SB', 'SO', 'ZA', 'GS', 'SS', 'ES', 'LK',
  'SD', 'SR', 'SJ', 'SE', 'CH', 'SY', 'TW', 'TJ', 'TZ', 'TH', 'TL', 'TG', 'TK', 'TO', 'TT',
  'TN', 'TM', 'TC', 'TV', 'TR', 'UG', 'UA', 'AE', 'GB', 'US', 'UM', 'UY', 'UZ', 'VU', 'VE',
  'VN', 'VG', 'VI', 'WF', 'EH', 'YE', 'ZM', 'ZW', 'AX',
]);

export const deriveCountryCodeFromCompanyId = (companyId?: string | null): string | undefined => {
  const normalized = normalizeCompanyId(companyId ?? undefined);
  if (!normalized) {
    return undefined;
  }

  const match = normalized.match(/(?:^|[^A-Z])([A-Z]{2})(?=[^A-Z]|$)/);
  const candidate = match ? match[1] : undefined;

  // Only return the derived code if it's actually a valid country code
  return candidate && VALID_COUNTRY_CODES.has(candidate) ? candidate : undefined;
};

export const isValidCountryCode = (value: string): boolean =>
  /^[A-Z]{2}$/.test(value) && VALID_COUNTRY_CODES.has(value);
