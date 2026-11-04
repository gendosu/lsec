import * as fs from 'node:fs';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { StoreError } from './errors.js';
import { ensureConfigDir } from './paths.js';

const sleepBuffer = new Int32Array(new SharedArrayBuffer(4));

/** Internal synchronous, non-reentrant lock. Never steal an interrupted owner's lock. */
export function withStoreLock<T>(configDir: string, operation: () => T, timeoutMs = 5000): T {
  const lockPath = path.join(configDir, '.lsec.lock');
  const deadline = performance.now() + timeoutMs;
  try {
    ensureConfigDir(configDir);
  } catch (cause) {
    throw new StoreError(`Cannot prepare store lock at ${lockPath}.`, { cause });
  }
  let contended = false;
  for (;;) {
    if (contended && performance.now() >= deadline) {
      throw new StoreError(
        `Timed out waiting for store lock at ${lockPath}. ` +
        'The owner may still be active. Stop all store users and verify recovery before manually removing the lock (see README).'
      );
    }
    try {
      fs.mkdirSync(lockPath, { mode: 0o700 });
      break;
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw new StoreError(`Cannot acquire store lock at ${lockPath}.`, { cause });
      }
    }
    contended = true;
    Atomics.wait(sleepBuffer, 0, 0, Math.max(0, Math.min(10, deadline - performance.now())));
  }

  let failed = false;
  let operationError: unknown;
  try {
    return operation();
  } catch (cause) {
    failed = true;
    operationError = cause;
    throw cause;
  } finally {
    try {
      fs.rmdirSync(lockPath);
    } catch (cause) {
      throw new StoreError(
        `Cannot release store lock at ${lockPath}; the operation may have completed and the lock remains. ` +
        'Stop all store users and verify recovery before manually removing the lock (see README).',
        { cause: failed ? new AggregateError([operationError, cause], 'Operation and lock release failed.') : cause }
      );
    }
  }
}
