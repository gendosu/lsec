import { describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { promptConfirm, promptHiddenPassword } from '../src/prompt.js';

/**
 * Renders a raw terminal byte stream into the text a human would actually see.
 *
 * node:readline (terminal mode) redraws the prompt line with "cursor to
 * column" (CSI <n> G) and "clear screen down" (CSI 0 J) sequences, so a
 * prompt that merely *appears* in the byte stream can still end up erased on
 * a real terminal. Tests must assert against the rendered result, not the
 * raw bytes. Handles only what readline emits for these prompts: CSI G / J,
 * \r, \n; any other CSI sequence is consumed and ignored.
 */
function renderVisible(bytes: string): string {
  const lines: string[][] = [[]];
  let row = 0;
  let col = 0;
  let i = 0;
  while (i < bytes.length) {
    const csi = /^\u001b\[([0-9;]*)([A-Za-z])/.exec(bytes.slice(i));
    if (csi) {
      const [seq, param, cmd] = csi;
      if (cmd === 'G') {
        col = (parseInt(param || '1', 10) || 1) - 1;
      } else if (cmd === 'J') {
        lines[row] = lines[row].slice(0, col);
        lines.length = row + 1;
      }
      i += seq.length;
      continue;
    }
    const ch = bytes[i];
    if (ch === '\r') {
      col = 0;
    } else if (ch === '\n') {
      row += 1;
      col = 0;
      if (!lines[row]) lines[row] = [];
    } else {
      lines[row][col] = ch;
      col += 1;
    }
    i += 1;
  }
  return lines.map((l) => Array.from(l, (c) => c ?? ' ').join('')).join('\n');
}

describe('promptHiddenPassword', () => {
  it('leaves the question visible on screen (readline line-refresh must not erase it)', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    let bytes = '';
    output.on('data', (c) => {
      bytes += c.toString();
    });

    const p = promptHiddenPassword('Enter secret value: ', input, output);
    input.write('mysecret\n');
    await p;

    const visible = renderVisible(bytes);
    expect(visible).toContain('Enter secret value: ');
    expect(visible).not.toContain('mysecret');
  });

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
