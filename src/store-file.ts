/**
 * Atomic read/write of secrets.json for local-secret.
 *
 * See design spec §4 (ストレージ仕様) and §7 (エラー処理):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 *
 * Mirrors the pattern used by local-secret's src/lib/config.ts:
 * - readRawConfig (config.ts:45-73): existence check -> readFileSync ->
 *   JSON.parse in a try/catch -> shape validation, all raised as a single
 *   domain error type.
 * - writeConfig (config.ts:289-293): atomic write via a `.tmp` file + rename,
 *   with mode 0o600.
 *
 * store-file.ts only handles plaintext JSON persistence of the StoreData
 * shape; encrypting/decrypting secret values is the responsibility of
 * src/crypto.ts. configDir resolution is the responsibility of src/paths.ts,
 * which is deliberately NOT imported here — this module takes `configDir` as
 * a plain argument and depends only on node:fs, node:path, and src/errors.ts.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { StoreError } from './errors.js';
import type { StoreData } from './types.js';

const STORE_FILE_NAME = 'secrets.json';

/**
 * Returns a null-prototype ({@link Object.create}(null)) shallow copy of
 * `source`'s own enumerable properties.
 *
 * `global`, `namespaces`, and each per-namespace container are
 * `Record<string, string>`-shaped maps that get bracket-indexed with
 * untrusted key/namespace names (see secret-store.ts's `getContainer` /
 * `set`). An ordinary `{}`-based object inherits from `Object.prototype`, so
 * indexing it with `"constructor"`, `"toString"`, or `"__proto__"` resolves
 * to (or, for `__proto__`, is intercepted by a setter instead of creating)
 * a value on the prototype chain rather than behaving like a missing own
 * key. Stripping the prototype here means every such container has no
 * inherited properties at all, so indexing it with *any* string key is
 * always either `undefined` or a real own value that was legitimately
 * stored — no `hasOwnProperty` guard needed at each call site.
 */
function toNullPrototypeRecord<T>(source: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, source);
}

function emptyStoreData(): StoreData {
  return {
    version: 1,
    global: Object.create(null) as Record<string, string>,
    namespaces: Object.create(null) as Record<string, Record<string, string>>,
  };
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => typeof v === 'string');
}

function isNamespaceMap(value: unknown): value is Record<string, Record<string, string>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every((v) => isStringRecord(v));
}

/**
 * Validates that `parsed` has the shape of {@link StoreData}
 * (`{ version: 1, global: Record<string,string>, namespaces: Record<string,Record<string,string>> }`),
 * throwing {@link StoreError} if it does not.
 */
function validateStoreData(parsed: unknown, secretsPath: string): StoreData {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new StoreError(`secrets.json at ${secretsPath} has an invalid format (expected an object).`);
  }
  const obj = parsed as Record<string, unknown>;

  if (obj['version'] !== 1) {
    throw new StoreError(`secrets.json at ${secretsPath} has a missing or unsupported "version" (expected 1).`);
  }
  if (!isStringRecord(obj['global'])) {
    throw new StoreError(
      `secrets.json at ${secretsPath} has an invalid "global" field (expected an object of string values).`
    );
  }
  if (!isNamespaceMap(obj['namespaces'])) {
    throw new StoreError(
      `secrets.json at ${secretsPath} has an invalid "namespaces" field (expected an object of objects of string values).`
    );
  }

  // Convert `global` and every container in `namespaces` (including
  // `namespaces` itself) to null-prototype objects, so no key or namespace
  // name coming from this on-disk (attacker- or user-controllable) JSON —
  // e.g. "constructor", "toString", "__proto__" — can resolve to a value on
  // Object.prototype instead of behaving like a missing key. See
  // toNullPrototypeRecord's doc comment for why this makes every downstream
  // bracket access on these objects safe by construction.
  const namespaces = toNullPrototypeRecord(obj['namespaces'] as Record<string, Record<string, string>>);
  for (const namespace of Object.keys(namespaces)) {
    namespaces[namespace] = toNullPrototypeRecord(namespaces[namespace]);
  }

  return {
    version: 1,
    global: toNullPrototypeRecord(obj['global'] as Record<string, string>),
    namespaces,
  };
}

/**
 * Reads and parses `<configDir>/secrets.json`.
 *
 * - Returns an empty structure (`{ version: 1, global, namespaces }`, with
 *   `global`/`namespaces` null-prototype — see {@link toNullPrototypeRecord})
 *   if the file (or `configDir` itself) does not exist.
 * - Throws {@link StoreError} if the file cannot be read, contains invalid
 *   JSON, or does not match the {@link StoreData} shape.
 */
export function readStoreFile(configDir: string): StoreData {
  const secretsPath = path.join(configDir, STORE_FILE_NAME);
  if (!fs.existsSync(secretsPath)) {
    return emptyStoreData();
  }

  let fileContent: string;
  try {
    fileContent = fs.readFileSync(secretsPath, 'utf-8');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new StoreError(`Failed to read secrets.json at ${secretsPath}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch {
    throw new StoreError(`secrets.json at ${secretsPath} contains invalid JSON.`);
  }

  return validateStoreData(parsed, secretsPath);
}

/**
 * Atomically writes `data` to `<configDir>/secrets.json`.
 *
 * Creates `configDir` (mode 0o700) if it does not exist yet, writes to a
 * `<secretsPath>.tmp` file with mode 0o600, then renames it over the target
 * path so readers never observe a partially written file.
 *
 * Any pre-existing `.tmp` file is removed before writing the new one.
 * `writeFileSync`'s `mode` option is only honored by the OS when it creates
 * the file (POSIX `open(O_CREAT, mode)`); if a stale `.tmp` file with looser
 * permissions were left over from a previous failed write and reused as-is,
 * its permissions would not be reset by `mode` alone, leaving a transient
 * window where the plaintext secrets JSON is more widely readable than
 * 0o600. Removing it first guarantees every `.tmp` file is newly created, so
 * its permissions are exactly 0o600 from the first byte written, with no
 * such window. `chmodSync` is applied afterwards as well, as a defense in
 * depth measure.
 *
 * Throws {@link StoreError} if the write or rename fails; on failure, any
 * `.tmp` file that was created is removed on a best-effort basis.
 */
export function writeStoreFile(configDir: string, data: StoreData): void {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });

  const secretsPath = path.join(configDir, STORE_FILE_NAME);
  const tmpPath = `${secretsPath}.tmp`;

  try {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // ignore: tmpPath did not exist (the common case)
    }
    fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.chmodSync(tmpPath, 0o600);
    fs.renameSync(tmpPath, secretsPath);
  } catch (err: unknown) {
    try {
      fs.unlinkSync(tmpPath);
    } catch {
      // best-effort cleanup; ignore failures (e.g. tmpPath was never created)
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new StoreError(`Failed to write secrets.json at ${secretsPath}: ${msg}`);
  }
}
