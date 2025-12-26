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
  clientScope?: string | string[] | null,
): Promise<EmployeeStatistics> {
  const entityName = 'clientmgmt.Employees';

  // Base condition for filtering by client
  if (Array.isArray(clientScope) && clientScope.length === 0) {
    return {
      totalEmployees: 0,
      activeEmployees: 0,
      inactiveEmployees: 0,
      internalEmployees: 0,
      externalEmployees: 0,
      managersCount: 0,
      recentHires: 0,
      upcomingExits: 0,
    };
  }

  const clientCondition = Array.isArray(clientScope)
    ? { client_ID: { in: clientScope } }
    : clientScope
      ? { client_ID: clientScope }
      : null;
  const hasClientCondition = clientCondition !== null;
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysAgo = daysAgo(30);
  const thirtyDaysFromNow = daysFromNow(30);

  // Helper function to build query with optional client condition
  const buildQuery = (additionalConditions?: Record<string, unknown>) => {
    const query = ql.SELECT.from(entityName).columns('count(*) as count');
    const conditions = {
      ...(hasClientCondition ? clientCondition : {}),
      ...(additionalConditions || {}),
    };
    // Only add where clause if there are actual conditions
    return Object.keys(conditions).length > 0 ? query.where(conditions) : query;
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
    tx.run(buildQuery()),
    // Active employees
    tx.run(buildQuery({ status: 'active' })),
    // Inactive employees
    tx.run(buildQuery({ status: 'inactive' })),
    // Internal employees
    tx.run(buildQuery({ employmentType: 'internal' })),
    // External employees
    tx.run(buildQuery({ employmentType: 'external' })),
    // Managers (employees with isManager = true)
    tx.run(buildQuery({ isManager: true })),
    // Recent hires (last 30 days)
    tx.run(buildQuery({ entryDate: { '>=': thirtyDaysAgo } })),
    // Upcoming exits (next 30 days)
    tx.run(buildQuery({ exitDate: { '>=': today, '<=': thirtyDaysFromNow } })),
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
