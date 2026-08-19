/**
 * Shared data types for local-secret.
 *
 * See design spec §4 (ストレージ仕様 - secrets.json の構造):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 */

/**
 * Persisted shape of `<configDir>/secrets.json`.
 *
 * Key names and namespace names are stored in plaintext; only the values
 * (secret contents) are encrypted (see src/crypto.ts) before being stored
 * here. src/store-file.ts reads and writes this shape as plain JSON and is
 * not responsible for encrypting/decrypting the values.
 */
export interface StoreData {
  version: 1;
  global: Record<string, string>;
  namespaces: Record<string, Record<string, string>>;
}
