import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';

interface Job {
  configDir: string;
  operations?: unknown[][];
  warm?: boolean;
  delayRead?: number;
  holdLock?: boolean;
  pauseAt?: string;
  failAt?: string;
  gate?: string;
}
interface Result {
  code: number | null;
  signal: NodeJS.Signals | null;
  results?: unknown[];
  error?: { name: string; message: string };
  stderr: string;
}
const workerPath = fileURLToPath(new URL('../fixtures/store-worker.mjs', import.meta.url));
const active = new Map<ChildProcess, Promise<Result>>();

export function launchStoreWorker(job: Job) {
  const child = spawn(process.execPath, [workerPath, JSON.stringify(job)], {
    stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  let result: Partial<Result> = {};
  let stderr = '';
  child.stderr!.on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise<void>((resolve, reject) => {
    child.on('message', (message) => {
      if (message === 'ready') resolve();
      else result = message as Partial<Result>;
    });
    child.on('error', reject);
    child.on('close', () => reject(new Error(`worker closed before ready: ${stderr}`)));
  });
  const timeout = setTimeout(() => child.kill('SIGKILL'), 20000);
  const done = new Promise<Result>((resolve) => {
    child.on('close', (code, signal) => {
      clearTimeout(timeout);
      active.delete(child);
      resolve({ ...result, code, signal, stderr });
    });
  });
  active.set(child, done);
  return { child, ready, done, start: () => child.send('go') };
}

export async function runStoreWorker(job: Job): Promise<Result> {
  const worker = launchStoreWorker(job);
  await worker.ready;
  worker.start();
  return worker.done;
}

export async function cleanupStoreWorkers() {
  const pending = [...active.entries()];
  for (const [child] of pending) child.kill('SIGKILL');
  await Promise.all(pending.map(([, done]) => done));
}
