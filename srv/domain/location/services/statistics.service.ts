/**
 * Location statistics service for dashboard functionality.
 * Provides aggregated counts for locations by various dimensions.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { daysFromNow, today as getToday } from '../../../shared/utils/date';
import { extractCount } from '../../../shared/utils/query';

const ql = cds.ql as typeof cds.ql;

export interface LocationStatistics {
  totalLocations: number;
  activeLocations: number;
  expiredLocations: number;
  upcomingExpiry: number;
}

/**
 * Get location statistics for a specific client or all clients.
 * Uses parallel queries for efficiency (SAP best practice).
 *
 * @param tx - The CDS transaction context
 * @param clientScope - Optional client ID or array of client IDs to filter by
 * @returns Location statistics object
 */
export async function getLocationStatistics(
  tx: Transaction,
  clientScope?: string | string[] | null,
): Promise<LocationStatistics> {
  const entityName = 'clientmgmt.Locations';

  // Return zeros for empty client scope
  if (Array.isArray(clientScope) && clientScope.length === 0) {
    return {
      totalLocations: 0,
      activeLocations: 0,
      expiredLocations: 0,
      upcomingExpiry: 0,
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

  // Build query for active locations (validFrom <= today AND (validTo IS NULL OR validTo >= today))
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

  // Run all queries in parallel for better performance (SAP best practice)
  const [
    totalResult,
    activeResult,
    expiredResult,
    upcomingExpiryResult,
  ] = await Promise.all([
    // Total locations
    tx.run(buildQuery()),
    // Active locations (validFrom <= today AND (validTo IS NULL OR validTo >= today))
    tx.run(buildActiveQuery()),
    // Expired locations (validTo < today AND validTo IS NOT NULL)
    tx.run(buildQuery({ validTo: { '<': today, '!=': null } })),
    // Upcoming expiry (validTo within next 30 days)
    tx.run(buildQuery({ validTo: { '>=': today, '<=': thirtyDaysFromNow } })),
  ]);

  return {
    totalLocations: extractCount(totalResult),
    activeLocations: extractCount(activeResult),
    expiredLocations: extractCount(expiredResult),
    upcomingExpiry: extractCount(upcomingExpiryResult),
  };
}
