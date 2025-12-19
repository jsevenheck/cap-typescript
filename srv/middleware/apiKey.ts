import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getEmployeeExportApiKey } from '../shared/utils/secrets';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('api-key-middleware');
const INVALID_API_KEY_RESPONSE = { error: 'invalid_api_key' } as const;

const DEFAULT_API_KEY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_REFRESH_JITTER_MS = 30_000; // 30 seconds
const DEFAULT_BACKOFF_MIN_MS = 5_000;
const DEFAULT_BACKOFF_MAX_MS = 5 * 60 * 1000; // 5 minutes

const parseDurationMs = (value: string | undefined, fallback: number, minimum: number, maximum: number): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum) {
    return fallback;
  }

  return Math.min(parsed, maximum);
};

const API_KEY_TTL_MS = parseDurationMs(
  process.env.EMPLOYEE_EXPORT_API_KEY_TTL_MS,
  DEFAULT_API_KEY_TTL_MS,
  1_000,
  Number.MAX_SAFE_INTEGER,
);

const REFRESH_JITTER_MS = parseDurationMs(
  process.env.EMPLOYEE_EXPORT_API_KEY_REFRESH_JITTER_MS,
  DEFAULT_REFRESH_JITTER_MS,
  0,
  API_KEY_TTL_MS,
);

const REFRESH_BACKOFF_MIN_MS = parseDurationMs(
  process.env.EMPLOYEE_EXPORT_API_KEY_REFRESH_BACKOFF_MIN_MS,
  DEFAULT_BACKOFF_MIN_MS,
  1_000,
  DEFAULT_BACKOFF_MAX_MS,
);

const REFRESH_BACKOFF_MAX_MS = parseDurationMs(
  process.env.EMPLOYEE_EXPORT_API_KEY_REFRESH_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_MAX_MS,
  REFRESH_BACKOFF_MIN_MS,
  Number.MAX_SAFE_INTEGER,
);

// Cache for the configured API key (loaded from Credential Store or env)
let cachedApiKey: string | undefined;
let lastLoadedAt = 0;

let refreshTimer: NodeJS.Timeout | undefined;
let currentBackoffMs = REFRESH_BACKOFF_MIN_MS;
let refreshLoopEnabled = false;

const LOCAL_DEV_FALLBACK_API_KEY = 'local-dev-api-key';

type LoadApiKeyOptions = {
  force?: boolean;
  reason?: string;
};

const resolveLocalDevApiKey = (): string | undefined => {
  // Only consider the fallback outside production so we don't weaken security in productive deployments
  if (process.env.NODE_ENV === 'production') {
    return undefined;
  }

  // Allow developers to override the fallback value without touching the main environment variable
  const localOverride = process.env.LOCAL_EMPLOYEE_EXPORT_API_KEY?.trim();
  if (localOverride) {
    return localOverride;
  }

  return LOCAL_DEV_FALLBACK_API_KEY;
};

const shouldRefresh = (force?: boolean): boolean => {
  if (force) {
    return true;
  }

  if (!lastLoadedAt) {
    return true;
  }

  return Date.now() - lastLoadedAt >= API_KEY_TTL_MS;
};

const withJitter = (baseMs: number): number => {
  if (REFRESH_JITTER_MS <= 0) {
    return baseMs;
  }

  const jitter = Math.floor(Math.random() * REFRESH_JITTER_MS);
  return baseMs + jitter;
};

const scheduleRefresh = (delayMs: number): void => {
  if (!refreshLoopEnabled) {
    return;
  }

  if (refreshTimer) {
    clearTimeout(refreshTimer);
  }

  refreshTimer = setTimeout(() => {
    void refreshWithBackoff('scheduled-refresh', true);
  }, Math.max(delayMs, 0));

  refreshTimer.unref?.();
};

const applyApiKey = (nextKey: string, source: 'primary' | 'fallback', reason?: string): boolean => {
  const trimmedKey = nextKey.trim();
  const previousKey = cachedApiKey;
  cachedApiKey = trimmedKey;
  lastLoadedAt = Date.now();

  if (!previousKey) {
    logger.info({ reason: reason ?? 'initial-load', source }, 'Employee export API key loaded successfully');
    return true;
  }

  if (previousKey !== trimmedKey) {
    logger.info({ reason: reason ?? 'refresh', source }, 'Employee export API key rotated');
    return true;
  }

  logger.debug({ reason: reason ?? 'refresh', source }, 'Employee export API key refreshed with unchanged value');
  return false;
};

/**
 * Load API key from Credential Store or environment variable.
 * Respects a cache TTL unless force=true is provided.
 */
export const loadApiKey = async (options: LoadApiKeyOptions = {}): Promise<boolean> => {
  const { force = false, reason } = options;

  if (!shouldRefresh(force)) {
    return Boolean(cachedApiKey);
  }

  try {
    const fetchedKey = await getEmployeeExportApiKey();
    if (fetchedKey) {
      applyApiKey(fetchedKey, 'primary', reason);
      return true;
    }

    // Use a deterministic, overridable fallback for local development so the endpoint is still reachable
    const localFallbackApiKey = resolveLocalDevApiKey();
    if (localFallbackApiKey) {
      applyApiKey(localFallbackApiKey, 'fallback', reason);
      logger.warn(
        'Employee export API key not configured. Using local development fallback key (set LOCAL_EMPLOYEE_EXPORT_API_KEY to override).',
      );
      return true;
    }

    logger.warn(
      'Employee export API key not configured. Set EMPLOYEE_EXPORT_API_KEY or bind the Credential Store secret employee-export/api-key.',
    );
    return false;
  } catch (error) {
    logger.warn({ err: error, reason: reason ?? 'refresh' }, 'Failed to load employee export API key');
    throw error;
  }
};

const refreshWithBackoff = async (reason: string, shouldScheduleNext: boolean): Promise<boolean> => {
  try {
    const loaded = await loadApiKey({ force: true, reason });
    currentBackoffMs = REFRESH_BACKOFF_MIN_MS;

    if (shouldScheduleNext && refreshLoopEnabled) {
      scheduleRefresh(withJitter(API_KEY_TTL_MS));
    }

    return loaded;
  } catch (error) {
    const nextDelay = Math.min(currentBackoffMs * 2, REFRESH_BACKOFF_MAX_MS);
    currentBackoffMs = nextDelay;

    logger.warn({ err: error, delayMs: nextDelay, reason }, 'Failed to refresh employee export API key; applying backoff');

    if (shouldScheduleNext && refreshLoopEnabled) {
      scheduleRefresh(withJitter(nextDelay));
    }

    return false;
  }
};

export const startApiKeyRefreshScheduler = (): void => {
  if (refreshLoopEnabled) {
    return;
  }

  refreshLoopEnabled = true;
  scheduleRefresh(withJitter(API_KEY_TTL_MS));
};

export const stopApiKeyRefreshScheduler = (): void => {
  refreshLoopEnabled = false;
  currentBackoffMs = REFRESH_BACKOFF_MIN_MS;

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
};

export const forceReloadApiKey = async (): Promise<boolean> => {
  return refreshWithBackoff('forced-reload', refreshLoopEnabled);
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

  const matches = authorization.match(/^ApiKey\\s+(?<key>.+)$/i);
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
