import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { EmployeeEntity } from '../dto/employee.dto';
import { ensureEmployeeIdentifier } from '../services/identifiers';
import { buildUserContext } from '../../../shared/utils/auth';
import { requireRequestUser } from '../../shared/request-context';
import { prepareEmployeeContext } from './context';

export const handleEmployeeUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext(requireRequestUser(req));
  const result = await prepareEmployeeContext(req, user);
  Object.assign(req.data, result.updates);

  // Validate manually provided employee IDs
  if (req.event === 'CREATE' && req.data.employeeId) {
    // User manually provided an employeeId during CREATE - validate uniqueness
    await ensureEmployeeIdentifier(
      cds.transaction(req),
      req.data as Partial<EmployeeEntity>,
      result.client,
      undefined,
    );
  } else if (req.event === 'UPDATE' && req.data.employeeId &&
      req.data.employeeId !== result.existingEmployee?.employeeId) {
    // Employee ID changed during UPDATE - validate uniqueness
    await ensureEmployeeIdentifier(
      cds.transaction(req),
      req.data as Partial<EmployeeEntity>,
      result.client,
      result.existingEmployee?.employeeId ?? undefined,
    );
  }
};

export const onCreate = handleEmployeeUpsert;
export default onCreate;
