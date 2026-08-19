/**
 * e2e test helpers for the local-secret CLI: run the built CLI (dist/cli.js)
 * as a child process against an isolated, temporary configDir (injected via
 * LOCAL_SECRET_CONFIG_DIR), so tests never touch the real
 * `~/.config/local-secret`.
 *
 * Mirrors the pattern in local-secret's tests/e2e/helpers.ts (runCli /
 * createTmpHome / cleanupTmpHome), adapted for local-secret: no real
 * external server is required, so there is no readE2EEnv()-style
 * skip-if-unconfigured gate — these tests always run.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawn } from 'node:child_process';

const CLI_PATH = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../dist/cli.js');

export interface RunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** Creates a fresh, empty temporary directory to use as an isolated configDir. Caller must clean it up with {@link cleanupTmpConfigDir}. */
export function createTmpConfigDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'local-secret-e2e-'));
}

/** Removes a temporary configDir created by {@link createTmpConfigDir}. */
export function cleanupTmpConfigDir(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Runs the built CLI (`dist/cli.js`, requires `pnpm build` to have been run
 * first) as a child process with `LOCAL_SECRET_CONFIG_DIR` set to `configDir`.
 *
 * If `input` is given, it is written to the child's stdin and the stream is
 * then closed (so `set --stdin` and non-interactive commands never hang
 * waiting for input); otherwise stdin is closed immediately.
 *
 * `extraEnv` is merged on top of the inherited `process.env` (after
 * `LOCAL_SECRET_CONFIG_DIR`), primarily so `run` e2e tests can set a parent
 * environment variable to a `lsec://` reference and assert it gets resolved
 * for the grandchild process.
 */
export function runCli(
  args: string[],
  configDir: string,
  input?: string,
  extraEnv?: Record<string, string>
): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(CLI_PATH)) {
      reject(new Error(`${CLI_PATH} does not exist. Run "pnpm build" before running e2e tests.`));
      return;
    }

    const child = spawn(process.execPath, [CLI_PATH, ...args], {
      env: { ...process.env, LOCAL_SECRET_CONFIG_DIR: configDir, ...extraEnv },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });
    // Defensive: if the child exits before consuming stdin (e.g. a fast
    // argument-parsing failure), writing to its already-closed stdin would
    // otherwise raise an unhandled 'error' event on the stream.
    child.stdin.on('error', () => { /* ignore: handled via child's 'close'/'error' above */ });

    if (input !== undefined) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}
