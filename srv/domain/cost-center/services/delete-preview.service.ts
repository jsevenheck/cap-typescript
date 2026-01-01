/**
 * Service for previewing the impact of deleting a cost center.
 * Returns counts of child entities that will be affected.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { extractCount } from '../../../shared/utils/query';

const ql = cds.ql as typeof cds.ql;

export interface CostCenterDeletePreview {
  clientId: string;
  costCenterName: string;
  costCenterCode: string;
  employeeCount: number;
  assignmentCount: number;
}

/**
 * Get the client ID for a cost center (for authorization checks).
 * Returns null if the cost center doesn't exist.
 */
export async function getCostCenterClientId(
  tx: Transaction,
  costCenterId: string,
): Promise<string | null> {
  const result = await tx.run(
    ql.SELECT.one.from('clientmgmt.CostCenters').columns('client_ID').where({ ID: costCenterId }),
  );

  if (!result) {
    return null;
  }

  const data = result as { client_ID?: string };
  return data.client_ID ?? null;
}

/**
 * Get a preview of the impact of deleting a cost center.
 * Counts all affected entities (employees with this cost center, assignments).
 * Uses parallel queries for efficiency (SAP best practice).
 *
 * @param tx - The CDS transaction context
 * @param costCenterId - The cost center ID to preview deletion for
 * @returns Delete preview with counts of affected entities
 */
export async function getCostCenterDeletePreview(
  tx: Transaction,
  costCenterId: string,
): Promise<CostCenterDeletePreview | null> {
  // First, verify the cost center exists and get its name/code/client
  const costCenterResult = await tx.run(
    ql.SELECT.one.from('clientmgmt.CostCenters').columns('name', 'code', 'client_ID').where({ ID: costCenterId }),
  );

  if (!costCenterResult) {
    return null;
  }

  const costCenterData = costCenterResult as { name?: string; code?: string; client_ID?: string };
  const clientId = costCenterData.client_ID ?? '';
  const costCenterName = costCenterData.name ?? '';
  const costCenterCode = costCenterData.code ?? '';

  // Run all count queries in parallel for better performance (SAP best practice)
  const [employeeResult, assignmentResult] = await Promise.all([
    tx.run(
      ql.SELECT.from('clientmgmt.Employees').columns('count(*) as count').where({ costCenter_ID: costCenterId }),
    ),
    tx.run(
      ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
        .columns('count(*) as count')
        .where({ costCenter_ID: costCenterId }),
    ),
  ]);

  return {
    clientId,
    costCenterName,
    costCenterCode,
    employeeCount: extractCount(employeeResult),
    assignmentCount: extractCount(assignmentResult),
  };
}
