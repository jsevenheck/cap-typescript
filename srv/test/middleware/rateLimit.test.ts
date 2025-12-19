import type { NextFunction, Request, Response } from 'express';

import type { RateLimitEntry, RateLimitStore } from '../../middleware/rateLimit';
import { createRateLimiter } from '../../middleware/rateLimit';

type MockResponse = Pick<Response, 'setHeader' | 'status' | 'json'>;

const createResponse = (): MockResponse => {
  const response = {
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
  } as unknown as MockResponse;

  return response;
};

describe('createRateLimiter', () => {
  const keyGenerator = (req: Request) => (req as Request & { key: string }).key;
  const createRequest = (key: string): Request & { key: string } =>
    ({ key } as unknown as Request & { key: string });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not evict other keys when resetting an existing entry', async () => {
    jest.useFakeTimers();
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    const rateLimiter = createRateLimiter({
      windowMs: 50,
      maxRequests: 5,
      maxKeys: 1,
      keyGenerator,
    });

    const req = createRequest('client-1');
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await rateLimiter(req, res as Response, next);

    // Advance beyond the window to trigger a reset of the same key
    jest.advanceTimersByTime(60);

    await rateLimiter(req, res as Response, next);

    expect(debugSpy).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
  });

  it('evicts the oldest entry when adding a new key past the limit', async () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    const rateLimiter = createRateLimiter({
      windowMs: 100,
      maxRequests: 5,
      maxKeys: 1,
      keyGenerator,
    });

    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await rateLimiter(createRequest('client-1'), res as Response, next);
    await rateLimiter(createRequest('client-2'), res as Response, next);

    expect(debugSpy).toHaveBeenCalledTimes(1);
  });

  it('uses namespaced bucket keys with a distributed store and enforces limits', async () => {
    jest.useFakeTimers();
    const now = new Date('2023-01-01T00:00:00.000Z');
    jest.setSystemTime(now);

    class RecordingStore implements RateLimitStore {
      public calls: { key: string; now: number; resetTime: number }[] = [];
      private readonly entries = new Map<string, RateLimitEntry>();

      increment = async (key: string, _windowMs: number, nowTs: number, resetTime: number): Promise<RateLimitEntry> => {
        this.calls.push({ key, now: nowTs, resetTime });

        const existing = this.entries.get(key);
        if (!existing || existing.resetTime <= nowTs) {
          const entry = { count: 1, resetTime };
          this.entries.set(key, entry);
          return entry;
        }

        const entry = { count: existing.count + 1, resetTime };
        this.entries.set(key, entry);
        return entry;
      };
    }

    const store = new RecordingStore();
    const rateLimiter = createRateLimiter({
      windowMs: 1_000,
      maxRequests: 1,
      namespace: 'distributed-test',
      backend: 'redis',
      keyGenerator: (req: Request) => (req as Request & { key: string }).key,
      store,
    });

    const req = createRequest('API-KEY-123');
    const res = createResponse();
    const next = jest.fn() as NextFunction;

    await rateLimiter(req, res as Response, next);
    expect(next).toHaveBeenCalledTimes(1);
    const expectedBucket = Math.floor(now.getTime() / 1_000);
    expect(store.calls[0]?.key).toBe(`distributed-test:bucket:${expectedBucket}:api-key-123`);

    const resBlocked = createResponse();
    await rateLimiter(req, resBlocked as Response, next);

    expect(resBlocked.status).toHaveBeenCalledWith(429);
    expect(resBlocked.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'rate_limit_exceeded' }));
    expect(resBlocked.setHeader).toHaveBeenCalledWith('Retry-After', expect.any(Number));
  });
});
