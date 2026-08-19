/**
 * Custom error classes for local-secret.
 *
 * See design spec §7 (エラー処理) and §3 (モジュール構成):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 */

/**
 * Error thrown when master.key is corrupt (invalid size) or decryption fails
 * (tampered ciphertext or a mismatched key).
 */
export class CryptoError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CryptoError';
  }
}

/**
 * Error thrown when SecretStore#get is called with a key that is not registered.
 */
export class SecretNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretNotFoundError';
  }
}

/**
 * Error thrown when secrets.json is corrupt, fails to parse, or fails to write.
 */
export class StoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StoreError';
  }
}
