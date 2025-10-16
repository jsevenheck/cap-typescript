import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const cdsModule = await import('@sap/cds');
const cds = cdsModule.default ?? cdsModule;

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

const compileCandidates = [
  path.resolve(repoRoot, 'node_modules/.bin/compile-dcl'),
  path.resolve(projectRoot, 'node_modules/.bin/compile-dcl'),
  path.resolve(repoRoot, 'node_modules/@sap/ams-dev/src/bin/compileDcl.js'),
  path.resolve(repoRoot, 'node_modules/@sap/ams/bin/compile-dcl'),
];

const cdsBin = candidateBins.find((candidate) => existsSync(candidate));

if (!cdsBin) {
  console.error('Unable to locate the cds CLI binary required to generate AMS policies.');
  process.exit(1);
}

const runCommand = (command, args, options, errorMessage) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, options);

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${errorMessage} (exit code ${code ?? 'unknown'})`));
    });

    child.on('error', (error) => {
      reject(error);
    });
  });

const resolveConfiguredPath = (value) => (value ? path.resolve(repoRoot, value) : undefined);
const resolveWithFallback = (configured, fallback) => configured ?? path.resolve(repoRoot, fallback);

const compilePoliciesToDcn = async () => {
  const amsConfig = cds?.env?.requires?.ams ?? {};
  const credentials = amsConfig.credentials ?? {};
  const configuredDclRoot = resolveConfiguredPath(credentials.dclRoot);
  const fallbackDclRoot = path.resolve(repoRoot, 'srv', 'ams');
  const potentialRoots = [
    configuredDclRoot ? path.join(configuredDclRoot, 'dcl') : undefined,
    configuredDclRoot,
    path.join(fallbackDclRoot, 'dcl'),
    fallbackDclRoot,
  ].filter((root, index, array) => root !== undefined && array.indexOf(root) === index);
  const dclRoot = potentialRoots.find((root) => existsSync(path.join(root, 'schema.dcl')))
    ?? fallbackDclRoot;
  const dcnRoot = resolveWithFallback(resolveConfiguredPath(credentials.dcnRoot), path.join('srv', 'gen', 'ams', 'dcn'));

  if (!existsSync(dclRoot)) {
    console.warn(`Skipping DCL compilation because the configured dclRoot "${dclRoot}" does not exist.`);
    return;
  }

  if (!existsSync(dcnRoot)) {
    mkdirSync(dcnRoot, { recursive: true });
  }

  const compileBin = compileCandidates.find((candidate) => existsSync(candidate));

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
      cwd: repoRoot,
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

