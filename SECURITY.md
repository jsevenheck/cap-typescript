# Security Report

This document tracks security vulnerabilities found in dependencies and their mitigation status.

## Current Vulnerabilities

### High Severity - qs Package (< 6.14.1)

**Status**: Acknowledged - Awaiting upstream fix

**Description**: qs's arrayLimit bypass in its bracket notation allows DoS via memory exhaustion  
**GHSA**: [GHSA-6rw7-vpxm-498p](https://github.com/advisories/GHSA-6rw7-vpxm-498p)  
**Affected Dependencies**:
- `@sap/ux-ui5-tooling` (development dependency)
- `@sap/cds-dk` (development dependency)
- `@ui5/cli` (development dependency)

**Impact**: Limited - These are development-time dependencies used for:
- UI5 application building and tooling
- CDS development kit features
- Not deployed to production runtime

**Mitigation**:
1. The vulnerable packages are NOT included in production builds
2. The `qs` vulnerability affects development tooling only
3. Development environments should follow security best practices:
   - Limit access to development servers
   - Use secure networks for development
   - Keep development machines updated

**Action Required**:
- Monitor for updates to `@sap/ux-ui5-tooling`, `@sap/cds-dk`, and `@ui5/cli`
- These packages are maintained by SAP and will be updated when upstream dependencies are fixed

### Production Dependencies

**Status**: ✅ No known vulnerabilities in production runtime dependencies

All production dependencies (used in the deployed application) are up-to-date and have no known high or critical severity vulnerabilities.

## Security Best Practices

### Development
- Run `npm audit` regularly to check for new vulnerabilities
- Update dependencies promptly when security patches are available
- Use `npm ci` instead of `npm install` for consistent builds

### Production
- Use the latest LTS version of Node.js (currently >= 20.0.0)
- Enable security headers via the built-in middleware
- Configure rate limiting for public APIs
- Use HTTPS/TLS for all external communications
- Regularly review and rotate API keys and secrets
- Monitor application logs for suspicious activity

### Deployment
- Follow the principle of least privilege for service bindings
- Use SAP BTP security services (IAS, AMS) as configured
- Enable audit logging for compliance requirements
- Regularly update the base images and buildpacks

## Reporting Security Issues

If you discover a security vulnerability, please report it via:
- GitHub Security Advisories (preferred)
- Or contact the repository maintainers directly

Do not open public issues for security vulnerabilities.

## Last Updated

**Date**: 2026-01-01  
**Audit Run**: `npm audit` - 8 high severity issues in development dependencies only
