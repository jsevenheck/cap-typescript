/**
 * Lightweight HTTP client for delivering employee notifications to downstream systems.
 */
import { createHmac } from 'node:crypto';
import type { HttpDestination } from '@sap-cloud-sdk/connectivity';
import { executeHttpRequest, type HttpRequestConfig } from '@sap-cloud-sdk/http-client';

type HttpErrorLike = Error & {
  statusCode?: number;
  response?: {
    status?: number;
    statusText?: string;
    data?: unknown;
  };
  body?: unknown;
};

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
  } catch (error: unknown) {
    if (error instanceof Error) {
      const httpError = error as HttpErrorLike;
      const status = httpError.statusCode ?? httpError.response?.status;
      const statusText = httpError.response?.statusText;
      const body = httpError.body ?? httpError.response?.data;

      const context: string[] = [];
      if (status !== undefined) {
        context.push(`status ${status}${statusText ? ` ${statusText}` : ''}`);
      }

      if (body !== undefined) {
        const serialized = (() => {
          if (typeof body === 'string') {
            return body;
          }
          try {
            return JSON.stringify(body);
          } catch (serializationError) {
            return `[unserializable body: ${serializationError instanceof Error ? serializationError.message : 'unknown'}]`;
          }
        })();

        context.push(`body ${serialized}`);
      }

      const contextSuffix = context.length ? ` (${context.join(', ')})` : '';
      const message = `Failed to deliver employee notification${contextSuffix}: ${httpError.message}`;

      const enrichedError = new Error(message, { cause: httpError });
      if (httpError.stack) {
        enrichedError.stack = httpError.stack;
      }

      Object.assign(enrichedError, {
        status,
        responseBody: body,
      });

      throw enrichedError;
    }

    throw new Error('Failed to deliver employee notification: Non-Error value thrown', {
      cause: error as unknown,
    });
  }
};
