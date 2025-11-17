import type { Transaction, Request } from '@sap/cds';

import {
  findEmployeeById,
  findCostCenterById,
  findOverlappingAssignments,
  type EmployeeEntity,
  type CostCenterEntity,
} from '../repository/employee-cost-center-assignment.repo';

export interface AssignmentValidationInput {
  employee_ID: string;
  costCenter_ID: string;
  validFrom: string;
  validTo?: string | null;
  isResponsible: boolean;
  client_ID: string;
}

/**
 * Validate date range consistency
 */
export const validateDateRange = (validFrom: string, validTo?: string | null): void => {
  if (!validFrom) {
    throw Object.assign(new Error('validFrom is required'), { code: 'INVALID_DATE_RANGE' });
  }

  if (validTo) {
    const fromDate = new Date(validFrom);
    const toDate = new Date(validTo);

    if (fromDate > toDate) {
      throw Object.assign(
        new Error('validFrom must be less than or equal to validTo'),
        { code: 'INVALID_DATE_RANGE' },
      );
    }
  }
};

/**
 * Validate that employee, cost center, and client exist and belong together
 */
export const validateEntityRelations = async (
  tx: Transaction,
  input: AssignmentValidationInput,
  req: Request,
): Promise<{ employee: EmployeeEntity; costCenter: CostCenterEntity }> => {
  // Validate employee exists and get manager status
  const employee = await findEmployeeById(tx, input.employee_ID, ['ID', 'client_ID', 'isManager']);
  if (!employee) {
    req.error(404, 'Employee not found');
    throw new Error('Employee not found');
  }

  // Validate employee belongs to the same client
  if (employee.client_ID !== input.client_ID) {
    req.error(400, 'Employee does not belong to the specified client');
    throw new Error('Employee does not belong to the specified client');
  }

  // Validate cost center exists
  const costCenter = await findCostCenterById(tx, input.costCenter_ID, [
    'ID',
    'client_ID',
    'validFrom',
    'validTo',
    'responsible_ID',
  ]);
  if (!costCenter) {
    req.error(404, 'Cost center not found');
    throw new Error('Cost center not found');
  }

  // Validate cost center belongs to the same client
  if (costCenter.client_ID !== input.client_ID) {
    req.error(400, 'Cost center does not belong to the specified client');
    throw new Error('Cost center does not belong to the specified client');
  }

  return { employee, costCenter };
};

/**
 * Validate that the assignment date range is within the cost center's validity period
 */
export const validateAssignmentWithinCostCenterValidity = (
  assignmentValidFrom: string,
  assignmentValidTo: string | null | undefined,
  costCenterValidFrom: string,
  costCenterValidTo: string | null | undefined,
  req: Request,
): void => {
  const assignmentFrom = new Date(assignmentValidFrom);
  const ccFrom = new Date(costCenterValidFrom);

  // Assignment must start on or after cost center validity start
  if (assignmentFrom < ccFrom) {
    req.error(
      400,
      `Assignment cannot start before cost center validity period (${costCenterValidFrom})`,
    );
    throw new Error('Assignment starts before cost center validity');
  }

  // If cost center has an end date, assignment must not extend beyond it
  if (costCenterValidTo) {
    const ccTo = new Date(costCenterValidTo);

    if (!assignmentValidTo) {
      req.error(
        400,
        `Assignment must have an end date as cost center validity ends on ${costCenterValidTo}`,
      );
      throw new Error('Assignment missing end date');
    }

    const assignmentTo = new Date(assignmentValidTo);
    if (assignmentTo > ccTo) {
      req.error(
        400,
        `Assignment cannot end after cost center validity period (${costCenterValidTo})`,
      );
      throw new Error('Assignment extends beyond cost center validity');
    }
  }
};

/**
 * Validate that non-manager employees don't have overlapping assignments
 */
export const validateNoOverlappingAssignments = async (
  tx: Transaction,
  input: AssignmentValidationInput,
  isManager: boolean,
  excludeId: string | undefined,
  req: Request,
): Promise<void> => {
  // Managers can have multiple overlapping assignments
  if (isManager) {
    return;
  }

  // For non-managers, check for overlapping assignments
  const overlapping = await findOverlappingAssignments(
    tx,
    input.employee_ID,
    input.validFrom,
    input.validTo,
    excludeId,
  );

  if (overlapping.length > 0) {
    const conflict = overlapping[0];
    const conflictRange = conflict.validTo
      ? `${conflict.validFrom} to ${conflict.validTo}`
      : `${conflict.validFrom} onwards`;

    req.error(
      400,
      `Non-manager employees can only have one active cost center assignment. Conflicting assignment exists for period: ${conflictRange}`,
    );
    throw new Error('Overlapping cost center assignment detected');
  }
};

/**
 * Validate that only managers can be marked as responsible
 */
export const validateManagerResponsibility = (
  isResponsible: boolean,
  isManager: boolean,
  req: Request,
): void => {
  if (isResponsible && !isManager) {
    req.error(400, 'Only managers can be marked as responsible for a cost center');
    throw new Error('Non-manager cannot be responsible');
  }
};

/**
 * Main validation function for employee cost center assignment
 */
export const validateAssignment = async (
  tx: Transaction,
  input: AssignmentValidationInput,
  req: Request,
  excludeId?: string,
): Promise<void> => {
  // 1. Validate date range
  validateDateRange(input.validFrom, input.validTo);

  // 2. Validate entity relations and get employee/cost center data
  const { employee, costCenter } = await validateEntityRelations(tx, input, req);

  // 3. Validate assignment is within cost center validity period
  validateAssignmentWithinCostCenterValidity(
    input.validFrom,
    input.validTo,
    costCenter.validFrom as string,
    costCenter.validTo as string | null | undefined,
    req,
  );

  // 4. Validate manager responsibility
  validateManagerResponsibility(input.isResponsible, employee.isManager || false, req);

  // 5. Validate no overlapping assignments for non-managers
  await validateNoOverlappingAssignments(tx, input, employee.isManager || false, excludeId, req);
};

/**
 * Validate that an assignment can be deleted
 * Returns the assignment if it exists and can be deleted
 */
export const validateAssignmentDeletion = async (
  _tx: Transaction,
  _assignmentId: string,
  _req: Request,
): Promise<void> => {
  // Note: We might want to add business rules here, such as:
  // - Preventing deletion of historical assignments
  // - Requiring a reason for deletion
  // - Checking if this is the employee's only assignment
  // For now, we allow all deletions
};
