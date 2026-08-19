import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptConfirm, promptHiddenPassword } from '../src/prompt.js';

describe('promptHiddenPassword', () => {
  it('reads a line from the provided input stream without echoing it back', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let echoed = '';
    output.on('data', (c) => {
      echoed += c.toString();
    });

    const p = promptHiddenPassword('Enter secret value: ', input, output);
    input.write('mysecret\n');
    const result = await p;

    expect(result).toBe('mysecret');
    expect(echoed).not.toContain('mysecret');
    expect(echoed).toContain('Enter secret value: ');
  });
});

describe('promptConfirm', () => {
  it('resolves true for a "y" answer', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const p = promptConfirm('Delete? [y/N] ', input, output);
    input.write('y\n');

    expect(await p).toBe(true);
  });

  it('resolves true for a "Y" or "yes" answer (case-insensitive, prefix match)', async () => {
    const input1 = new PassThrough();
    const output1 = new PassThrough();
    const p1 = promptConfirm('Delete? [y/N] ', input1, output1);
    input1.write('Yes\n');
    expect(await p1).toBe(true);
  });

  it('resolves false for a "n" answer', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const p = promptConfirm('Delete? [y/N] ', input, output);
    input.write('n\n');

    expect(await p).toBe(false);
  });

  it('resolves false for an empty answer (default: no)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();

    const p = promptConfirm('Delete? [y/N] ', input, output);
    input.write('\n');

    expect(await p).toBe(false);
  });

  it('echoes the typed answer back (unlike promptHiddenPassword)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let echoed = '';
    output.on('data', (c) => {
      echoed += c.toString();
    });

    const p = promptConfirm('Delete? [y/N] ', input, output);
    input.write('y\n');
    await p;

    expect(echoed).toContain('Delete? [y/N] ');
  });
});
