import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { EmployeeCostCenterAssignmentEntity } from '../dto/employee-cost-center-assignment.dto';
import { validateAssignment } from '../services/validation.service';
import { findAssignmentById } from '../repository/employee-cost-center-assignment.repo';
import { deriveTargetId } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';

export const onUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    throw createServiceError(400, 'Request data is required.');
  }

  const tx = cds.transaction(req);
  const data = req.data as Partial<EmployeeCostCenterAssignmentEntity>;
  const targetId = deriveTargetId(req);
  const isUpdate = req.event === 'UPDATE';

  // Validate required fields
  if (!data.employee_ID) {
    req.error(400, 'employee_ID is required');
    throw new Error('employee_ID is required');
  }

  if (!data.costCenter_ID) {
    req.error(400, 'costCenter_ID is required');
    throw new Error('costCenter_ID is required');
  }

  if (!data.validFrom) {
    req.error(400, 'validFrom is required');
    throw new Error('validFrom is required');
  }

  if (!data.client_ID) {
    req.error(400, 'client_ID is required');
    throw new Error('client_ID is required');
  }

  // For UPDATE, validate the assignment exists and preserve isResponsible if not provided
  let existingAssignment: Partial<EmployeeCostCenterAssignmentEntity> | undefined;
  if (isUpdate && targetId) {
    existingAssignment = await findAssignmentById(tx, targetId, [
      'ID',
      'client_ID',
      'employee_ID',
      'costCenter_ID',
      'validFrom',
      'validTo',
      'isResponsible',
    ]);
    if (!existingAssignment) {
      req.error(404, 'Assignment not found');
      throw new Error('Assignment not found');
    }

    // Preserve isResponsible flag on partial updates
    if (data.isResponsible === undefined && existingAssignment.isResponsible !== undefined) {
      data.isResponsible = existingAssignment.isResponsible;
    }
  }

  // Set default for isResponsible if not provided (CREATE only)
  if (data.isResponsible === undefined) {
    data.isResponsible = false;
  }

  // Validate the assignment
  await validateAssignment(
    tx,
    {
      employee_ID: data.employee_ID,
      costCenter_ID: data.costCenter_ID,
      validFrom: data.validFrom,
      validTo: data.validTo,
      isResponsible: data.isResponsible,
      client_ID: data.client_ID,
    },
    req,
    isUpdate ? targetId : undefined,
  );
};

export default onUpsert;
