import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { constants as osConstants } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { cleanupTmpConfigDir, createTmpConfigDir, runCli, startCli } from './helpers.js';

let configDir: string;

beforeEach(async () => {
  configDir = createTmpConfigDir();
  const result = await runCli(['set', 'signal_test', '--stdin'], configDir, 'DUMMY_SIGNAL_SECRET');
  expect(result.exitCode).toBe(0);
});

afterEach(() => cleanupTmpConfigDir(configDir));

async function until(predicate: () => boolean, description: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
    await delay(10);
  }
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
  }
}

function pidExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ESRCH') throw err;
    return false;
  }
}

function startRun(script: string) {
  const child = startCli(
    ['run', '--', process.execPath, '-e', `
      if (process.env.SIGNAL_SECRET !== 'DUMMY_SIGNAL_SECRET') process.exit(91);
      const ready = () => console.log('READY:' + process.pid);
      setInterval(() => {}, 1000);
      ${script}
    `],
    configDir,
    { SIGNAL_SECRET: 'lsec://global/signal_test' },
    // Only the test owns a detached process group; production still inherits it.
    { detached: true }
  );
  let stdout = '';
  let stderr = '';
  let exited = false;
  let closed = false;
  let spawnError: Error | undefined;
  let result: { code: number | null; signal: NodeJS.Signals | null } | undefined;
  child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.on('error', (err) => { spawnError = err; });
  // exit is independent of inherited stdout, which a stranded child keeps open.
  child.on('exit', (code, signal) => { exited = true; result = { code, signal }; });
  child.on('close', () => { closed = true; });

  return {
    child,
    async waitFor(marker: string) {
      await until(() => {
        if (spawnError) throw spawnError;
        if (stdout.includes(marker)) return true;
        if (exited) throw new Error('CLI exited before the expected marker');
        return false;
      }, marker);
    },
    pid() {
      const match = stdout.match(/READY:(\d+)/);
      if (!match) throw new Error('Missing child PID');
      return Number(match[1]);
    },
    async expectExit(code: number) {
      await until(() => exited, 'parent exit');
      expect(result).toEqual({ code, signal: null });
      await until(() => !pidExists(this.pid()), 'child PID disappearance');
      await until(() => closed, 'stdio close');
      expect(stdout + stderr).not.toContain('DUMMY_SIGNAL_SECRET');
      expect(stderr).toBe('');
    },
    async cleanup() {
      // Kill the owned group even if readiness failed or the parent exited first.
      if (child.pid) signalGroup(child.pid, 'SIGKILL');
      await until(() => closed, 'test process group cleanup');
    },
  };
}

describe.skipIf(process.platform === 'win32')('run signal forwarding (e2e)', () => {
  it.each(['SIGTERM', 'SIGINT'] as const)('親 PID のみへの %s を子へ転送する', async (signal) => {
    const run = startRun('ready();');
    try {
      await run.waitFor('READY:');
      expect(run.child.kill(signal)).toBe(true);
      await run.expectExit(128 + osConstants.signals[signal]);
    } finally {
      await run.cleanup();
    }
  });

  it.each(['SIGTERM', 'SIGINT'] as const)('%s 後の非同期後片付けと子の終了コードを待つ', async (signal) => {
    const run = startRun(`
      process.on('${signal}', () => {
        if (globalThis.stopping) return;
        globalThis.stopping = true;
        console.log('CLEANING');
        process.stdin.resume();
        process.stdin.once('data', () => {
          console.log('CLEANED');
          process.exit(37);
        });
      });
      ready();
    `);
    try {
      await run.waitFor('READY:');
      run.child.kill(signal);
      await run.waitFor('CLEANING');
      expect(run.child.exitCode).toBe(null);
      expect(run.child.signalCode).toBe(null);
      expect(pidExists(run.pid())).toBe(true);
      // An explicit acknowledgement proves the parent waits, without fixed sleeps.
      run.child.stdin.write('finish\n');
      await run.expectExit(37);
      await run.waitFor('CLEANED');
    } finally {
      await run.cleanup();
    }
  });

  it('最初の SIGTERM を無視した子にも後続の SIGINT を転送する', async () => {
    const run = startRun(`
      process.on('SIGTERM', () => console.log('IGNORED'));
      process.on('SIGINT', () => process.exit(38));
      ready();
    `);
    try {
      await run.waitFor('READY:');
      run.child.kill('SIGTERM');
      await run.waitFor('IGNORED');
      run.child.kill('SIGINT');
      await run.expectExit(38);
    } finally {
      await run.cleanup();
    }
  });

  it('同じシグナルを続けて受け取っても子の終了まで待つ', async () => {
    const run = startRun(`
      let received = 0;
      process.on('SIGTERM', () => {
        if (++received === 1) console.log('AGAIN');
        else process.exit(39);
      });
      ready();
    `);
    try {
      await run.waitFor('READY:');
      run.child.kill('SIGTERM');
      await run.waitFor('AGAIN');
      run.child.kill('SIGTERM');
      await run.expectExit(39);
    } finally {
      await run.cleanup();
    }
  });

  it.each([false, true])('所有するグループへの SIGINT を扱う（独自処理: %s）', async (custom) => {
    const run = startRun(custom ? `
      let stopping = false;
      process.on('SIGINT', () => {
        if (stopping) return;
        stopping = true;
        setTimeout(() => { console.log('CLEANED'); process.exit(37); }, 100);
      });
      ready();
    ` : 'ready();');
    try {
      await run.waitFor('READY:');
      signalGroup(run.child.pid!, 'SIGINT');
      await run.expectExit(custom ? 37 : 130);
      if (custom) await run.waitFor('CLEANED');
    } finally {
      await run.cleanup();
    }
  });
});
