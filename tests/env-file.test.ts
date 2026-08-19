import { describe, expect, it } from 'vitest';
import { parseEnvFile } from '../src/env-file.js';

describe('parseEnvFile', () => {
  it('returns an empty array for empty content', () => {
    expect(parseEnvFile('')).toEqual([]);
  });

  it('parses simple KEY=VALUE lines', () => {
    expect(parseEnvFile('GITHUB_TOKEN=lsec://global/gh_token\nPLAIN=hello')).toEqual([
      { key: 'GITHUB_TOKEN', value: 'lsec://global/gh_token' },
      { key: 'PLAIN', value: 'hello' },
    ]);
  });

  it('ignores blank lines', () => {
    expect(parseEnvFile('A=1\n\n\nB=2\n')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
  });

  it('ignores full-line comments starting with #', () => {
    expect(parseEnvFile('# a comment\nA=1\n  # indented comment\nB=2')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
  });

  it('strips matching double quotes from the value', () => {
    expect(parseEnvFile('A="hello world"')).toEqual([{ key: 'A', value: 'hello world' }]);
  });

  it('strips matching single quotes from the value', () => {
    expect(parseEnvFile("A='hello world'")).toEqual([{ key: 'A', value: 'hello world' }]);
  });

  it('does not strip mismatched quote characters', () => {
    expect(parseEnvFile('A="hello\'')).toEqual([{ key: 'A', value: '"hello\'' }]);
  });

  it('treats an empty value as an empty string', () => {
    expect(parseEnvFile('A=')).toEqual([{ key: 'A', value: '' }]);
  });

  it('trims surrounding whitespace around key and unquoted value', () => {
    expect(parseEnvFile('  A  =  hello  ')).toEqual([{ key: 'A', value: 'hello' }]);
  });

  it('preserves internal whitespace inside quotes verbatim', () => {
    expect(parseEnvFile('A="  hello  "')).toEqual([{ key: 'A', value: '  hello  ' }]);
  });

  it('handles CRLF line endings', () => {
    expect(parseEnvFile('A=1\r\nB=2\r\n')).toEqual([
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ]);
  });

  it('does not interpolate shell variables or command substitution (literal string only)', () => {
    expect(parseEnvFile('A=$HOME')).toEqual([{ key: 'A', value: '$HOME' }]);
    expect(parseEnvFile('A=`whoami`')).toEqual([{ key: 'A', value: '`whoami`' }]);
    expect(parseEnvFile('A=$(whoami)')).toEqual([{ key: 'A', value: '$(whoami)' }]);
  });

  it('does not treat a trailing # after a value as an inline comment (full-line comments only)', () => {
    expect(parseEnvFile('A=value # not a comment')).toEqual([{ key: 'A', value: 'value # not a comment' }]);
  });

  it('throws on a line with no "=" (not blank, not a comment)', () => {
    expect(() => parseEnvFile('not-a-valid-line')).toThrow();
  });

  it('throws on a line whose key does not match [A-Za-z_][A-Za-z0-9_]*', () => {
    expect(() => parseEnvFile('1KEY=value')).toThrow();
    expect(() => parseEnvFile('KEY-WITH-DASH=value')).toThrow();
  });

  it('includes the 1-based line number in the error message for malformed lines', () => {
    expect(() => parseEnvFile('A=1\nnot-valid\nB=2')).toThrow(/line 2/);
  });
});
