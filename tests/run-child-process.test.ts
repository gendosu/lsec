import { spawn, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { constants as osConstants } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runChildProcess } from '../src/run-child-process.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const signals = ['SIGTERM', 'SIGINT'] as const;
let originalListeners: Map<string, Function[]>;

beforeEach(() => {
  vi.mocked(spawn).mockReset();
  originalListeners = new Map(signals.map((signal) => [signal, process.listeners(signal)]));
});

afterEach(() => {
  const remaining = signals.map((signal) => process.listeners(signal));
  // Clean up even a failed assertion so a failure cannot poison later tests.
  for (const signal of signals) {
    for (const listener of process.listeners(signal)) {
      if (!originalListeners.get(signal)!.includes(listener)) process.off(signal, listener);
    }
  }
  vi.restoreAllMocks();
  expect(remaining).toEqual(signals.map((signal) => originalListeners.get(signal)));
});

function receive(signal: typeof signals[number]): void {
  const listeners = process.listeners(signal).filter((listener) => !originalListeners.get(signal)!.includes(listener));
  expect(listeners).toHaveLength(1);
  // Invoke only our listener; never signal the runner or its other listeners.
  listeners[0](signal);
}

function mockChild() {
  const child = Object.assign(new EventEmitter(), {
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    killed: false,
    kill: vi.fn((_signal: NodeJS.Signals) => { child.killed = true; return true; }),
  });
  vi.mocked(spawn).mockReturnValue(child as unknown as ChildProcess);
  return child;
}

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

  it.each(signals)('forwards every %s and waits for close, preserving the child exit code', async (signal) => {
    const child = mockChild();
    const result = runChildProcess('child-command', [], {});
    const settled = vi.fn();
    void result.then(settled);
    child.emit('spawn');
    receive(signal);
    receive(signal);
    expect(child.killed).toBe(true);
    expect(child.kill.mock.calls).toEqual([[signal], [signal]]);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    child.emit('exit', 37, null);
    receive(signal);
    expect(child.kill).toHaveBeenCalledTimes(2);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    child.emit('close', 37, null);
    expect(await result).toBe(37);
  });

  it('queues signals received during spawn setup and flushes them after spawn', async () => {
    const child = mockChild();
    vi.mocked(spawn).mockImplementation(() => {
      receive('SIGTERM');
      return child as unknown as ChildProcess;
    });
    const result = runChildProcess('child-command', [], {});
    receive('SIGINT');
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('spawn');
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGINT']]);
    child.emit('close', null, 'SIGTERM');
    expect(await result).toBe(143);
  });

  it.each(['exitCode', 'signalCode'] as const)('does not signal a child with a final %s before exit is delivered', async (property) => {
    const child = mockChild();
    const result = runChildProcess('child-command', [], {});
    child.emit('spawn');
    if (property === 'exitCode') child.exitCode = 0;
    else child.signalCode = 'SIGINT';
    receive('SIGTERM');
    expect(child.kill).not.toHaveBeenCalled();
    child.emit('close', 0, null);
    expect(await result).toBe(0);
  });

  it.each(['false', 'throw', 'error'] as const)('waits after kill %s and prints only a fixed diagnostic', async (mode) => {
    const child = mockChild();
    const diagnostic = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    const original = Object.assign(new Error(secret), { code: secret, env: secret });
    child.kill.mockImplementationOnce(() => {
      if (mode === 'throw') throw original;
      if (mode === 'error') child.emit('error', original);
      return false;
    });
    const result = runChildProcess('child-command', [], {});
    const settled = vi.fn();
    void result.then(settled, settled);
    child.emit('spawn');
    receive('SIGTERM');
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalled();
    expect(diagnostic.mock.calls.every(([message]) =>
      message === 'Could not forward signal to child process; waiting for child to exit.\n'
    )).toBe(true);
    receive('SIGINT');
    expect(child.kill.mock.calls).toEqual([['SIGTERM'], ['SIGINT']]);
    child.emit('exit', 37, null);
    child.emit('close', 37, null);
    child.emit('error', original);
    child.emit('close', 9, null);
    expect(await result).toBe(37);
  });

  it('drops queued signals on asynchronous startup failure and tolerates a later close', async () => {
    const child = mockChild();
    const result = runChildProcess('child-command', [], {}).catch((err: unknown) => err);
    receive('SIGTERM');
    child.emit('error', Object.assign(new Error(secret), { code: 'ENOENT' }));
    child.emit('close', -2, null);
    expect((await result as Error).message).toBe('Could not start child process: command not found (ENOENT).');
    expect(child.kill).not.toHaveBeenCalled();
  });

  it('preserves pre-existing listeners and makes saved forwarding callbacks inert after close', async () => {
    const existing = vi.fn();
    process.on('SIGTERM', existing);
    try {
      const child = mockChild();
      const result = runChildProcess('child-command', [], {});
      const callbacks = process.listeners('SIGTERM').filter((fn) => fn !== existing && !originalListeners.get('SIGTERM')!.includes(fn));
      expect(callbacks).toHaveLength(1);
      child.emit('spawn');
      child.emit('close', 0, null);
      expect(await result).toBe(0);
      callbacks[0]('SIGTERM');
      expect(child.kill).not.toHaveBeenCalled();
      expect(process.listeners('SIGTERM')).toContain(existing);
      expect(existing).not.toHaveBeenCalled();
    } finally {
      process.off('SIGTERM', existing);
    }
  });
});
