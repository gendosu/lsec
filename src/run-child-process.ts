import { spawn, type ChildProcess } from 'node:child_process';
import { constants as osConstants } from 'node:os';

/** Runs a child with inherited stdio and propagates its exit code or 128 + signal number. */
export function runChildProcess(command: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess | undefined;
    let spawned = false;
    let exited = false;
    let finished = false;
    const pending: NodeJS.Signals[] = [];

    function cleanup(): void {
      finished = true;
      pending.length = 0;
      process.off('SIGTERM', onSigterm);
      process.off('SIGINT', onSigint);
    }

    function reportSignalFailure(): void {
      process.stderr.write('Could not forward signal to child process; waiting for child to exit.\n');
    }

    function forward(signal: NodeJS.Signals): void {
      if (finished || exited) return;
      if (!spawned || !child) {
        pending.push(signal);
        return;
      }
      if (child.exitCode !== null || child.signalCode !== null) return;
      try {
        // killed records delivery, not exit: a child may handle or ignore signals.
        if (!child.kill(signal)) reportSignalFailure();
      } catch {
        reportSignalFailure();
      }
    }

    const onSigterm = () => forward('SIGTERM');
    const onSigint = () => forward('SIGINT');
    process.on('SIGTERM', onSigterm);
    process.on('SIGINT', onSigint);

    try {
      child = spawn(command, args, { stdio: 'inherit', env });
      child.once('spawn', () => {
        spawned = true;
        for (const signal of pending.splice(0)) forward(signal);
      });
      child.on('error', (err: unknown) => {
        if (finished) return;
        if (spawned) {
          // A failed signal delivery must not orphan a successfully started child.
          reportSignalFailure();
        } else {
          cleanup();
          reject(safeSpawnError(err));
        }
      });
      child.once('exit', () => {
        exited = true;
        pending.length = 0;
      });
      child.once('close', (code, signal) => {
        if (finished) return;
        cleanup();
        if (signal) {
          resolve(128 + (osConstants.signals[signal] ?? 0));
        } else {
          resolve(code ?? 1);
        }
      });
    } catch (err) {
      cleanup();
      reject(safeSpawnError(err));
    }
  });
}

function safeSpawnError(err: unknown): Error {
  // Runtime errors can embed decrypted env values in messages and properties.
  // Only fixed diagnostics selected by known codes may cross this boundary.
  let code: unknown;
  try {
    code = typeof err === 'object' && err !== null ? (err as { code?: unknown }).code : undefined;
  } catch {
    // An accessor can itself throw; it must not bypass the safe fallback.
  }
  let reason: string;
  switch (code) {
    case 'ENOENT':
      reason = 'command not found (ENOENT).';
      break;
    case 'EACCES':
      reason = 'permission denied (EACCES).';
      break;
    case 'E2BIG':
      reason = 'arguments or environment are too large (E2BIG).';
      break;
    case 'ERR_INVALID_ARG_VALUE':
      reason = 'invalid process arguments or environment (ERR_INVALID_ARG_VALUE).';
      break;
    default:
      reason = 'process startup failed.';
  }
  return new Error(`Could not start child process: ${reason}`);
}
