/**
 * Minimal `.env` file parser for `lsec run --dotenv`.
 *
 * Deliberately minimal (no dependency added): supports `KEY=VALUE` lines,
 * full-line `#` comments, blank lines, and simple (single or double)
 * quoting. This is *not* a shell parser: values are never interpolated,
 * expanded, or evaluated as shell syntax (no `$VAR` expansion, no `` `cmd` ``
 * or `$(cmd)` command substitution) — the content is always used as a
 * literal string, which is a deliberate security choice to avoid injection
 * risks when the file's contents are attacker-influenced.
 *
 * This module is pure string parsing with no dependency on secret-store.ts
 * / crypto.ts / store-file.ts / paths.ts, and no knowledge of the
 * `lsec://` reference syntax (see src/secret-ref.ts) — a parsed entry's
 * value may or may not be a secret reference; that is resolved separately
 * by src/run-env.ts.
 */

/** A single parsed `.env` entry: an environment variable name and its literal string value. */
export interface EnvFileEntry {
  /** Environment variable name (matches `[A-Za-z_][A-Za-z0-9_]*`). */
  key: string;
  /** Literal value, with at most one layer of matching quotes stripped. */
  value: string;
}

/** Valid environment variable name shape. */
const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Parses `content` (the text of a `.env` file) into an ordered list of
 * `{ key, value }` entries.
 *
 * Per line:
 * - A line that is empty after trimming, or starts with `#` after
 *   trimming leading whitespace, is ignored (blank line / full-line
 *   comment). There is no support for trailing/inline comments — a `#`
 *   appearing after a `KEY=` is part of the value, not a comment.
 * - Any other line must contain `=`; the part before the first `=` is the
 *   key (trimmed, must match {@link KEY_PATTERN}) and the part after is the
 *   value (trimmed). If the trimmed value is wrapped in a matching pair of
 *   `"` or `'` quotes, the quotes are stripped and the content between them
 *   is used verbatim (no unescaping, no interpolation) — so quoting is only
 *   useful for preserving leading/trailing whitespace in a value.
 * - Any other shape (no `=`, or an invalid key name) throws, with the
 *   1-based line number in the message. The message never includes the
 *   line's own content — a malformed line's right-hand side may itself be
 *   (an attempt at) a secret value, so only the line number and, for an
 *   invalid key name, the key itself (never secret) are included.
 *
 * Both `\n` and `\r\n` line endings are accepted.
 */
export function parseEnvFile(content: string): EnvFileEntry[] {
  const entries: EnvFileEntry[] = [];
  const lines = content.split(/\r\n|\n/);

  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) {
      continue;
    }

    const eqIndex = line.indexOf('=');
    if (eqIndex === -1) {
      throw new Error(`Invalid .env line ${index + 1}: expected KEY=VALUE`);
    }

    const key = line.slice(0, eqIndex).trim();
    if (!KEY_PATTERN.test(key)) {
      throw new Error(`Invalid .env line ${index + 1}: invalid key name "${key}"`);
    }

    const rawValue = line.slice(eqIndex + 1).trim();
    entries.push({ key, value: stripMatchingQuotes(rawValue) });
  }

  return entries;
}

/** Strips a single matching pair of leading/trailing `"` or `'` quotes, if present. Leaves mismatched or absent quoting untouched. */
function stripMatchingQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}
