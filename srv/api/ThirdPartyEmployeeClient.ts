/**
 * Lightweight HTTP client for delivering employee notifications to downstream systems.
 */
import { createHmac } from 'node:crypto';
import fetch, { type RequestInit } from 'node-fetch';

export interface NotificationRequest {
  endpoint: string;
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
  endpoint,
  payload,
  secret,
  timeoutMs,
}: NotificationRequest): Promise<void> => {
  const headers = buildHeaders(payload, secret);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const request: RequestInit = {
      method: 'POST',
      headers,
      body: payload,
      signal: controller.signal,
    };
    const response = await fetch(endpoint, request);

    if (!response.ok) {
      const message = await response.text();
      throw new Error(`HTTP ${response.status} ${message}`.trim());
    }
  } finally {
    clearTimeout(timeout);
  }
};
