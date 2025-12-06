import { getLogger } from './logger';

const logger = getLogger('secrets');

// Track warnings that were already emitted to avoid noisy logs when secrets are missing
const missingSecretWarnings = new Set<string>();

// Maximum time to wait for Credential Store responses before falling back to environment variables
const CREDSTORE_REQUEST_TIMEOUT_MS = 5000;

// Type declarations for @sap/xsenv (doesn't have TypeScript definitions)
interface XsenvServices {
  [serviceName: string]: {
    credentials?: Record<string, unknown>;
    [key: string]: unknown;
  };
}

type GetServicesFunc = (filter?: unknown) => XsenvServices;

let getServicesFunc: GetServicesFunc | null | undefined = undefined;

const getEnvCredentialStoreCredentials = (): CredentialStoreCredentials | null => {
  const url = process.env.CREDSTORE_URL;
  if (!url) return null;

  return {
    url,
    username: process.env.CREDSTORE_USERNAME,
    password: process.env.CREDSTORE_PASSWORD,
  };
};

const loadGetServices = (): GetServicesFunc | null => {
  if (getServicesFunc !== undefined) {
    return getServicesFunc;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const xsenv = require('@sap/xsenv') as { getServices: GetServicesFunc };
    getServicesFunc = xsenv.getServices;
  } catch {
    getServicesFunc = null;
  }

  return getServicesFunc;
};

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

  const envCreds = getEnvCredentialStoreCredentials();
  if (envCreds) {
    credStoreCache = envCreds;
    return credStoreCache;
  }

  const getServices = loadGetServices();

  if (!getServices) {
    credStoreCache = null;
    return null;
  }

  try {
    const services = getServices({ tag: 'credstore' });
    const credStore = services.credstore;

    if (!credStore || !credStore.credentials) {
      credStoreCache = null;
      return null;
    }

    credStoreCache = credStore.credentials as unknown as CredentialStoreCredentials;
    return credStoreCache;
  } catch (error: unknown) {
    logger.debug({ err: error }, 'Credential Store service not bound; using fallbacks');
    credStoreCache = null;
    return null;
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

      const abortController = new AbortController();
      let timeoutId: NodeJS.Timeout | null = null;

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          abortController.abort();
          reject(new Error('Credential Store request timed out'));
        }, CREDSTORE_REQUEST_TIMEOUT_MS);
      });

      try {
        // Make the HTTP request to Credential Store
        const response = (await Promise.race([
          fetch(apiUrl.toString(), {
            method: 'GET',
            headers,
            signal: abortController.signal,
          }),
          timeoutPromise,
        ])) as Response;

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
      } finally {
        if (timeoutId) {
          clearTimeout(timeoutId);
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

  const warningKey = `${namespace}:${name}:${envVarFallback ?? 'NO_FALLBACK'}`;
  if (!missingSecretWarnings.has(warningKey)) {
    missingSecretWarnings.add(warningKey);
    logger.warn({ namespace, name, envVarFallback }, 'Secret not found in Credential Store or environment');
  }
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
