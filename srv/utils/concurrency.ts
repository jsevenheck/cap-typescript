/**
 * Utility helpers for optimistic concurrency handling across CAP services.
 */
import cds from '@sap/cds';
import type { Transaction } from '@sap/cds';

import { createServiceError } from './errors';

export type HeaderMap = Record<string, unknown> | undefined;

export const extractIfMatchHeader = (headers: HeaderMap): string | undefined => {
  if (!headers) {
    return undefined;
  }
  const raw = headers['if-match'] ?? headers['If-Match'] ?? headers['IF-MATCH'];
  if (Array.isArray(raw)) {
    return raw.filter((value): value is string => typeof value === 'string').join(',');
  }
  return typeof raw === 'string' ? raw : undefined;
};

export const parseIfMatchHeader = (header: string): { wildcard: boolean; values: string[] } => {
  const parts = header
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  let wildcard = false;
  const values: string[] = [];

  for (const part of parts) {
    if (part === '*') {
      wildcard = true;
      continue;
    }

    let value = part;
    if (value.startsWith('W/')) {
      value = value.substring(2).trim();
    }
    if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
      value = value.substring(1, value.length - 1);
    }

    if (value.length > 0) {
      values.push(value);
    }
  }

  return { wildcard, values };
};

export const normalizeConcurrencyValue = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === 'string') {
    return value;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
};

export const getEntityConcurrencyField = (
  entityName: string,
): { etag?: string; field?: string } => {
  const definition = (cds as any).model?.definitions?.[entityName] as
    | { ['@odata.etag']?: string; elements?: Record<string, unknown> }
    | undefined;

  const etagElement = typeof definition?.['@odata.etag'] === 'string' ? definition['@odata.etag'] : undefined;

  if (etagElement) {
    return { etag: etagElement, field: etagElement };
  }

  const hasModifiedAt = Boolean((definition as { elements?: Record<string, unknown> } | undefined)?.elements?.modifiedAt);

  if (hasModifiedAt) {
    return { field: 'modifiedAt' };
  }

  return {};
};

const extractIdFromWhereClause = (where: unknown): string | undefined => {
  if (!Array.isArray(where)) {
    return undefined;
  }

  for (let index = 0; index < where.length; index += 1) {
    const segment = where[index];
    if (
      segment &&
      typeof segment === 'object' &&
      'ref' in segment &&
      Array.isArray((segment as { ref: unknown[] }).ref) &&
      (segment as { ref: unknown[] }).ref.length === 1 &&
      (segment as { ref: unknown[] }).ref[0] === 'ID'
    ) {
      const operator = where[index + 1];
      const value = where[index + 2];

      if (operator === '=' || operator === '==') {
        if (value && typeof value === 'object' && 'val' in (value as Record<string, unknown>)) {
          const resolved = (value as Record<string, unknown>).val;
          return typeof resolved === 'string' ? resolved : undefined;
        }
      }
    }
  }

  return undefined;
};

export interface EntityReferenceContext {
  data?: { ID?: string | null };
  params?: Array<Record<string, unknown>>;
  query?: {
    UPDATE?: { where?: unknown; data?: Record<string, unknown> };
    DELETE?: { where?: unknown };
  };
}

export const deriveEntityId = (context: EntityReferenceContext): string | undefined => {
  if (context.data?.ID) {
    return context.data.ID;
  }

  if (Array.isArray(context.params) && context.params.length > 0) {
    const lastParam = context.params[context.params.length - 1];
    if (lastParam && typeof lastParam === 'object' && 'ID' in lastParam) {
      return lastParam.ID as string | undefined;
    }
  }

  const where = context.query?.UPDATE?.where ?? context.query?.DELETE?.where;
  if (where) {
    const derived = extractIdFromWhereClause(where);
    if (derived) {
      return derived;
    }
  }

  return undefined;
};

export interface ConcurrencyCheckInput {
  tx: Transaction;
  entityName: string;
  targetId: string;
  headerValue?: string;
  hasHttpHeaders: boolean;
  payloadValue?: unknown;
}

export const ensureOptimisticConcurrency = async ({
  tx,
  entityName,
  targetId,
  headerValue,
  hasHttpHeaders,
  payloadValue,
}: ConcurrencyCheckInput): Promise<void> => {
  const { etag, field } = getEntityConcurrencyField(entityName);

  if (!field) {
    return;
  }

  if (!hasHttpHeaders && !headerValue) {
    return;
  }

  const record = (await tx.run(
    cds.ql.SELECT.one.from(entityName).columns(field).where({ ID: targetId }),
  )) as Record<string, unknown> | undefined;

  if (!record) {
    throw createServiceError(404, `Entity ${targetId} not found.`);
  }

  const currentValue = normalizeConcurrencyValue(record[field]);

  if (headerValue) {
    const { wildcard, values } = parseIfMatchHeader(headerValue);
    if (wildcard) {
      return;
    }

    if (values.length === 0) {
      throw createServiceError(400, 'Invalid If-Match header.');
    }

    if (currentValue === undefined) {
      throw createServiceError(412);
    }

    if (!values.includes(currentValue)) {
      throw createServiceError(412);
    }

    return;
  }

  const providedValue = normalizeConcurrencyValue(payloadValue);

  if (etag && hasHttpHeaders) {
    throw createServiceError(428, 'Precondition required: supply an If-Match header.');
  }

  if (!providedValue) {
    throw createServiceError(428, `Precondition required: include ${field} in the request payload.`);
  }

  if (currentValue === undefined) {
    throw createServiceError(412);
  }

  if (providedValue !== currentValue) {
    throw createServiceError(412);
  }
};
