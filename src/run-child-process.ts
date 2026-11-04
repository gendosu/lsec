import { spawn } from 'node:child_process';
import { constants as osConstants } from 'node:os';

/** Runs a child with inherited stdio and propagates its exit code or 128 + signal number. */
export function runChildProcess(command: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      const child = spawn(command, args, { stdio: 'inherit', env });
      child.on('error', (err: unknown) => reject(safeSpawnError(err)));
      child.on('close', (code, signal) => {
        if (signal) {
          resolve(128 + (osConstants.signals[signal] ?? 0));
        } else {
          resolve(code ?? 1);
        }
      });
    } catch (err) {
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
