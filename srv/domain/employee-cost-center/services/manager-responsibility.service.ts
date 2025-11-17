import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

const ql = cds.ql as typeof cds.ql;

/**
 * Update the cost center's responsible employee based on assignment responsibility
 * This should be called after an assignment is created or updated with isResponsible=true
 */
export const updateCostCenterResponsible = async (
  tx: Transaction,
  costCenterId: string,
  employeeId: string,
): Promise<void> => {
  // Update the cost center's responsible_ID to point to this employee
  await tx.run(
    ql.UPDATE('clientmgmt.CostCenters')
      .set({ responsible_ID: employeeId })
      .where({ ID: costCenterId }),
  );
};

/**
 * Get all employees assigned to a cost center during a specific time period
 * This excludes the responsible employee themselves
 */
export const getEmployeesInCostCenterDuringPeriod = async (
  tx: Transaction,
  costCenterId: string,
  validFrom: string,
  validTo: string | null | undefined,
  excludeEmployeeId: string,
): Promise<Array<{ employee_ID: string }>> => {
  // Query for assignments that overlap with the given period
  const assignments = await tx.run(
    ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
      .columns('employee_ID')
      .where({
        costCenter_ID: costCenterId,
        employee_ID: { '!=': excludeEmployeeId },
      }),
  );

  if (!Array.isArray(assignments)) {
    return [];
  }

  // Filter overlapping assignments in memory to handle null validTo properly
  const overlapping = assignments.filter((assignment: any) => {
    const existingFrom = assignment.validFrom as string;
    const existingTo = assignment.validTo as string | null | undefined;

    // Check if ranges overlap
    const startsBeforeNewEnds = validTo ? existingFrom <= validTo : true;
    const endsAfterNewStarts = existingTo ? existingTo >= validFrom : true;

    return startsBeforeNewEnds && endsAfterNewStarts;
  });

  return overlapping.map((a: any) => ({ employee_ID: a.employee_ID }));
};

/**
 * Update manager assignments for employees in the same cost center
 * When an employee becomes responsible for a cost center, they should become the manager
 * for all employees assigned to that cost center during the same time period
 */
export const assignManagerToEmployeesInCostCenter = async (
  tx: Transaction,
  costCenterId: string,
  managerId: string,
  validFrom: string,
  validTo: string | null | undefined,
): Promise<void> => {
  // Get all employees assigned to this cost center during the period
  const employees = await getEmployeesInCostCenterDuringPeriod(
    tx,
    costCenterId,
    validFrom,
    validTo,
    managerId,
  );

  // Update the manager_ID for each of these employees
  for (const emp of employees) {
    await tx.run(
      ql.UPDATE('clientmgmt.Employees')
        .set({ manager_ID: managerId })
        .where({ ID: emp.employee_ID }),
    );
  }
};

/**
 * Handle responsibility changes when an assignment is created or updated
 * This is the main entry point for manager responsibility logic
 */
export const handleResponsibilityChange = async (
  tx: Transaction,
  assignmentData: {
    employee_ID: string;
    costCenter_ID: string;
    validFrom: string;
    validTo: string | null | undefined;
    isResponsible: boolean;
  },
): Promise<void> => {
  if (!assignmentData.isResponsible) {
    return;
  }

  // 1. Update the cost center's responsible employee
  await updateCostCenterResponsible(tx, assignmentData.costCenter_ID, assignmentData.employee_ID);

  // 2. Assign this employee as manager to all employees in the same cost center during the period
  await assignManagerToEmployeesInCostCenter(
    tx,
    assignmentData.costCenter_ID,
    assignmentData.employee_ID,
    assignmentData.validFrom,
    assignmentData.validTo,
  );
};
