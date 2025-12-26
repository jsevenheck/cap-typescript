/**
 * Employee statistics service for dashboard functionality.
 * Provides aggregated counts for employees by various dimensions.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

const ql = cds.ql as typeof cds.ql;

export interface EmployeeStatistics {
  totalEmployees: number;
  activeEmployees: number;
  inactiveEmployees: number;
  internalEmployees: number;
  externalEmployees: number;
  managersCount: number;
  recentHires: number;
  upcomingExits: number;
}

/**
 * Calculate the date N days ago from today
 */
const daysAgo = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().split('T')[0];
};

/**
 * Calculate the date N days from today
 */
const daysFromNow = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

/**
 * Extract count from CDS query result
 */
const extractCount = (result: unknown): number => {
  if (Array.isArray(result) && result.length > 0) {
    const row = result[0] as { count?: number | string };
    return typeof row.count === 'number' ? row.count : parseInt(String(row.count || '0'), 10);
  }
  const row = result as { count?: number | string } | undefined;
  return typeof row?.count === 'number' ? row.count : parseInt(String(row?.count || '0'), 10);
};

/**
 * Get employee statistics for a specific client or all clients.
 * Uses parallel queries for efficiency (SAP best practice).
 *
 * @param tx - The CDS transaction context
 * @param clientId - Optional client ID to filter by
 * @returns Employee statistics object
 */
export async function getEmployeeStatistics(
  tx: Transaction,
  clientId?: string | null,
): Promise<EmployeeStatistics> {
  const entityName = 'clientmgmt.Employees';

  // Base condition for filtering by client
  const clientCondition = clientId ? { client_ID: clientId } : {};
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = daysAgo(30);
  const thirtyDaysFromNow = daysFromNow(30);

  // Build conditions for date-based queries
  const recentHiresCondition: Record<string, unknown> = {
    ...clientCondition,
    entryDate: { '>=': thirtyDaysAgo },
  };

  const upcomingExitsCondition: Record<string, unknown> = {
    ...clientCondition,
    exitDate: { '>=': today, '<=': thirtyDaysFromNow },
  };

  // Run all queries in parallel for better performance (SAP best practice)
  const [
    totalResult,
    activeResult,
    inactiveResult,
    internalResult,
    externalResult,
    managersResult,
    recentHiresResult,
    upcomingExitsResult,
  ] = await Promise.all([
    // Total employees
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where(clientCondition),
    ),
    // Active employees
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where({ ...clientCondition, status: 'active' }),
    ),
    // Inactive employees
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where({ ...clientCondition, status: 'inactive' }),
    ),
    // Internal employees
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where({ ...clientCondition, employmentType: 'internal' }),
    ),
    // External employees
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where({ ...clientCondition, employmentType: 'external' }),
    ),
    // Managers (employees with isManager = true)
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where({ ...clientCondition, isManager: true }),
    ),
    // Recent hires (last 30 days)
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where(recentHiresCondition),
    ),
    // Upcoming exits (next 30 days)
    tx.run(
      ql.SELECT.from(entityName)
        .columns('count(*) as count')
        .where(upcomingExitsCondition),
    ),
  ]);

  return {
    totalEmployees: extractCount(totalResult),
    activeEmployees: extractCount(activeResult),
    inactiveEmployees: extractCount(inactiveResult),
    internalEmployees: extractCount(internalResult),
    externalEmployees: extractCount(externalResult),
    managersCount: extractCount(managersResult),
    recentHires: extractCount(recentHiresResult),
    upcomingExits: extractCount(upcomingExitsResult),
  };
}
