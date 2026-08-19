/**
 * Config directory resolution for local-secret.
 *
 * See design spec §3 (モジュール構成) and §4 (ストレージ仕様):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 *
 * Mirrors the pattern used by local-secret's src/lib/credentials.ts
 * (path.join(os.homedir(), '.config', ...) / fs.mkdirSync with mode 0o700).
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

const DEFAULT_APP_NAME = 'local-secret';

export interface ResolveConfigDirOptions {
  /** Application name used to derive the default config directory (~/.config/<appName>). Defaults to 'local-secret'. */
  appName?: string;
  /** Full path override for the config directory, primarily for test isolation. Takes precedence over appName. */
  configDir?: string;
}

/**
 * Resolves the config directory to use.
 *
 * - If `options.configDir` is given, it is returned as-is (mainly for test isolation).
 * - Otherwise, resolves to `~/.config/<appName>`, where `appName` defaults to
 *   'local-secret' and `~` is `os.homedir()`.
 */
export function resolveConfigDir(options?: ResolveConfigDirOptions): string {
  if (options?.configDir) {
    return options.configDir;
  }
  const appName = options?.appName ?? DEFAULT_APP_NAME;
  return path.join(os.homedir(), '.config', appName);
}

/**
 * Ensures the given config directory exists, creating it (and any missing
 * parents) with mode 0o700 if necessary.
 */
export function ensureConfigDir(configDir: string): void {
  fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
}
