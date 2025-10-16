import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

let cds;
try {
  const cdsModule = await import('@sap/cds');
  cds = cdsModule.default ?? cdsModule;
} catch (error) {
  console.error('Failed to load @sap/cds. Ensure it is installed in the workspace (srv) or at the repo root.');
  process.exit(1);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(projectRoot, '..');
const cdsRoot = path.resolve(projectRoot, cds?.env?.root ?? '.');

const candidateBins = [
  path.resolve(repoRoot, 'node_modules/@sap/cds-dk/bin/cds.js'),
  path.resolve(projectRoot, 'node_modules/@sap/cds-dk/bin/cds.js'),
  path.resolve(repoRoot, 'node_modules/@sap/cds/bin/cds.js'),
  path.resolve(projectRoot, 'node_modules/@sap/cds/bin/cds.js'),
];

const compileCandidates = [
  path.resolve(repoRoot, 'node_modules/.bin/compile-dcl'),
  path.resolve(projectRoot, 'node_modules/.bin/compile-dcl'),
  path.resolve(repoRoot, 'node_modules/@sap/ams-dev/src/bin/compileDcl.js'),
  path.resolve(projectRoot, 'node_modules/@sap/ams-dev/src/bin/compileDcl.js'),
  path.resolve(repoRoot, 'node_modules/@sap/ams/bin/compile-dcl'),
  path.resolve(projectRoot, 'node_modules/@sap/ams/bin/compile-dcl'),
];

const cdsBin = candidateBins.find((candidate) => existsSync(candidate));

if (!cdsBin) {
  console.error('Unable to locate the cds CLI binary required to generate AMS policies.');
  process.exit(1);
}

const runCommand = (command, args, options, errorMessage) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, options);

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = code != null ? `exit code ${code}` : signal ? `signal ${signal}` : 'unknown exit';
      reject(new Error(`${errorMessage} (${reason})`));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });

const resolveConfiguredPath = (value) => (value ? path.resolve(cdsRoot, value) : undefined);

const compilePoliciesToDcn = async () => {
  const amsConfig = cds?.env?.requires?.ams ?? {};
  const credentials = amsConfig.credentials ?? {};
  const configuredDclRoot = resolveConfiguredPath(credentials.dclRoot);
  const fallbackDclRoot = path.resolve(projectRoot, 'ams');
  const potentialRoots = [
    configuredDclRoot ? path.join(configuredDclRoot, 'dcl') : undefined,
    configuredDclRoot,
    path.join(fallbackDclRoot, 'dcl'),
    fallbackDclRoot,
  ].filter((root, index, array) => root !== undefined && array.indexOf(root) === index);
  const dclRoot = potentialRoots.find((root) => existsSync(path.join(root, 'schema.dcl')));
  const configuredDcnRoot = resolveConfiguredPath(credentials.dcnRoot);
  const dcnRoot = configuredDcnRoot ?? path.resolve(projectRoot, 'gen', 'ams', 'dcn');

  if (!dclRoot) {
    console.warn(
      'Skipping DCL compilation because no schema.dcl was found under the configured or default DCL roots.',
    );
    return;
  }

  mkdirSync(dcnRoot, { recursive: true });

  const compileBin = (() => {
    const extensions = process.platform === 'win32' ? ['.cmd', '.ps1'] : [];
    for (const candidate of compileCandidates) {
      const variants = [candidate, ...extensions.map((ext) => `${candidate}${ext}`)];
      const resolved = variants.find((variant) => existsSync(variant));
      if (resolved) {
        return resolved;
      }
    }
    return undefined;
  })();

  if (!compileBin) {
    console.warn(
      'compile-dcl binary not found. Skipping DCN generation; AMS authorizations may not be available.',
    );
    return;
  }

  const command = compileBin.endsWith('.js') ? process.execPath : compileBin;
  const args = command === process.execPath
    ? [compileBin, '--dcl', dclRoot, '--output', dcnRoot]
    : ['--dcl', dclRoot, '--output', dcnRoot];

  await runCommand(
    command,
    args,
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
    },
    'compile-dcl failed',
  );
};

try {
  await runCommand(
    process.execPath,
    [cdsBin, 'build', '--for', 'ams'],
    {
      cwd: projectRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        NODE_ENV: process.env.NODE_ENV ?? 'development',
      },
    },
    'cds build --for ams failed',
  );

  await compilePoliciesToDcn();
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

