import { describe, expect, it } from 'vitest';
import { formatSecretRef, isSecretRef, parseSecretRef } from '../src/secret-ref.js';

describe('isSecretRef', () => {
  it('returns true for values starting with the lsec:// scheme prefix', () => {
    expect(isSecretRef('lsec://global/api_key')).toBe(true);
    expect(isSecretRef('lsec://work/token')).toBe(true);
  });

  it('returns false for plain literal values', () => {
    expect(isSecretRef('plain-value')).toBe(false);
    expect(isSecretRef('')).toBe(false);
    expect(isSecretRef('op://Private/GitHub/GITHUB_TOKEN')).toBe(false);
  });

  it('is case-sensitive: an uppercase scheme is not recognized as a reference', () => {
    expect(isSecretRef('LSEC://global/api_key')).toBe(false);
  });
});

describe('parseSecretRef', () => {
  it('parses lsec://<namespace>/<key> into { namespace, key }', () => {
    expect(parseSecretRef('lsec://work/token')).toEqual({ namespace: 'work', key: 'token' });
  });

  it('normalizes the "global" namespace to an omitted namespace (matches SecretOpts default)', () => {
    const ref = parseSecretRef('lsec://global/api_key');
    expect(ref.key).toBe('api_key');
    expect(ref.namespace).toBeUndefined();
    expect('namespace' in ref === false || ref.namespace === undefined).toBe(true);
  });

  it('throws when the value does not start with the lsec:// prefix', () => {
    expect(() => parseSecretRef('plain-value')).toThrow(/lsec:\/\//);
    expect(() => parseSecretRef('op://Private/GitHub/GITHUB_TOKEN')).toThrow();
  });

  it('throws on a reference with no slash after the scheme', () => {
    expect(() => parseSecretRef('lsec://onlynamespace')).toThrow();
  });

  it('throws on a reference with an empty namespace', () => {
    expect(() => parseSecretRef('lsec:///key')).toThrow();
  });

  it('throws on a reference with an empty key', () => {
    expect(() => parseSecretRef('lsec://ns/')).toThrow();
  });

  it('throws on a reference with an extra path segment', () => {
    expect(() => parseSecretRef('lsec://ns/sub/key')).toThrow();
  });

  it('throws on a reference containing whitespace in namespace or key', () => {
    expect(() => parseSecretRef('lsec://ns/key with space')).toThrow();
    expect(() => parseSecretRef('lsec://na mespace/key')).toThrow();
  });

  it('throws on a completely empty reference body', () => {
    expect(() => parseSecretRef('lsec://')).toThrow();
  });

  it('does not include the resolved secret value in its error message (only the reference string)', () => {
    try {
      parseSecretRef('not-a-ref');
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('not-a-ref');
    }
  });
});

describe('formatSecretRef', () => {
  it('formats { namespace, key } as lsec://<namespace>/<key>', () => {
    expect(formatSecretRef({ namespace: 'work', key: 'token' })).toBe('lsec://work/token');
  });

  it('formats an omitted namespace as the "global" namespace', () => {
    expect(formatSecretRef({ key: 'api_key' })).toBe('lsec://global/api_key');
  });

  it('round-trips through parseSecretRef', () => {
    const refs = [{ namespace: 'work', key: 'token' }, { key: 'api_key' }];
    for (const ref of refs) {
      expect(parseSecretRef(formatSecretRef(ref))).toEqual(ref);
    }
  });

  it('throws when the namespace is literally "global" (parseSecretRef would resolve it to the default container, not a namespace named "global")', () => {
    expect(() => formatSecretRef({ namespace: 'global', key: 'token' })).toThrow(/global/);
  });

  it('throws when the key or namespace contains a slash', () => {
    expect(() => formatSecretRef({ key: 'a/b' })).toThrow();
    expect(() => formatSecretRef({ namespace: 'n/s', key: 'token' })).toThrow();
  });

  it('throws when the key or namespace contains whitespace', () => {
    expect(() => formatSecretRef({ key: 'a b' })).toThrow();
    expect(() => formatSecretRef({ namespace: 'n s', key: 'token' })).toThrow();
  });

  it('throws when the key is empty', () => {
    expect(() => formatSecretRef({ key: '' })).toThrow();
  });

  it('treats an empty-string namespace as the global namespace (SecretOpts: falsy means global)', () => {
    expect(formatSecretRef({ namespace: '', key: 'token' })).toBe('lsec://global/token');
  });
});
