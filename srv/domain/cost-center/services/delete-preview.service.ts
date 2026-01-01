/**
 * Service for previewing the impact of deleting a cost center.
 * Returns counts of child entities that will be affected.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { extractCount } from '../../../shared/utils/query';

const ql = cds.ql as typeof cds.ql;

export interface CostCenterDeletePreview {
  costCenterName: string;
  costCenterCode: string;
  employeeCount: number;
  assignmentCount: number;
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
  // First, verify the cost center exists and get its name/code
  const costCenterResult = await tx.run(
    ql.SELECT.one.from('clientmgmt.CostCenters').columns('name', 'code').where({ ID: costCenterId }),
  );

  if (!costCenterResult) {
    return null;
  }

  const costCenterData = costCenterResult as { name?: string; code?: string };
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
    costCenterName,
    costCenterCode,
    employeeCount: extractCount(employeeResult),
    assignmentCount: extractCount(assignmentResult),
  };
}
