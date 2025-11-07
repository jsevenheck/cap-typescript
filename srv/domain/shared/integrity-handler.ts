/**
 * Client Integrity Handler
 *
 * Enforces referential integrity to ensure employees and cost centers
 * always reference entities belonging to the same client.
 *
 * Validation Rules:
 * 1. Employee manager must belong to same client as employee
 * 2. Employee cost center must belong to same client as employee
 * 3. Cost center responsible employee must belong to same client as cost center
 */
import type { Transaction } from '@sap/cds';
import { createServiceError } from '../../shared/utils/errors';

/**
 * Cache for storing entity-to-client mappings to minimize database queries
 */
interface LookupCache {
  clientIds: Map<string, string>;
}

/**
 * Creates a new lookup cache instance
 */
const createCache = (): LookupCache => ({
  clientIds: new Map(),
});

/**
 * Fetches the client ID for a given entity, with caching
 *
 * @param tx - CAP transaction
 * @param entityName - Entity name (e.g., 'clientmgmt.Employees', 'clientmgmt.CostCenters')
 * @param entityId - Entity UUID
 * @param cache - Lookup cache to minimize queries
 * @returns Client ID or null if entity not found
 */
const fetchClientId = async (
  tx: Transaction,
  entityName: string,
  entityId: string,
  cache: LookupCache,
): Promise<string | null> => {
  const cacheKey = `${entityName}:${entityId}`;

  // Check cache first
  if (cache.clientIds.has(cacheKey)) {
    return cache.clientIds.get(cacheKey)!;
  }

  // Query database
  const result = await tx.run(
    // @ts-expect-error - CDS SELECT API
    tx.context.cds.ql.SELECT.one
      .from(entityName)
      .columns('client_ID')
      .where({ ID: entityId }),
  );

  const clientId = result?.client_ID ?? null;

  // Cache result (even null results to avoid repeated queries)
  if (clientId) {
    cache.clientIds.set(cacheKey, clientId);
  }

  return clientId;
};

/**
 * Extracts association ID from data object
 * Handles both direct ID reference (e.g., manager_ID) and association objects
 *
 * @param data - Entity data
 * @param field - Field name (e.g., 'manager', 'costCenter')
 * @returns Entity ID or null
 */
const extractAssociationId = (data: unknown, field: string): string | null => {
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
 * Validates employee integrity constraints
 *
 * Ensures:
 * - Manager belongs to same client as employee
 * - Cost center belongs to same client as employee
 *
 * @param tx - CAP transaction
 * @param employees - Array of employee data to validate
 * @param getClientId - Function to retrieve client ID for employee
 * @throws {Error} If any integrity constraint is violated
 */
export const validateEmployeeRelations = async (
  tx: Transaction,
  employees: unknown[],
  getClientId: (employee: unknown) => string | null | undefined,
): Promise<void> => {
  if (!Array.isArray(employees) || employees.length === 0) {
    return;
  }

  const cache = createCache();
  const errors: string[] = [];

  for (const [index, employee] of employees.entries()) {
    if (!employee || typeof employee !== 'object') {
      continue;
    }

    const employeeClientId = getClientId(employee);
    if (!employeeClientId) {
      // If we don't have a client ID, skip validation
      // (this will be caught by other validations like 'client is required')
      continue;
    }

    // Validate manager belongs to same client
    const managerId = extractAssociationId(employee, 'manager');
    if (managerId) {
      const managerClientId = await fetchClientId(
        tx,
        'clientmgmt.Employees',
        managerId,
        cache,
      );

      if (!managerClientId) {
        errors.push(
          `Employee at index ${index}: Manager with ID '${managerId}' not found.`,
        );
      } else if (managerClientId !== employeeClientId) {
        errors.push(
          `Employee at index ${index}: Manager must belong to the same client. ` +
          `Employee belongs to client '${employeeClientId}' but manager belongs to client '${managerClientId}'.`,
        );
      }
    }

    // Validate cost center belongs to same client
    const costCenterId = extractAssociationId(employee, 'costCenter');
    if (costCenterId) {
      const costCenterClientId = await fetchClientId(
        tx,
        'clientmgmt.CostCenters',
        costCenterId,
        cache,
      );

      if (!costCenterClientId) {
        errors.push(
          `Employee at index ${index}: Cost center with ID '${costCenterId}' not found.`,
        );
      } else if (costCenterClientId !== employeeClientId) {
        errors.push(
          `Employee at index ${index}: Cost center must belong to the same client. ` +
          `Employee belongs to client '${employeeClientId}' but cost center belongs to client '${costCenterClientId}'.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw createServiceError(
      400,
      `Integrity validation failed:\n${errors.join('\n')}`,
    );
  }
};

/**
 * Validates cost center integrity constraints
 *
 * Ensures:
 * - Responsible employee belongs to same client as cost center
 *
 * @param tx - CAP transaction
 * @param costCenters - Array of cost center data to validate
 * @param getClientId - Function to retrieve client ID for cost center
 * @throws {Error} If any integrity constraint is violated
 */
export const validateCostCenterRelations = async (
  tx: Transaction,
  costCenters: unknown[],
  getClientId: (costCenter: unknown) => string | null | undefined,
): Promise<void> => {
  if (!Array.isArray(costCenters) || costCenters.length === 0) {
    return;
  }

  const cache = createCache();
  const errors: string[] = [];

  for (const [index, costCenter] of costCenters.entries()) {
    if (!costCenter || typeof costCenter !== 'object') {
      continue;
    }

    const costCenterClientId = getClientId(costCenter);
    if (!costCenterClientId) {
      // If we don't have a client ID, skip validation
      continue;
    }

    // Validate responsible employee belongs to same client
    const responsibleId = extractAssociationId(costCenter, 'responsible');
    if (responsibleId) {
      const responsibleClientId = await fetchClientId(
        tx,
        'clientmgmt.Employees',
        responsibleId,
        cache,
      );

      if (!responsibleClientId) {
        errors.push(
          `Cost center at index ${index}: Responsible employee with ID '${responsibleId}' not found.`,
        );
      } else if (responsibleClientId !== costCenterClientId) {
        errors.push(
          `Cost center at index ${index}: Responsible employee must belong to the same client. ` +
          `Cost center belongs to client '${costCenterClientId}' but responsible employee belongs to client '${responsibleClientId}'.`,
        );
      }
    }
  }

  if (errors.length > 0) {
    throw createServiceError(
      400,
      `Integrity validation failed:\n${errors.join('\n')}`,
    );
  }
};

/**
 * Class-based API for integrity validation
 */
export class IntegrityValidator {
  private tx: Transaction;

  constructor(tx: Transaction) {
    this.tx = tx;
  }

  /**
   * Validates employee relations (manager and cost center)
   */
  async validateEmployeeRelations(
    employees: unknown[],
    getClientId: (employee: unknown) => string | null | undefined,
  ): Promise<void> {
    return validateEmployeeRelations(this.tx, employees, getClientId);
  }

  /**
   * Validates cost center relations (responsible employee)
   */
  async validateCostCenterRelations(
    costCenters: unknown[],
    getClientId: (costCenter: unknown) => string | null | undefined,
  ): Promise<void> {
    return validateCostCenterRelations(this.tx, costCenters, getClientId);
  }
}
