import type { Request, Response, NextFunction } from 'express';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('rate-limiter');

interface RateLimitEntry {
  count: number;
  resetTime: number;
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
}

/**
 * Simple in-memory rate limiter middleware.
 * For production with multiple instances, consider using Redis-backed rate limiting.
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
    maxKeys = 10_000,
  } = config;

  const store = new Map<string, RateLimitEntry>();
  const effectiveMaxKeys = maxKeys > 0 ? maxKeys : Number.POSITIVE_INFINITY;

  const evictOldestKey = (): void => {
    const oldestKey = store.keys().next().value as string | undefined;
    if (!oldestKey) {
      return;
    }

    store.delete(oldestKey);
    logger.debug({ oldestKey, maxKeys: effectiveMaxKeys }, 'Evicted oldest rate limit entry to enforce maxKeys');
  };

  // Periodic cleanup to prevent memory leaks
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of store.entries()) {
      if (entry.resetTime < now) {
        store.delete(key);
      }
    }
  }, windowMs);

  // Allow cleanup on process termination
  if (cleanupInterval.unref) {
    cleanupInterval.unref();
  }

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = keyGenerator(req);
    const now = Date.now();
    let entry = store.get(key);

    // Reset if window has expired
    if (!entry || entry.resetTime < now) {
      if (store.size >= effectiveMaxKeys) {
        evictOldestKey();
      }

      entry = {
        count: 0,
        resetTime: now + windowMs,
      };
      store.set(key, entry);
    }

    entry.count += 1;

    // Set rate limit headers
    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - entry.count));
    res.setHeader('X-RateLimit-Reset', new Date(entry.resetTime).toISOString());

    if (entry.count > maxRequests) {
      logger.warn(
        { key, count: entry.count, limit: maxRequests },
        'Rate limit exceeded',
      );

      res.setHeader('Retry-After', Math.ceil((entry.resetTime - now) / 1000));
      res.status(statusCode).json({
        error: 'rate_limit_exceeded',
        message,
        retryAfter: Math.ceil((entry.resetTime - now) / 1000),
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
});

export default createRateLimiter;
