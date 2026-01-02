import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { handleResponsibilityChange, handleResponsibilityRemoval, isAssignmentCurrentlyActive } from '../services/manager-responsibility.service';

export const afterUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    return;
  }

  const tx = cds.tx(req);
  const isUpdate = req.event === 'UPDATE';

  const data = req.data as {
    employee_ID: string;
    costCenter_ID: string;
    validFrom: string;
    validTo?: string | null;
    isResponsible: boolean;
  };

  // For updates, check if responsibility was removed using pre-update state
  if (isUpdate) {
    const preUpdateAssignment = (req as any)._preUpdateAssignment;

    // If responsibility was removed from a currently active assignment
    if (
      preUpdateAssignment &&
      preUpdateAssignment.isResponsible &&
      !data.isResponsible &&
      isAssignmentCurrentlyActive(preUpdateAssignment.validFrom as string, preUpdateAssignment.validTo)
    ) {
      // Use pre-update IDs to clean up the ORIGINAL cost center that lost its responsible employee
      await handleResponsibilityRemoval(
        tx,
        preUpdateAssignment.costCenter_ID as string,
        preUpdateAssignment.employee_ID as string,
      );
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
