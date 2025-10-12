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

  const sanitizeBodyForDiagnostics = (body: unknown): string => {
    const truncate = (value: string, maxLength = 500): string =>
      value.length > maxLength ? `${value.slice(0, maxLength)}…` : value;

    const sensitiveKeyPattern = /password|secret|token|authorization|auth|apiKey|apikey|accessToken|refreshToken/i;

    const redactObject = (value: unknown): unknown => {
      if (Array.isArray(value)) {
        return value.map(redactObject);
      }
      if (value && typeof value === 'object') {
        return Object.entries(value as Record<string, unknown>).reduce<Record<string, unknown>>(
          (acc, [key, val]) => {
            if (sensitiveKeyPattern.test(key)) {
              acc[key] = '[redacted]';
            } else {
              acc[key] = redactObject(val);
            }
            return acc;
          },
          {},
        );
      }
      if (typeof value === 'string' && sensitiveKeyPattern.test(value)) {
        return '[redacted]';
      }
      return value;
    };

    const serialise = (value: unknown): string => {
      if (value === undefined || value === null) {
        return '';
      }
      if (typeof value === 'string') {
        try {
          const parsed = JSON.parse(value);
          return JSON.stringify(redactObject(parsed));
        } catch {
          const redacted = value.replace(
            /("(?:password|secret|token|authorization|auth|apiKey|apikey|accessToken|refreshToken)"\s*:\s*)"[^"]*"/gi,
            '$1"[redacted]"',
          );
          return redacted;
        }
      }
      if (typeof value === 'object') {
        try {
          return JSON.stringify(redactObject(value));
        } catch {
          return '[unserializable body]';
        }
      }
      if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
        return JSON.stringify(value);
      }
      if (typeof value === 'symbol') {
        return value.description ? `Symbol(${value.description})` : 'Symbol()';
      }
      if (typeof value === 'function') {
        return '[function]';
      }
      return '[unserializable body]';
    };

    return truncate(serialise(body));
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
        context.push('body [redacted]');
      }

      const contextSuffix = context.length ? ` (${context.join(', ')})` : '';
      const message = `Failed to deliver employee notification${contextSuffix}: ${httpError.message}`;

      const enrichedError = new Error(message, { cause: httpError });
      if (httpError.stack) {
        enrichedError.stack = httpError.stack;
      }

      Object.assign(enrichedError, {
        status,
        responseBodySnippet: body !== undefined ? sanitizeBodyForDiagnostics(body) : undefined,
      });

      throw enrichedError;
    }

    throw new Error('Failed to deliver employee notification: Non-Error value thrown', {
      cause: error as unknown,
    });
  }
};
