import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import { validateAssignmentDeletion } from '../services/validation.service';
import { findAssignmentById } from '../repository/employee-cost-center-assignment.repo';
import { deriveTargetId, getHeaders } from '../../shared/request-context';
import { createServiceError } from '../../../shared/utils/errors';
import { ensureOptimisticConcurrency, extractIfMatchHeader } from '../../../shared/utils/concurrency';

export const onDelete = async (req: Request): Promise<void> => {
  const targetId = deriveTargetId(req);

  if (!targetId) {
    throw createServiceError(400, 'Assignment ID is required for deletion.');
  }

  // Store assignment data for after-delete cleanup
  const tx = cds.tx(req);
  const assignment = await findAssignmentById(tx, targetId, [
    'ID',
    'client_ID',
    'employee_ID',
    'costCenter_ID',
    'isResponsible',
    'validFrom',
    'validTo',
    'modifiedAt',
  ]);

  if (!assignment) {
    throw createServiceError(404, 'Assignment not found.');
  }

  // Check optimistic concurrency before deletion
  const headers = getHeaders(req);
  const headerValue = extractIfMatchHeader(headers);
  const hasHttpHeaders = Boolean(headers && Object.keys(headers).length > 0);
  await ensureOptimisticConcurrency({
    tx,
    entityName: 'clientmgmt.EmployeeCostCenterAssignments',
    targetId,
    headerValue,
    hasHttpHeaders,
    payloadValue: (req.data as any)?.modifiedAt,
  });

  // Store in request context for after-delete handler
  (req as any)._deletedAssignment = assignment;

  await validateAssignmentDeletion();
};

export default onDelete;
