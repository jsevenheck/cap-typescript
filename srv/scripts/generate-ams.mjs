import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectRoot, '..');

const candidateBins = [
  path.resolve(repoRoot, 'node_modules/@sap/cds-dk/bin/cds.js'),
  path.resolve(projectRoot, 'node_modules/@sap/cds-dk/bin/cds.js'),
  path.resolve(repoRoot, 'node_modules/@sap/cds/bin/cds.js'),
  path.resolve(projectRoot, 'node_modules/@sap/cds/bin/cds.js'),
];

const cdsBin = candidateBins.find((candidate) => existsSync(candidate));

if (!cdsBin) {
  console.error('Unable to locate the cds CLI binary required to generate AMS policies.');
  process.exit(1);
}

const child = spawn(process.execPath, [cdsBin, 'build', '--for', 'ams'], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    // Ensure the build task writes output into the configured DCL root.
    NODE_ENV: process.env.NODE_ENV ?? 'development',
  },
});

child.on('close', (code) => {
  process.exit(code ?? 0);
});

child.on('error', (error) => {
  console.error('Failed to run cds build for AMS policy generation:', error);
  process.exit(1);
});
