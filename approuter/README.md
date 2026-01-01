# Approuter Configuration

The approuter serves as the central entry point for the application, handling authentication, routing, and security headers.

## Configuration Files

- **xs-app.json** - Default/fallback configuration
- **xs-app.local.json** - Local development configuration (no authentication)
- **xs-app.production.json** - Production configuration with full security

## Content Security Policy (CSP)

The production configuration includes a Content-Security-Policy header to protect against XSS attacks. The CSP directives are documented below for maintainability:

### CSP Directives Breakdown

| Directive | Value | Purpose |
|-----------|-------|---------|
| `default-src` | `'self'` | Default fallback for all resource types |
| `script-src` | `'self' 'nonce-ui5-bootstrap' https://ui5.sap.com https://sapui5.hana.ondemand.com` | Allow scripts from self and SAP UI5 CDN with nonce-based inline script support |
| `style-src` | `'self' 'unsafe-inline' https://ui5.sap.com https://sapui5.hana.ondemand.com` | Allow styles from self and SAP UI5 CDN (unsafe-inline required for UI5 dynamic styles) |
| `font-src` | `'self' https://ui5.sap.com https://sapui5.hana.ondemand.com data:` | Allow fonts from self, SAP CDN, and data URIs |
| `img-src` | `'self' https://ui5.sap.com https://sapui5.hana.ondemand.com data:` | Allow images from self, SAP CDN, and data URIs |
| `connect-src` | `'self'` | Allow XHR/fetch only to same origin |
| `frame-ancestors` | `'none'` | Prevent embedding in iframes (clickjacking protection) |

### Modifying CSP

When updating the CSP in `xs-app.production.json`, ensure:
1. Each directive is separated by a semicolon and space
2. Source values are separated by spaces
3. Test changes thoroughly before deployment

### Full CSP Value

```
default-src 'self'; script-src 'self' 'nonce-ui5-bootstrap' https://ui5.sap.com https://sapui5.hana.ondemand.com; style-src 'self' 'unsafe-inline' https://ui5.sap.com https://sapui5.hana.ondemand.com; font-src 'self' https://ui5.sap.com https://sapui5.hana.ondemand.com data:; img-src 'self' https://ui5.sap.com https://sapui5.hana.ondemand.com data:; connect-src 'self'; frame-ancestors 'none'
```

## Other Security Headers

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-Content-Type-Options` | `nosniff` | Prevent MIME type sniffing |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Control referrer information |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Disable sensitive browser APIs |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforce HTTPS |

## Session Configuration

- **sessionTimeout**: 30 minutes of inactivity before session expires
