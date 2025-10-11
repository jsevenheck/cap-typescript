import 'ts-node/register';
import cds from '@sap/cds';

const env = cds.env as any;
env.features.typescript = true;
process.env.NODE_ENV = 'test';

if (env?.requires?.ams) {
  env.requires.ams.generateDcl = false;
}
