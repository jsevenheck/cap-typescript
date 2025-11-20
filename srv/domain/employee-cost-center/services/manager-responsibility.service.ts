import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

const ql = cds.ql as typeof cds.ql;

/**
 * Check if an assignment period is currently active (contains today's date)
 */
export const isAssignmentCurrentlyActive = (validFrom: string, validTo: string | null | undefined): boolean => {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // normalize to midnight for date-only comparison

  const fromDate = new Date(validFrom);
  fromDate.setHours(0, 0, 0, 0);

  // Assignment must have started
  if (fromDate > today) {
    return false;
  }

  // If no end date, assignment is active
  if (!validTo) {
    return true;
  }

  const toDate = new Date(validTo);
  toDate.setHours(0, 0, 0, 0);

  // Assignment must not have ended
  return toDate >= today;
};

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
      .columns('employee_ID', 'validFrom', 'validTo')
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
    const existingFrom = assignment.validFrom as string | Date;
    const existingTo = assignment.validTo as string | Date | null | undefined;

    // Normalize dates to timestamps for comparison to handle both Date objects and strings
    const existingFromTime = new Date(existingFrom).getTime();
    const validFromTime = new Date(validFrom).getTime();
    const validToTime = validTo ? new Date(validTo).getTime() : null;
    const existingToTime = existingTo ? new Date(existingTo).getTime() : null;

    // Check if ranges overlap
    const startsBeforeNewEnds = validToTime !== null ? existingFromTime <= validToTime : true;
    const endsAfterNewStarts = existingToTime !== null ? existingToTime >= validFromTime : true;

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
 * Find the most appropriate currently active responsible assignment for a cost center
 * Returns the employee_ID of the responsible person, or null if none found
 */
const findCurrentResponsibleAssignment = async (
  tx: Transaction,
  costCenterId: string,
): Promise<string | null> => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find all responsible assignments for this cost center
  const assignments = await tx.run(
    ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
      .columns('employee_ID', 'validFrom', 'validTo')
      .where({
        costCenter_ID: costCenterId,
        isResponsible: true,
      }),
  );

  if (!Array.isArray(assignments) || assignments.length === 0) {
    return null;
  }

  // Filter for currently active assignments
  const activeAssignments = assignments.filter((assignment: any) => {
    const fromDate = new Date(assignment.validFrom as string);
    fromDate.setHours(0, 0, 0, 0);

    if (fromDate > today) {
      return false; // Not started yet
    }

    if (!assignment.validTo) {
      return true; // No end date, currently active
    }

    const toDate = new Date(assignment.validTo as string);
    toDate.setHours(0, 0, 0, 0);

    return toDate >= today; // Check if not ended
  });

  if (activeAssignments.length === 0) {
    return null;
  }

  // Return the most recent one (by validFrom)
  activeAssignments.sort((a: any, b: any) => {
    const aDate = new Date(a.validFrom as string).getTime();
    const bDate = new Date(b.validFrom as string).getTime();
    return bDate - aDate; // Descending order
  });

  return activeAssignments[0].employee_ID as string;
};

/**
 * Handle responsibility removal when an assignment is updated or deleted
 * Finds another currently active responsible assignment and updates the cost center accordingly
 */
export const handleResponsibilityRemoval = async (
  tx: Transaction,
  costCenterId: string,
  removedEmployeeId: string,
): Promise<void> => {
  // Find if there's another currently active responsible assignment
  const newResponsibleId = await findCurrentResponsibleAssignment(tx, costCenterId);

  if (newResponsibleId && newResponsibleId !== removedEmployeeId) {
    // Update the cost center to use the new responsible employee
    await updateCostCenterResponsible(tx, costCenterId, newResponsibleId);

    // Note: We don't update manager assignments here because the new responsible
    // employee should have already set up their manager assignments when their
    // responsible assignment was created
  }
  // If no other responsible assignment exists, leave the cost center's responsible_ID as is
  // (it's a required field, so we can't clear it)
};

/**
 * Handle responsibility changes when an assignment is created or updated
 * This is the main entry point for manager responsibility logic
 *
 * Only updates the current responsible employee and manager assignments if the
 * assignment period is currently active (contains today's date).
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

  // Only update current responsible employee and manager assignments if this assignment is currently active
  // Future-dated or past assignments should not affect the current state
  if (!isAssignmentCurrentlyActive(assignmentData.validFrom, assignmentData.validTo)) {
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
