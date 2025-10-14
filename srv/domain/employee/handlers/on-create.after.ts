import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import {
  EMPLOYEE_ID_RETRIES,
  ensureEmployeeIdentifier,
  isEmployeeIdUniqueConstraintError,
} from '../services/identifiers';
import { buildUserContext } from '../../../shared/utils/auth';
import { normalizeCompanyId } from '../../../shared/utils/normalization';
import {
  enqueueEmployeeCreatedNotification,
  type EmployeeCreatedNotification,
} from '../../../infrastructure/outbox/dispatcher';
import type { EmployeeEntity } from '../dto/employee.dto';
import { createServiceError } from '../../../shared/utils/errors';
import { getEmployeeContext, prepareEmployeeContext } from './context';

const getServiceLogger = () => {
  const typedCds = cds as unknown as { log?: (component: string) => { error: (...args: unknown[]) => void } };
  if (typeof typedCds.log === 'function') {
    return typedCds.log('client-service');
  }
  return console;
};

const logger = getServiceLogger();

export const onCreateEvent = async (
  req: Request,
  next: () => Promise<unknown>,
): Promise<unknown> => {
  const user = buildUserContext((req as Request & { user?: unknown }).user as any);
  const tx = cds.transaction(req);
  let lastError: unknown;

  for (let attempt = 0; attempt < EMPLOYEE_ID_RETRIES; attempt += 1) {
    let generatedEmployeeId = false;
    try {
      const result = await prepareEmployeeContext(req, user);
      generatedEmployeeId = await ensureEmployeeIdentifier(
        tx,
        req.data as Partial<EmployeeEntity>,
        result.client,
        result.existingEmployee?.ID,
      );

      const response = await next();
      const createdEmployee = Array.isArray(response)
        ? ((response[0] as Record<string, unknown> | undefined) ?? undefined)
        : (response as Record<string, unknown> | undefined);

      const destinationName = process.env.THIRD_PARTY_EMPLOYEE_DESTINATION;
      const context = getEmployeeContext(req);
      if (destinationName && createdEmployee && context?.client.companyId) {
        const clientCompanyId = normalizeCompanyId(context.client.companyId) ?? context.client.companyId;
        const record = createdEmployee as Partial<EmployeeEntity>;
        const requestSnapshot = (req.data ?? {}) as Partial<EmployeeEntity>;
        const payload: EmployeeCreatedNotification['payload'] = {
          event: 'EMPLOYEE_CREATED',
          employeeId: record.employeeId ?? requestSnapshot.employeeId,
          employeeUUID: record.ID ?? requestSnapshot.ID,
          clientCompanyId,
          client_ID: record.client_ID ?? requestSnapshot.client_ID ?? context.client.ID,
          firstName: record.firstName ?? requestSnapshot.firstName,
          lastName: record.lastName ?? requestSnapshot.lastName,
          email: record.email ?? requestSnapshot.email,
        };

        await enqueueEmployeeCreatedNotification(tx, { destinationName, payload });
      }

      return response;
    } catch (error) {
      lastError = error;
      if (generatedEmployeeId && isEmployeeIdUniqueConstraintError(error) && attempt < EMPLOYEE_ID_RETRIES - 1) {
        delete (req.data as Partial<EmployeeEntity>).employeeId;
        continue;
      }
      throw error;
    }
  }

  logger.error({ err: lastError }, 'Failed to create employee after multiple attempts.');
  throw createServiceError(500, 'Failed to create employee after multiple attempts.');
};

export default onCreateEvent;
