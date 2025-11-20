/**
 * Formatters for UI5 data binding with XSS protection
 * All formatters properly escape HTML and handle null/undefined values
 */

/**
 * Safely escape HTML special characters to prevent XSS
 */
function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Safely format text with HTML escaping
 */
export function formatText(text?: string | null): string {
  if (!text) return '';
  return escapeHtml(String(text));
}

/**
 * Format person name (firstName + lastName)
 */
export function formatPersonName(firstName?: string | null, lastName?: string | null): string {
  const first = firstName ? escapeHtml(String(firstName)) : '';
  const last = lastName ? escapeHtml(String(lastName)) : '';
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
  const emailText = email ? escapeHtml(String(email)) : '';
  const typeText = employmentType
    ? ` • ${escapeHtml(employmentType === 'external' ? 'External' : 'Internal')}`
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
  if (!clientName) return escapeHtml(baseTitle);
  const safeName = escapeHtml(String(clientName));
  return `${escapeHtml(baseTitle)} ${safeName}`;
}

/**
 * Format company ID display text
 */
export function formatCompanyIdText(companyId?: string | null): string {
  if (!companyId) return '';
  return `Company ID: ${escapeHtml(String(companyId))}`;
}

/**
 * Format cost center title (Code - Name)
 */
export function formatCostCenterTitle(code?: string | null, name?: string | null): string {
  const codeText = code ? escapeHtml(String(code)) : '';
  const nameText = name ? ` - ${escapeHtml(String(name))}` : '';
  return `${codeText}${nameText}`.trim();
}

/**
 * Format location title (Street, City)
 */
export function formatLocationTitle(street?: string | null, city?: string | null): string {
  const streetText = street ? escapeHtml(String(street)) : '';
  const cityText = city ? escapeHtml(String(city)) : '';
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
  const zipText = zipCode ? escapeHtml(String(zipCode)) : '';
  const countryText = countryCode ? escapeHtml(String(countryCode)) : '';
  if (zipText && countryText) {
    return `${zipText} • ${countryText}`;
  }
  return zipText || countryText;
}

/**
 * Format country display (Name (Code))
 */
export function formatCountryDisplay(name?: string | null, code?: string | null): string {
  const nameText = name ? escapeHtml(String(name)) : '';
  const codeText = code ? ` (${escapeHtml(String(code))})` : '';
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
