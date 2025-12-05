import {
  createClient,
  RedisClientType,
  RedisDefaultFunctions,
  RedisDefaultModules,
  RedisDefaultScripts,
} from 'redis';

import { getLogger } from '../utils/logger';

const logger = getLogger('rate-limit-cache');

const RATE_LIMIT_SCRIPT = `
local current = redis.call("INCR", KEYS[1])
if current == 1 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
end
local ttl = redis.call("PTTL", KEYS[1])
if ttl < 0 then
  redis.call("PEXPIRE", KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {current, ttl}
`;

const maskUrl = (url: string): string => {
  const [protocol, rest] = url.split('://');
  if (!rest) {
    return url;
  }
  const [, hostAndPath] = rest.split('@');
  if (!hostAndPath) {
    return url;
  }
  return `${protocol}://***@${hostAndPath}`;
};

type FilterServicesFunc = <T>(predicate: (service: T) => boolean) => T[];

let loadEnv: (() => void) | null = null;
let filterServices: FilterServicesFunc | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xsenv = require('@sap/xsenv') as { loadEnv: () => void; filterServices: FilterServicesFunc };
  loadEnv = xsenv.loadEnv;
  filterServices = xsenv.filterServices;
} catch {
  loadEnv = null;
  filterServices = null;
}

interface CacheServiceCredentials {
  uri?: string;
  url?: string;
  host?: string;
  port?: number;
  password?: string;
  username?: string;
}

interface CacheService {
  name?: string;
  label?: string;
  tags?: string[];
  credentials?: CacheServiceCredentials;
}

const buildUrlFromCredentials = (credentials?: CacheServiceCredentials): string | undefined => {
  if (!credentials) {
    return undefined;
  }

  const { uri, url, host, port, password, username } = credentials;
  if (uri || url) {
    return uri || url;
  }

  if (host && port && password) {
    const safeUser = encodeURIComponent(username || 'default');
    const safePassword = encodeURIComponent(password);
    return `rediss://${safeUser}:${safePassword}@${host}:${port}`;
  }

  return undefined;
};

const resolveFromSapCacheBinding = (): string | undefined => {
  try {
    loadEnv?.();
    const [cacheService] = (filterServices?.((service: CacheService) => {
      const tags = service.tags || [];
      return service.label === 'cache' || tags.includes('cache') || tags.includes('redis');
    }) as CacheService[]) || [];

    return buildUrlFromCredentials(cacheService?.credentials);
  } catch (error) {
    logger.warn({ err: error }, 'Unable to resolve cache service binding from environment');
    return undefined;
  }
};

type RateLimitClient = RedisClientType<RedisDefaultModules, RedisDefaultFunctions, RedisDefaultScripts>;

let clientPromise: Promise<RateLimitClient> | null = null;

export const resolveRateLimitCacheUrl = (): string => {
  const url = resolveFromSapCacheBinding() || process.env.RATE_LIMIT_CACHE_URL;
  if (!url) {
    throw new Error('Bind a SAP Cache service (or set RATE_LIMIT_CACHE_URL) for distributed rate limiting');
  }

  return url;
};

const getClient = async (): Promise<RateLimitClient> => {
  if (!clientPromise) {
    clientPromise = (async () => {
      const url = resolveRateLimitCacheUrl();
      const client = createClient({ url });

      client.on('error', (err) => {
        logger.error({ err }, 'Rate limit cache client error');
      });

      await client.connect();
      logger.info({ url: maskUrl(url) }, 'Connected to rate limit cache backend');

      return client;
    })().catch((error) => {
      clientPromise = null;
      throw error;
    });
  }

  if (clientPromise === null) {
    throw new Error('Rate limit cache client unavailable');
  }

  return clientPromise;
};

export interface RateLimitState {
  count: number;
  ttlMs: number;
}

export const incrementRequestCount = async (key: string, windowMs: number): Promise<RateLimitState> => {
  const client = await getClient();
  const [count, ttl] = (await client.eval(RATE_LIMIT_SCRIPT, {
    keys: [key],
    arguments: [windowMs.toString()],
  })) as [number, number];

  const ttlMs = typeof ttl === 'number' ? ttl : Number(ttl);

  return {
    count,
    ttlMs: Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : windowMs,
  };
};
