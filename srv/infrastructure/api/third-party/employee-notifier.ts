import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';
import crypto from 'crypto';
import axios, { type AxiosInstance } from 'axios';

import { getThirdPartyEmployeeSecret } from '../../../shared/utils/secrets';

const ql = cds.ql as typeof cds.ql & { SELECT: typeof cds.ql.SELECT };

export interface NotificationEnvelope {
  body: Record<string, unknown>;
  secret?: string;
  headers?: Record<string, string>;
}

export interface PreparedNotification {
  eventType: string;
  payloadsByEndpoint: Map<string, NotificationEnvelope[]>;
}

interface ClientRow {
  ID: string;
  companyId: string;
  name?: string;
  notificationEndpoint?: string | null;
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

const DEFAULT_RETRY_ATTEMPTS = 3;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const mergeEmployeeSnapshots = (request: any, persisted: any): EmployeeSnapshot => ({
  ...request,
  ...persisted,
});

export class EmployeeThirdPartyNotifier {
  private readonly httpClient: AxiosInstance;

  constructor(private readonly tx?: Transaction) {
    this.httpClient = axios.create({
      timeout: 10_000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  private defaultSecretPromise: Promise<string | undefined> | null = null;

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
    const payloadsByEndpoint = new Map<string, NotificationEnvelope[]>();

    if (!Array.isArray(requestEntries) || !Array.isArray(persistedRows) || !persistedRows.length) {
      return { eventType: 'EMPLOYEE_CREATED', payloadsByEndpoint };
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
      return { eventType: 'EMPLOYEE_CREATED', payloadsByEndpoint };
    }

    const clientIds = Array.from(byClient.keys());
    const tx = this.tx ?? ((cds as any).db ?? (await cds.connect.to('db')));
    if (!tx) {
      return { eventType: 'EMPLOYEE_CREATED', payloadsByEndpoint };
    }

    const clients = (await tx.run(
      ql.SELECT.from('clientmgmt.Clients')
        .columns('ID', 'companyId', 'name', 'notificationEndpoint')
        .where({ ID: { in: clientIds } }),
    )) as ClientRow[];

    const clientsById = new Map<string, ClientRow>();
    for (const client of clients) {
      clientsById.set(client.ID, client);
    }

    const defaultSecret = await this.getDefaultSecret();
    const timestamp = new Date().toISOString();

    for (const [clientId, employees] of byClient.entries()) {
      const client = clientsById.get(clientId);
      const endpoint = client?.notificationEndpoint ?? undefined;
      if (!client || !endpoint) {
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

      if (!payloadsByEndpoint.has(endpoint)) {
        payloadsByEndpoint.set(endpoint, []);
      }

      payloadsByEndpoint.get(endpoint)?.push(envelope);
    }

    return { eventType: 'EMPLOYEE_CREATED', payloadsByEndpoint };
  }

  async dispatch(notification: PreparedNotification): Promise<void> {
    const tasks: Promise<void>[] = [];

    for (const [endpoint, envelopes] of notification.payloadsByEndpoint.entries()) {
      for (const envelope of envelopes) {
        tasks.push(this.dispatchEnvelope(notification.eventType, endpoint, envelope));
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
    endpoint: string,
    envelope: NotificationEnvelope,
  ): Promise<void> {
    const payload = { ...envelope.body };
    if (!payload.eventType) {
      payload.eventType = eventType;
    }
    if (!payload.timestamp) {
      payload.timestamp = new Date().toISOString();
    }

    await this.sendWithRetry(endpoint, payload, envelope.headers ?? {}, envelope.secret, 1);
  }

  generateSignature(payload: any, secret: string): string {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(JSON.stringify(payload));
    return hmac.digest('hex');
  }

  private async sendWithRetry(
    endpoint: string,
    payload: Record<string, unknown>,
    headers: Record<string, string>,
    secret?: string,
    attempt: number = 1,
  ): Promise<void> {
    const maxAttempts = DEFAULT_RETRY_ATTEMPTS;
    const signingSecret = secret ?? (await this.getDefaultSecret());

    const finalHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      ...headers,
    };

    if (signingSecret) {
      finalHeaders['x-signature-sha256'] = this.generateSignature(payload, signingSecret);
    }

    try {
      await this.httpClient.post(endpoint, payload, { headers: finalHeaders });
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      const backoff = Math.pow(2, attempt - 1) * 1000;
      await delay(backoff);
      await this.sendWithRetry(endpoint, payload, headers, secret, attempt + 1);
    }
  }
}

export default EmployeeThirdPartyNotifier;
