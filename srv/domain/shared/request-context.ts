import type { Request } from '@sap/cds/apis/services';

import {
  deriveEntityId,
  extractIfMatchHeader,
  getEntityConcurrencyField,
  type HeaderMap,
} from '../../shared/utils/concurrency';
import { createServiceError } from '../../shared/utils/errors';
import type { CapUserLike } from '../../shared/utils/auth';

export const getHeaders = (req: Request): HeaderMap => (req as Request & { headers?: HeaderMap }).headers;

export const extractRequestParams = (req: Request): Array<Record<string, unknown>> | undefined =>
  (req as Request & { params?: Array<Record<string, unknown>> }).params;

const isCapUserLike = (user: unknown): user is CapUserLike => {
  if (!user || typeof user !== 'object') {
    return false;
  }

  const candidate = user as CapUserLike & Record<string, unknown>;
  if ('is' in candidate && candidate.is !== undefined && typeof candidate.is !== 'function') {
    return false;
  }

  if ('attr' in candidate && candidate.attr !== undefined) {
    const attr = candidate.attr;
    if (typeof attr !== 'function' && (typeof attr !== 'object' || attr === null)) {
      return false;
    }
  }

  return true;
};

interface RequestWithUser extends Request {
  user?: unknown;
}

export const requireRequestUser = (req: Request): CapUserLike => {
  const candidate = (req as RequestWithUser).user;
  if (!candidate) {
    throw createServiceError(401, 'User context is required.');
  }

  if (!isCapUserLike(candidate)) {
    throw createServiceError(401, 'Invalid user context received.');
  }

  return candidate;
};

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
