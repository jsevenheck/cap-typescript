import { spawn } from 'node:child_process';
import { access } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const srvRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(srvRoot, '..');

async function exists(targetPath) {
  try {
    await access(targetPath, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

const requireFromWorkspace = createRequire(path.join(srvRoot, 'package.json'));
try {
  requireFromWorkspace.resolve('@sap/ams/cds-plugin');
} catch {
  console.warn('Skipping AMS artifact generation because the @sap/ams package is not installed in the workspace.');
  process.exit(0);
}

const cdsCli = path.join(
  projectRoot,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'cds.cmd' : 'cds',
);

if (!(await exists(cdsCli))) {
  console.warn('Unable to locate the cds CLI executable. Did you run "npm install" in the project root?');
  process.exit(0);
}

const child = spawn(cdsCli, ['build', '--for', 'ams'], {
  cwd: srvRoot,
  env: process.env,
  stdio: 'inherit',
});

child.on('exit', (code, signal) => {
  if (typeof signal === 'string') {
    console.error(`cds build was terminated with signal ${signal}.`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
