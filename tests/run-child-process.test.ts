import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { constants as osConstants } from 'node:os';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runChildProcess } from '../src/run-child-process.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

beforeEach(() => {
  vi.mocked(spawn).mockReset();
});

describe('runChildProcess', () => {
  const secret = 'DUMMY_PRIVATE_STARTUP_SECRET';
  const failures: [unknown, string][] = [
    ['ENOENT', 'command not found (ENOENT).'],
    ['EACCES', 'permission denied (EACCES).'],
    ['E2BIG', 'arguments or environment are too large (E2BIG).'],
    ['ERR_INVALID_ARG_VALUE', 'invalid process arguments or environment (ERR_INVALID_ARG_VALUE).'],
    [secret, 'process startup failed.'],
    [undefined, 'process startup failed.'],
  ];

  describe.each(['synchronous', 'asynchronous'])('%s spawn failures', (mode) => {
    it.each(failures)('sanitizes a failure with code %s', async (code, reason) => {
      const original = Object.assign(new Error(secret, { cause: new Error(secret) }), {
        code,
        path: secret,
        spawnargs: [secret],
        env: { TOKEN: secret },
      });
      vi.mocked(spawn).mockImplementation(() => {
        if (mode === 'synchronous') throw original;
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('error', original));
        return child as ChildProcess;
      });

      const error = await runChildProcess('child-command', [], { TOKEN: secret }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe(`Could not start child process: ${reason}`);
      expect((error as Error).stack).not.toContain(secret);
      expect(error).not.toBe(original);
      expect(Object.getOwnPropertyNames(error)).toEqual(expect.arrayContaining(['message', 'stack']));
      for (const key of ['cause', 'code', 'path', 'spawnargs', 'env']) {
        expect(Object.hasOwn(error as object, key)).toBe(false);
      }
    });

    it.each([secret, null, undefined, Symbol(secret), { message: secret, toString: () => secret }])(
      'sanitizes a non-Error failure (case %#)',
      async (original) => {
        vi.mocked(spawn).mockImplementation(() => {
          if (mode === 'synchronous') throw original;
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('error', original));
          return child as ChildProcess;
        });
        const error = await runChildProcess('child-command', [], { TOKEN: secret }).catch((err: unknown) => err);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe('Could not start child process: process startup failed.');
        expect((error as Error).stack).not.toContain(secret);
        expect((error as Error).cause).toBeUndefined();
      }
    );

    it('uses the generic diagnostic if reading the error code throws', async () => {
      const original = { get code() { throw new Error(secret); } };
      vi.mocked(spawn).mockImplementation(() => {
        if (mode === 'synchronous') throw original;
        const child = new EventEmitter();
        queueMicrotask(() => child.emit('error', original));
        return child as ChildProcess;
      });
      const error = await runChildProcess('child-command', [], { TOKEN: secret }).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('Could not start child process: process startup failed.');
      expect((error as Error).stack).not.toContain(secret);
      expect((error as Error).cause).toBeUndefined();
    });
  });

  it.each([
    [0, null, 0],
    [3, null, 3],
    [null, 'SIGTERM', 128 + osConstants.signals.SIGTERM],
    [null, null, 1],
  ] as const)('propagates close code %s and signal %s as exit code %s', async (code, signal, expected) => {
    const child = new EventEmitter();
    vi.mocked(spawn).mockReturnValue(child as ChildProcess);
    const env = { TOKEN: secret };
    const result = runChildProcess('child-command', ['arg'], env);
    expect(spawn).toHaveBeenCalledWith('child-command', ['arg'], { stdio: 'inherit', env });
    child.emit('close', code, signal);
    expect(await result).toBe(expected);
  });
});
