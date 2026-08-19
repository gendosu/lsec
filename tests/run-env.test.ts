import { describe, expect, it, vi } from 'vitest';
import { resolveEnv } from '../src/run-env.js';
import type { SecretRef } from '../src/secret-ref.js';

describe('resolveEnv', () => {
  it('passes through non-reference process.env values untouched', () => {
    const resolveSecret = vi.fn();
    const env = resolveEnv({
      processEnv: { PATH: '/usr/bin', PLAIN: 'literal-value' },
      resolveSecret,
    });
    expect(env.PATH).toBe('/usr/bin');
    expect(env.PLAIN).toBe('literal-value');
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('skips process.env entries whose value is undefined', () => {
    const env = resolveEnv({
      processEnv: { SET: 'value', UNSET: undefined },
      resolveSecret: vi.fn(),
    });
    expect(env.SET).toBe('value');
    expect('UNSET' in env).toBe(false);
  });

  it('resolves a process.env value that is a secret reference', () => {
    const resolveSecret = vi.fn((ref: SecretRef) => `resolved:${ref.namespace ?? 'global'}:${ref.key}`);
    const env = resolveEnv({
      processEnv: { GITHUB_TOKEN: 'lsec://work/gh_token' },
      resolveSecret,
    });
    expect(env.GITHUB_TOKEN).toBe('resolved:work:gh_token');
    expect(resolveSecret).toHaveBeenCalledWith({ namespace: 'work', key: 'gh_token' });
  });

  it('resolves lsec://global/<key> with namespace omitted', () => {
    const resolveSecret = vi.fn((ref: SecretRef) => `resolved:${ref.namespace ?? 'global'}:${ref.key}`);
    const env = resolveEnv({
      processEnv: { TOKEN: 'lsec://global/api_key' },
      resolveSecret,
    });
    expect(env.TOKEN).toBe('resolved:global:api_key');
    expect(resolveSecret).toHaveBeenCalledWith({ key: 'api_key' });
  });

  it('sets literal (non-reference) --env-file entries as-is, without invoking resolveSecret', () => {
    const resolveSecret = vi.fn();
    const env = resolveEnv({
      processEnv: {},
      envFileEntries: [{ key: 'FOO', value: 'bar' }],
      resolveSecret,
    });
    expect(env.FOO).toBe('bar');
    expect(resolveSecret).not.toHaveBeenCalled();
  });

  it('resolves reference values found in --env-file entries', () => {
    const resolveSecret = vi.fn(() => 'secret-value');
    const env = resolveEnv({
      processEnv: {},
      envFileEntries: [{ key: 'GITHUB_TOKEN', value: 'lsec://global/gh_token' }],
      resolveSecret,
    });
    expect(env.GITHUB_TOKEN).toBe('secret-value');
  });

  it('overlays --env-file entries on top of process.env, overriding same-name keys', () => {
    const env = resolveEnv({
      processEnv: { FOO: 'from-process-env' },
      envFileEntries: [{ key: 'FOO', value: 'from-env-file' }],
      resolveSecret: vi.fn(),
    });
    expect(env.FOO).toBe('from-env-file');
  });

  it('leaves process.env entries that are not in --env-file untouched, and vice versa', () => {
    const env = resolveEnv({
      processEnv: { ONLY_PROCESS: 'p' },
      envFileEntries: [{ key: 'ONLY_FILE', value: 'f' }],
      resolveSecret: vi.fn(),
    });
    expect(env.ONLY_PROCESS).toBe('p');
    expect(env.ONLY_FILE).toBe('f');
  });

  it('propagates errors thrown by resolveSecret (e.g. secret not found) without catching them', () => {
    const resolveSecret = vi.fn(() => {
      throw new Error('Secret "gh_token" was not found in the global namespace.');
    });
    expect(() =>
      resolveEnv({
        processEnv: { GITHUB_TOKEN: 'lsec://global/gh_token' },
        resolveSecret,
      })
    ).toThrow('Secret "gh_token" was not found in the global namespace.');
  });

  it('wraps a resolveSecret error with the offending environment variable name (never a secret, safe to include)', () => {
    const resolveSecret = vi.fn(() => {
      throw new Error('Secret "gh_token" was not found in the global namespace.');
    });
    expect(() =>
      resolveEnv({
        processEnv: { GITHUB_TOKEN: 'lsec://global/gh_token' },
        resolveSecret,
      })
    ).toThrow(/"GITHUB_TOKEN"/);
  });

  it('wraps a malformed-reference error with the offending environment variable name too', () => {
    expect(() =>
      resolveEnv({
        processEnv: { BAD_REF: 'lsec://onlynamespace' },
        resolveSecret: vi.fn(),
      })
    ).toThrow(/"BAD_REF"/);
  });

  it('propagates errors thrown for a malformed reference (invalid format)', () => {
    expect(() =>
      resolveEnv({
        processEnv: { GITHUB_TOKEN: 'lsec://onlynamespace' },
        resolveSecret: vi.fn(),
      })
    ).toThrow();
  });

  it('passes through a literal (non-reference) process.env variable named "__proto__" instead of silently dropping it', () => {
    // Regression test: a plain `{}`-based accumulator's inherited
    // `__proto__` setter would discard this entry (string values assigned
    // through it are a no-op), so the child process would start without
    // it and no error would ever be raised.
    //
    // Uses a computed key (`["__proto__"]:`), not a literal `__proto__:`
    // key: in an object *literal*, a non-computed `__proto__:` key sets the
    // object's prototype instead of creating an own property (and is a
    // no-op here since the value is a string, not an object/null) — which
    // would make this fixture itself fail to reproduce the bug it's meant
    // to catch. A real `process.env` (a plain string-keyed object built by
    // Node, not from object-literal syntax) does not have this quirk: a
    // shell-exported `__proto__=value` really does become an own property.
    const env = resolveEnv({
      processEnv: { ['__proto__']: 'literal-proto-value' },
      resolveSecret: vi.fn(),
    });
    expect(env['__proto__']).toBe('literal-proto-value');
    expect(Object.prototype.hasOwnProperty.call(env, '__proto__')).toBe(true);
  });

  it('resolves a secret reference for a --env-file entry named "__proto__" instead of silently dropping it', () => {
    const resolveSecret = vi.fn(() => 'resolved-proto-secret');
    const env = resolveEnv({
      processEnv: {},
      envFileEntries: [{ key: '__proto__', value: 'lsec://global/some_key' }],
      resolveSecret,
    });
    expect(env['__proto__']).toBe('resolved-proto-secret');
    expect(Object.prototype.hasOwnProperty.call(env, '__proto__')).toBe(true);
  });
});
