import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { validateAssignmentDeletion } from '../services/validation.service';
import { findAssignmentById } from '../repository/employee-cost-center-assignment.repo';
import { deriveTargetId } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';

export const onDelete = async (req: Request): Promise<void> => {
  const targetId = deriveTargetId(req);

  if (!targetId) {
    throw createServiceError(400, 'Assignment ID is required for deletion.');
  }

  // Store assignment data for after-delete cleanup
  const tx = cds.transaction(req);
  const assignment = await findAssignmentById(tx, targetId, [
    'ID',
    'client_ID',
    'employee_ID',
    'costCenter_ID',
    'isResponsible',
    'validFrom',
    'validTo',
  ]);

  if (assignment) {
    // Store in request context for after-delete handler
    (req as any)._deletedAssignment = assignment;
  }

  await validateAssignmentDeletion();
};

export default onDelete;
