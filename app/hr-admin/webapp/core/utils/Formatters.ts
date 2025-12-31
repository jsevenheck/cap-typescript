/**
 * Formatters for UI5 data binding
 * UI5 automatically escapes text bindings, so no manual HTML escaping is needed
 */

/**
 * Format text with null/undefined handling
 */
export function formatText(text?: string | null): string {
  if (!text) return '';
  return String(text);
}

/**
 * Format person name (firstName + lastName)
 */
export function formatPersonName(firstName?: string | null, lastName?: string | null): string {
  const first = firstName ? String(firstName) : '';
  const last = lastName ? String(lastName) : '';
  return `${first} ${last}`.trim();
}

/**
 * Format employee title for list (Name + Employment Type)
 */
export function formatEmployeeTitle(
  firstName?: string | null,
  lastName?: string | null,
): string {
  return formatPersonName(firstName, lastName);
}

/**
 * Format employee description (Email + Employment Type)
 */
export function formatEmployeeDescription(
  email?: string | null,
  employmentType?: string | null,
): string {
  const emailText = email ? String(email) : '';
  const typeText = employmentType
    ? ` • ${employmentType === 'external' ? 'External' : 'Internal'}`
    : '';
  return `${emailText}${typeText}`.trim();
}

/**
 * Format employee status text
 */
export function formatEmployeeStatus(status?: string | null): string {
  if (!status) return 'Active';
  return status === 'inactive' ? 'Inactive' : 'Active';
}

/**
 * Format employee status state (for infoState property)
 */
export function formatEmployeeStatusState(status?: string | null): string {
  return status === 'inactive' ? 'Warning' : 'Success';
}

/**
 * Format page title with client name (e.g., "Employees of ClientName")
 */
export function formatPageTitle(
  baseTitle: string,
  clientName?: string | null,
): string {
  if (!clientName) return baseTitle;
  return `${baseTitle} ${String(clientName)}`;
}

/**
 * Format company ID display text
 */
export function formatCompanyIdText(companyId?: string | null): string {
  if (!companyId) return '';
  return `Company ID: ${String(companyId)}`;
}

/**
 * Format cost center title (Code - Name)
 */
export function formatCostCenterTitle(code?: string | null, name?: string | null): string {
  const codeText = code ? String(code) : '';
  const nameText = name ? ` - ${String(name)}` : '';
  return `${codeText}${nameText}`.trim();
}

/**
 * Format location title (Street, City)
 */
export function formatLocationTitle(street?: string | null, city?: string | null): string {
  const streetText = street ? String(street) : '';
  const cityText = city ? String(city) : '';
  if (streetText && cityText) {
    return `${streetText}, ${cityText}`;
  }
  return streetText || cityText;
}

/**
 * Format location description (ZipCode • Country)
 */
export function formatLocationDescription(
  zipCode?: string | null,
  countryCode?: string | null,
): string {
  const zipText = zipCode ? String(zipCode) : '';
  const countryText = countryCode ? String(countryCode) : '';
  if (zipText && countryText) {
    return `${zipText} • ${countryText}`;
  }
  return zipText || countryText;
}

/**
 * Format country display (Name (Code))
 */
export function formatCountryDisplay(name?: string | null, code?: string | null): string {
  const nameText = name ? String(name) : '';
  const codeText = code ? ` (${String(code)})` : '';
  return `${nameText}${codeText}`.trim();
}

/**
 * Format boolean as Yes/No
 */
export function formatBoolean(value?: boolean | null): string {
  return value ? 'Yes' : 'No';
}

/**
 * Check if a value is not empty (for visibility/enabled bindings)
 */
export function isNotEmpty(value?: string | null): boolean {
  return Boolean(value && String(value).trim().length > 0);
}

/**
 * Format date to locale string
 */
export function formatDate(date?: string | Date | null): string {
  if (!date) return '';
  try {
    const dateObj = typeof date === 'string' ? new Date(date) : date;
    return dateObj.toLocaleDateString();
  } catch {
    return '';
  }
}

/**
 * Check if a validity period has expired (validTo is in the past or equal to now)
 */
export function isExpired(validTo?: string | Date | null): boolean {
  if (!validTo) return false;
  try {
    const toDate = typeof validTo === 'string' ? new Date(validTo) : validTo;
    return toDate <= new Date();
  } catch {
    return false;
  }
}

/**
 * Format validity status text (Active/Expired)
 * @param validTo - The end date of the validity period
 * @param expiredText - Text to display when expired (default: 'Expired')
 * @param activeText - Text to display when active (default: 'Active')
 */
export function formatValidityStatus(
  validTo?: string | Date | null,
  expiredText: string = 'Expired',
  activeText: string = 'Active',
): string {
  return isExpired(validTo) ? expiredText : activeText;
}

/**
 * Format validity status state (for infoState property)
 */
export function formatValidityStatusState(validTo?: string | Date | null): string {
  return isExpired(validTo) ? 'Error' : 'Success';
}

/**
 * Format validity period display (validFrom → validTo or "Open ended")
 */
export function formatValidityPeriod(
  validFrom?: string | Date | null,
  validTo?: string | Date | null,
  openEndedText?: string,
): string {
  const from = formatDate(validFrom);
  const to = validTo ? formatDate(validTo) : (openEndedText || 'Open ended');
  if (!from && !validTo) return '';
  if (!from) return `→ ${to}`;
  return `${from} → ${to}`;
}
