import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import {
  EMPLOYEE_ID_RETRIES,
  ensureEmployeeIdentifier,
  isEmployeeIdUniqueConstraintError,
} from '../services/identifiers';
import { buildUserContext } from '../../../shared/utils/auth';
import { enqueueOutboxEntry } from '../../../infrastructure/outbox/dispatcher';
import { EmployeeThirdPartyNotifier } from '../../../infrastructure/api/third-party/employee-notifier';
import type { EmployeeEntity } from '../dto/employee.dto';
import { createServiceError } from '../../../shared/utils/errors';
import { requireRequestUser } from '../../shared/request-context';
import { prepareEmployeeContext } from './context';
import { getLogger } from '../../../shared/utils/logger';
import { outboxConfig, outboxMetrics } from '../../../infrastructure/outbox';

const logger = getLogger('employee-service');

export const onCreateEvent = async (
  req: Request,
  next: () => Promise<unknown>,
): Promise<unknown> => {
  const user = buildUserContext(requireRequestUser(req));
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
        result.existingEmployee?.employeeId ?? undefined,
      );

      const response = await next();
      const notifier = new EmployeeThirdPartyNotifier(tx);
      const requestEntries = Array.isArray(req.data) ? (req.data as any[]) : [req.data];
      const persistedRows = Array.isArray(response) ? (response as any[]) : [response];

      const notification = await notifier.prepareEmployeesCreated(requestEntries, persistedRows);
      if (notification.payloadsByEndpoint.size) {
        for (const [endpoint, envelopes] of notification.payloadsByEndpoint.entries()) {
          for (const envelope of envelopes) {
            await enqueueOutboxEntry(
              tx,
              { eventType: notification.eventType, endpoint, payload: envelope },
              outboxConfig,
              outboxMetrics,
            );
          }
        }
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
