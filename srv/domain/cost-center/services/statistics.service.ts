/**
 * Cost center statistics service for dashboard functionality.
 * Provides aggregated counts for cost centers by various dimensions.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { daysFromNow, today as getToday } from '../../../shared/utils/date';
import { extractCount } from '../../../shared/utils/query';

const ql = cds.ql as typeof cds.ql;

export interface CostCenterStatistics {
  totalCostCenters: number;
  activeCostCenters: number;
  expiredCostCenters: number;
  upcomingExpiry: number;
  withAssignedEmployees: number;
}

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
  const today = getToday();
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

  // Build query for active cost centers (validFrom <= today AND (validTo IS NULL OR validTo >= today))
  const buildActiveQuery = () => {
    const baseConditions = hasClientCondition ? clientCondition : {};
    // Use raw SQL condition for OR logic with NULL handling
    return ql.SELECT.from(entityName)
      .columns('count(*) as count')
      .where({
        ...baseConditions,
        validFrom: { '<=': today },
        or: [{ validTo: { '>=': today } }, { validTo: { '=': null } }],
      });
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
    // Active cost centers (validFrom <= today AND (validTo IS NULL OR validTo >= today))
    tx.run(buildActiveQuery()),
    // Expired cost centers (validTo < today AND validTo IS NOT NULL)
    tx.run(buildQuery({ validTo: { '<': today, '!=': null } })),
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
