import type { NextFunction, Request, Response } from 'express';

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
  const createRequest = (key: string) => ({ key } as Request);

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('does not evict other keys when resetting an existing entry', () => {
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

    rateLimiter(req, res as Response, next);

    // Advance beyond the window to trigger a reset of the same key
    jest.advanceTimersByTime(60);

    rateLimiter(req, res as Response, next);

    expect(debugSpy).not.toHaveBeenCalled();

    jest.runOnlyPendingTimers();
  });

  it('evicts the oldest entry when adding a new key past the limit', () => {
    const debugSpy = jest.spyOn(console, 'debug').mockImplementation(() => {});

    const rateLimiter = createRateLimiter({
      windowMs: 100,
      maxRequests: 5,
      maxKeys: 1,
      keyGenerator,
    });

    const res = createResponse();
    const next = jest.fn() as NextFunction;

    rateLimiter(createRequest('client-1'), res as Response, next);
    rateLimiter(createRequest('client-2'), res as Response, next);

    expect(debugSpy).toHaveBeenCalledTimes(1);
  });
});
