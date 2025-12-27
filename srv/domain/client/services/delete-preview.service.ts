/**
 * Service for previewing the impact of deleting a client.
 * Returns counts of child entities that will be deleted.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

const ql = cds.ql as typeof cds.ql;

export interface ClientDeletePreview {
  clientName: string;
  employeeCount: number;
  costCenterCount: number;
  locationCount: number;
  assignmentCount: number;
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
 * Get a preview of the impact of deleting a client.
 * Counts all child entities (employees, cost centers, locations, assignments).
 * Uses parallel queries for efficiency (SAP best practice).
 *
 * @param tx - The CDS transaction context
 * @param clientId - The client ID to preview deletion for
 * @returns Delete preview with counts of affected entities
 */
export async function getClientDeletePreview(
  tx: Transaction,
  clientId: string,
): Promise<ClientDeletePreview | null> {
  // First, verify the client exists and get its name
  const clientResult = await tx.run(
    ql.SELECT.one.from('clientmgmt.Clients').columns('name').where({ ID: clientId }),
  );

  if (!clientResult) {
    return null;
  }

  const clientName = (clientResult as { name?: string }).name ?? '';

  // Run all count queries in parallel for better performance (SAP best practice)
  const [employeeResult, costCenterResult, locationResult, assignmentResult] = await Promise.all([
    tx.run(
      ql.SELECT.from('clientmgmt.Employees').columns('count(*) as count').where({ client_ID: clientId }),
    ),
    tx.run(
      ql.SELECT.from('clientmgmt.CostCenters').columns('count(*) as count').where({ client_ID: clientId }),
    ),
    tx.run(
      ql.SELECT.from('clientmgmt.Locations').columns('count(*) as count').where({ client_ID: clientId }),
    ),
    tx.run(
      ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
        .columns('count(*) as count')
        .where({ client_ID: clientId }),
    ),
  ]);

  return {
    clientName,
    employeeCount: extractCount(employeeResult),
    costCenterCount: extractCount(costCenterResult),
    locationCount: extractCount(locationResult),
    assignmentCount: extractCount(assignmentResult),
  };
}
