import type { Server } from 'http';
import path from 'node:path';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { once } from 'node:events';

export interface RunningServer {
  url: string;
  server: Server;
  close: () => Promise<void>;
}

export const startCapServer = async (): Promise<RunningServer> => {
  process.env.NODE_ENV = process.env.NODE_ENV ?? 'test';
  process.env.CDS_ENV = process.env.CDS_ENV ?? 'test';
  process.env.CDS_PROFILES = process.env.CDS_PROFILES ?? 'test';
  const projectRoot = path.resolve(__dirname, '../..');
  const tsConfig = path.join(projectRoot, 'srv/tsconfig.json');
  const child = spawn(
    'node',
    ['-r', 'ts-node/register/transpile-only', './node_modules/@sap/cds-dk/bin/cds.js', 'run', '--in-memory?', '--port', '0'],
    {
      cwd: projectRoot,
      env: {
        ...process.env,
        TS_NODE_PROJECT: tsConfig,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  ) as ChildProcessWithoutNullStreams;

  const urlPattern = /server listening on \{ url: '([^']+)' \}/i;

  const forwardStdout = (chunk: Buffer) => {
    process.stdout.write(chunk);
  };

  const forwardStderr = (chunk: Buffer) => {
    process.stderr.write(chunk);
  };

  child.stderr.on('data', forwardStderr);

  const url = await new Promise<string>((resolve, reject) => {
    const handleStdout = (chunk: Buffer) => {
      forwardStdout(chunk);
      const text = chunk.toString();
      const sanitized = text.replace(/\u001b\[[0-9;]*m/g, '');
      const match = sanitized.match(urlPattern);
      if (match) {
        child.stdout.off('data', handleStdout);
        child.stdout.on('data', forwardStdout);
        child.off('error', onError);
        child.off('exit', onExit);
        const url = match[1];
        if (process.env.DEBUG?.includes('cap-server')) {
          console.log('CAP server ready at', url);
        }
        resolve(url);
      } else {
        if (process.env.DEBUG?.includes('cap-server')) {
          console.log('CAP stdout chunk (no match)', JSON.stringify(sanitized));
        }
      }
    };

    child.stdout.on('data', handleStdout);
    const onError = (err: Error) => {
      child.stdout.off('data', handleStdout);
      child.off('exit', onExit);
      reject(err);
    };

    const onExit = (code: number | null) => {
      child.stdout.off('data', handleStdout);
      child.off('error', onError);
      reject(new Error(`CAP server exited before startup. Exit code: ${code ?? 'unknown'}`));
    };

    child.on('error', onError);
    child.on('exit', onExit);
  });

  let closed = false;
  const close = async () => {
    if (closed) {
      return;
    }
    closed = true;

    child.stdout.off('data', forwardStdout);
    child.stderr.off('data', forwardStderr);

    if (child.exitCode === null) {
      child.kill();
      await once(child, 'exit');
    }
  };

  return {
    url,
    server: child as unknown as Server,
    close,
  };
};
