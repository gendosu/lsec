import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { decrypt, encrypt } from '../src/crypto.js';
import { CryptoError, SecretNotFoundError } from '../src/errors.js';
import { SecretStore } from '../src/secret-store.js';
import { readStoreFile, writeStoreFile } from '../src/store-file.js';

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempConfigDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-secret-secret-store-test-'));
  createdDirs.push(dir);
  return dir;
}

function makeStore(): { store: SecretStore; configDir: string } {
  const configDir = makeTempConfigDir();
  return { store: new SecretStore({ configDir }), configDir };
}

describe('constructor', () => {
  it('does not read or create master.key until the first set/get-family call (lazy load)', () => {
    const { configDir } = makeStore();

    expect(fs.existsSync(path.join(configDir, 'master.key'))).toBe(false);
  });

  it('resolves configDir via options.configDir, isolating each instance from the real home directory', () => {
    const { store, configDir } = makeStore();

    store.set('key', 'value');

    // secrets.json should be written under the injected configDir, not ~/.config.
    expect(fs.existsSync(path.join(configDir, 'secrets.json'))).toBe(true);
  });
});

describe('set / get', () => {
  it('round-trips a value in the global namespace (namespace omitted)', () => {
    const { store } = makeStore();

    store.set('github_token', 'ghp_xxx');

    expect(store.get('github_token')).toBe('ghp_xxx');
  });

  it('round-trips a value in a named namespace', () => {
    const { store } = makeStore();

    store.set('password', 'p', { namespace: 'imap' });

    expect(store.get('password', { namespace: 'imap' })).toBe('p');
  });

  it('creates master.key lazily on the first set call', () => {
    const { store, configDir } = makeStore();

    store.set('key', 'value');

    expect(fs.existsSync(path.join(configDir, 'master.key'))).toBe(true);
  });

  it('stores the value encrypted on disk, not as plaintext', () => {
    const { store, configDir } = makeStore();

    store.set('github_token', 'ghp_plaintext_value');

    const raw = fs.readFileSync(path.join(configDir, 'secrets.json'), 'utf-8');
    expect(raw).not.toContain('ghp_plaintext_value');
    const parsed = JSON.parse(raw);
    expect(parsed.global.github_token).not.toBe('ghp_plaintext_value');
    expect(typeof parsed.global.github_token).toBe('string');
  });

  it('overwrites a previous value when set is called again for the same key', () => {
    const { store } = makeStore();

    store.set('key', 'first');
    store.set('key', 'second');

    expect(store.get('key')).toBe('second');
  });

  it('overwrites a previous value in a namespace when set is called again for the same key', () => {
    const { store } = makeStore();

    store.set('token', 'first', { namespace: 'aws' });
    store.set('token', 'second', { namespace: 'aws' });

    expect(store.get('token', { namespace: 'aws' })).toBe('second');
  });

  it('keeps global and namespace values for the same key name independent', () => {
    const { store } = makeStore();

    store.set('token', 'global-value');
    store.set('token', 'namespaced-value', { namespace: 'work' });

    expect(store.get('token')).toBe('global-value');
    expect(store.get('token', { namespace: 'work' })).toBe('namespaced-value');
  });

  it('keeps the same key name independent across two different namespaces', () => {
    const { store } = makeStore();

    store.set('token', 'work-value', { namespace: 'work' });
    store.set('token', 'aws-value', { namespace: 'aws' });

    expect(store.get('token', { namespace: 'work' })).toBe('work-value');
    expect(store.get('token', { namespace: 'aws' })).toBe('aws-value');
  });

  it('reuses the same master key across multiple calls on the same instance (instance-level cache)', () => {
    const { store, configDir } = makeStore();

    store.set('a', '1');
    const keyAfterFirstSet = fs.readFileSync(path.join(configDir, 'master.key'));
    store.set('b', '2');
    const keyAfterSecondSet = fs.readFileSync(path.join(configDir, 'master.key'));

    expect(keyAfterSecondSet.equals(keyAfterFirstSet)).toBe(true);
    // Both values set on the same instance must still decrypt correctly with
    // that single cached key.
    expect(store.get('a')).toBe('1');
    expect(store.get('b')).toBe('2');
  });

  it('persists values across separate SecretStore instances pointed at the same configDir', () => {
    const configDir = makeTempConfigDir();
    const writer = new SecretStore({ configDir });
    writer.set('shared', 'value');

    const reader = new SecretStore({ configDir });
    expect(reader.get('shared')).toBe('value');
  });

  it('treats an explicit empty-string namespace the same as an omitted namespace (global)', () => {
    const { store } = makeStore();

    store.set('key', 'value', { namespace: '' });

    expect(store.get('key')).toBe('value');
    expect(store.get('key', { namespace: '' })).toBe('value');
  });
});

describe('get', () => {
  it('throws SecretNotFoundError for an unregistered key in global', () => {
    const { store } = makeStore();

    expect(() => store.get('missing')).toThrow(SecretNotFoundError);
  });

  it('throws SecretNotFoundError for an unregistered key in a namespace', () => {
    const { store } = makeStore();
    store.set('key', 'value', { namespace: 'imap' });

    expect(() => store.get('key', { namespace: 'other-namespace' })).toThrow(SecretNotFoundError);
  });

  it('throws SecretNotFoundError when the namespace itself does not exist', () => {
    const { store } = makeStore();

    expect(() => store.get('key', { namespace: 'never-created' })).toThrow(SecretNotFoundError);
  });
});

describe('tryGet', () => {
  it('returns the value when the key exists', () => {
    const { store } = makeStore();
    store.set('key', 'value');

    expect(store.tryGet('key')).toBe('value');
  });

  it('returns undefined when the key does not exist in global', () => {
    const { store } = makeStore();

    expect(store.tryGet('missing')).toBeUndefined();
  });

  it('returns undefined when the namespace does not exist', () => {
    const { store } = makeStore();

    expect(store.tryGet('key', { namespace: 'never-created' })).toBeUndefined();
  });

  it('does not throw for a missing key', () => {
    const { store } = makeStore();

    expect(() => store.tryGet('missing')).not.toThrow();
  });
});

describe('has', () => {
  it('returns true when the key exists in global', () => {
    const { store } = makeStore();
    store.set('key', 'value');

    expect(store.has('key')).toBe(true);
  });

  it('returns false when the key does not exist in global', () => {
    const { store } = makeStore();

    expect(store.has('missing')).toBe(false);
  });

  it('returns true when the key exists in the given namespace', () => {
    const { store } = makeStore();
    store.set('key', 'value', { namespace: 'imap' });

    expect(store.has('key', { namespace: 'imap' })).toBe(true);
  });

  it('returns false when the key exists in a different namespace than the one queried', () => {
    const { store } = makeStore();
    store.set('key', 'value', { namespace: 'imap' });

    expect(store.has('key', { namespace: 'aws' })).toBe(false);
    expect(store.has('key')).toBe(false);
  });

  it('returns false when the namespace does not exist at all', () => {
    const { store } = makeStore();

    expect(store.has('key', { namespace: 'never-created' })).toBe(false);
  });
});

describe('delete', () => {
  it('returns true and removes an existing global key', () => {
    const { store } = makeStore();
    store.set('key', 'value');

    expect(store.delete('key')).toBe(true);
    expect(store.has('key')).toBe(false);
    expect(() => store.get('key')).toThrow(SecretNotFoundError);
  });

  it('returns true and removes an existing namespaced key', () => {
    const { store } = makeStore();
    store.set('key', 'value', { namespace: 'imap' });

    expect(store.delete('key', { namespace: 'imap' })).toBe(true);
    expect(store.has('key', { namespace: 'imap' })).toBe(false);
  });

  it('returns false when the key does not exist in global', () => {
    const { store } = makeStore();

    expect(store.delete('missing')).toBe(false);
  });

  it('returns false when the namespace does not exist', () => {
    const { store } = makeStore();

    expect(store.delete('key', { namespace: 'never-created' })).toBe(false);
  });

  it('does not remove the global key with the same name when deleting from a namespace', () => {
    const { store } = makeStore();
    store.set('token', 'global-value');
    store.set('token', 'namespaced-value', { namespace: 'work' });

    expect(store.delete('token', { namespace: 'work' })).toBe(true);
    expect(store.get('token')).toBe('global-value');
  });

  it('persists the deletion so a fresh SecretStore instance no longer sees the key', () => {
    const configDir = makeTempConfigDir();
    const writer = new SecretStore({ configDir });
    writer.set('key', 'value');
    writer.delete('key');

    const reader = new SecretStore({ configDir });
    expect(reader.has('key')).toBe(false);
  });
});

describe('list', () => {
  it('returns an empty array when global has no keys', () => {
    const { store } = makeStore();

    expect(store.list()).toEqual([]);
  });

  it('returns all key names in global', () => {
    const { store } = makeStore();
    store.set('a', '1');
    store.set('b', '2');

    expect(store.list().sort()).toEqual(['a', 'b']);
  });

  it('returns key names scoped to the given namespace only', () => {
    const { store } = makeStore();
    store.set('a', '1');
    store.set('b', '2', { namespace: 'imap' });
    store.set('c', '3', { namespace: 'imap' });

    expect(store.list({ namespace: 'imap' }).sort()).toEqual(['b', 'c']);
    expect(store.list().sort()).toEqual(['a']);
  });

  it('returns an empty array for a namespace that does not exist', () => {
    const { store } = makeStore();

    expect(store.list({ namespace: 'never-created' })).toEqual([]);
  });
});

describe('namespaces', () => {
  it('returns an empty array when no namespace has been used yet', () => {
    const { store } = makeStore();

    expect(store.namespaces()).toEqual([]);
  });

  it('returns the names of all namespaces that have at least one key', () => {
    const { store } = makeStore();
    store.set('a', '1', { namespace: 'imap' });
    store.set('b', '2', { namespace: 'aws' });

    expect(store.namespaces().sort()).toEqual(['aws', 'imap']);
  });

  it('does not include "global" as a namespace name', () => {
    const { store } = makeStore();
    store.set('a', '1');
    store.set('b', '2', { namespace: 'imap' });

    expect(store.namespaces()).toEqual(['imap']);
  });

  it('still lists a namespace after its only key has been deleted (namespace container remains, just empty)', () => {
    const { store } = makeStore();
    store.set('a', '1', { namespace: 'imap' });
    store.delete('a', { namespace: 'imap' });

    expect(store.namespaces()).toEqual(['imap']);
    expect(store.list({ namespace: 'imap' })).toEqual([]);
  });
});

describe('prototype-pollution safety (constructor / __proto__ / toString as namespace or key)', () => {
  const dangerousNames = ['constructor', '__proto__', 'toString'];

  afterEach(() => {
    // Defense in depth: if any of these tests were to regress and actually
    // pollute the real Object/Object.prototype/Object.prototype.toString,
    // clean up "token" so the pollution does not bleed into unrelated
    // tests sharing this worker.
    delete (Object.prototype as unknown as Record<string, unknown>)['token'];
    delete (Object as unknown as Record<string, unknown>)['token'];
    delete (Object.prototype.toString as unknown as Record<string, unknown>)['token'];
  });

  it.each(dangerousNames)(
    'treats an unset "%s" key in global as not registered, not as a prototype-chain value',
    (dangerousKey) => {
      const { store } = makeStore();

      expect(store.has(dangerousKey)).toBe(false);
      expect(store.tryGet(dangerousKey)).toBeUndefined();
      expect(() => store.get(dangerousKey)).toThrow(SecretNotFoundError);
      expect(store.delete(dangerousKey)).toBe(false);
    }
  );

  it.each(dangerousNames)(
    'treats an unset "%s" namespace as not registered, not as a prototype-chain value',
    (dangerousNamespace) => {
      const { store } = makeStore();

      expect(store.has('some-key', { namespace: dangerousNamespace })).toBe(false);
      expect(store.tryGet('some-key', { namespace: dangerousNamespace })).toBeUndefined();
      expect(() => store.get('some-key', { namespace: dangerousNamespace })).toThrow(SecretNotFoundError);
      expect(store.delete('some-key', { namespace: dangerousNamespace })).toBe(false);
      expect(store.list({ namespace: dangerousNamespace })).toEqual([]);
    }
  );

  it.each(dangerousNames)(
    'round-trips a value stored under key "%s" in global via set/get/has/list/delete',
    (dangerousKey) => {
      const { store } = makeStore();

      store.set(dangerousKey, 'sekret-value');

      expect(store.has(dangerousKey)).toBe(true);
      expect(store.get(dangerousKey)).toBe('sekret-value');
      expect(store.list()).toEqual([dangerousKey]);
      expect(store.delete(dangerousKey)).toBe(true);
      expect(store.has(dangerousKey)).toBe(false);
    }
  );

  it.each(dangerousNames)(
    'round-trips a value stored in namespace "%s" via set/get/has/list/namespaces/delete',
    (dangerousNamespace) => {
      const { store } = makeStore();

      store.set('token', 'sekret-value', { namespace: dangerousNamespace });

      expect(store.has('token', { namespace: dangerousNamespace })).toBe(true);
      expect(store.get('token', { namespace: dangerousNamespace })).toBe('sekret-value');
      expect(store.list({ namespace: dangerousNamespace })).toEqual(['token']);
      expect(store.namespaces()).toEqual([dangerousNamespace]);
      expect(store.delete('token', { namespace: dangerousNamespace })).toBe(true);
    }
  );

  it.each(dangerousNames)(
    'setting a value in namespace "%s" does not pollute globalThis.Object or Object.prototype',
    (dangerousNamespace) => {
      const { store } = makeStore();

      store.set('token', 'sekret-value', { namespace: dangerousNamespace });

      // None of the real, process-wide values these dangerous names could
      // resolve to on Object.prototype's chain may have gained an own
      // "token" property as a side effect of this set() call:
      // - "constructor" -> the Object constructor function itself.
      // - "__proto__"    -> Object.prototype (affects every plain object).
      // - "toString"     -> Object.prototype.toString (the function).
      expect(Object.prototype.hasOwnProperty.call(Object, 'token')).toBe(false);
      expect(({} as Record<string, unknown>)['token']).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype.toString, 'token')).toBe(false);
    }
  );

  it('persists a round-tripped dangerous key/namespace combination across separate SecretStore instances', () => {
    const configDir = makeTempConfigDir();
    const writer = new SecretStore({ configDir });
    writer.set('__proto__', 'global-dangerous-value');
    writer.set('toString', 'ns-dangerous-value', { namespace: 'constructor' });

    const reader = new SecretStore({ configDir });
    expect(reader.get('__proto__')).toBe('global-dangerous-value');
    expect(reader.get('toString', { namespace: 'constructor' })).toBe('ns-dangerous-value');
    expect(reader.namespaces()).toEqual(['constructor']);
  });

  it('rotateMasterKey re-encrypts a value stored under a "__proto__" key without dropping it', () => {
    const { store } = makeStore();
    store.set('__proto__', 'sekret-value');
    store.set('token', 'ns-value', { namespace: '__proto__' });

    const count = store.rotateMasterKey();

    expect(count).toBe(2);
    expect(store.get('__proto__')).toBe('sekret-value');
    expect(store.get('token', { namespace: '__proto__' })).toBe('ns-value');
    expect(Object.prototype.hasOwnProperty.call(Object, 'token')).toBe(false);
    expect(({} as Record<string, unknown>)['token']).toBeUndefined();
  });
});

describe('deleteNamespace', () => {
  it('returns true and removes an existing namespace along with all its keys', () => {
    const { store } = makeStore();
    store.set('a', '1', { namespace: 'imap' });
    store.set('b', '2', { namespace: 'imap' });

    expect(store.deleteNamespace('imap')).toBe(true);
    expect(store.namespaces()).toEqual([]);
    expect(store.list({ namespace: 'imap' })).toEqual([]);
  });

  it('returns false when the namespace does not exist, without writing anything', () => {
    const { store } = makeStore();

    expect(store.deleteNamespace('never-created')).toBe(false);
    expect(store.namespaces()).toEqual([]);
  });

  it('does not affect the global namespace or other namespaces', () => {
    const { store } = makeStore();
    store.set('token', 'global-value');
    store.set('a', '1', { namespace: 'imap' });
    store.set('b', '2', { namespace: 'aws' });

    expect(store.deleteNamespace('imap')).toBe(true);
    expect(store.get('token')).toBe('global-value');
    expect(store.namespaces()).toEqual(['aws']);
  });

  it('does not fall for a "__proto__" namespace name (no prototype pollution false-positive)', () => {
    const { store } = makeStore();

    expect(store.deleteNamespace('__proto__')).toBe(false);
  });

  it('returns true and actually removes a "__proto__" namespace that was legitimately created', () => {
    const { store } = makeStore();
    store.set('token', 'value', { namespace: '__proto__' });

    expect(store.deleteNamespace('__proto__')).toBe(true);
    expect(store.namespaces()).toEqual([]);
    expect(store.has('token', { namespace: '__proto__' })).toBe(false);
  });

  it('persists the deletion so a fresh SecretStore instance no longer sees the namespace', () => {
    const configDir = makeTempConfigDir();
    const writer = new SecretStore({ configDir });
    writer.set('a', '1', { namespace: 'imap' });
    writer.deleteNamespace('imap');

    const reader = new SecretStore({ configDir });
    expect(reader.namespaces()).toEqual([]);
  });
});

describe('rotateMasterKey', () => {
  it('returns 0 and still rotates master.key for an empty store', () => {
    const { store, configDir } = makeStore();
    const keyPath = path.join(configDir, 'master.key');
    store.set('bootstrap', 'v'); // ensure master.key exists
    store.delete('bootstrap');
    const keyBefore = fs.readFileSync(keyPath);

    const count = store.rotateMasterKey();

    expect(count).toBe(0);
    expect(fs.readFileSync(keyPath).equals(keyBefore)).toBe(false);
  });

  it('re-encrypts every value in global and every namespace under a new key', () => {
    const { store } = makeStore();
    store.set('a', '1');
    store.set('b', '2');
    store.set('token', 'work-token', { namespace: 'work' });
    store.set('token', 'aws-token', { namespace: 'aws' });

    const count = store.rotateMasterKey();

    expect(count).toBe(4);
    expect(store.get('a')).toBe('1');
    expect(store.get('b')).toBe('2');
    expect(store.get('token', { namespace: 'work' })).toBe('work-token');
    expect(store.get('token', { namespace: 'aws' })).toBe('aws-token');
  });

  it('replaces master.key on disk so the old key no longer decrypts the values', () => {
    const { store, configDir } = makeStore();
    store.set('a', '1');
    const oldKey = fs.readFileSync(path.join(configDir, 'master.key'));

    store.rotateMasterKey();

    const newKey = fs.readFileSync(path.join(configDir, 'master.key'));
    expect(newKey.equals(oldKey)).toBe(false);
    const data = readStoreFile(configDir);
    const encryptedValue = data.global['a']!;
    expect(() => decrypt(encryptedValue, oldKey)).toThrow(CryptoError);
  });

  it('a fresh SecretStore instance can read values after rotation persisted to disk', () => {
    const configDir = makeTempConfigDir();
    const writer = new SecretStore({ configDir });
    writer.set('a', '1');
    writer.set('b', '2', { namespace: 'ns' });

    writer.rotateMasterKey();

    const reader = new SecretStore({ configDir });
    expect(reader.get('a')).toBe('1');
    expect(reader.get('b', { namespace: 'ns' })).toBe('2');
  });

  it('updates the instance-level master key cache so subsequent set/get use the new key', () => {
    const { store } = makeStore();
    store.set('a', '1');

    store.rotateMasterKey();
    store.set('c', '3');

    expect(store.get('a')).toBe('1');
    expect(store.get('c')).toBe('3');
  });

  it('removes master.key.bak after a successful rotation', () => {
    const { store, configDir } = makeStore();
    store.set('a', '1');

    store.rotateMasterKey();

    expect(fs.existsSync(path.join(configDir, 'master.key.bak'))).toBe(false);
  });

  it('is all-or-nothing: aborts without writing anything if a value fails to decrypt with the current key', () => {
    const { store, configDir } = makeStore();
    store.set('a', '1');
    store.set('b', '2');
    // Corrupt one value directly on disk so it can no longer be decrypted
    // with the store's cached master key.
    const data = readStoreFile(configDir);
    data.global['b'] = encrypt('2', Buffer.alloc(32, 9));
    writeStoreFile(configDir, data);
    const keyBefore = fs.readFileSync(path.join(configDir, 'master.key'));

    expect(() => store.rotateMasterKey()).toThrow(CryptoError);

    // Neither master.key nor secrets.json (nor a stray backup) were touched.
    expect(fs.readFileSync(path.join(configDir, 'master.key')).equals(keyBefore)).toBe(true);
    expect(fs.existsSync(path.join(configDir, 'master.key.bak'))).toBe(false);
    expect(store.get('a')).toBe('1');
  });
});
