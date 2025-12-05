import type { NextFunction, Request, Response } from 'express';

import { securityHeadersMiddleware } from '../../middleware/securityHeaders';

type MockResponse = Partial<Response> & {
  headers: Record<string, string>;
};

const createResponse = (): MockResponse => {
  const headers: Record<string, string> = {};

  return {
    headers,
    locals: {},
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
    getHeader: (name: string): string | undefined => headers[name],
  };
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

    securityHeadersMiddleware({} as Request, res as Response, jest.fn() as NextFunction);

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

    securityHeadersMiddleware({} as Request, res as Response, next as NextFunction);

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
