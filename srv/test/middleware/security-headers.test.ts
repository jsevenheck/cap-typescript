import type { NextFunction, Request, Response } from 'express';

import { securityHeadersMiddleware } from '../../middleware/securityHeaders';

type ResponseHeaderValue = Parameters<Response['setHeader']>[1];
type MockResponse = Response & {
  headers: Record<string, string>;
  locals: Record<string, unknown>;
};

const createResponse = (): MockResponse => {
  const headers: Record<string, string> = {};

  const response = {
    headers,
    locals: {},
    setHeader: (name: string, value: ResponseHeaderValue) => {
      headers[name] = Array.isArray(value) ? value.join(',') : String(value);
      return response;
    },
    getHeader: (name: string) => headers[name],
  } as unknown as MockResponse;

  return response;
};

describe('securityHeadersMiddleware', () => {
  const originalEnv = process.env.NODE_ENV;
  const originalApprouter = process.env.APP_ROUTER_HOST;
  const originalTelemetry = process.env.TELEMETRY_URL;
  const originalNonce = process.env.UI5_BOOT_NONCE;

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    process.env.APP_ROUTER_HOST = originalApprouter;
    process.env.TELEMETRY_URL = originalTelemetry;
    process.env.UI5_BOOT_NONCE = originalNonce;
  });

  it('keeps a relaxed CSP for development to preserve DX', () => {
    process.env.NODE_ENV = 'development';
    const res = createResponse();

    securityHeadersMiddleware({} as Request, res, jest.fn() as NextFunction);

    const csp = res.headers['Content-Security-Policy'];
    expect(csp).toContain("'unsafe-inline'");
    expect(csp).toContain("'unsafe-eval'");
  });

  it('enforces a strict CSP with nonces and no unsafe directives in production', () => {
    process.env.NODE_ENV = 'production';
    process.env.UI5_BOOT_NONCE = 'test-nonce';
    process.env.APP_ROUTER_HOST = 'https://approuter.example.com';
    process.env.TELEMETRY_URL = 'https://telemetry.example.com';

    const res = createResponse();
    const next = jest.fn();

    securityHeadersMiddleware({} as Request, res, next as NextFunction);

    const csp = res.headers['Content-Security-Policy'];

    expect(csp).not.toContain('unsafe-inline');
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("'nonce-test-nonce'");
    expect(csp).toContain('connect-src ');
    expect(csp).toContain('https://approuter.example.com');
    expect(csp).toContain('https://telemetry.example.com');
    expect(next).toHaveBeenCalled();
  });
});
