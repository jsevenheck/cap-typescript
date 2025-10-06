import 'ts-node/register';
import cds from '@sap/cds';

cds.env.features.typescript = true;
process.env.NODE_ENV = 'test';
