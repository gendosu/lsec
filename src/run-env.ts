/**
 * Resolves the full environment variable map for `lsec run`, combining the
 * two sources 1Password's `op run` also uses: the parent process's own
 * environment, and an optional `--dotenv` (this CLI's equivalent of `op
 * run`'s `--env-file`; see src/cli.ts for why the flag was renamed). Dotenv
 * overrides are applied first, with the last entry for each key winning.
 * Only the final values are resolved: a `lsec://<namespace>/<key>` reference
 * (see src/secret-ref.ts) is replaced by its secret value; other values are
 * passed through unchanged.
 *
 * This module is pure logic: it takes the resolution of an individual
 * reference as an injected `resolveSecret` callback rather than importing
 * secret-store.ts directly, so it has no dependency on crypto.ts /
 * store-file.ts / paths.ts and can be unit-tested without a real store.
 * src/cli.ts supplies `resolveSecret` bound to a real `SecretStore`
 * obtained via the public API (./index.js).
 */
import { isSecretRef, parseSecretRef, type SecretRef } from './secret-ref.js';
import type { EnvFileEntry } from './env-file.js';

/** Options accepted by {@link resolveEnv}. */
export interface ResolveEnvOptions {
  /**
   * Candidate source #1 (op run's "environment"): typically `process.env`.
   * Own entries with an `undefined` value are skipped. Values are resolved
   * only if they remain after all `envFileEntries` overrides.
   */
  processEnv: Record<string, string | undefined>;
  /**
   * Candidate source #2 (`lsec run --dotenv`, op run's `--env-file`
   * equivalent): entries parsed by {@link parseEnvFile}, in file order.
   * Overlaid on top of `processEnv` before reference resolution. The last
   * entry for each key wins, including empty strings. Overwritten values
   * are never parsed or resolved. Omit when `--dotenv` was not given.
   */
  envFileEntries?: EnvFileEntry[];
  /**
   * Resolves a parsed secret reference to its decrypted value. Should throw
   * if the reference cannot be resolved (e.g. the key is not registered) —
   * {@link resolveEnv} does not catch such errors itself, but wraps them
   * (see below) with the offending environment variable's name before they
   * propagate to the caller, to be reported and to abort before any child
   * process is spawned.
   */
  resolveSecret: (ref: SecretRef) => string;
}

/**
 * Builds the full environment map to pass to the child process spawned by
 * `lsec run`. Applies all dotenv overrides before resolving the final
 * values. Overwritten values are never parsed or resolved. Final values
 * that are not secret references are copied through verbatim.
 *
 * If a value is a reference but fails to parse or resolve, the resulting
 * error is re-thrown wrapped with the environment variable's *name* (never
 * its value — an environment variable name is not secret) so the caller can
 * tell which entry was the problem.
 */
export function resolveEnv(options: ResolveEnvOptions): Record<string, string> {
  const { processEnv, envFileEntries = [], resolveSecret } = options;
  // Must be null-prototype, not a `{}` literal: `processEnv` (from
  // process.env) or `envFileEntries` (from a user-controlled --dotenv file)
  // can legitimately contain a variable literally named "__proto__". A
  // plain object's inherited `__proto__` setter silently discards a string
  // assigned through it (`result[key] = value` becomes a no-op instead of
  // creating an own property), so that variable would vanish from the
  // child's environment without any error — the same defect class as
  // SecretStore's namespace/key containers (see secret-store.ts/
  // store-file.ts), just for env var names instead of secret names.
  const result = Object.create(null) as Record<string, string>;

  for (const [key, value] of Object.entries(processEnv)) {
    if (value === undefined) continue;
    result[key] = value;
  }
  for (const { key, value } of envFileEntries) {
    result[key] = value;
  }
  for (const [key, value] of Object.entries(result)) {
    result[key] = resolveValue(key, value, resolveSecret);
  }

  return result;
}

/**
 * Validates the final, resolved environment after all dotenv overrides.
 * Storage accepts general strings; child-process environments cannot contain
 * NUL bytes. Never include a value in these errors, even through coercion.
 */
export function validateRunEnv(env: Record<string, unknown>): asserts env is Record<string, string> {
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') {
      throw new Error(`Invalid value for environment variable "${key}": value must be a string.`);
    }
    if (value.includes('\0')) {
      throw new Error(`Invalid value for environment variable "${key}": NUL bytes are not allowed.`);
    }
  }
}

function resolveValue(key: string, value: string, resolveSecret: (ref: SecretRef) => string): string {
  if (!isSecretRef(value)) return value;
  try {
    return resolveSecret(parseSecretRef(value));
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Could not resolve secret reference for environment variable "${key}": ${msg}`);
  }
}
