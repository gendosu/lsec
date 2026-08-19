/**
 * Public entry point for local-secret.
 *
 * See design spec §3 (モジュール構成) and §5 (ライブラリ API - 既定インスタンスの
 * 関数糖衣): docs/superpowers/specs/2026-06-30-local-secret-design.html
 *
 * This module re-exports the library's public surface:
 * - {@link SecretStore} (the class-based API) and its option types.
 * - {@link StoreData} (the persisted-storage shape).
 * - The custom error classes ({@link CryptoError}, {@link SecretNotFoundError},
 *   {@link StoreError}).
 *
 * It also exposes a small set of "sugar" functions (`setSecret`, `getSecret`,
 * `tryGetSecret`, `hasSecret`, `deleteSecret`, `listSecrets`,
 * `listNamespaces`, `deleteNamespace`, `rotateMasterKey`) that delegate to a
 * lazily-created default {@link SecretStore} instance, for callers who don't
 * need a custom `configDir` and would rather not manage an instance
 * themselves.
 *
 * Finally, it re-exports the pure-logic building blocks behind `lsec run`
 * (the CLI's `op run`-equivalent secret injection command): reference
 * parsing (`isSecretRef` / `parseSecretRef`), the minimal `.env` parser
 * (`parseEnvFile`), and the env-map resolver (`resolveEnv`). src/cli.ts only
 * imports this module and ./prompt.js (never secret-store.ts / crypto.ts /
 * store-file.ts / paths.ts / secret-ref.ts / env-file.ts / run-env.ts
 * directly), so these are re-exported here for that command to use.
 */
import { SecretStore, type SecretOpts, type SecretStoreOptions } from './secret-store.js';

export { SecretStore };
export type { SecretOpts, SecretStoreOptions };
export type { StoreData } from './types.js';
export { CryptoError, SecretNotFoundError, StoreError } from './errors.js';
export { formatSecretRef, isSecretRef, parseSecretRef } from './secret-ref.js';
export type { SecretRef } from './secret-ref.js';
export { parseEnvFile } from './env-file.js';
export type { EnvFileEntry } from './env-file.js';
export { resolveEnv } from './run-env.js';
export type { ResolveEnvOptions } from './run-env.js';

/**
 * Lazily-created default {@link SecretStore} instance backing the sugar
 * functions below. Created on first use (not on module import), so merely
 * importing this module never touches the filesystem or reads/creates
 * `master.key` (design spec §5, "遅延生成"). Uses the default `configDir`
 * (`~/.config/local-secret`); there is no way to inject a custom `configDir`
 * through these functions — construct a {@link SecretStore} directly if you
 * need that.
 */
let defaultStore: SecretStore | undefined;

function getDefaultStore(): SecretStore {
  return (defaultStore ??= new SecretStore());
}

/**
 * Encrypts `value` and stores it under `key` in the default SecretStore
 * instance, overwriting any previous value. Delegates to
 * {@link SecretStore.set}.
 */
export function setSecret(key: string, value: string, opts?: SecretOpts): void {
  getDefaultStore().set(key, value, opts);
}

/**
 * Returns the decrypted value stored under `key` in the default SecretStore
 * instance. Throws {@link SecretNotFoundError} if it is not registered.
 * Delegates to {@link SecretStore.get}.
 */
export function getSecret(key: string, opts?: SecretOpts): string {
  return getDefaultStore().get(key, opts);
}

/**
 * Like {@link getSecret}, but returns `undefined` instead of throwing when
 * `key` is not registered. Delegates to {@link SecretStore.tryGet}.
 */
export function tryGetSecret(key: string, opts?: SecretOpts): string | undefined {
  return getDefaultStore().tryGet(key, opts);
}

/**
 * Returns whether `key` is registered in the default SecretStore instance.
 * Delegates to {@link SecretStore.has}.
 */
export function hasSecret(key: string, opts?: SecretOpts): boolean {
  return getDefaultStore().has(key, opts);
}

/**
 * Removes `key` from the default SecretStore instance if it is registered,
 * returning whether it was removed. Delegates to {@link SecretStore.delete}.
 */
export function deleteSecret(key: string, opts?: SecretOpts): boolean {
  return getDefaultStore().delete(key, opts);
}

/**
 * Returns the registered key names in the default SecretStore instance for
 * the given namespace (or `global` if omitted). Delegates to
 * {@link SecretStore.list}.
 */
export function listSecrets(opts?: SecretOpts): string[] {
  return getDefaultStore().list(opts);
}

/**
 * Returns the names of all namespaces that have been used at least once in
 * the default SecretStore instance. Delegates to {@link SecretStore.namespaces}.
 */
export function listNamespaces(): string[] {
  return getDefaultStore().namespaces();
}

/**
 * Removes namespace `namespace` (and every key stored in it) from the
 * default SecretStore instance, returning whether it existed. Delegates to
 * {@link SecretStore.deleteNamespace}.
 */
export function deleteNamespace(namespace: string): boolean {
  return getDefaultStore().deleteNamespace(namespace);
}

/**
 * Rotates the master key of the default SecretStore instance, re-encrypting
 * every stored value under a newly generated key. Returns the number of
 * values that were re-encrypted. Delegates to {@link
 * SecretStore.rotateMasterKey}.
 */
export function rotateMasterKey(): number {
  return getDefaultStore().rotateMasterKey();
}
