import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CryptoError,
  deleteNamespace,
  deleteSecret,
  getSecret,
  hasSecret,
  listNamespaces,
  listSecrets,
  rotateMasterKey,
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
  it.each([
    ['setSecret', setSecret],
    ['getSecret', getSecret],
    ['tryGetSecret', tryGetSecret],
    ['hasSecret', hasSecret],
    ['deleteSecret', deleteSecret],
    ['listSecrets', listSecrets],
    ['listNamespaces', listNamespaces],
    ['deleteNamespace', deleteNamespace],
    ['rotateMasterKey', rotateMasterKey],
  ])('%s is exported as a function', (_name, fn) => {
    expect(typeof fn).toBe('function');
  });
});

describe('default instance after external rotation', () => {
  let configDir: string;

  beforeEach(() => {
    configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-secret-index-test-'));
    vi.resetModules();
    vi.doMock('../src/paths.js', async (importOriginal) => {
      const paths = await importOriginal<typeof import('../src/paths.js')>();
      return {
        ...paths,
        resolveConfigDir: (options?: SecretStoreOptions) => options?.configDir ?? configDir,
      };
    });
  });

  afterEach(() => {
    vi.doUnmock('../src/paths.js');
    vi.resetModules();
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it.each(['getSecret', 'tryGetSecret', 'setSecret', 'rotateMasterKey'] as const)(
    '%s as the first operation follows a rotation by another instance',
    async (firstOperation) => {
      const api = await import('../src/index.js');
      expect(fs.readdirSync(configDir)).toEqual([]);
      api.setSecret('original', 'original-value');
      api.setSecret('token', 'work-value', { namespace: 'work' });
      const other = new api.SecretStore({ configDir });
      expect(other.rotateMasterKey()).toBe(2);

      switch (firstOperation) {
        case 'getSecret':
        case 'tryGetSecret':
          expect(api[firstOperation]('original')).toBe('original-value');
          break;
        case 'setSecret':
          api.setSecret('later', 'later-value');
          break;
        case 'rotateMasterKey':
          expect(api.rotateMasterKey()).toBe(2);
          break;
      }

      expect(api.getSecret('original')).toBe('original-value');
      expect(api.tryGetSecret('token', { namespace: 'work' })).toBe('work-value');
      api.setSecret('later', 'later-value');
      api.setSecret('token', 'updated-work-value', { namespace: 'work' });
      expect(api.rotateMasterKey()).toBe(3);
      const reader = new api.SecretStore({ configDir });
      expect(reader.get('original')).toBe('original-value');
      expect(reader.get('later')).toBe('later-value');
      expect(reader.get('token', { namespace: 'work' })).toBe('updated-work-value');
      expect(fs.existsSync(path.join(configDir, 'master.key.bak'))).toBe(false);
    }
  );
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
