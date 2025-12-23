import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { getEmployeeExportApiKey } from '../shared/utils/secrets';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('api-key-middleware');
const INVALID_API_KEY_RESPONSE = { error: 'invalid_api_key' } as const;

const DEFAULT_API_KEY_TTL_MS = 15 * 60 * 1000; // 15 minutes
const DEFAULT_REFRESH_JITTER_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_BACKOFF_MIN_MS = 5_000;
const DEFAULT_BACKOFF_MAX_MS = 5 * 60 * 1000; // 5 minutes
const DEFAULT_MAX_CONSECUTIVE_REFRESH_FAILURES = 5;

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
  Number.MAX_SAFE_INTEGER,
);

const REFRESH_BACKOFF_MAX_MS = parseDurationMs(
  process.env.EMPLOYEE_EXPORT_API_KEY_REFRESH_BACKOFF_MAX_MS,
  DEFAULT_BACKOFF_MAX_MS,
  REFRESH_BACKOFF_MIN_MS,
  Number.MAX_SAFE_INTEGER,
);

const parseMaxFailures = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
};

const MAX_CONSECUTIVE_REFRESH_FAILURES = parseMaxFailures(
  process.env.EMPLOYEE_EXPORT_API_KEY_MAX_CONSECUTIVE_FAILURES,
  DEFAULT_MAX_CONSECUTIVE_REFRESH_FAILURES,
);

type LoadResult = {
  /**
   * Whether the API key was successfully obtained from any source.
   * False indicates the key could not be loaded; true means it was retrieved.
   */
  loaded: boolean;
  /**
   * True when the applied key differs from the previously cached key (including the initial load).
   * False when the key was loaded successfully but remained unchanged.
   */
  rotated: boolean;
  /**
   * Which source provided the key (Credential Store/environment, local fallback, or unknown on failure).
   */
  source: 'primary' | 'fallback' | 'unknown';
};

// Cache for the configured API key (loaded from Credential Store or env)
let cachedApiKey: string | undefined;
let lastLoadedAt = 0;
let lastLoadedSource: LoadResult['source'] = 'unknown';

let refreshTimer: NodeJS.Timeout | undefined;
let currentBackoffMs = REFRESH_BACKOFF_MIN_MS;
let refreshLoopEnabled = false;
let refreshPausedDueToFailures = false;
let refreshSchedulerInitInProgress = false;
let consecutiveRefreshFailures = 0;
let loadInFlight: Promise<LoadResult> | null = null;

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
  if (!refreshLoopEnabled || refreshPausedDueToFailures) {
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

const applyApiKey = (nextKey: string, source: 'primary' | 'fallback', reason?: string): LoadResult => {
  // Trim defensively to tolerate stray whitespace returned by secret sources
  const trimmedKey = nextKey.trim();
  const previousKey = cachedApiKey;
  cachedApiKey = trimmedKey;
  lastLoadedAt = Date.now();
  lastLoadedSource = source;

  if (!previousKey) {
    logger.info({ reason: reason ?? 'initial-load', source }, 'Employee export API key loaded successfully');
    return { loaded: true, rotated: true, source };
  }

  if (previousKey !== trimmedKey) {
    logger.info({ reason: reason ?? 'refresh', source }, 'Employee export API key rotated');
    return { loaded: true, rotated: true, source };
  }

  logger.debug({ reason: reason ?? 'refresh', source }, 'Employee export API key refreshed with unchanged value');
  return { loaded: true, rotated: false, source };
};

/**
 * Load API key from Credential Store or environment variable.
 * Respects a cache TTL unless force=true is provided.
 * When a load is already in progress, concurrent callers share the same in-flight request via `loadInFlight`.
 */
export const loadApiKey = async (options: LoadApiKeyOptions = {}): Promise<LoadResult> => {
  const { force = false, reason } = options;

  if (!shouldRefresh(force)) {
    return { loaded: Boolean(cachedApiKey), rotated: false, source: lastLoadedSource };
  }

  if (loadInFlight) {
    return loadInFlight;
  }

  loadInFlight = (async () => {
    try {
      const fetchedKey = await getEmployeeExportApiKey();
      if (fetchedKey) {
        return applyApiKey(fetchedKey, 'primary', reason);
      }

      // Use a deterministic, overridable fallback for local development so the endpoint is still reachable
      const localFallbackApiKey = resolveLocalDevApiKey();
      if (localFallbackApiKey) {
        const result = applyApiKey(localFallbackApiKey, 'fallback', reason);
        logger.warn(
          'Employee export API key not configured. Using local development fallback key (set LOCAL_EMPLOYEE_EXPORT_API_KEY to override).',
        );
        return result;
      }

      logger.warn(
        'Employee export API key not configured. Set EMPLOYEE_EXPORT_API_KEY or bind the Credential Store secret employee-export/api-key.',
      );
      return { loaded: false, rotated: false, source: 'unknown' };
    } catch (error) {
      logger.warn({ err: error, reason: reason ?? 'refresh' }, 'Failed to load employee export API key');
      throw error;
    } finally {
      loadInFlight = null;
    }
  })();

  return loadInFlight;
};

const handleRefreshFailure = (reason: string, error: unknown, scheduleNextRefresh: boolean): LoadResult => {
  consecutiveRefreshFailures += 1;

  currentBackoffMs = Math.min(currentBackoffMs * 2, REFRESH_BACKOFF_MAX_MS);
  const nextDelay = currentBackoffMs;

  const shouldPause = consecutiveRefreshFailures >= MAX_CONSECUTIVE_REFRESH_FAILURES;

  logger.warn(
    {
      err: error,
      delayMs: nextDelay,
      reason,
      consecutiveFailures: consecutiveRefreshFailures,
      paused: shouldPause,
    },
    shouldPause
      ? 'Failed to refresh employee export API key repeatedly; pausing scheduler'
      : 'Failed to refresh employee export API key; applying backoff',
  );

  if (shouldPause) {
    refreshPausedDueToFailures = true;
    if (refreshTimer) {
      clearTimeout(refreshTimer);
      refreshTimer = undefined;
    }
  } else if (scheduleNextRefresh && refreshLoopEnabled) {
    scheduleRefresh(withJitter(nextDelay));
  }

  return { loaded: false, rotated: false, source: 'unknown' };
};

const refreshWithBackoff = async (reason: string, scheduleNextRefresh: boolean): Promise<LoadResult> => {
  try {
    const result = await loadApiKey({ force: true, reason });

    if (!result.loaded) {
      return handleRefreshFailure(reason, new Error('employee export API key unavailable'), scheduleNextRefresh);
    }

    consecutiveRefreshFailures = 0;
    currentBackoffMs = REFRESH_BACKOFF_MIN_MS;
    refreshPausedDueToFailures = false;

    if (scheduleNextRefresh && refreshLoopEnabled) {
      scheduleRefresh(withJitter(API_KEY_TTL_MS));
    }

    return result;
  } catch (error) {
    return handleRefreshFailure(reason, error, scheduleNextRefresh);
  }
};

/**
 * Start the periodic API key refresh loop using TTL and jitter settings.
 */
export const startApiKeyRefreshScheduler = (): void => {
  if (refreshLoopEnabled || refreshSchedulerInitInProgress) {
    return;
  }

  refreshSchedulerInitInProgress = true;
  try {
    refreshLoopEnabled = true;
    refreshPausedDueToFailures = false;
    consecutiveRefreshFailures = 0;
    currentBackoffMs = REFRESH_BACKOFF_MIN_MS;
    scheduleRefresh(withJitter(API_KEY_TTL_MS));
  } finally {
    refreshSchedulerInitInProgress = false;
  }
};

/**
 * Stop the periodic API key refresh loop and reset backoff state.
 */
export const stopApiKeyRefreshScheduler = (): void => {
  refreshLoopEnabled = false;
  currentBackoffMs = REFRESH_BACKOFF_MIN_MS;
  refreshSchedulerInitInProgress = false;

  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  refreshPausedDueToFailures = false;
  consecutiveRefreshFailures = 0;
};

/**
 * Force an immediate API key reload, optionally continuing the refresh loop.
 */
export const forceReloadApiKey = async (): Promise<LoadResult> => {
  // Avoid overlapping timers when a force reload is triggered
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }

  return refreshWithBackoff('forced-reload', refreshLoopEnabled && !refreshPausedDueToFailures);
};

/**
 * Extract an API key from request headers (x-api-key or Authorization: ApiKey ...).
 */
export function readApiKeyFromRequest(req: Request): string | undefined {
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

/**
 * Validate a provided API key against the cached key. Optionally supply a snapshot to avoid races.
 */
export const isApiKeyValid = (providedKey: string | undefined, referenceKey?: string): boolean => {
  // Use cached API key (loaded from Credential Store or env at startup)
  const configuredKey = (referenceKey ?? cachedApiKey)?.trim();
  const provided = providedKey?.trim();

  const configuredBuffer = toKeyBuffer(configuredKey);
  const providedBuffer = toKeyBuffer(provided);

  if (!configuredBuffer || !providedBuffer || configuredBuffer.length !== providedBuffer.length) {
    return false;
  }

  try {
    return crypto.timingSafeEqual(configuredBuffer, providedBuffer);
  } catch {
    return false;
  }
};

/**
 * Express middleware enforcing API key authentication.
 */
export const apiKeyMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const providedKey = readApiKeyFromRequest(req);

  if (!isApiKeyValid(providedKey)) {
    res.status(401).json(INVALID_API_KEY_RESPONSE);
    return;
  }

  next();
};

export const getCachedApiKeySnapshot = (): string | undefined => cachedApiKey;

/* istanbul ignore next - test-only state reset helper */
export const resetApiKeyCacheForTest = (): void => {
  cachedApiKey = undefined;
  lastLoadedAt = 0;
  lastLoadedSource = 'unknown';
  currentBackoffMs = REFRESH_BACKOFF_MIN_MS;
  refreshPausedDueToFailures = false;
  consecutiveRefreshFailures = 0;
  refreshSchedulerInitInProgress = false;
  loadInFlight = null;
  if (refreshTimer) {
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
  }
  refreshLoopEnabled = false;
};

export default apiKeyMiddleware;
