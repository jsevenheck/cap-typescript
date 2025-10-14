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

  if (req.event === 'UPDATE' && req.data.employeeId) {
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
