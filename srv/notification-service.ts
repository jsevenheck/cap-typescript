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

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  });

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
