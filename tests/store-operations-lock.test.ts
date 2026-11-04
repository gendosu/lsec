import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { SecretStore } from '../src/secret-store.js';

vi.mock('node:fs', async (original) => ({ ...await original<typeof fs>() }));
const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('holds the lock before inspecting recovery, selecting the current key or reading ciphertext for every operation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsec-operation-lock-'));
  dirs.push(dir);
  const store = new SecretStore({ configDir: dir });
  store.set('key', 'dummy');
  store.set('key', 'namespace-dummy', { namespace: 'work' });
  const read = fs.readFileSync;
  const lstat = fs.lstatSync;
  let reads = 0;
  vi.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) => {
    if (typeof file === 'string' && path.dirname(file) === dir) {
      expect(fs.existsSync(path.join(dir, '.lsec.lock'))).toBe(true);
      reads++;
    }
    return read(file, ...args);
  });
  vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
    if (file === path.join(dir, 'master.key.bak')) expect(fs.existsSync(path.join(dir, '.lsec.lock'))).toBe(true);
    return lstat(file, ...args);
  });
  for (const operation of [
    () => store.set('added', 'dummy'), () => store.get('key'), () => store.tryGet('key'),
    () => store.has('key'), () => store.list(), () => store.namespaces(),
    () => store.delete('added'), () => store.deleteNamespace('work'), () => store.rotateMasterKey(),
  ]) {
    const before = reads;
    operation();
    expect(reads).toBeGreaterThan(before);
    expect(fs.existsSync(path.join(dir, '.lsec.lock'))).toBe(false);
  }
});

it('keeps import and construction lazy and missing-key results unchanged without generating a key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsec-empty-lock-'));
  dirs.push(dir);
  const target = path.join(dir, 'new');
  const store = new SecretStore({ configDir: target });
  expect(fs.existsSync(target)).toBe(false);
  expect(store.tryGet('missing')).toBeUndefined();
  expect(store.has('missing')).toBe(false);
  expect(store.list()).toEqual([]);
  expect(store.namespaces()).toEqual([]);
  expect(store.delete('missing')).toBe(false);
  expect(store.deleteNamespace('missing')).toBe(false);
  expect(fs.readdirSync(target)).toEqual([]);
});
