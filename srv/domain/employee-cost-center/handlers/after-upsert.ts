import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { handleResponsibilityChange, handleResponsibilityRemoval, isAssignmentCurrentlyActive } from '../services/manager-responsibility.service';
import { findAssignmentById } from '../repository/employee-cost-center-assignment.repo';
import { deriveTargetId } from '../../shared/request-context';

export const afterUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    return;
  }

  const tx = cds.transaction(req);
  const isUpdate = req.event === 'UPDATE';
  const targetId = deriveTargetId(req);

  const data = req.data as {
    employee_ID: string;
    costCenter_ID: string;
    validFrom: string;
    validTo?: string | null;
    isResponsible: boolean;
  };

  // For updates, check if responsibility was removed
  if (isUpdate && targetId) {
    const existingAssignment = await findAssignmentById(tx, targetId, [
      'ID',
      'client_ID',
      'employee_ID',
      'costCenter_ID',
      'isResponsible',
      'validFrom',
      'validTo',
    ]);

    // If responsibility was removed from a currently active assignment
    if (
      existingAssignment &&
      existingAssignment.isResponsible &&
      !data.isResponsible &&
      isAssignmentCurrentlyActive(existingAssignment.validFrom as string, existingAssignment.validTo)
    ) {
      await handleResponsibilityRemoval(tx, data.costCenter_ID, data.employee_ID);
    }
  }

  // Handle manager responsibility if this is a responsible assignment
  if (data.isResponsible) {
    await handleResponsibilityChange(tx, {
      employee_ID: data.employee_ID,
      costCenter_ID: data.costCenter_ID,
      validFrom: data.validFrom,
      validTo: data.validTo,
      isResponsible: data.isResponsible,
    });
  }
};

export default afterUpsert;
