import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import type { EmployeeWriteResult } from '../services/lifecycle.service';
import { prepareEmployeeWrite } from '../services/lifecycle.service';
import type { ClientEntity, EmployeeEntity } from '../dto/employee.dto';
import type { UserContext } from '../../../shared/utils/auth';
import { buildConcurrencyContext, deriveTargetId } from '../../shared/request-context';

const EMPLOYEE_CONTEXT_KEY = Symbol('employeeContext');

export interface EmployeeContext {
  client: ClientEntity;
  existingEmployee?: EmployeeEntity;
}

export const storeEmployeeContext = (req: Request, context: EmployeeContext): void => {
  (req as unknown as Record<PropertyKey, unknown>)[EMPLOYEE_CONTEXT_KEY] = context;
};

export const getEmployeeContext = (req: Request): EmployeeContext | undefined =>
  (req as unknown as Record<PropertyKey, unknown>)[EMPLOYEE_CONTEXT_KEY] as EmployeeContext | undefined;

export const prepareEmployeeContext = async (
  req: Request,
  user: UserContext,
): Promise<EmployeeWriteResult> => {
  const existing = getEmployeeContext(req);
  if (existing) {
    return {
      updates: {},
      client: existing.client,
      existingEmployee: existing.existingEmployee,
    } as EmployeeWriteResult;
  }

  const result = await prepareEmployeeWrite({
    event: req.event as 'CREATE' | 'UPDATE',
    data: req.data as Partial<EmployeeEntity>,
    targetId: deriveTargetId(req),
    tx: cds.tx(req),
    user,
    concurrency: buildConcurrencyContext(req, 'clientmgmt.Employees'),
  });

  storeEmployeeContext(req, {
    client: result.client,
    existingEmployee: result.existingEmployee,
  });

  return result;
};
