/**
 * Association Utilities
 *
 * Helper functions for working with CAP associations and extracting IDs
 */

/**
 * Extracts association ID from data object
 * Handles both direct ID reference (e.g., manager_ID) and association objects (e.g., { manager: { ID: '...' } })
 *
 * @param data - Entity data
 * @param field - Field name (e.g., 'manager', 'costCenter', 'client')
 * @returns Entity ID or null if not found
 *
 * @example
 * // Direct ID field
 * extractAssociationId({ manager_ID: '123' }, 'manager') // '123'
 *
 * // Association object
 * extractAssociationId({ manager: { ID: '123' } }, 'manager') // '123'
 *
 * // Null association
 * extractAssociationId({ manager_ID: null }, 'manager') // null
 */
export const extractAssociationId = (data: unknown, field: string): string | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;

  // Check for direct ID field (e.g., manager_ID)
  const directIdField = `${field}_ID`;
  if (typeof record[directIdField] === 'string' && record[directIdField]) {
    return record[directIdField] as string;
  }

  // Check for association object (e.g., { manager: { ID: '...' } })
  const associationValue = record[field];
  if (associationValue && typeof associationValue === 'object') {
    const assocRecord = associationValue as Record<string, unknown>;
    if (typeof assocRecord.ID === 'string' && assocRecord.ID) {
      return assocRecord.ID;
    }
  }

  // Check for null explicitly set
  if (record[directIdField] === null || record[field] === null) {
    return null;
  }

  return null;
};

/**
 * Resolves association object from data
 * Returns the full association object if present
 *
 * @param data - Entity data
 * @param field - Field name
 * @returns Association object or null
 *
 * @example
 * resolveAssociation({ manager: { ID: '123', name: 'John' } }, 'manager')
 * // Returns: { ID: '123', name: 'John' }
 */
export const resolveAssociation = <T = Record<string, unknown>>(
  data: unknown,
  field: string,
): T | null => {
  if (!data || typeof data !== 'object') {
    return null;
  }

  const record = data as Record<string, unknown>;
  const associationValue = record[field];

  if (associationValue && typeof associationValue === 'object') {
    return associationValue as T;
  }

  return null;
};

/**
 * Checks if an association is set (either as direct ID or object)
 *
 * @param data - Entity data
 * @param field - Field name
 * @returns true if association is set, false otherwise
 */
export const hasAssociation = (data: unknown, field: string): boolean => {
  return extractAssociationId(data, field) !== null;
};

/**
 * Extracts multiple association IDs from data
 *
 * @param data - Entity data
 * @param fields - Array of field names
 * @returns Map of field names to IDs
 */
export const extractAssociationIds = (
  data: unknown,
  fields: string[],
): Map<string, string | null> => {
  const result = new Map<string, string | null>();

  for (const field of fields) {
    result.set(field, extractAssociationId(data, field));
  }

  return result;
};
