import 'ts-node/register';
import cds from '@sap/cds';

const env = cds.env as any;
env.features.typescript = true;
process.env.NODE_ENV = 'test';

// Provide deterministic secrets for tests to avoid Credential Store lookups and noisy warnings
process.env.EMPLOYEE_EXPORT_API_KEY = process.env.EMPLOYEE_EXPORT_API_KEY ?? 'test-api-key';
process.env.THIRD_PARTY_EMPLOYEE_SECRET = process.env.THIRD_PARTY_EMPLOYEE_SECRET ?? 'test-notification-secret';

if (env?.requires?.ams) {
  env.requires.ams.generateDcl = false;
}

// Set default test timeout
jest.setTimeout(60000);
