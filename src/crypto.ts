/**
 * Encryption/decryption and master key management for local-secret.
 *
 * See design spec §4 (ストレージ仕様 - 暗号フォーマット) and §7 (エラー処理):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 *
 * Ported from local-secret's src/lib/credentials.ts (loadOrCreateMasterKey /
 * encryptPassword / decryptPassword). The master key path and the AES key
 * used for encrypt/decrypt are injected as parameters here (instead of a
 * fixed module-level path and an implicit internal key load) so this module
 * stays a pure function library and is trivially testable with an isolated
 * configDir.
 */
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CryptoError, StoreError } from './errors.js';
import { ensureConfigDir } from './paths.js';
import { writeFileAtomic } from './atomic-file.js';

/** AES-256 key size in bytes. */
export const KEY_BYTES = 32;
/** GCM standard IV size in bytes. */
export const IV_BYTES = 12;
/** GCM authentication tag size in bytes. */
export const TAG_BYTES = 16;

const MASTER_KEY_FILE_NAME = 'master.key';
const MASTER_KEY_BACKUP_FILE_NAME = 'master.key.bak';

/** A backup path of any kind requires recovery, including a dangling symlink. */
export function hasMasterKeyBackup(configDir: string): boolean {
  const backupPath = path.join(configDir, MASTER_KEY_BACKUP_FILE_NAME);
  try {
    fs.lstatSync(backupPath);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw new StoreError(`Cannot check rotation recovery backup at ${backupPath}.`, { cause });
  }
}

/** Prevents updates until the preserved key/data have been verified manually. */
export function assertNoMasterKeyBackup(configDir: string): void {
  if (hasMasterKeyBackup(configDir)) {
    throw new StoreError(
      `Rotation recovery required at ${configDir}: master.key.bak exists. ` +
      'Updates are blocked. Preserve master.key, secrets.json and master.key.bak; ' +
      'verify every value with the matching key before removing the backup (see README recovery steps).'
    );
  }
}

function loadMasterKey(configDir: string): Buffer {
  const keyPath = path.join(configDir, MASTER_KEY_FILE_NAME);
  const key = fs.readFileSync(keyPath);
  if (key.length !== KEY_BYTES) {
    throw new CryptoError(
      `master.key at ${keyPath} is corrupt (expected ${KEY_BYTES} bytes, got ${key.length}).`
    );
  }
  return key;
}

/**
 * Loads the master key from `<configDir>/master.key`, generating and
 * persisting a new one if it does not exist yet.
 *
 * - If the file exists but its size is not exactly {@link KEY_BYTES}, the key
 *   is considered corrupt and a {@link CryptoError} is thrown.
 * - Otherwise, if the file does not exist, `configDir` is created (mode
 *   0o700) if necessary, a new `crypto.randomBytes(KEY_BYTES)` key is
 *   generated and written to `master.key` with mode 0o600.
 */
export function loadOrCreateMasterKey(configDir: string): Buffer {
  const keyPath = path.join(configDir, 'master.key');
  if (fs.existsSync(keyPath)) {
    return loadMasterKey(configDir);
  }
  assertNoMasterKeyBackup(configDir);
  ensureConfigDir(configDir);
  const key = crypto.randomBytes(KEY_BYTES);
  writeMasterKeyAtomic(configDir, key);
  return key;
}

/**
 * Encrypts `plain` with AES-256-GCM using a fresh random IV on every call
 * (so encrypting the same value twice yields different output).
 *
 * Returns `base64(iv[12] | authTag[16] | ciphertext)`.
 */
export function encrypt(plain: string, key: Buffer): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, ciphertext]).toString('base64');
}

/**
 * Decrypts a value produced by {@link encrypt}.
 *
 * Throws {@link CryptoError} if the encoded value is too short to contain an
 * iv + authTag (invalid base64 or truncated data), or if decryption fails
 * (tampered ciphertext or a mismatched key).
 */
export function decrypt(enc: string, key: Buffer): string {
  // Buffer.from with 'base64' never throws — invalid chars are silently ignored.
  const raw = Buffer.from(enc, 'base64');
  if (raw.length < IV_BYTES + TAG_BYTES) {
    throw new CryptoError('enc is too short or corrupt (invalid base64 or truncated data).');
  }
  const iv = raw.subarray(0, IV_BYTES);
  const tag = raw.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + TAG_BYTES);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8');
  } catch {
    throw new CryptoError('Failed to decrypt value (tampered data or wrong master.key).');
  }
}

/** Generates a fresh random master key of {@link KEY_BYTES} length, for use with {@link writeMasterKeyAtomic}. */
export function generateMasterKey(): Buffer {
  return crypto.randomBytes(KEY_BYTES);
}

/**
 * Publishes a complete key by private, exclusive temporary-file creation
 * and rename, both on first creation and replacement. The caller holds
 * the store lock across key selection and the corresponding data operation.
 */
export function writeMasterKeyAtomic(configDir: string, key: Buffer): void {
  writeFileAtomic(path.join(configDir, MASTER_KEY_FILE_NAME), key);
}

/**
 * Exclusively creates `master.key.bak` from the valid current key, so the
 * pre-rotation key can be recovered if a crash occurs between {@link
 * writeMasterKeyAtomic} replacing master.key and secrets.json being
 * re-encrypted under the new key. Returns the backup's path.
 */
export function backupMasterKey(configDir: string): string {
  const key = loadMasterKey(configDir);
  const backupPath = path.join(configDir, MASTER_KEY_BACKUP_FILE_NAME);
  const fd = fs.openSync(backupPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, key);
    fs.fchmodSync(fd, 0o600);
  } finally {
    // Keep even a partial backup: the unchanged current key remains valid,
    // and removing a path here could discard recovery evidence.
    fs.closeSync(fd);
  }
  return backupPath;
}

/**
 * Removes `<configDir>/master.key.bak` if present. Only ENOENT is ignored;
 * other failures must leave the store in recovery mode.
 */
export function removeMasterKeyBackup(configDir: string): void {
  const backupPath = path.join(configDir, MASTER_KEY_BACKUP_FILE_NAME);
  try {
    fs.unlinkSync(backupPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }
}
