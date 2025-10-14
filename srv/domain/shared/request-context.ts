import type { Request } from '@sap/cds';

import {
  deriveEntityId,
  extractIfMatchHeader,
  getEntityConcurrencyField,
  type HeaderMap,
} from '../../shared/utils/concurrency';

export const getHeaders = (req: Request): HeaderMap => (req as Request & { headers?: HeaderMap }).headers;

export const extractRequestParams = (req: Request): Array<Record<string, unknown>> | undefined =>
  (req as Request & { params?: Array<Record<string, unknown>> }).params;

export const buildConcurrencyContext = (req: Request, entityName: string) => {
  const headers = getHeaders(req);
  const hasHttpHeaders = Boolean(headers && Object.keys(headers).length > 0);
  const headerValue = extractIfMatchHeader(headers);
  const { field } = getEntityConcurrencyField(entityName);
  let payloadValue: unknown;
  if (field) {
    const updatePayload = (req as { query?: { UPDATE?: { data?: Record<string, unknown> } } }).query?.UPDATE?.data;
    const httpBody = (req as Request & { req?: { body?: unknown } }).req?.body;
    const bodyValue =
      httpBody && typeof httpBody === 'object' ? (httpBody as Record<string, unknown>)[field] : undefined;
    payloadValue = (req.data as Record<string, unknown> | undefined)?.[field] ?? updatePayload?.[field] ?? bodyValue;
  }
  return { headerValue, hasHttpHeaders, payloadValue };
};

export const deriveTargetId = (req: Request): string | undefined =>
  deriveEntityId({
    data: req.data as { ID?: string },
    params: extractRequestParams(req),
    query: (req as unknown as { query?: Record<string, unknown> }).query,
  });
