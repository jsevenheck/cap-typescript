import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

const INVALID_API_KEY_RESPONSE = { error: 'invalid_api_key' } as const;

function extractApiKey(req: Request): string | undefined {
  const headerKey = req.header('x-api-key');
  if (headerKey) {
    return headerKey.trim();
  }

  const authorization = req.header('authorization');
  if (!authorization) {
    return undefined;
  }

  const matches = authorization.match(/^ApiKey\s+(?<key>.+)$/i);
  return matches?.groups?.key?.trim();
}

const toKeyBuffer = (key: string | undefined): Buffer | undefined => {
  if (!key) {
    return undefined;
  }

  return Buffer.from(key, 'utf8');
};

export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const configuredKey = process.env.EMPLOYEE_EXPORT_API_KEY?.trim();
  const providedKey = extractApiKey(req)?.trim();

  const configuredBuffer = toKeyBuffer(configuredKey);
  const providedBuffer = toKeyBuffer(providedKey);

  if (!configuredBuffer || !providedBuffer || configuredBuffer.length !== providedBuffer.length) {
    res.status(401).json(INVALID_API_KEY_RESPONSE);
    return;
  }

  try {
    if (!crypto.timingSafeEqual(configuredBuffer, providedBuffer)) {
      res.status(401).json(INVALID_API_KEY_RESPONSE);
      return;
    }
  } catch (_error) {
    res.status(401).json(INVALID_API_KEY_RESPONSE);
    return;
  }

  next();
};

export default apiKeyMiddleware;
