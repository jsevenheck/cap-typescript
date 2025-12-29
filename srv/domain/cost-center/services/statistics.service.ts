/**
 * Cost center statistics service for dashboard functionality.
 * Provides aggregated counts for cost centers by various dimensions.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

const ql = cds.ql as typeof cds.ql;

export interface CostCenterStatistics {
  totalCostCenters: number;
  activeCostCenters: number;
  expiredCostCenters: number;
  upcomingExpiry: number;
  withAssignedEmployees: number;
}

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
 * Calculate the date N days from today
 */
const daysFromNow = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().split('T')[0];
};

/**
 * Get cost center statistics for a specific client or all clients.
 * Uses parallel queries for efficiency (SAP best practice).
 *
 * @param tx - The CDS transaction context
 * @param clientScope - Optional client ID or array of client IDs to filter by
 * @returns Cost center statistics object
 */
export async function getCostCenterStatistics(
  tx: Transaction,
  clientScope?: string | string[] | null,
): Promise<CostCenterStatistics> {
  const entityName = 'clientmgmt.CostCenters';
  const assignmentsEntityName = 'clientmgmt.EmployeeCostCenterAssignments';

  // Return zeros for empty client scope
  if (Array.isArray(clientScope) && clientScope.length === 0) {
    return {
      totalCostCenters: 0,
      activeCostCenters: 0,
      expiredCostCenters: 0,
      upcomingExpiry: 0,
      withAssignedEmployees: 0,
    };
  }

  const clientCondition = Array.isArray(clientScope)
    ? { client_ID: { in: clientScope } }
    : clientScope
      ? { client_ID: clientScope }
      : null;
  const hasClientCondition = clientCondition !== null;
  const today = new Date().toISOString().split('T')[0];
  const thirtyDaysFromNow = daysFromNow(30);

  // Helper function to build query with optional client condition
  const buildQuery = (additionalConditions?: Record<string, unknown>) => {
    const query = ql.SELECT.from(entityName).columns('count(*) as count');
    const conditions = {
      ...(hasClientCondition ? clientCondition : {}),
      ...(additionalConditions || {}),
    };
    return Object.keys(conditions).length > 0 ? query.where(conditions) : query;
  };

  // Build query for cost centers with assigned employees (distinct count)
  const buildAssignedQuery = () => {
    const query = ql.SELECT.from(assignmentsEntityName).columns('count(distinct costCenter_ID) as count');
    if (hasClientCondition) {
      return query.where(clientCondition);
    }
    return query;
  };

  // Run all queries in parallel for better performance (SAP best practice)
  const [
    totalResult,
    activeResult,
    expiredResult,
    upcomingExpiryResult,
    withAssignedResult,
  ] = await Promise.all([
    // Total cost centers
    tx.run(buildQuery()),
    // Active cost centers (validFrom <= today AND validTo >= today)
    tx.run(buildQuery({ validFrom: { '<=': today }, validTo: { '>=': today } })),
    // Expired cost centers (validTo < today)
    tx.run(buildQuery({ validTo: { '<': today } })),
    // Upcoming expiry (validTo within next 30 days)
    tx.run(buildQuery({ validTo: { '>=': today, '<=': thirtyDaysFromNow } })),
    // Cost centers with assigned employees
    tx.run(buildAssignedQuery()),
  ]);

  return {
    totalCostCenters: extractCount(totalResult),
    activeCostCenters: extractCount(activeResult),
    expiredCostCenters: extractCount(expiredResult),
    upcomingExpiry: extractCount(upcomingExpiryResult),
    withAssignedEmployees: extractCount(withAssignedResult),
  };
}
