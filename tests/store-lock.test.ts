import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StoreError } from '../src/errors.js';
import { withStoreLock } from '../src/store-lock.js';

vi.mock('node:fs', async (original) => ({ ...await original<typeof fs>() }));
const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsec-lock-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('store locking', () => {
  it('creates private directories, returns results and releases after success', () => {
    const dir = path.join(fixture(), 'new');
    expect(withStoreLock(dir, () => {
      expect(fs.statSync(dir).mode & 0o777).toBe(0o700);
      expect(fs.statSync(path.join(dir, '.lsec.lock')).mode & 0o777).toBe(0o700);
      return 42;
    })).toBe(42);
    expect(fs.readdirSync(dir)).toEqual([]);
  });

  it('releases after an exception and preserves the original error', () => {
    const dir = fixture();
    const cause = new Error('operation failed');
    expect(() => withStoreLock(dir, () => { throw cause; })).toThrow(cause);
    expect(withStoreLock(dir, () => 'next')).toBe('next');
  });

  it.each(['directory', 'symlink'])('times out without invoking the operation or removing an existing %s', (kind) => {
    const dir = fixture();
    const lock = path.join(dir, '.lsec.lock');
    if (kind === 'directory') fs.mkdirSync(lock);
    else fs.symlinkSync(path.join(dir, 'absent'), lock);
    const before = fs.lstatSync(lock);
    const operation = vi.fn();
    expect(() => withStoreLock(dir, operation, 25)).toThrow(StoreError);
    expect(() => withStoreLock(dir, operation, 25)).toThrow(/Timed out.*\.lsec\.lock/);
    expect(operation).not.toHaveBeenCalled();
    expect(fs.lstatSync(lock).ino).toBe(before.ino);
  });

  it('reports acquisition errors immediately with their cause', () => {
    const dir = fixture();
    const cause = Object.assign(new Error('denied'), { code: 'EACCES' });
    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => { throw cause; });
    expect(() => withStoreLock(dir, vi.fn())).toThrow(expect.objectContaining({ cause }));
  });

  it('does not begin an operation after the deadline even if the owner released during a delayed wakeup', () => {
    const dir = fixture();
    const lock = path.join(dir, '.lsec.lock');
    fs.mkdirSync(lock);
    let now = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.spyOn(Atomics, 'wait').mockImplementation(() => {
      fs.rmdirSync(lock);
      now = 100;
      return 'timed-out';
    });
    const operation = vi.fn();
    expect(() => withStoreLock(dir, operation, 25)).toThrow(/Timed out/);
    expect(operation).not.toHaveBeenCalled();
    expect(fs.existsSync(lock)).toBe(false);
  });

  it.each([false, true])('reports release failure, retaining operation failure=%s', (failOperation) => {
    const dir = fixture();
    const cause = new Error('release denied');
    const operationError = new Error('operation failed');
    vi.spyOn(fs, 'rmdirSync').mockImplementation(() => { throw cause; });
    let error: StoreError | undefined;
    try {
      withStoreLock(dir, () => { if (failOperation) throw operationError; });
    } catch (err) { error = err as StoreError; }
    expect(error).toBeInstanceOf(StoreError);
    expect(error!.message).toMatch(/may have completed/);
    expect(error!.message).toContain(path.join(dir, '.lsec.lock'));
    if (failOperation) expect((error!.cause as AggregateError).errors).toEqual([operationError, cause]);
    else expect(error!.cause).toBe(cause);
    expect(fs.existsSync(path.join(dir, '.lsec.lock'))).toBe(true);
  });

  it('does not recursively delete unexpected files in the lock', () => {
    const dir = fixture();
    const file = path.join(dir, '.lsec.lock', 'evidence');
    expect(() => withStoreLock(dir, () => fs.writeFileSync(file, 'dummy'))).toThrow(StoreError);
    expect(fs.readFileSync(file, 'utf8')).toBe('dummy');
  });
});
