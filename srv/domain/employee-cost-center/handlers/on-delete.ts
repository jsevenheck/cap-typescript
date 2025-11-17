import type { Request } from '@sap/cds';

import { validateAssignmentDeletion } from '../services/validation.service';
import { deriveTargetId } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';

export const onDelete = async (req: Request): Promise<void> => {
  const targetId = deriveTargetId(req);

  if (!targetId) {
    throw createServiceError(400, 'Assignment ID is required for deletion.');
  }

  await validateAssignmentDeletion();
};

export default onDelete;
