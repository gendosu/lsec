import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { StoreError } from '../src/errors.js';
import { readStoreFile, writeStoreFile } from '../src/store-file.js';
import type { StoreData } from '../src/types.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-secret-store-file-test-'));
  createdDirs.push(dir);
  return dir;
}

function emptyStoreData(): StoreData {
  return { version: 1, global: {}, namespaces: {} };
}

function writeRawSecretsFile(configDir: string, content: string): void {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(configDir, 'secrets.json'), content, { mode: 0o600 });
}

describe('readStoreFile', () => {
  it('returns an empty structure when secrets.json does not exist', () => {
    const configDir = makeTempConfigDir();
    const data = readStoreFile(configDir);

    expect(data).toEqual(emptyStoreData());
    // `toEqual` ignores the prototype, so it alone would still pass if
    // `global`/`namespaces` regressed back to plain `{}`-literals; assert
    // the null-prototype invariant explicitly.
    expect(Object.getPrototypeOf(data.global)).toBeNull();
    expect(Object.getPrototypeOf(data.namespaces)).toBeNull();
  });

  it('returns an empty structure when configDir itself does not exist', () => {
    const parent = makeTempConfigDir();
    const configDir = path.join(parent, 'missing-config-dir');
    expect(fs.existsSync(configDir)).toBe(false);

    const data = readStoreFile(configDir);

    expect(data).toEqual(emptyStoreData());
    expect(Object.getPrototypeOf(data.global)).toBeNull();
    expect(Object.getPrototypeOf(data.namespaces)).toBeNull();
  });

  it('reads back data previously written by writeStoreFile', () => {
    const configDir = makeTempConfigDir();
    const data: StoreData = {
      version: 1,
      global: { apiKey: 'enc-a' },
      namespaces: { work: { token: 'enc-b' } },
    };

    writeStoreFile(configDir, data);

    expect(readStoreFile(configDir)).toEqual(data);
  });

  it('throws StoreError when secrets.json contains invalid JSON', () => {
    const configDir = makeTempConfigDir();
    writeRawSecretsFile(configDir, '{ not valid json');

    expect(() => readStoreFile(configDir)).toThrow(StoreError);
  });

  it('throws StoreError when the top-level value is not an object', () => {
    const configDir = makeTempConfigDir();
    writeRawSecretsFile(configDir, JSON.stringify([1, 2, 3]));

    expect(() => readStoreFile(configDir)).toThrow(StoreError);
  });

  it('throws StoreError when "version" is missing or not 1', () => {
    const configDir = makeTempConfigDir();
    writeRawSecretsFile(configDir, JSON.stringify({ version: 2, global: {}, namespaces: {} }));

    expect(() => readStoreFile(configDir)).toThrow(StoreError);
  });

  it('throws StoreError when "global" is not an object of string values', () => {
    const configDir = makeTempConfigDir();
    writeRawSecretsFile(
      configDir,
      JSON.stringify({ version: 1, global: { apiKey: 123 }, namespaces: {} })
    );

    expect(() => readStoreFile(configDir)).toThrow(StoreError);
  });

  it('throws StoreError when "namespaces" is not an object of objects of string values', () => {
    const configDir = makeTempConfigDir();
    writeRawSecretsFile(
      configDir,
      JSON.stringify({ version: 1, global: {}, namespaces: { work: 'not-an-object' } })
    );

    expect(() => readStoreFile(configDir)).toThrow(StoreError);
  });

  it('throws StoreError when "namespaces" is missing entirely', () => {
    const configDir = makeTempConfigDir();
    writeRawSecretsFile(configDir, JSON.stringify({ version: 1, global: {} }));

    expect(() => readStoreFile(configDir)).toThrow(StoreError);
  });

  it('loads own "__proto__" / "constructor" keys in global and namespaces as plain data, without polluting Object.prototype', () => {
    const configDir = makeTempConfigDir();
    // Written as raw JSON text (not a JS object literal) so the "__proto__"
    // keys below become real own properties after JSON.parse, matching how
    // an attacker- or user-crafted secrets.json would actually look on disk.
    const rawJson =
      '{"version":1,' +
      '"global":{"__proto__":"global-secret","constructor":"ctor-secret"},' +
      '"namespaces":{"__proto__":{"toString":"ns-secret"},"constructor":{"a":"1"}}}';
    writeRawSecretsFile(configDir, rawJson);

    const data = readStoreFile(configDir);

    expect(data.global['__proto__']).toBe('global-secret');
    expect(data.global['constructor']).toBe('ctor-secret');
    expect(data.namespaces['__proto__']?.['toString']).toBe('ns-secret');
    expect(data.namespaces['constructor']?.['a']).toBe('1');

    // Every container reachable from the loaded StoreData must be
    // null-prototype, so none of the above own-property reads could have
    // come from Object.prototype instead of the file's actual content.
    expect(Object.getPrototypeOf(data.global)).toBeNull();
    expect(Object.getPrototypeOf(data.namespaces)).toBeNull();
    expect(Object.getPrototypeOf(data.namespaces['__proto__'])).toBeNull();
    expect(Object.getPrototypeOf(data.namespaces['constructor'])).toBeNull();

    // Loading this file must not have touched the real Object.prototype.
    expect(({} as Record<string, unknown>)['toString']).toBe(Object.prototype.toString);

    // Round-trips unchanged through a write + re-read cycle.
    writeStoreFile(configDir, data);
    const reloaded = readStoreFile(configDir);
    expect(reloaded.global['__proto__']).toBe('global-secret');
    expect(reloaded.namespaces['__proto__']?.['toString']).toBe('ns-secret');
  });
});

describe('writeStoreFile', () => {
  it('creates configDir if it does not exist yet', () => {
    const parent = makeTempConfigDir();
    const configDir = path.join(parent, 'nested-config');
    expect(fs.existsSync(configDir)).toBe(false);

    writeStoreFile(configDir, emptyStoreData());

    expect(fs.existsSync(configDir)).toBe(true);
  });

  it('writes secrets.json with mode 0o600', () => {
    const configDir = makeTempConfigDir();

    writeStoreFile(configDir, emptyStoreData());

    const mode = fs.statSync(path.join(configDir, 'secrets.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('does not leave a .tmp file behind after a successful write', () => {
    const configDir = makeTempConfigDir();

    writeStoreFile(configDir, emptyStoreData());

    const entries = fs.readdirSync(configDir);
    expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('overwrites previous content atomically on repeated writes', () => {
    const configDir = makeTempConfigDir();

    writeStoreFile(configDir, { version: 1, global: { a: '1' }, namespaces: {} });
    writeStoreFile(configDir, { version: 1, global: { b: '2' }, namespaces: {} });

    expect(readStoreFile(configDir)).toEqual({ version: 1, global: { b: '2' }, namespaces: {} });
    const entries = fs.readdirSync(configDir);
    expect(entries.some((name) => name.endsWith('.tmp'))).toBe(false);
  });

  it('forces mode 0o600 even when a stale .tmp file with different permissions is left over', () => {
    const configDir = makeTempConfigDir();
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(configDir, 'secrets.json.tmp'), '{}', { mode: 0o644 });

    writeStoreFile(configDir, emptyStoreData());

    const mode = fs.statSync(path.join(configDir, 'secrets.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('removes a stale .tmp file before writing so its content is never carried over', () => {
    const configDir = makeTempConfigDir();
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    // Simulate a leftover .tmp file from a previous crashed write, with
    // unrelated stale content and looser permissions.
    fs.writeFileSync(
      path.join(configDir, 'secrets.json.tmp'),
      JSON.stringify({ version: 1, global: { stale: 'leftover' }, namespaces: {} }),
      { mode: 0o644 }
    );

    writeStoreFile(configDir, { version: 1, global: { fresh: 'value' }, namespaces: {} });

    expect(readStoreFile(configDir)).toEqual({ version: 1, global: { fresh: 'value' }, namespaces: {} });
    const mode = fs.statSync(path.join(configDir, 'secrets.json')).mode & 0o777;
    expect(mode).toBe(0o600);
  });
});
