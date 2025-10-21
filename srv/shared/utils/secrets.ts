import { getLogger } from './logger';

const logger = getLogger('secrets');

// Type declarations for @sap/xsenv (doesn't have TypeScript definitions)
interface XsenvServices {
  [serviceName: string]: {
    credentials?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

let getServicesFunc: (() => XsenvServices) | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xsenv = require('@sap/xsenv') as { getServices: typeof getServicesFunc };
  getServicesFunc = xsenv.getServices;
} catch {
  getServicesFunc = null;
}

interface CredentialStoreCredentials {
  url: string;
  username?: string;
  password?: string;
  encryption?: {
    client_private_key: string;
  };
}

let credStoreCache: CredentialStoreCredentials | null | undefined;

/**
 * Get Credential Store service credentials from VCAP_SERVICES.
 * Returns null if not bound, undefined if error.
 */
const getCredentialStoreCredentials = (): CredentialStoreCredentials | null | undefined => {
  if (credStoreCache !== undefined) {
    return credStoreCache;
  }

  if (!getServicesFunc) {
    credStoreCache = null;
    return null;
  }

  try {
    const services = getServicesFunc();
    const credStore = services.credstore;

    if (!credStore || !credStore.credentials) {
      credStoreCache = null;
      return null;
    }

    credStoreCache = credStore.credentials as unknown as CredentialStoreCredentials;
    return credStoreCache;
  } catch (error) {
    logger.warn({ err: error }, 'Failed to get Credential Store credentials');
    credStoreCache = undefined;
    return undefined;
  }
};

/**
 * Get a secret from BTP Credential Store.
 * Falls back to environment variable if Credential Store is not available.
 *
 * @param namespace - Credential Store namespace (e.g., 'employee-export')
 * @param name - Secret name (e.g., 'api-key')
 * @param envVarFallback - Environment variable name to use as fallback
 * @returns Secret value or undefined if not found
 */
export const getSecret = async (
  namespace: string,
  name: string,
  envVarFallback?: string,
): Promise<string | undefined> => {
  // Try Credential Store first
  const credStore = getCredentialStoreCredentials();

  if (credStore) {
    try {
      // In a real implementation, you would use @sap/xssec or make an HTTP request to Credential Store API
      // For now, we'll document the integration point and use the fallback

      logger.info({ namespace, name }, 'Credential Store binding detected but API integration not yet implemented');

      // TODO: Implement actual Credential Store API call:
      // const response = await fetch(`${credStore.url}/api/v1/credentials?namespace=${namespace}&name=${name}`, {
      //   headers: {
      //     'Authorization': `Basic ${Buffer.from(`${credStore.username}:${credStore.password}`).toString('base64')}`,
      //   },
      // });
      // const data = await response.json();
      // return data.value;
    } catch (error) {
      logger.warn({ err: error, namespace, name }, 'Failed to fetch secret from Credential Store, using fallback');
    }
  }

  // Fallback to environment variable
  if (envVarFallback) {
    const envValue = process.env[envVarFallback];
    if (envValue) {
      logger.debug({ envVar: envVarFallback }, 'Using environment variable fallback for secret');
      return envValue.trim();
    }
  }

  logger.warn({ namespace, name, envVarFallback }, 'Secret not found in Credential Store or environment');
  return undefined;
};

/**
 * Get the employee export API key from Credential Store or environment.
 */
export const getEmployeeExportApiKey = async (): Promise<string | undefined> => {
  return getSecret('employee-export', 'api-key', 'EMPLOYEE_EXPORT_API_KEY');
};

/**
 * Get the third-party employee notification secret from Credential Store or environment.
 */
export const getThirdPartyEmployeeSecret = async (): Promise<string | undefined> => {
  return getSecret('employee-export', 'notification-secret', 'THIRD_PARTY_EMPLOYEE_SECRET');
};
