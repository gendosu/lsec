/**
 * High-level SecretStore API for local-secret.
 *
 * See design spec §3 (アーキテクチャ) and §5 (ライブラリ API - SecretStore クラス):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 *
 * Dependency direction: secret-store -> (crypto + store-file) -> paths.
 * This module composes crypto.ts (encrypt/decrypt/master key) and
 * store-file.ts (secrets.json read/write) into the public SecretStore class;
 * it does not touch node:fs/node:crypto directly.
 */
import {
  backupMasterKey,
  decrypt,
  encrypt,
  generateMasterKey,
  loadOrCreateMasterKey,
  removeMasterKeyBackup,
  writeMasterKeyAtomic,
} from './crypto.js';
import type { CryptoError } from './errors.js';
import { SecretNotFoundError, StoreError } from './errors.js';
import { resolveConfigDir, type ResolveConfigDirOptions } from './paths.js';
import { readStoreFile, writeStoreFile } from './store-file.js';
import type { StoreData } from './types.js';

/** Options accepted by {@link SecretStore}'s constructor. */
export type SecretStoreOptions = ResolveConfigDirOptions;

/** Options accepted by the per-key {@link SecretStore} methods. */
export interface SecretOpts {
  /** Namespace to operate on. Omitted (or falsy) means the `global` namespace. */
  namespace?: string;
}

/**
 * High-level API for storing and retrieving secrets, encrypted at rest.
 *
 * `namespace` is omitted on every method except the constructor and
 * {@link SecretStore.namespaces}; when omitted, the `global` namespace is
 * used (see design spec §5).
 */
export class SecretStore {
  private readonly configDir: string;
  private masterKey: Buffer | undefined;

  constructor(options?: SecretStoreOptions) {
    this.configDir = resolveConfigDir(options);
  }

  /**
   * Lazily loads (or creates, on first use) the master key for this
   * instance's `configDir`, caching it for the lifetime of the instance.
   */
  private getMasterKey(): Buffer {
    if (!this.masterKey) {
      this.masterKey = loadOrCreateMasterKey(this.configDir);
    }
    return this.masterKey;
  }

  /**
   * Returns the container (a key -> encrypted-value map) that `namespace`
   * refers to, or `undefined` if that namespace does not exist yet.
   * Omitting `namespace` refers to the `global` container, which always
   * exists.
   *
   * Safe against prototype-chain lookups (e.g. `namespace` being
   * `"constructor"` or `"__proto__"`) only because `readStoreFile` (see
   * store-file.ts) guarantees `data.global` and `data.namespaces` are
   * null-prototype objects — a plain bracket index into them can never
   * resolve to anything on `Object.prototype`. Do not reassign
   * `data.namespaces[namespace]` to a plain `{}`-literal container anywhere
   * (see `set` below) or that guarantee breaks for that namespace.
   */
  private getContainer(data: StoreData, namespace?: string): Record<string, string> | undefined {
    return namespace ? data.namespaces[namespace] : data.global;
  }

  /** Encrypts `value` and stores it under `key`, overwriting any previous value. */
  set(key: string, value: string, opts?: SecretOpts): void {
    const data = readStoreFile(this.configDir);
    const encrypted = encrypt(value, this.getMasterKey());
    const namespace = opts?.namespace;
    if (!namespace) {
      data.global[key] = encrypted;
    } else {
      // Must be null-prototype (not a `{}` literal): a plain object's
      // inherited `__proto__` setter would silently swallow `key ===
      // "__proto__"` (a string value assigned to it is a no-op), and
      // `getContainer`'s safety guarantee above depends on every container
      // reachable from `data.namespaces` being null-prototype.
      const container = data.namespaces[namespace] ?? (Object.create(null) as Record<string, string>);
      container[key] = encrypted;
      data.namespaces[namespace] = container;
    }
    writeStoreFile(this.configDir, data);
  }

  /** Returns the decrypted value stored under `key`. Throws {@link SecretNotFoundError} if it is not registered. */
  get(key: string, opts?: SecretOpts): string {
    const value = this.tryGet(key, opts);
    if (value === undefined) {
      const namespace = opts?.namespace;
      const location = namespace ? `namespace "${namespace}"` : 'the global namespace';
      throw new SecretNotFoundError(`Secret "${key}" was not found in ${location}.`);
    }
    return value;
  }

  /** Like {@link SecretStore.get}, but returns `undefined` instead of throwing when `key` is not registered. */
  tryGet(key: string, opts?: SecretOpts): string | undefined {
    const data = readStoreFile(this.configDir);
    const encrypted = this.getContainer(data, opts?.namespace)?.[key];
    if (encrypted === undefined) {
      return undefined;
    }
    return decrypt(encrypted, this.getMasterKey());
  }

  /** Returns whether `key` is registered. */
  has(key: string, opts?: SecretOpts): boolean {
    const data = readStoreFile(this.configDir);
    return this.getContainer(data, opts?.namespace)?.[key] !== undefined;
  }

  /** Removes `key` if it is registered, returning whether it was removed. */
  delete(key: string, opts?: SecretOpts): boolean {
    const data = readStoreFile(this.configDir);
    const container = this.getContainer(data, opts?.namespace);
    if (container?.[key] === undefined) {
      return false;
    }
    delete container[key];
    writeStoreFile(this.configDir, data);
    return true;
  }

  /** Returns the registered key names in the given namespace (or `global` if omitted). */
  list(opts?: SecretOpts): string[] {
    const data = readStoreFile(this.configDir);
    const container = this.getContainer(data, opts?.namespace);
    return container ? Object.keys(container) : [];
  }

  /** Returns the names of all namespaces that have been used at least once. */
  namespaces(): string[] {
    const data = readStoreFile(this.configDir);
    return Object.keys(data.namespaces);
  }

  /**
   * Removes an entire namespace (and every key stored in it), returning
   * whether it existed. Does not affect the `global` namespace; there is no
   * way to bulk-delete `global` through this method.
   */
  deleteNamespace(namespace: string): boolean {
    const data = readStoreFile(this.configDir);
    if (!Object.prototype.hasOwnProperty.call(data.namespaces, namespace)) {
      return false;
    }
    delete data.namespaces[namespace];
    writeStoreFile(this.configDir, data);
    return true;
  }

  /**
   * Generates a new master key, re-encrypts every stored value under it, and
   * atomically replaces master.key with the new key. Returns the number of
   * values that were re-encrypted.
   *
   * All-or-nothing: every value is decrypted with the current key and
   * re-encrypted with the new key entirely in memory first. If any value
   * fails to decrypt, the {@link CryptoError} propagates and nothing on disk
   * is touched.
   *
   * Write order (crash resilience): the current master.key is first copied
   * to `master.key.bak`, then the new key atomically replaces master.key,
   * then the re-encrypted secrets.json is atomically written, then
   * master.key.bak is removed. A crash between the second and third steps
   * leaves master.key.bak holding the key that still decrypts the on-disk
   * secrets.json — restore it over master.key to recover.
   */
  rotateMasterKey(): number {
    const data = readStoreFile(this.configDir);
    const currentKey = this.getMasterKey();
    const newKey = generateMasterKey();

    let reencryptedCount = 0;
    // Both accumulators must be null-prototype for the same reason `set`'s
    // new-container path is (see its comment above): a plain `{}` here
    // would silently drop a `key === "__proto__"` entry (string values
    // assigned to `__proto__` are a no-op) or a `namespace === "__proto__"`
    // entry (an object value assigned to `__proto__` replaces the
    // accumulator's actual prototype instead of becoming an own,
    // JSON-serializable property) when re-encrypting.
    const reencryptContainer = (container: Record<string, string>): Record<string, string> => {
      const reencrypted = Object.create(null) as Record<string, string>;
      for (const [key, encrypted] of Object.entries(container)) {
        reencrypted[key] = encrypt(decrypt(encrypted, currentKey), newKey);
        reencryptedCount++;
      }
      return reencrypted;
    };

    const newGlobal = reencryptContainer(data.global);
    const newNamespaces = Object.create(null) as Record<string, Record<string, string>>;
    for (const [namespace, container] of Object.entries(data.namespaces)) {
      newNamespaces[namespace] = reencryptContainer(container);
    }
    const newData: StoreData = { version: 1, global: newGlobal, namespaces: newNamespaces };

    const backupPath = backupMasterKey(this.configDir);
    writeMasterKeyAtomic(this.configDir, newKey);
    try {
      writeStoreFile(this.configDir, newData);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new StoreError(
        `master.key was rotated but secrets.json could not be re-encrypted (${msg}). ` +
          `The previous key was preserved at ${backupPath}; restore it to master.key to recover access to the existing secrets.json, then retry rotate-key.`
      );
    }
    removeMasterKeyBackup(this.configDir);

    this.masterKey = newKey;
    return reencryptedCount;
  }
}
