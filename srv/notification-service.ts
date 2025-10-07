import cds from '@sap/cds';
import type { Request } from '@sap/cds';

import fetch from 'node-fetch';
import { createHmac } from 'crypto';

export interface NotifyNewEmployeePayload {
  employeeId?: string;
  employeeUUID?: string;
  clientCompanyId?: string;
  client_ID?: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  [key: string]: unknown;
}

export const deliverNewEmployeeNotification = async (
  payload: NotifyNewEmployeePayload,
): Promise<void> => {
  const endpoint = process.env.THIRD_PARTY_EMPLOYEE_ENDPOINT;
  if (!endpoint) {
    return;
  }

  const body = JSON.stringify(payload);
  const headers: Record<string, string> = {
    'content-type': 'application/json',
  };

  const secret = process.env.THIRD_PARTY_EMPLOYEE_SECRET;
  if (secret) {
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    headers['x-signature-sha256'] = signature;
  }

  const timeoutMs = Number.parseInt(
    process.env.THIRD_PARTY_EMPLOYEE_TIMEOUT_MS ?? '10000',
    10,
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body,
      signal: controller.signal,
    });
  } catch (error: any) {
    if (error?.name === 'AbortError') {
      throw new Error(`Notify request timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    const message = await response.text();
    throw new Error(`Notify failed: ${response.status} ${message}`.trim());
  }
};

const registerNotificationHandlers = (service: any): void => {
  service.on('NotifyNewEmployee', async (req: Request) => {
    await deliverNewEmployeeNotification(req.data as NotifyNewEmployeePayload);
    return { ok: true };
  });
};

export default cds.service.impl(registerNotificationHandlers);
