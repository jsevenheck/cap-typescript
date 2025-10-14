import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { EmployeeEntity } from '../dto/employee.dto';
import { ensureEmployeeIdentifier } from '../services/identifiers';
import { buildUserContext } from '../../../shared/utils/auth';
import { prepareEmployeeContext } from './context';

export const handleEmployeeUpsert = async (req: Request): Promise<void> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const result = await prepareEmployeeContext(req, user);
  Object.assign(req.data, result.updates);

  if (req.event === 'UPDATE' && req.data.employeeId) {
    await ensureEmployeeIdentifier(
      cds.transaction(req),
      req.data as Partial<EmployeeEntity>,
      result.client,
      result.existingEmployee?.ID,
    );
  }
};

export const onCreate = handleEmployeeUpsert;
export default onCreate;
