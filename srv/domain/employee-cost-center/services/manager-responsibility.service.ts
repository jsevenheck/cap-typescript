import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';
import { normalizeDateToMidnight, todayAtMidnight } from '../../../shared/utils/date';

const ql = cds.ql as typeof cds.ql;

/**
 * Check if an assignment period is currently active (contains today's date)
 */
export const isAssignmentCurrentlyActive = (validFrom: string, validTo: string | null | undefined): boolean => {
  const today = todayAtMidnight();
  const fromDate = normalizeDateToMidnight(validFrom);

  // Assignment must have started
  if (fromDate > today) {
    return false;
  }

  // If no end date, assignment is active
  if (!validTo) {
    return true;
  }

  const toDate = normalizeDateToMidnight(validTo);

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
  // Query for assignments that overlap with the given period using database-level filtering
  // Date range overlap logic: (validFrom <= existingValidTo OR existingValidTo IS NULL)
  //                       AND (validTo >= existingValidFrom OR validTo IS NULL)

  const whereConditions: any[] = [
    { costCenter_ID: costCenterId },
    { employee_ID: { '!=': excludeEmployeeId } },
  ];

  // Build date overlap conditions at database level
  // Assignment must start before or when the period ends (if period has an end)
  if (validTo !== null && validTo !== undefined) {
    whereConditions.push({
      or: [
        { validFrom: { '<=': validTo } },
      ],
    });
  }

  // Assignment must end after or when the period starts (or has no end date)
  whereConditions.push({
    or: [
      { validTo: { '>=': validFrom } },
      { validTo: null },
    ],
  });

  const assignments = await tx.run(
    ql.SELECT.from('clientmgmt.EmployeeCostCenterAssignments')
      .columns('employee_ID')
      .where({ and: whereConditions }),
  );

  if (!Array.isArray(assignments)) {
    return [];
  }

  return assignments.map((a: any) => ({ employee_ID: a.employee_ID }));
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

  // Update the manager_ID for all employees in a single batch operation
  if (employees.length > 0) {
    const employeeIds = employees.map((emp) => emp.employee_ID);
    await tx.run(
      ql.UPDATE('clientmgmt.Employees')
        .set({ manager_ID: managerId })
        .where({ ID: { in: employeeIds } }),
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
  const today = todayAtMidnight();

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
    const fromDate = normalizeDateToMidnight(assignment.validFrom as string);

    if (fromDate > today) {
      return false; // Not started yet
    }

    if (!assignment.validTo) {
      return true; // No end date, currently active
    }

    const toDate = normalizeDateToMidnight(assignment.validTo as string);

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
