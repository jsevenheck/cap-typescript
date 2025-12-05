import type { Request, Response, NextFunction } from 'express';
import { incrementRequestCount } from '../shared/cache/rateLimitStore';
import { getLogger } from '../shared/utils/logger';

const logger = getLogger('rate-limiter');

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  message?: string;
  statusCode?: number;
  keyGenerator?: (req: Request) => string;
}

/**
 * Distributed rate limiter middleware backed by a shared SAP-managed cache service.
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
  } = config;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `rate-limit:${keyGenerator(req)}`;
      const { count, ttlMs } = await incrementRequestCount(key, windowMs);
      const retryAfterSeconds = Math.max(1, Math.ceil(ttlMs / 1000));

      res.setHeader('X-RateLimit-Limit', maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - count));
      res.setHeader('X-RateLimit-Reset', new Date(Date.now() + ttlMs).toISOString());

      if (count > maxRequests) {
        logger.warn(
          { key, count, limit: maxRequests },
          'Rate limit exceeded',
        );

        res.setHeader('Retry-After', retryAfterSeconds);
        res.status(statusCode).json({
          error: 'rate_limit_exceeded',
          message,
          retryAfter: retryAfterSeconds,
        });
        return;
      }

      next();
    } catch (error) {
      logger.error({ err: error }, 'Rate limiter unavailable, allowing request');
      next();
    }
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
