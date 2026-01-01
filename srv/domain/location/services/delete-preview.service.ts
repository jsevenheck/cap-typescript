/**
 * Service for previewing the impact of deleting a location.
 * Returns counts of child entities that will be affected.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

const ql = cds.ql as typeof cds.ql;

export interface LocationDeletePreview {
  locationCity: string;
  locationStreet: string;
  employeeCount: number;
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
 * Get a preview of the impact of deleting a location.
 * Counts all affected entities (employees assigned to this location).
 * Uses parallel queries for efficiency (SAP best practice).
 *
 * @param tx - The CDS transaction context
 * @param locationId - The location ID to preview deletion for
 * @returns Delete preview with counts of affected entities
 */
export async function getLocationDeletePreview(
  tx: Transaction,
  locationId: string,
): Promise<LocationDeletePreview | null> {
  // First, verify the location exists and get its identifying info
  const locationResult = await tx.run(
    ql.SELECT.one.from('clientmgmt.Locations').columns('city', 'street').where({ ID: locationId }),
  );

  if (!locationResult) {
    return null;
  }

  const locationData = locationResult as { city?: string; street?: string };
  const locationCity = locationData.city ?? '';
  const locationStreet = locationData.street ?? '';

  // Count employees assigned to this location
  const employeeResult = await tx.run(
    ql.SELECT.from('clientmgmt.Employees').columns('count(*) as count').where({ location_ID: locationId }),
  );

  return {
    locationCity,
    locationStreet,
    employeeCount: extractCount(employeeResult),
  };
}
