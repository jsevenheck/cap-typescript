import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { handleResponsibilityRemoval, isAssignmentCurrentlyActive } from '../services/manager-responsibility.service';

export const afterDelete = async (req: Request): Promise<void> => {
  const tx = cds.transaction(req);

  // Get the deleted assignment data from request context (stored in on-delete handler)
  const deletedAssignment = (req as any)._deletedAssignment;

  if (!deletedAssignment) {
    return;
  }

  // If a responsible assignment was deleted and it was currently active, handle cleanup
  if (
    deletedAssignment.isResponsible &&
    isAssignmentCurrentlyActive(deletedAssignment.validFrom as string, deletedAssignment.validTo)
  ) {
    await handleResponsibilityRemoval(
      tx,
      deletedAssignment.costCenter_ID as string,
      deletedAssignment.employee_ID as string,
    );
  }
};

export default afterDelete;
