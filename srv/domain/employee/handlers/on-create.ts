import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { EmployeeEntity } from '../dto/employee.dto';
import { ensureEmployeeIdentifier } from '../services/identifiers';
import { buildUserContext } from '../../../shared/utils/auth';
import { requireRequestUser } from '../../shared/request-context';
import { prepareEmployeeContext } from './context';
import { createServiceError } from '../../../shared/utils/errors';

export const handleEmployeeUpsert = async (req: Request): Promise<void> => {
  if (!req.data || typeof req.data !== 'object') {
    throw createServiceError(400, 'Request data is required.');
  }

  const data = req.data as Partial<EmployeeEntity>;
  const user = buildUserContext(requireRequestUser(req));
  const result = await prepareEmployeeContext(req, user);
  Object.assign(data, result.updates);

  // Validate manually provided employee IDs
  if (req.event === 'CREATE' && data.employeeId) {
    // User manually provided an employeeId during CREATE - validate uniqueness
    await ensureEmployeeIdentifier(
      cds.transaction(req),
      data,
      result.client,
      undefined,
      undefined,
    );
  } else if (req.event === 'UPDATE' && data.employeeId &&
      data.employeeId !== result.existingEmployee?.employeeId) {
    // Employee ID changed during UPDATE - validate uniqueness
    // Pass the employee UUID to exclude them from the uniqueness check
    await ensureEmployeeIdentifier(
      cds.transaction(req),
      data,
      result.client,
      result.existingEmployee?.employeeId ?? undefined,
      result.existingEmployee?.ID,
    );
  }
};

export const onCreate = handleEmployeeUpsert;
export default onCreate;
