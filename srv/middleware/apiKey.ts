import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getEmployeeExportApiKey } from '../shared/utils/secrets';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('api-key-middleware');
const INVALID_API_KEY_RESPONSE = { error: 'invalid_api_key' } as const;

// Cache for the configured API key (loaded from Credential Store or env)
let cachedApiKey: string | undefined;
let apiKeyLoaded = false;

/**
 * Load API key from Credential Store or environment variable.
 * Should be called once during application startup.
 */
export const loadApiKey = async (): Promise<void> => {
  try {
    cachedApiKey = await getEmployeeExportApiKey();
    apiKeyLoaded = true;

    if (cachedApiKey) {
      logger.info('Employee export API key loaded successfully');
    } else {
      logger.warn('No employee export API key configured');
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to load employee export API key');
    apiKeyLoaded = true; // Mark as loaded even if failed, to avoid infinite retries
  }
};

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
  // Use cached API key (loaded from Credential Store or env at startup)
  const configuredKey = cachedApiKey?.trim();
  const providedKey = extractApiKey(req)?.trim();

  if (!apiKeyLoaded) {
    logger.error('API key not loaded yet, rejecting request');
    res.status(503).json({ error: 'service_initializing' });
    return;
  }

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
  } catch {
    res.status(401).json(INVALID_API_KEY_RESPONSE);
    return;
  }

  next();
};

export default apiKeyMiddleware;
