/**
 * Lightweight HTTP client for delivering employee notifications to downstream systems.
 */
import { createHmac } from 'node:crypto';
import type { HttpDestination } from '@sap-cloud-sdk/connectivity';
import { executeHttpRequest, type HttpRequestConfig } from '@sap-cloud-sdk/http-client';

export interface NotificationRequest {
  destination: HttpDestination;
  payload: string;
  secret?: string;
  timeoutMs: number;
}

const buildHeaders = (payload: string, secret?: string): Record<string, string> => {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (secret) {
    const signature = createHmac('sha256', secret).update(String(payload ?? '')).digest('hex');
    headers['x-signature-sha256'] = signature;
  }
  return headers;
};

export const postEmployeeNotification = async ({
  destination,
  payload,
  secret,
  timeoutMs,
}: NotificationRequest): Promise<void> => {
  const headers = buildHeaders(payload, secret);
  const request: HttpRequestConfig = {
    method: 'post',
    data: payload,
    headers,
    timeout: timeoutMs,
  };

  try {
    await executeHttpRequest(destination, request);
  } catch (error: any) {
    const message = error?.message ?? 'Unknown error';
    throw new Error(String(message));
  }
};
