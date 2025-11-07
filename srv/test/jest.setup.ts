import 'ts-node/register';
import cds from '@sap/cds';

const env = cds.env as any;
env.features.typescript = true;
process.env.NODE_ENV = 'test';

if (env?.requires?.ams) {
  env.requires.ams.generateDcl = false;
}

// Set default test timeout
jest.setTimeout(60000);

// Mock p-limit to avoid ESM module issues in tests
jest.mock('p-limit', () => {
  return jest.fn(() => {
    return (fn: () => Promise<unknown>) => fn();
  });
});
