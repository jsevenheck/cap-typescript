import { getLogger } from './logger';

const logger = getLogger('secrets');

// Type declarations for @sap/xsenv (doesn't have TypeScript definitions)
interface XsenvServices {
  [serviceName: string]: {
    credentials?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

type GetServicesFunc = () => XsenvServices;

let getServicesFunc: GetServicesFunc | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const xsenv = require('@sap/xsenv') as { getServices: GetServicesFunc };
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
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException)?.code === 'ERR_ASSERTION') {
      logger.debug({ err: error }, 'Credential Store service not bound; using fallbacks');
      credStoreCache = null;
      return null;
    }

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

  if (credStore?.url) {
    try {
      logger.debug({ namespace, name }, 'Fetching secret from Credential Store');

      // Build the Credential Store API URL
      const apiUrl = new URL('/api/v1/credentials', credStore.url);
      apiUrl.searchParams.set('namespace', namespace);
      apiUrl.searchParams.set('name', name);

      // Prepare headers
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add authentication
      if (credStore.username && credStore.password) {
        // Basic authentication
        const authString = Buffer.from(`${credStore.username}:${credStore.password}`).toString('base64');
        headers['Authorization'] = `Basic ${authString}`;
      }

      // Make the HTTP request to Credential Store
      const response = await fetch(apiUrl.toString(), {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        if (response.status === 404) {
          logger.debug({ namespace, name }, 'Secret not found in Credential Store');
        } else {
          logger.warn(
            { namespace, name, status: response.status, statusText: response.statusText },
            'Failed to fetch secret from Credential Store'
          );
        }
      } else {
        const data = await response.json() as { value?: string };
        if (data.value) {
          logger.debug({ namespace, name }, 'Successfully retrieved secret from Credential Store');
          return data.value;
        }
      }
    } catch (error) {
      logger.warn({ err: error, namespace, name }, 'Error fetching secret from Credential Store, using fallback');
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
