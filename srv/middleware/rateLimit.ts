import type { Request, Response, NextFunction } from 'express';
import { createClient, type RedisClientType } from 'redis';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('rate-limiter');

export interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export type RateLimitBackend = 'memory' | 'redis';

export interface RateLimitStore {
  increment: (key: string, windowMs: number, now: number, resetTime: number) => Promise<RateLimitEntry>;
  shutdown?: () => Promise<void>;
}

interface RedisStoreOptions {
  namespace: string;
  maxKeys: number;
  client?: RedisClientType;
  url?: string;
}

interface InMemoryStoreOptions {
  namespace: string;
  maxKeys: number;
  cleanupIntervalMs: number;
}

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  statusCode?: number;
  keyGenerator?: (req: Request) => string;
  /**
   * Maximum distinct keys to keep in memory to avoid unbounded growth.
   * Oldest entries are evicted when the limit is reached.
   */
  maxKeys?: number;
  /**
   * Optional namespace for backing-store keys when using a shared cache such as Redis.
   */
  namespace?: string;
  /**
   * Backend to use for rate limit storage. Defaults to memory but can be overridden via
   * RATE_LIMIT_BACKEND environment variable.
   */
  backend?: RateLimitBackend;
  /**
   * Optional override for the Redis connection URL. When omitted, RATE_LIMIT_REDIS_URL or
   * REDIS_URL are used.
   */
  redisUrl?: string;
  /**
   * Provide a custom store implementation (e.g., SAP Cache adapter) for advanced deployments.
   */
  store?: RateLimitStore;
}

const parseMaxKeys = (maxKeys?: number): number => {
  const fromEnv = process.env.RATE_LIMIT_MAX_KEYS;
  const envValue = fromEnv ? Number.parseInt(fromEnv, 10) : Number.NaN;
  const resolved = Number.isFinite(envValue) && envValue > 0 ? envValue : maxKeys;

  if (resolved === undefined || resolved === null) {
    return 10_000;
  }

  return resolved > 0 ? resolved : Number.POSITIVE_INFINITY;
};

class InMemoryRateLimitStore implements RateLimitStore {
  private readonly store = new Map<string, RateLimitEntry>();
  private readonly effectiveMaxKeys: number;
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly options: InMemoryStoreOptions) {
    this.effectiveMaxKeys = parseMaxKeys(options.maxKeys);

    this.cleanupInterval = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of this.store.entries()) {
        if (entry.resetTime <= now) {
          this.store.delete(key);
        }
      }
    }, options.cleanupIntervalMs);

    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  shutdown = async (): Promise<void> => {
    clearInterval(this.cleanupInterval);
  };

  private evictOldestKey(): void {
    const oldestKey = this.store.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }

    this.store.delete(oldestKey);
    logger.debug({ oldestKey, maxKeys: this.effectiveMaxKeys }, 'Evicted oldest rate limit entry to enforce maxKeys');
  }

  private cleanupExpired(now: number): void {
    for (const [key, entry] of this.store.entries()) {
      if (entry.resetTime <= now) {
        this.store.delete(key);
      }
    }
  }

  increment = async (key: string, windowMs: number, now: number, resetTime: number): Promise<RateLimitEntry> => {
    this.cleanupExpired(now);

    const existing = this.store.get(key);
    if (!existing) {
      if (this.store.size >= this.effectiveMaxKeys) {
        this.evictOldestKey();
      }

      const entry = { count: 1, resetTime } satisfies RateLimitEntry;
      this.store.set(key, entry);
      return entry;
    }

    if (existing.resetTime <= now) {
      existing.count = 1;
      existing.resetTime = resetTime;
    } else {
      existing.count += 1;
    }

    return existing;
  };
}

class RedisRateLimitStore implements RateLimitStore {
  private readonly client: RedisClientType;
  private readonly keySetName: string;
  private readonly effectiveMaxKeys: number;
  private readonly ready: Promise<void>;

  constructor(private readonly options: RedisStoreOptions) {
    this.effectiveMaxKeys = parseMaxKeys(options.maxKeys);
    this.client = options.client ?? createClient({ url: options.url });
    this.keySetName = `${options.namespace}:keys`;
    this.ready = this.initialize();
  }

  private initialize = async (): Promise<void> => {
    if (this.client.isOpen) {
      return;
    }

    await this.client.connect();
  };

  shutdown = async (): Promise<void> => {
    await this.ready;
    if (this.client.isOpen) {
      await this.client.quit();
    }
  };

  private async enforceMaxKeys(): Promise<void> {
    const currentSize = await this.client.zCard(this.keySetName);
    if (currentSize <= this.effectiveMaxKeys) {
      return;
    }

    const overflow = currentSize - this.effectiveMaxKeys;
    if (overflow <= 0) {
      return;
    }

    const keysToRemove = await this.client.zRange(this.keySetName, 0, overflow - 1);
    if (keysToRemove.length === 0) {
      return;
    }

    await this.client
      .multi()
      .zRem(this.keySetName, keysToRemove)
      .del(keysToRemove)
      .exec();

    logger.debug({ overflow, evicted: keysToRemove.length }, 'Evicted rate limit keys in Redis to enforce maxKeys');
  }

  increment = async (key: string, windowMs: number, now: number, resetTime: number): Promise<RateLimitEntry> => {
    await this.ready;
    const ttlMs = Math.max(resetTime - now, 1);

    const results = await this.client
      .multi()
      .incr(key)
      .pExpire(key, ttlMs)
      .pTTL(key)
      .zAdd(this.keySetName, { score: now, value: key })
      .zRemRangeByScore(this.keySetName, '-inf', now - windowMs * 2)
      .exec();

    if (!results) {
      throw new Error('Redis transaction failed for rate limiting');
    }

    const count = Number(results[0]);
    const ttlResult = Number(results[2]);
    const effectiveReset = Number.isFinite(ttlResult) && ttlResult > 0 ? now + ttlResult : resetTime;

    if (this.effectiveMaxKeys < Number.POSITIVE_INFINITY) {
      await this.enforceMaxKeys();
    }

    return { count, resetTime: effectiveReset } satisfies RateLimitEntry;
  };
}

const resolveBackend = (backend?: RateLimitBackend): RateLimitBackend => {
  const fromEnv = process.env.RATE_LIMIT_BACKEND?.toLowerCase();
  if (fromEnv === 'redis') {
    return 'redis';
  }

  return backend ?? 'memory';
};

const resolveNamespace = (namespace?: string): string => namespace ?? process.env.RATE_LIMIT_NAMESPACE ?? 'rate-limit';

const toBucketKey = (baseKey: string, namespace: string, windowMs: number, now: number): { key: string; resetTime: number } => {
  const bucket = Math.floor(now / windowMs);
  const resetTime = (bucket + 1) * windowMs;
  const sanitizedKey = baseKey.replace(/\s+/g, '').toLowerCase();

  return {
    key: `${namespace}:bucket:${bucket}:${sanitizedKey}`,
    resetTime,
  };
};

const resolveStore = (
  options: Pick<RateLimitConfig, 'backend' | 'redisUrl' | 'maxKeys' | 'namespace' | 'store'> & { windowMs: number },
): RateLimitStore => {
  if (options.store) {
    return options.store;
  }

  const backend = resolveBackend(options.backend);
  const namespace = resolveNamespace(options.namespace);

  if (backend === 'redis') {
    const url = options.redisUrl ?? process.env.RATE_LIMIT_REDIS_URL ?? process.env.REDIS_URL;
    if (!url) {
      logger.warn('RATE_LIMIT_BACKEND=redis but no Redis URL provided; falling back to in-memory store');
    } else {
      try {
        return new RedisRateLimitStore({ namespace, maxKeys: options.maxKeys ?? 10_000, url });
      } catch (error) {
        logger.error({ err: error }, 'Failed to initialize Redis rate limit store; falling back to in-memory store');
      }
    }
  }

  return new InMemoryRateLimitStore({
    namespace,
    maxKeys: options.maxKeys ?? 10_000,
    cleanupIntervalMs: options.windowMs,
  });
};

/**
 * Rate limiter middleware with pluggable backing stores (memory by default, Redis for distributed deployments).
 *
 * @param config - Rate limit configuration
 * @returns Express middleware function
 */
export const createRateLimiter = (config: RateLimitConfig) => {
  const {
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
    statusCode = 429,
    keyGenerator = (req: Request) => {
      const forwardedFor = req.header('x-forwarded-for');
      const forwardedIp = Array.isArray(forwardedFor)
        ? forwardedFor[0]
        : forwardedFor?.split(',')[0]?.trim();

      const clientIp = forwardedIp || req.ip || req.socket.remoteAddress || 'unknown';

      const authorization = req.header('authorization');
      const apiKeyMatch = authorization?.match(/^ApiKey\s+(?<key>.+)$/i);
      const apiKey = req.header('x-api-key') || apiKeyMatch?.groups?.key;

      // Prefer API key when present to avoid grouping all clients behind a proxy
      return apiKey ? `api-key:${apiKey}` : `ip:${clientIp}`;
    },
    maxKeys,
    backend,
    namespace,
    redisUrl,
    store,
  } = config;

  const effectiveNamespace = resolveNamespace(namespace);
  const backingStore = resolveStore({ backend, redisUrl, namespace: effectiveNamespace, maxKeys, windowMs, store });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const baseKey = keyGenerator(req);
    const now = Date.now();
    const { key, resetTime } = toBucketKey(baseKey, effectiveNamespace, windowMs, now);

    let entry: RateLimitEntry;
    try {
      entry = await backingStore.increment(key, windowMs, now, resetTime);
    } catch (error) {
      logger.error({ err: error }, 'Rate limiter backend failed; allowing request to proceed');
      next();
      return;
    }

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());

    if (entry.count > maxRequests) {
      logger.warn({ key, count: entry.count, limit: maxRequests }, 'Rate limit exceeded');

      const retryAfterSeconds = Math.ceil((entry.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfterSeconds);
      res.status(statusCode).json({
        error: 'rate_limit_exceeded',
        message,
        retryAfter: retryAfterSeconds,
      });
      return;
    }

    next();
  };
};

/**
 * Pre-configured rate limiter for public APIs.
 * Allows 100 requests per 15 minutes per IP + User-Agent combination.
 */
export const apiRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  message: 'Too many API requests, please try again later',
  namespace: 'api-rate-limit',
  backend: resolveBackend(),
});

export default createRateLimiter;
