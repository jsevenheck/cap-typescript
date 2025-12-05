import type { Request, Response, NextFunction } from 'express';

const DEFAULT_BOOT_NONCE = process.env.UI5_BOOT_NONCE ?? 'ui5-bootstrap';
const DEFAULT_STYLE_NONCE = process.env.UI5_STYLE_NONCE ?? DEFAULT_BOOT_NONCE;
const normalizeSource = (value?: string): string | undefined => value?.trim() || undefined;

/**
 * Security headers middleware for defense-in-depth protection.
 * Implements OWASP recommended security headers.
 *
 * For production deployments behind SAP BTP approuter, many security headers
 * are already set by the approuter. This middleware provides additional protection
 * for direct API access and development environments.
 */
export const securityHeadersMiddleware = (
  _req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Prevent clickjacking attacks
  res.setHeader('X-Frame-Options', 'DENY');

  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // Enable XSS protection in older browsers
  res.setHeader('X-XSS-Protection', '1; mode=block');

  // Control referrer information
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Prevent browser features that could be exploited
  res.setHeader(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );

  const isProduction = process.env.NODE_ENV === 'production';
  const scriptNonce = DEFAULT_BOOT_NONCE;
  const styleNonce = DEFAULT_STYLE_NONCE;

  res.locals.cspScriptNonce = scriptNonce;
  res.locals.cspStyleNonce = styleNonce;

  // Strict Transport Security (HSTS) - only enable in production with HTTPS
  if (isProduction) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  const connectSources = new Set<string>(["'self'"]);
  const approuterHost = normalizeSource(process.env.APP_ROUTER_HOST ?? process.env.APP_ROUTER_URL);
  const telemetryHost = normalizeSource(process.env.TELEMETRY_HOST ?? process.env.TELEMETRY_URL);

  if (approuterHost) {
    connectSources.add(approuterHost);
  }
  if (telemetryHost) {
    connectSources.add(telemetryHost);
  }

  const cspDirectives = isProduction
    ? [
        "default-src 'self'",
        `script-src 'self' 'nonce-${scriptNonce}'`,
        `style-src 'self' 'nonce-${styleNonce}'`,
        "img-src 'self' data:",
        "font-src 'self' data:",
        `connect-src ${Array.from(connectSources).join(' ')}`,
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "object-src 'none'",
      ].join('; ')
    : [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: https:",
        "font-src 'self' data:",
        "connect-src 'self' https: http: ws:",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; ');

  res.setHeader('Content-Security-Policy', cspDirectives);

  next();
};

export default securityHeadersMiddleware;
