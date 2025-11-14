/**
 * Centralized utilities for handling CAP associations and foreign key relationships.
 *
 * These utilities handle multiple association formats:
 * - Direct FK: { manager_ID: "123" }
 * - Nested object: { manager: { ID: "123" } }
 * - Mixed: { manager_ID: "123", manager: {...} }
 */

/**
 * Extracts the ID from an association field.
 * Handles multiple formats and normalizes the output.
 *
 * @param data - The entity data object
 * @param associationName - Name of the association (e.g., "manager", "client")
 * @returns The association ID (string), null (explicitly cleared), or undefined (not provided)
 *
 * @example
 * ```typescript
 * // Direct FK
 * extractAssociationId({ manager_ID: "123" }, "manager") // => "123"
 *
 * // Nested object
 * extractAssociationId({ manager: { ID: "123" } }, "manager") // => "123"
 *
 * // Explicit null
 * extractAssociationId({ manager_ID: null }, "manager") // => null
 *
 * // Not provided
 * extractAssociationId({}, "manager") // => undefined
 * ```
 */
export function extractAssociationId(
  data: any,
  associationName: string
): string | null | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  // Check foreign key field first (e.g., manager_ID)
  const fkField = `${associationName}_ID`;
  if (Object.prototype.hasOwnProperty.call(data, fkField)) {
    const value = data[fkField];
    if (value === null || value === undefined) {
      return value;
    }
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
    return null;
  }

  // Check nested association object (e.g., manager: { ID: "123" })
  const association = data[associationName];
  if (association === null) {
    return null;
  }
  if (association && typeof association === 'object') {
    const id = association.ID ?? association.id ?? association.Id;
    if (typeof id === 'string' && id.trim()) {
      return id.trim();
    }
    if (id === null) {
      return null;
    }
  }

  return undefined;
}

/**
 * Checks if an association was explicitly provided in the payload.
 * Returns true if either FK or nested object is present.
 *
 * @param data - The entity data object
 * @param associationName - Name of the association
 * @returns true if the association was provided in the payload
 *
 * @example
 * ```typescript
 * isAssociationProvided({ manager_ID: "123" }, "manager") // => true
 * isAssociationProvided({ manager: { ID: "123" } }, "manager") // => true
 * isAssociationProvided({}, "manager") // => false
 * ```
 */
export function isAssociationProvided(
  data: any,
  associationName: string
): boolean {
  if (!data || typeof data !== 'object') {
    return false;
  }

  const fkField = `${associationName}_ID`;
  return (
    Object.prototype.hasOwnProperty.call(data, fkField) ||
    Object.prototype.hasOwnProperty.call(data, associationName)
  );
}

/**
 * Sets the association ID in the data object.
 * Clears any nested association object to avoid conflicts.
 *
 * @param data - The entity data object (mutated in place)
 * @param associationName - Name of the association
 * @param id - The ID to set, or null to clear
 *
 * @example
 * ```typescript
 * const data = { manager: { ID: "old" } };
 * setAssociationId(data, "manager", "new");
 * // data is now { manager_ID: "new" }
 * ```
 */
export function setAssociationId(
  data: any,
  associationName: string,
  id: string | null
): void {
  if (!data || typeof data !== 'object') {
    return;
  }

  const fkField = `${associationName}_ID`;
  data[fkField] = id;

  // Clear nested object if present to avoid conflicts
  if (Object.prototype.hasOwnProperty.call(data, associationName)) {
    delete data[associationName];
  }
}

/**
 * Extracts the primary ID from an entity object.
 * Supports multiple ID field names (ID, id, Id).
 *
 * @param data - The entity data object
 * @returns The entity ID, or undefined if not found
 *
 * @example
 * ```typescript
 * extractEntityId({ ID: "123", name: "John" }) // => "123"
 * extractEntityId({ id: "456" }) // => "456"
 * extractEntityId({}) // => undefined
 * ```
 */
export function extractEntityId(data: any): string | undefined {
  if (!data || typeof data !== 'object') {
    return undefined;
  }

  const id = data.ID ?? data.id ?? data.Id;
  return typeof id === 'string' && id.trim() ? id.trim() : undefined;
}

/**
 * Batch extraction of association IDs from multiple entities.
 * Returns a Set of unique, non-empty IDs.
 *
 * @param entries - Array of entity data objects
 * @param associationName - Name of the association to extract
 * @returns Set of unique association IDs (nulls and undefined excluded)
 *
 * @example
 * ```typescript
 * const employees = [
 *   { manager_ID: "123" },
 *   { manager_ID: "456" },
 *   { manager_ID: "123" }, // duplicate
 *   { manager_ID: null },  // excluded
 *   {}                      // excluded
 * ];
 * extractAssociationIds(employees, "manager") // => Set { "123", "456" }
 * ```
 */
export function extractAssociationIds(
  entries: any[],
  associationName: string
): Set<string> {
  const ids = new Set<string>();

  for (const entry of entries) {
    const id = extractAssociationId(entry, associationName);
    if (typeof id === 'string' && id.trim()) {
      ids.add(id.trim());
    }
  }

  return ids;
}

/**
 * Batch extraction of entity IDs from multiple entities.
 * Returns a Set of unique, non-empty IDs.
 *
 * @param entries - Array of entity data objects
 * @returns Set of unique entity IDs
 *
 * @example
 * ```typescript
 * const employees = [
 *   { ID: "123", name: "Alice" },
 *   { ID: "456", name: "Bob" },
 *   { ID: "123", name: "Alice" }, // duplicate
 *   { name: "Charlie" }            // no ID, excluded
 * ];
 * extractEntityIds(employees) // => Set { "123", "456" }
 * ```
 */
export function extractEntityIds(entries: any[]): Set<string> {
  const ids = new Set<string>();

  for (const entry of entries) {
    const id = extractEntityId(entry);
    if (id) {
      ids.add(id);
    }
  }

  return ids;
}

/**
 * Resolves an association ID with fallback to existing value.
 * Useful for UPDATE operations where the association might not be in the payload.
 *
 * @param data - The entity data object (potentially partial for updates)
 * @param associationName - Name of the association
 * @param existingValue - The current value from the database
 * @returns The resolved association ID (from data or existing), or null
 *
 * @example
 * ```typescript
 * // Association provided in update
 * resolveAssociationId({ manager_ID: "new" }, "manager", "old") // => "new"
 *
 * // Association not in update, use existing
 * resolveAssociationId({}, "manager", "old") // => "old"
 *
 * // Association explicitly cleared
 * resolveAssociationId({ manager_ID: null }, "manager", "old") // => null
 * ```
 */
export function resolveAssociationId(
  data: any,
  associationName: string,
  existingValue?: string | null
): string | null {
  const explicit = extractAssociationId(data, associationName);
  if (explicit !== undefined) {
    return explicit;
  }
  return existingValue ?? null;
}
