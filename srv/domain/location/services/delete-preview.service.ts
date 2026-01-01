/**
 * Service for previewing the impact of deleting a location.
 * Returns counts of child entities that will be affected.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { extractCount } from '../../../shared/utils/query';

const ql = cds.ql as typeof cds.ql;

export interface LocationDeletePreview {
  clientId: string;
  locationCity: string;
  locationStreet: string;
  employeeCount: number;
}

/**
 * Get a preview of the impact of deleting a location.
 * Counts all affected entities (employees assigned to this location).
 * Executes the required queries within a single transaction context.
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
    ql.SELECT.one.from('clientmgmt.Locations').columns('city', 'street', 'client_ID').where({ ID: locationId }),
  );

  if (!locationResult) {
    return null;
  }

  const locationData = locationResult as { city?: string; street?: string; client_ID?: string };
  const clientId = locationData.client_ID ?? '';
  const locationCity = locationData.city ?? '';
  const locationStreet = locationData.street ?? '';

  // Count employees assigned to this location
  const employeeResult = await tx.run(
    ql.SELECT.from('clientmgmt.Employees').columns('count(*) as count').where({ location_ID: locationId }),
  );

  return {
    clientId,
    locationCity,
    locationStreet,
    employeeCount: extractCount(employeeResult),
  };
}
