import { describe, expect, it } from 'vitest';
import {
  CryptoError,
  deleteNamespace,
  deleteSecret,
  getSecret,
  hasSecret,
  listNamespaces,
  listSecrets,
  SecretNotFoundError,
  SecretStore,
  setSecret,
  StoreError,
  tryGetSecret,
  type SecretOpts,
  type SecretStoreOptions,
  type StoreData,
} from '../src/index.js';

describe('SecretStore', () => {
  it('is exported as a class (constructible)', () => {
    expect(typeof SecretStore).toBe('function');
  });

  it('can be instantiated via the index re-export, with an injected configDir so the real home directory is never touched', () => {
    // The constructor only resolves+stores configDir; it never reads or
    // writes anything on disk, so this path does not need to exist.
    const store = new SecretStore({ configDir: '/nonexistent/local-secret-index-test' });

    expect(store).toBeInstanceOf(SecretStore);
  });
});

describe('error classes', () => {
  it('re-exports CryptoError as an Error subclass', () => {
    const err = new CryptoError('boom');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(CryptoError);
  });

  it('re-exports SecretNotFoundError as an Error subclass', () => {
    const err = new SecretNotFoundError('boom');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(SecretNotFoundError);
  });

  it('re-exports StoreError as an Error subclass', () => {
    const err = new StoreError('boom');

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(StoreError);
  });
});

describe('default-instance sugar functions', () => {
  // Intentionally not invoked: these delegate to a default SecretStore with
  // no configDir injection point, so calling them would read/write under
  // the real ~/.config/local-secret. Reference-only (typeof) checks suffice
  // for this task's acceptance criteria ("index経由のエクスポートが全て参照できる").
  it.each([
    ['setSecret', setSecret],
    ['getSecret', getSecret],
    ['tryGetSecret', tryGetSecret],
    ['hasSecret', hasSecret],
    ['deleteSecret', deleteSecret],
    ['listSecrets', listSecrets],
    ['listNamespaces', listNamespaces],
    ['deleteNamespace', deleteNamespace],
  ])('%s is exported as a function', (_name, fn) => {
    expect(typeof fn).toBe('function');
  });
});

describe('type exports', () => {
  it('StoreData, SecretOpts, and SecretStoreOptions are usable as types', () => {
    // Compile-time check (via tsc during `pnpm build`) that these types are
    // importable from the index entry point; runtime assertions below
    // confirm the values conform to their declared shape.
    const storeData: StoreData = { version: 1, global: {}, namespaces: {} };
    const secretOpts: SecretOpts = { namespace: 'ns' };
    const secretStoreOptions: SecretStoreOptions = { configDir: '/nonexistent' };

    expect(storeData.version).toBe(1);
    expect(secretOpts.namespace).toBe('ns');
    expect(secretStoreOptions.configDir).toBe('/nonexistent');
  });
});
