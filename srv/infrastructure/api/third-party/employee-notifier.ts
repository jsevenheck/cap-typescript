import cds from '@sap/cds';
import type { Transaction } from '@sap/cds/apis/services';
import { getDestination, isHttpDestination, type HttpDestination } from '@sap-cloud-sdk/connectivity';

import { getThirdPartyEmployeeSecret } from '../../../shared/utils/secrets';
import { postEmployeeNotification } from './employee.client';

const ql = cds.ql as typeof cds.ql & { SELECT: typeof cds.ql.SELECT };

export interface NotificationEnvelope {
  body: Record<string, unknown>;
  secret?: string;
  headers?: Record<string, string>;
}

export interface PreparedNotification {
  eventType: string;
  payloadsByDestination: Map<string, NotificationEnvelope[]>;
}

interface ClientRow {
  ID: string;
  companyId: string;
  name?: string;
}

interface EmployeeSnapshot {
  ID?: string;
  employeeId?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  entryDate?: string;
  exitDate?: string | null;
  status?: string;
  employmentType?: string;
  isManager?: boolean;
  anonymizedAt?: string | null;
  client_ID?: string;
}

const mergeEmployeeSnapshots = (request: any, persisted: any): EmployeeSnapshot => ({
  ...request,
  ...persisted,
});

export class EmployeeThirdPartyNotifier {
  constructor(private readonly tx?: Transaction) {}

  private defaultSecretPromise: Promise<string | undefined> | null = null;
  private destinationName: string | null = null;

  private async getDefaultSecret(): Promise<string | undefined> {
    if (!this.defaultSecretPromise) {
      this.defaultSecretPromise = getThirdPartyEmployeeSecret();
    }
    return this.defaultSecretPromise;
  }

  async prepareEmployeesCreated(
    requestEntries: any[],
    persistedRows: any[],
  ): Promise<PreparedNotification> {
    const payloadsByDestination = new Map<string, NotificationEnvelope[]>();

    if (!Array.isArray(requestEntries) || !Array.isArray(persistedRows) || !persistedRows.length) {
      return { eventType: 'EMPLOYEE_CREATED', payloadsByDestination };
    }

    const snapshots: EmployeeSnapshot[] = persistedRows.map((row, index) =>
      mergeEmployeeSnapshots(requestEntries[index] ?? {}, row),
    );

    const byClient = new Map<string, EmployeeSnapshot[]>();
    for (const snapshot of snapshots) {
      const clientId = snapshot.client_ID;
      if (!clientId) {
        continue;
      }

      if (!byClient.has(clientId)) {
        byClient.set(clientId, []);
      }

      byClient.get(clientId)?.push(snapshot);
    }

    if (!byClient.size) {
      return { eventType: 'EMPLOYEE_CREATED', payloadsByDestination };
    }

    const clientIds = Array.from(byClient.keys());
    const tx = this.tx ?? ((cds as any).db ?? (await cds.connect.to('db')));
    if (!tx) {
      return { eventType: 'EMPLOYEE_CREATED', payloadsByDestination };
    }

    const clients = (await tx.run(
      ql.SELECT.from('clientmgmt.Clients').columns('ID', 'companyId', 'name').where({ ID: { in: clientIds } }),
    )) as ClientRow[];

    const clientsById = new Map<string, ClientRow>();
    for (const client of clients) {
      clientsById.set(client.ID, client);
    }

    const defaultSecret = await this.getDefaultSecret();
    const timestamp = new Date().toISOString();
    const destinationName = this.getEmployeeCreatedDestination();

    for (const [clientId, employees] of byClient.entries()) {
      const client = clientsById.get(clientId);
      if (!client) {
        continue;
      }

      const body = {
        eventType: 'EMPLOYEE_CREATED',
        client: {
          id: client.ID,
          companyId: client.companyId,
          name: client.name ?? undefined,
        },
        employees: employees.map((employee) => ({
          id: employee.ID ?? undefined,
          employeeId: employee.employeeId ?? undefined,
          firstName: employee.firstName ?? undefined,
          lastName: employee.lastName ?? undefined,
          email: employee.email ?? undefined,
          entryDate: employee.entryDate ?? undefined,
          exitDate: employee.exitDate ?? undefined,
          status: employee.status ?? undefined,
          employmentType: employee.employmentType ?? undefined,
          isManager: employee.isManager ?? undefined,
          anonymizedAt: employee.anonymizedAt ?? undefined,
        })),
        timestamp,
      } as Record<string, unknown>;

      const envelope: NotificationEnvelope = {
        body,
        secret: defaultSecret ?? undefined,
      };

      if (!payloadsByDestination.has(destinationName)) {
        payloadsByDestination.set(destinationName, []);
      }

      payloadsByDestination.get(destinationName)?.push(envelope);
    }

    return { eventType: 'EMPLOYEE_CREATED', payloadsByDestination };
  }

  async dispatch(notification: PreparedNotification): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const [destinationName, envelopes] of notification.payloadsByDestination.entries()) {
      for (const envelope of envelopes) {
        tasks.push(this.dispatchEnvelope(notification.eventType, destinationName, envelope));
      }
    }

    const results = await Promise.allSettled(tasks);
    const failures = results
      .map((result, index) => ({ result, index }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length) {
      const errorMessages = failures
        .map(({ result, index }) => `task ${index + 1}: ${(result as PromiseRejectedResult).reason}`)
        .join('; ');
      throw new Error(`Failed to dispatch third-party notifications: ${errorMessages}`);
    }
  }

  async dispatchEnvelope(
    eventType: string,
    destinationName: string,
    envelope: NotificationEnvelope,
  ): Promise<void> {
    const payload = { ...envelope.body };
    if (!payload.eventType) {
      payload.eventType = eventType;
    }
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }

    const payloadString = JSON.stringify(payload);
    const destination = await this.resolveDestination(destinationName);
    const signingSecret = envelope.secret ?? (await this.getDefaultSecret());

    await postEmployeeNotification({
      destination,
      payload: payloadString,
      secret: signingSecret,
      timeoutMs: 10_000,
      headers: envelope.headers,
    });
  }

  private async resolveDestination(destinationName: string): Promise<HttpDestination> {
    const destination = await getDestination({ destinationName });
    if (!destination) {
      throw new Error(`Destination ${destinationName} not found`);
    }

    if (!isHttpDestination(destination)) {
      throw new Error(`Destination ${destinationName} is not an HTTP destination`);
    }

    if (!destination.url || !destination.url.startsWith('https://')) {
      throw new Error(`Destination ${destinationName} must resolve to an HTTPS URL`);
    }

    return destination;
  }

  private getEmployeeCreatedDestination(): string {
    if (this.destinationName) {
      return this.destinationName;
    }

    const destinationName =
      (cds.env as Record<string, any>)?.employeeNotifications?.employeeCreatedDestination ??
      process.env.EMPLOYEE_CREATED_DESTINATION;

    if (!destinationName || typeof destinationName !== 'string') {
      throw new Error(
        'Employee created notification destination is not configured. Set cds.employeeNotifications.employeeCreatedDestination or EMPLOYEE_CREATED_DESTINATION.',
      );
    }

    this.destinationName = destinationName;
    return destinationName;
  }
}

export default EmployeeThirdPartyNotifier;
