/**
 * `lsec://<namespace>/<key>` secret reference parsing, used by `lsec run`
 * (and the underlying `resolveEnv` library API) to recognize and decompose
 * references embedded in environment variable values or `--dotenv` entries.
 *
 * See design spec (task #2 planning): the scheme name matches the CLI
 * command name (`lsec`), mirroring 1Password CLI's `op://` convention.
 *
 * This module is intentionally pure string parsing with no dependency on
 * secret-store.ts / crypto.ts / store-file.ts / paths.ts: it does not know
 * how to *resolve* a reference to a secret value, only how to recognize and
 * parse the reference syntax itself.
 */

/** The scheme prefix that marks a string as a secret reference rather than a literal value. */
const SCHEME_PREFIX = 'lsec://';

/**
 * The namespace name that is normalized to "no namespace" (i.e. the same
 * `global` container that every other CLI command defaults to when `--ns`
 * is omitted). This is a normalization performed by {@link parseSecretRef}
 * only; the string `lsec://global/<key>` never resolves to a namespace
 * literally named `"global"` in storage.
 */
const GLOBAL_NAMESPACE = 'global';

/** A `<namespace>/<key>` pattern with no slashes or whitespace in either part, and nothing else. */
const REF_PATTERN = /^([^/\s]+)\/([^/\s]+)$/;

/**
 * A parsed `lsec://<namespace>/<key>` reference, shaped to be usable
 * directly as `SecretOpts` (namespace omitted means the `global` namespace).
 */
export interface SecretRef {
  /** Namespace to resolve the secret from. Omitted means the `global` namespace. */
  namespace?: string;
  /** Secret key name. */
  key: string;
}

/**
 * Returns whether `value` is intended to be a secret reference, i.e. starts
 * with the `lsec://` scheme prefix. Case-sensitive: `LSEC://...` is treated
 * as a literal value, not a malformed reference.
 *
 * Callers should treat this as the sole discriminator between "this is a
 * literal env var value, leave it alone" and "this is a reference, parse
 * and resolve it" — only pass values that return `true` here to
 * {@link parseSecretRef}.
 */
export function isSecretRef(value: string): boolean {
  return value.startsWith(SCHEME_PREFIX);
}

/**
 * Parses a `lsec://<namespace>/<key>` secret reference into its namespace
 * and key parts.
 *
 * Validates strictly: throws unless `value` starts with the exact `lsec://`
 * prefix and the remainder matches exactly `<namespace>/<key>` with a
 * single `/` separator, and both parts non-empty and free of whitespace.
 * This deliberately rejects anything ambiguous (extra path segments, empty
 * parts, embedded whitespace) rather than trying to guess an intended
 * meaning.
 *
 * The namespace `global` is normalized to an omitted namespace (see
 * {@link SecretRef}), since that is what every other CLI command means by
 * "no `--ns` given" — it is not looked up as a namespace literally named
 * `"global"`.
 *
 * The error message includes only the reference string itself, never a
 * resolved secret value (there is none to leak at this stage; parsing
 * happens before any secret is looked up).
 */
/**
 * Formats a {@link SecretRef} back into its `lsec://<namespace>/<key>`
 * string form — the inverse of {@link parseSecretRef}. An omitted (or
 * falsy, matching the SecretOpts convention) namespace is written as the
 * `global` namespace.
 *
 * Guarantees round-tripping: any string this returns parses back to an
 * equal ref via {@link parseSecretRef}. Names that cannot round-trip are
 * rejected with an error instead of producing a broken reference:
 * - a key or namespace that is empty, or contains `/` or whitespace
 *   (REF_PATTERN could not parse it back), and
 * - a namespace literally named `"global"`, which parseSecretRef would
 *   normalize to the default global container rather than resolve to the
 *   stored namespace of that name.
 */
export function formatSecretRef(ref: SecretRef): string {
  const namespace = ref.namespace || GLOBAL_NAMESPACE;
  if (ref.namespace === GLOBAL_NAMESPACE) {
    throw new Error(
      `Namespace literally named "${GLOBAL_NAMESPACE}" cannot be expressed as a secret reference: ` +
        `"${SCHEME_PREFIX}${GLOBAL_NAMESPACE}/<key>" resolves to the default global namespace instead.`
    );
  }
  const formatted = `${SCHEME_PREFIX}${namespace}/${ref.key}`;
  if (!REF_PATTERN.test(`${namespace}/${ref.key}`)) {
    throw new Error(
      `Cannot express as a secret reference (namespace and key must be non-empty, with no "/" or whitespace): ${formatted}`
    );
  }
  return formatted;
}

export function parseSecretRef(value: string): SecretRef {
  if (!isSecretRef(value)) {
    throw new Error(`Not a secret reference (must start with "${SCHEME_PREFIX}"): ${value}`);
  }
  const rest = value.slice(SCHEME_PREFIX.length);
  const match = REF_PATTERN.exec(rest);
  if (!match) {
    throw new Error(
      `Invalid secret reference (expected exactly "${SCHEME_PREFIX}<namespace>/<key>"): ${value}`
    );
  }
  const [, namespace, key] = match;
  return namespace === GLOBAL_NAMESPACE ? { key } : { namespace, key };
}
