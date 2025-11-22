import type { Request, Response, NextFunction } from 'express';

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

  // Strict Transport Security (HSTS) - only enable in production with HTTPS
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  // Content Security Policy (CSP) - restrictive default
  // Note: Adjust this based on your application's needs
  const cspDirectives = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'", // UI5 requires unsafe-eval
    "style-src 'self' 'unsafe-inline'", // UI5 requires unsafe-inline
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  res.setHeader('Content-Security-Policy', cspDirectives);

  next();
};

export default securityHeadersMiddleware;
