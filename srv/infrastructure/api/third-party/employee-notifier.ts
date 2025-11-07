/**
 * Employee Third-Party Notifier
 *
 * Prepares and enqueues employee creation notifications for external systems.
 * Supports HTTP endpoints with HMAC-SHA256 request signing for authentication.
 */
import type { Transaction } from '@sap/cds';
import { enqueueEmployeeCreatedNotification } from '../../outbox/dispatcher';
import { getLogger } from '../../../shared/utils/logger';

const logger = getLogger('employee-notifier');

export interface EmployeeNotificationPayload {
  employeeId: string;
  firstName: string;
  lastName: string;
  email: string;
  clientId: string;
  clientName?: string;
  companyId?: string;
  entryDate: string;
  status?: string;
}

export interface PreparedNotification {
  eventType: string;
  payloadsByEndpoint: Map<string, EmployeeNotificationPayload[]>;
}

/**
 * Prepare employee created notifications grouped by client notification endpoint
 *
 * @param tx - CAP transaction
 * @param employees - Array of created employees
 * @returns Prepared notification grouped by endpoint
 */
export const prepareEmployeesCreatedNotifications = async (
  tx: Transaction,
  employees: any[],
): Promise<PreparedNotification> => {
  if (!Array.isArray(employees) || employees.length === 0) {
    return {
      eventType: 'EMPLOYEE_CREATED',
      payloadsByEndpoint: new Map(),
    };
  }

  // Fetch client information for all employees
  const clientIds = [...new Set(employees.map((e) => e.client_ID).filter(Boolean))];
  if (clientIds.length === 0) {
    logger.warn('No valid client IDs found in employees');
    return {
      eventType: 'EMPLOYEE_CREATED',
      payloadsByEndpoint: new Map(),
    };
  }

  interface ClientRecord {
    ID: string;
    companyId: string;
    name?: string;
    notificationEndpoint?: string;
  }

  const clients = await tx.run(
    // @ts-expect-error - CDS QL types
    tx.context.cds.ql.SELECT.from('clientmgmt.Clients')
      .columns('ID', 'companyId', 'name', 'notificationEndpoint')
      .where({ ID: { in: clientIds } }),
  ) as ClientRecord[];

  const clientMap = new Map(clients.map((c) => [c.ID, c]));

  // Group employees by notification endpoint
  const payloadsByEndpoint = new Map<string, EmployeeNotificationPayload[]>();

  for (const employee of employees) {
    const client = clientMap.get(employee.client_ID);
    if (!client) {
      logger.warn({ employeeId: employee.ID }, 'Client not found for employee');
      continue;
    }

    const notificationEndpoint = client.notificationEndpoint?.trim();
    if (!notificationEndpoint) {
      // Skip employees whose clients don't have notification endpoints configured
      continue;
    }

    const payload: EmployeeNotificationPayload = {
      employeeId: employee.employeeId,
      firstName: employee.firstName,
      lastName: employee.lastName,
      email: employee.email,
      clientId: client.ID,
      clientName: client.name,
      companyId: client.companyId,
      entryDate: employee.entryDate,
      status: employee.status,
    };

    const existing = payloadsByEndpoint.get(notificationEndpoint) ?? [];
    existing.push(payload);
    payloadsByEndpoint.set(notificationEndpoint, existing);
  }

  return {
    eventType: 'EMPLOYEE_CREATED',
    payloadsByEndpoint,
  };
};

/**
 * Enqueue prepared notifications to outbox for reliable delivery
 *
 * @param tx - CAP transaction
 * @param notification - Prepared notification
 */
export const enqueueNotifications = async (
  tx: Transaction,
  notification: PreparedNotification,
): Promise<void> => {
  if (notification.payloadsByEndpoint.size === 0) {
    return;
  }

  const destinationName = process.env.THIRD_PARTY_EMPLOYEE_DESTINATION;
  if (!destinationName) {
    logger.warn('THIRD_PARTY_EMPLOYEE_DESTINATION not configured, skipping notification enqueue');
    return;
  }

  for (const [endpoint, payloads] of notification.payloadsByEndpoint.entries()) {
    try {
      await enqueueEmployeeCreatedNotification(tx, {
        destinationName,
        payload: {
          eventType: notification.eventType,
          endpoint,
          employees: payloads,
          timestamp: new Date().toISOString(),
        },
      });

      logger.info(
        { endpoint, employeeCount: payloads.length },
        'Enqueued employee notifications to outbox'
      );
    } catch (error) {
      logger.error(
        { err: error, endpoint, employeeCount: payloads.length },
        'Failed to enqueue employee notifications'
      );
      // Don't throw - we want the employee creation to succeed even if notification fails
      // The outbox will handle retries for successfully enqueued messages
    }
  }
};

/**
 * Prepare and enqueue notifications for created employees in a single operation
 *
 * @param tx - CAP transaction
 * @param employees - Array of created employees
 */
export const notifyEmployeesCreated = async (
  tx: Transaction,
  employees: any[],
): Promise<void> => {
  const notification = await prepareEmployeesCreatedNotifications(tx, employees);
  await enqueueNotifications(tx, notification);
};
