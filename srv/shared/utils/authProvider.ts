/**
 * Utility for reporting which authentication provider CAP is configured to use.
 */
import cds from '@sap/cds';

export const resolveAuthProviderName = (): string => {
  const env = cds.env as any;
  const authConfig = env?.requires?.auth;
  const kind = typeof authConfig?.kind === 'string' ? authConfig.kind.toLowerCase() : undefined;

  if (kind === 'mocked') {
    return 'Mocked';
  }

  if (kind === 'ias' || kind === 'ias-auth' || kind === 'identity') {
    return 'IAS';
  }

  if (kind === 'xsuaa') {
    return 'XSUAA';
  }

  if (env?.security?.identity?.enabled) {
    return 'IAS';
  }

  if (env?.security?.xsuaa?.enabled) {
    return 'XSUAA';
  }

  return kind ?? 'Unknown';
};
