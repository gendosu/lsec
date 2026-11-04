import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  backupMasterKey, decrypt, encrypt, hasMasterKeyBackup, loadOrCreateMasterKey,
  removeMasterKeyBackup,
} from '../src/crypto.js';
import { CryptoError, SecretNotFoundError, StoreError } from '../src/errors.js';
import { SecretStore } from '../src/secret-store.js';
import { readStoreFile, writeStoreFile } from '../src/store-file.js';

vi.mock('node:fs', async (importOriginal) => ({ ...await importOriginal<typeof fs>() }));

const dirs: string[] = [];
const entries = [
  { key: 'token', value: 'global-dummy', namespace: undefined },
  { key: 'token', value: 'work-dummy', namespace: 'work' },
  { key: 'token', value: 'aws-dummy', namespace: 'aws' },
  { key: '__proto__', value: '', namespace: '__proto__' },
];

afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeFixture(populate = true) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsec-recovery-test-'));
  dirs.push(configDir);
  const store = new SecretStore({ configDir });
  if (populate) {
    for (const { key, value, namespace } of entries) store.set(key, value, { namespace });
  }
  return { configDir, store };
}

function snapshot(configDir: string) {
  return ['master.key', 'secrets.json', 'master.key.bak'].map((name) => {
    const file = path.join(configDir, name);
    return fs.existsSync(file) ? fs.readFileSync(file) : undefined;
  });
}

function expectAllValues(store: SecretStore) {
  for (const { key, value, namespace } of entries) {
    expect(store.get(key, { namespace })).toBe(value);
    expect(store.tryGet(key, { namespace })).toBe(value);
  }
}

function expectDecrypts(configDir: string, key: Buffer) {
  const data = readStoreFile(configDir);
  for (const entry of entries) {
    const container = entry.namespace ? data.namespaces[entry.namespace]! : data.global;
    expect(decrypt(container[entry.key]!, key)).toBe(entry.value);
  }
}

function expectUpdatesBlocked(store: SecretStore, configDir: string) {
  const before = snapshot(configDir);
  for (const update of [
    () => store.set('token', 'replacement-dummy'),
    () => store.set('new', 'replacement-dummy', { namespace: 'new' }),
    () => store.delete('token'),
    () => store.delete('token', { namespace: 'work' }),
    () => store.delete('missing'),
    () => store.deleteNamespace('work'),
    () => store.deleteNamespace('missing'),
    () => store.rotateMasterKey(),
  ]) {
    expect(update).toThrow(StoreError);
    expect(update).toThrow(/recovery/i);
    expect(snapshot(configDir)).toEqual(before);
  }
}

describe('pending rotation recovery', () => {
  it('does not retain a failed read key when another reader verifies and clears recovery', () => {
    const { configDir, store } = makeFixture();
    const keyPath = path.join(configDir, 'master.key');
    const backupPath = path.join(configDir, 'master.key.bak');
    const tmpPath = path.join(configDir, 'secrets.json.tmp');
    fs.mkdirSync(tmpPath);
    expect(() => store.rotateMasterKey()).toThrow(StoreError);
    expect(() => store.get('token')).toThrow(CryptoError);
    expect(() => store.tryGet('token')).toThrow(CryptoError);
    fs.rmdirSync(tmpPath);
    fs.copyFileSync(backupPath, keyPath);
    expectAllValues(new SecretStore({ configDir }));
    fs.unlinkSync(backupPath);

    store.set('after-recovery', 'recovered-dummy');
    const reader = new SecretStore({ configDir });
    expectAllValues(reader);
    expect(reader.get('after-recovery')).toBe('recovered-dummy');
    expect(store.rotateMasterKey()).toBe(entries.length + 1);
    expectAllValues(new SecretStore({ configDir }));
  });

  it('blocks every mutation in existing and new instances without masking mismatched-key reads', () => {
    const { configDir, store } = makeFixture();
    fs.mkdirSync(path.join(configDir, 'secrets.json.tmp'));
    expect(() => store.rotateMasterKey()).toThrow(StoreError);
    for (const reader of [store, new SecretStore({ configDir })]) {
      expectUpdatesBlocked(reader, configDir);
      expect(() => reader.get('token')).toThrow(CryptoError);
      expect(() => reader.tryGet('token', { namespace: 'work' })).toThrow(CryptoError);
      expect(reader.tryGet('missing')).toBeUndefined();
      expect(() => reader.get('missing')).toThrow(SecretNotFoundError);
      expect(reader.has('token')).toBe(true);
      expect(reader.list()).toEqual(['token']);
      expect(reader.namespaces()).toEqual(['work', 'aws', '__proto__']);
    }
  });

  it.each(['absent', 'empty'])('blocks updates with a %s store and never generates a missing key', (state) => {
    const { configDir, store } = makeFixture(false);
    if (state === 'empty') writeStoreFile(configDir, { version: 1, global: {}, namespaces: {} });
    fs.writeFileSync(path.join(configDir, 'master.key.bak'), Buffer.alloc(32, 5));
    expectUpdatesBlocked(store, configDir);
    expectUpdatesBlocked(new SecretStore({ configDir }), configDir);
    expect(() => loadOrCreateMasterKey(configDir)).toThrow(StoreError);
    expect(fs.existsSync(path.join(configDir, 'master.key'))).toBe(false);
    expect(store.tryGet('missing')).toBeUndefined();
  });

  it('never regenerates a missing current key for pending reads, even in a previously cached instance', () => {
    const { configDir, store } = makeFixture();
    backupMasterKey(configDir);
    fs.unlinkSync(path.join(configDir, 'master.key'));
    for (const reader of [store, new SecretStore({ configDir })]) {
      expect(() => reader.get('token')).toThrow(StoreError);
      expect(() => reader.tryGet('token')).toThrow(StoreError);
      expectUpdatesBlocked(reader, configDir);
    }
    expect(fs.existsSync(path.join(configDir, 'master.key'))).toBe(false);
  });

  it.each(['directory', 'symlink', 'dangling symlink', 'invalid key'])('preserves a backup path containing a %s', (kind) => {
    const { configDir, store } = makeFixture();
    const backup = path.join(configDir, 'master.key.bak');
    const target = path.join(configDir, 'target');
    if (kind === 'directory') fs.mkdirSync(backup);
    else if (kind.includes('symlink')) {
      if (kind === 'symlink') fs.writeFileSync(target, 'target-dummy', { mode: 0o640 });
      fs.symlinkSync(target, backup);
    } else fs.writeFileSync(backup, 'invalid-dummy', { mode: 0o640 });
    const before = fs.lstatSync(backup);
    const keyBefore = fs.readFileSync(path.join(configDir, 'master.key'));
    const dataBefore = fs.readFileSync(path.join(configDir, 'secrets.json'));
    expect(hasMasterKeyBackup(configDir)).toBe(true);
    for (const reader of [store, new SecretStore({ configDir })]) {
      expect(() => reader.set('new', 'dummy')).toThrow(StoreError);
      expect(() => reader.delete('missing')).toThrow(StoreError);
      expect(() => reader.deleteNamespace('missing')).toThrow(StoreError);
      expect(() => reader.rotateMasterKey()).toThrow(StoreError);
      expectAllValues(reader);
    }
    expect(() => backupMasterKey(configDir)).toThrow();
    expect(fs.lstatSync(backup).ino).toBe(before.ino);
    expect(fs.lstatSync(backup).mode).toBe(before.mode);
    expect(fs.readFileSync(path.join(configDir, 'master.key'))).toEqual(keyBefore);
    expect(fs.readFileSync(path.join(configDir, 'secrets.json'))).toEqual(dataBefore);
    if (kind.includes('symlink')) expect(fs.readlinkSync(backup)).toBe(target);
    if (kind === 'symlink') {
      expect(fs.readFileSync(target, 'utf8')).toBe('target-dummy');
      expect(fs.statSync(target).mode & 0o777).toBe(0o640);
    }
    if (kind === 'dangling symlink') expect(fs.existsSync(target)).toBe(false);
    if (kind === 'invalid key') expect(fs.readFileSync(backup, 'utf8')).toBe('invalid-dummy');
  });

  it('does not overwrite or chmod an existing valid recovery key', () => {
    const { configDir } = makeFixture();
    const backup = path.join(configDir, 'master.key.bak');
    const recoveryKey = Buffer.alloc(32, 9);
    fs.writeFileSync(backup, recoveryKey, { mode: 0o640 });
    expect(() => backupMasterKey(configDir)).toThrow();
    expect(fs.readFileSync(backup)).toEqual(recoveryKey);
    expect(fs.statSync(backup).mode & 0o777).toBe(0o640);
  });

  it('rejects corrupt current keys before creating a backup', () => {
    const { configDir } = makeFixture();
    fs.writeFileSync(path.join(configDir, 'master.key'), Buffer.alloc(31));
    expect(() => backupMasterKey(configDir)).toThrow(CryptoError);
    expect(hasMasterKeyBackup(configDir)).toBe(false);
  });

  it('treats backup inspection errors as failures and preserves their cause', () => {
    const { configDir, store } = makeFixture();
    const cause = Object.assign(new Error('inspection denied'), { code: 'EACCES' });
    const realLstat = fs.lstatSync;
    vi.spyOn(fs, 'lstatSync').mockImplementation((file, ...args) => {
      if (file === path.join(configDir, 'master.key.bak')) throw cause;
      return realLstat(file, ...args);
    });
    const before = snapshot(configDir);
    expect(() => store.set('new', 'dummy')).toThrow(StoreError);
    expect(() => store.rotateMasterKey()).toThrow(expect.objectContaining({ cause }));
    expect(snapshot(configDir)).toEqual(before);
  });

  it('preserves a store that cannot be fully decrypted by either candidate key', () => {
    const { configDir, store } = makeFixture();
    const data = readStoreFile(configDir);
    data.namespaces['work']!['token'] = encrypt('other-dummy', Buffer.alloc(32, 7));
    writeStoreFile(configDir, data);
    backupMasterKey(configDir);
    expect(() => store.get('token', { namespace: 'work' })).toThrow(CryptoError);
    expectUpdatesBlocked(store, configDir);
    expectUpdatesBlocked(new SecretStore({ configDir }), configDir);
  });
});

const failurePoints = [
  { method: 'openSync', file: 'master.key.bak', stage: 'backup creation', changed: false, backup: false },
  { method: 'writeFileSync', file: 'fd', stage: 'backup creation', changed: false, backup: true },
  { method: 'fchmodSync', file: 'fd', stage: 'backup creation', changed: false, backup: true },
  { method: 'closeSync', file: 'fd', stage: 'backup creation', changed: false, backup: true },
  { method: 'writeFileSync', file: 'master.key.tmp', stage: 'master.key replacement', changed: false, backup: true },
  { method: 'chmodSync', file: 'master.key.tmp', stage: 'master.key replacement', changed: false, backup: true },
  { method: 'renameSync', file: 'master.key.tmp', stage: 'master.key replacement', changed: false, backup: true },
  { method: 'writeFileSync', file: 'secrets.json.tmp', stage: 'secrets.json persistence', changed: true, backup: true },
  { method: 'chmodSync', file: 'secrets.json.tmp', stage: 'secrets.json persistence', changed: true, backup: true },
  { method: 'renameSync', file: 'secrets.json.tmp', stage: 'secrets.json persistence', changed: true, backup: true },
  { method: 'unlinkSync', file: 'master.key.bak', stage: 'backup cleanup', changed: true, backup: true },
] as const;

describe('rotation persistence failures', () => {
  it('retains a partial backup and the valid current key after a short backup write fails', () => {
    const { configDir, store } = makeFixture();
    const before = snapshot(configDir);
    const realWrite = fs.writeFileSync;
    const close = vi.spyOn(fs, 'closeSync');
    vi.spyOn(fs, 'writeFileSync').mockImplementation((file, data, ...args) => {
      if (typeof file === 'number' && Buffer.isBuffer(data)) {
        realWrite(file, data.subarray(0, 12));
        throw new Error('injected short write');
      }
      return realWrite(file, data, ...args);
    });
    expect(() => store.rotateMasterKey()).toThrow(StoreError);
    expect(close).toHaveBeenCalledOnce();
    vi.restoreAllMocks();
    expect(snapshot(configDir)).toEqual([before[0], before[1], before[0]!.subarray(0, 12)]);
    expectAllValues(store);
    expectUpdatesBlocked(store, configDir);
  });

  it.each(failurePoints)('preserves recoverable files when $method fails for $file', (point) => {
    const { configDir, store } = makeFixture();
    const keyPath = path.join(configDir, 'master.key');
    const backupPath = path.join(configDir, 'master.key.bak');
    const before = snapshot(configDir);
    const cause = Object.assign(new Error('injected failure'), { code: 'EIO' });
    const realOperation = fs[point.method] as (...args: unknown[]) => unknown;
    const injected = vi.spyOn(fs, point.method).mockImplementation((...args: unknown[]) => {
      if (point.file === 'fd' ? typeof args[0] === 'number' : args[0] === path.join(configDir, point.file)) {
        // Release the real descriptor while simulating a reported close failure.
        if (point.method === 'closeSync') realOperation(...args);
        throw cause;
      }
      return realOperation(...args);
    });
    let error: StoreError | undefined;
    try { store.rotateMasterKey(); } catch (err) { error = err as StoreError; }
    expect(injected).toHaveBeenCalled();
    injected.mockRestore();
    expect(error).toBeInstanceOf(StoreError);
    expect(error!.message).toContain(point.stage);
    expect(error!.message).toContain(configDir);
    const originalCause = point.stage === 'secrets.json persistence'
      ? (error!.cause as StoreError).cause : error!.cause;
    expect(originalCause).toBe(cause);
    for (const { value } of entries.filter((entry) => entry.value)) {
      expect(error!.message).not.toContain(value);
    }
    expect(error!.message).not.toContain(before[0]!.toString('hex'));
    const currentKey = fs.readFileSync(keyPath);
    expect(currentKey.equals(before[0]!)).toBe(!point.changed);
    expect(hasMasterKeyBackup(configDir)).toBe(point.backup);

    if (point.stage === 'backup cleanup') {
      expect(error!.message).toContain('were saved');
      expectAllValues(store);
      expectAllValues(new SecretStore({ configDir }));
      expectDecrypts(configDir, currentKey);
      expect(fs.readFileSync(backupPath)).toEqual(before[0]);
    } else {
      expect(fs.readFileSync(path.join(configDir, 'secrets.json'))).toEqual(before[1]);
      expectDecrypts(configDir, before[0]!);
      if (point.changed) {
        expect(() => store.get('token')).toThrow(CryptoError);
        expect(fs.readFileSync(backupPath)).toEqual(before[0]);
      } else expectAllValues(store);
    }
    if (point.backup) {
      expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
      expectUpdatesBlocked(store, configDir);
      expectUpdatesBlocked(new SecretStore({ configDir }), configDir);
    }

    // Reproduce the documented decision: restore only when old data needs it.
    if (point.stage === 'secrets.json persistence') fs.copyFileSync(backupPath, keyPath);
    expectAllValues(store);
    expectAllValues(new SecretStore({ configDir }));
    if (point.backup) fs.unlinkSync(backupPath);
    store.set('after-recovery', 'recovered-dummy');
    new SecretStore({ configDir }).set('after-recovery', 'recovered-dummy');
    expect(store.rotateMasterKey()).toBe(entries.length + 1);
    const reader = new SecretStore({ configDir });
    expectAllValues(reader);
    expect(reader.get('after-recovery')).toBe('recovered-dummy');
    expect(hasMasterKeyBackup(configDir)).toBe(false);
  });

  it('surfaces backup removal errors other than ENOENT', () => {
    const { configDir } = makeFixture();
    fs.mkdirSync(path.join(configDir, 'master.key.bak'));
    expect(() => removeMasterKeyBackup(configDir)).toThrow();
    expect(hasMasterKeyBackup(configDir)).toBe(true);
  });
});
