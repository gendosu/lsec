import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CryptoError } from '../src/errors.js';
import {
  IV_BYTES,
  KEY_BYTES,
  TAG_BYTES,
  backupMasterKey,
  decrypt,
  encrypt,
  generateMasterKey,
  loadOrCreateMasterKey,
  removeMasterKeyBackup,
  writeMasterKeyAtomic,
} from '../src/crypto.js';

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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-secret-crypto-test-'));
  createdDirs.push(dir);
  return dir;
}

describe('constants', () => {
  it('matches the design spec §4 encryption format constants', () => {
    expect(KEY_BYTES).toBe(32);
    expect(IV_BYTES).toBe(12);
    expect(TAG_BYTES).toBe(16);
  });
});

describe('encrypt / decrypt', () => {
  it('round-trips: decrypt(encrypt(x, key), key) === x', () => {
    const key = Buffer.from('01234567890123456789012345678901', 'utf-8').subarray(0, KEY_BYTES);
    const plain = 'super-secret-password';
    const enc = encrypt(plain, key);
    expect(decrypt(enc, key)).toBe(plain);
  });

  it('round-trips an empty string', () => {
    const key = Buffer.alloc(KEY_BYTES, 7);
    const enc = encrypt('', key);
    expect(decrypt(enc, key)).toBe('');
  });

  it('round-trips unicode / multi-byte content', () => {
    const key = Buffer.alloc(KEY_BYTES, 9);
    const plain = 'こんにちは 🔐 secret';
    const enc = encrypt(plain, key);
    expect(decrypt(enc, key)).toBe(plain);
  });

  it('produces a different ciphertext each time (random IV), even for the same plaintext and key', () => {
    const key = Buffer.alloc(KEY_BYTES, 3);
    const plain = 'same-value';
    const encA = encrypt(plain, key);
    const encB = encrypt(plain, key);
    expect(encA).not.toBe(encB);
    // Both must still decrypt to the same plaintext.
    expect(decrypt(encA, key)).toBe(plain);
    expect(decrypt(encB, key)).toBe(plain);
  });

  it('encodes as base64(iv[12] | authTag[16] | ciphertext)', () => {
    const key = Buffer.alloc(KEY_BYTES, 1);
    const plain = 'abc';
    const enc = encrypt(plain, key);
    const raw = Buffer.from(enc, 'base64');
    expect(raw.length).toBe(IV_BYTES + TAG_BYTES + Buffer.byteLength(plain, 'utf-8'));
  });

  it('throws CryptoError when the ciphertext has been tampered with', () => {
    const key = Buffer.alloc(KEY_BYTES, 5);
    const enc = encrypt('do-not-tamper', key);
    const raw = Buffer.from(enc, 'base64');
    // Flip a bit inside the ciphertext region (after iv + authTag) to simulate tampering.
    raw[IV_BYTES + TAG_BYTES] = raw[IV_BYTES + TAG_BYTES]! ^ 0xff;
    const tampered = raw.toString('base64');

    expect(() => decrypt(tampered, key)).toThrow(CryptoError);
  });

  it('throws CryptoError when decrypting with the wrong key', () => {
    const key = Buffer.alloc(KEY_BYTES, 1);
    const otherKey = Buffer.alloc(KEY_BYTES, 2);
    const enc = encrypt('secret-value', key);

    expect(() => decrypt(enc, otherKey)).toThrow(CryptoError);
  });

  it('throws CryptoError when the encoded value is too short to contain iv + authTag', () => {
    const key = Buffer.alloc(KEY_BYTES, 1);
    const tooShort = Buffer.alloc(IV_BYTES + TAG_BYTES - 1, 0).toString('base64');

    expect(() => decrypt(tooShort, key)).toThrow(CryptoError);
  });
});

describe('loadOrCreateMasterKey', () => {
  it('generates a new 32-byte master key when none exists yet', () => {
    const configDir = makeTempConfigDir();
    const keyPath = path.join(configDir, 'master.key');
    expect(fs.existsSync(keyPath)).toBe(false);

    const key = loadOrCreateMasterKey(configDir);

    expect(key.length).toBe(KEY_BYTES);
    expect(fs.existsSync(keyPath)).toBe(true);
  });

  it('creates the config directory with mode 0o700 when generating a new key', () => {
    const parent = makeTempConfigDir();
    const configDir = path.join(parent, 'nested-config');
    expect(fs.existsSync(configDir)).toBe(false);

    loadOrCreateMasterKey(configDir);

    const dirMode = fs.statSync(configDir).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it('writes master.key with mode 0o600', () => {
    const configDir = makeTempConfigDir();

    loadOrCreateMasterKey(configDir);

    const keyPath = path.join(configDir, 'master.key');
    const fileMode = fs.statSync(keyPath).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('returns the same key on subsequent calls (loads existing file instead of regenerating)', () => {
    const configDir = makeTempConfigDir();

    const first = loadOrCreateMasterKey(configDir);
    const second = loadOrCreateMasterKey(configDir);

    expect(second.equals(first)).toBe(true);
  });

  it('produces a key usable by encrypt/decrypt for a full round trip', () => {
    const configDir = makeTempConfigDir();
    const key = loadOrCreateMasterKey(configDir);
    const plain = 'value-encrypted-with-real-master-key';

    expect(decrypt(encrypt(plain, key), key)).toBe(plain);
  });

  it('throws CryptoError when the existing master.key file has an invalid size (corrupt)', () => {
    const configDir = makeTempConfigDir();
    fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
    const keyPath = path.join(configDir, 'master.key');
    fs.writeFileSync(keyPath, Buffer.alloc(KEY_BYTES - 1, 0), { mode: 0o600 });

    expect(() => loadOrCreateMasterKey(configDir)).toThrow(CryptoError);
  });
});

describe('generateMasterKey', () => {
  it('returns a KEY_BYTES-length buffer, different on each call', () => {
    const a = generateMasterKey();
    const b = generateMasterKey();

    expect(a.length).toBe(KEY_BYTES);
    expect(b.length).toBe(KEY_BYTES);
    expect(a.equals(b)).toBe(false);
  });
});

describe('writeMasterKeyAtomic', () => {
  it('replaces an existing master.key with the given key', () => {
    const configDir = makeTempConfigDir();
    loadOrCreateMasterKey(configDir);
    const newKey = generateMasterKey();

    writeMasterKeyAtomic(configDir, newKey);

    const keyPath = path.join(configDir, 'master.key');
    expect(fs.readFileSync(keyPath).equals(newKey)).toBe(true);
  });

  it('creates master.key with mode 0o600', () => {
    const configDir = makeTempConfigDir();
    const key = generateMasterKey();

    writeMasterKeyAtomic(configDir, key);

    const keyPath = path.join(configDir, 'master.key');
    const fileMode = fs.statSync(keyPath).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('creates configDir (mode 0o700) if it does not exist yet', () => {
    const parent = makeTempConfigDir();
    const configDir = path.join(parent, 'nested-config');
    expect(fs.existsSync(configDir)).toBe(false);

    writeMasterKeyAtomic(configDir, generateMasterKey());

    const dirMode = fs.statSync(configDir).mode & 0o777;
    expect(dirMode).toBe(0o700);
  });

  it('does not leave a stray .tmp file behind', () => {
    const configDir = makeTempConfigDir();

    writeMasterKeyAtomic(configDir, generateMasterKey());

    expect(fs.existsSync(path.join(configDir, 'master.key.tmp'))).toBe(false);
  });
});

describe('backupMasterKey / removeMasterKeyBackup', () => {
  it('copies the current master.key to master.key.bak and returns its path', () => {
    const configDir = makeTempConfigDir();
    const key = loadOrCreateMasterKey(configDir);

    const backupPath = backupMasterKey(configDir);

    expect(backupPath).toBe(path.join(configDir, 'master.key.bak'));
    expect(fs.readFileSync(backupPath).equals(key)).toBe(true);
    // master.key itself is untouched by backing it up.
    expect(fs.readFileSync(path.join(configDir, 'master.key')).equals(key)).toBe(true);
  });

  it('writes master.key.bak with mode 0o600', () => {
    const configDir = makeTempConfigDir();
    loadOrCreateMasterKey(configDir);

    const backupPath = backupMasterKey(configDir);

    const fileMode = fs.statSync(backupPath).mode & 0o777;
    expect(fileMode).toBe(0o600);
  });

  it('removeMasterKeyBackup deletes an existing backup', () => {
    const configDir = makeTempConfigDir();
    loadOrCreateMasterKey(configDir);
    const backupPath = backupMasterKey(configDir);
    expect(fs.existsSync(backupPath)).toBe(true);

    removeMasterKeyBackup(configDir);

    expect(fs.existsSync(backupPath)).toBe(false);
  });

  it('removeMasterKeyBackup is a no-op (does not throw) when no backup exists', () => {
    const configDir = makeTempConfigDir();

    expect(() => removeMasterKeyBackup(configDir)).not.toThrow();
  });
});
