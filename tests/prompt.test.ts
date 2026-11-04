import { describe, expect, it, vi } from 'vitest';
import { PassThrough, Writable } from 'node:stream';
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

describe.each([
  ['hidden', promptHiddenPassword],
  ['confirmation', promptConfirm],
] as const)('%s prompt lifecycle', (_name, prompt) => {
  function streams(raw = false) {
    const input = Object.assign(new PassThrough(), {
      isRaw: raw,
      setRawMode: vi.fn(function (this: { isRaw: boolean }, mode: boolean) {
        this.isRaw = mode;
      }),
    });
    const output = new PassThrough();
    output.resume();
    return { input, output };
  }

  async function within(promise: Promise<unknown>): Promise<unknown> {
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Prompt did not settle')), 200);
    });
    try {
      return await Promise.race([promise, deadline]);
    } finally {
      clearTimeout(timer!);
    }
  }

  const interruptions = [
    ['EOF', (input: PassThrough) => input.end(), 1],
    ['Ctrl-D', (input: PassThrough) => input.write('\x04'), 1],
    ['Ctrl-C', (input: PassThrough) => input.write('\x03'), 130],
    ['partial input then EOF', (input: PassThrough) => input.end('y-sensitive-dummy'), 1],
    ['partial input then Ctrl-C', (input: PassThrough) => input.write('y-sensitive-dummy\x03'), 130],
    ['destroy', (input: PassThrough) => input.destroy(), 1],
    ['input close', (input: PassThrough) => input.emit('close'), 1],
    ['input error', (input: PassThrough) => input.destroy(new Error('sensitive-dummy')), 1],
  ] as const;

  it.each(interruptions)('rejects on %s and restores the terminal', async (_label, interrupt, exitCode) => {
    const { input, output } = streams();
    const result = within(prompt('Question? ', input, output));
    const check = expect(result).rejects.toMatchObject({ exitCode });
    interrupt(input);
    try {
      await check;
      expect(input.isRaw).toBe(false);
      // Successful writes may still have callbacks queued after cancellation.
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(input.listenerCount('keypress')).toBe(0);
      expect(input.listenerCount('end')).toBe(0);
      expect(input.listenerCount('error')).toBe(0);
      expect(output.listenerCount('error')).toBe(0);
      expect(output.listenerCount('resize')).toBe(0);
      expect(output.destroyed).toBe(false);
    } finally {
      input.destroy();
      output.destroy();
    }
  });

  it.each(['ended', 'destroyed'] as const)('rejects an already %s input', async (state) => {
    const { input, output } = streams();
    if (state === 'ended') {
      input.resume();
      input.end();
      await new Promise<void>((resolve) => input.once('end', resolve));
    } else {
      input.destroy();
    }
    await expect(within(prompt('Question? ', input, output))).rejects.toMatchObject({ exitCode: 1 });
    expect(input.isRaw).toBe(false);
  });

  it('preserves a completed answer followed immediately by EOF', async () => {
    const { input, output } = streams();
    const result = within(prompt('Question? ', input, output));
    input.end('yes\n');
    expect(await result).toBe(_name === 'hidden' ? 'yes' : true);
    expect(input.isRaw).toBe(false);
  });

  it('preserves external listeners and the original raw state across repeated prompts', async () => {
    const { input, output } = streams(true);
    const external = vi.fn();
    input.on('error', external);
    input.on('end', external);
    output.on('error', external);
    output.on('resize', external);
    for (let i = 0; i < 3; i++) {
      const result = within(prompt('Question? ', input, output));
      input.write('yes\n');
      expect(await result).toBe(_name === 'hidden' ? 'yes' : true);
      expect(input.isRaw).toBe(true);
      expect(input.listeners('error')).toEqual([external]);
      expect(input.listeners('end')).toEqual([external]);
      expect(output.listeners('error')).toEqual([external]);
      expect(output.listeners('resize')).toEqual([external]);
      expect(input.destroyed).toBe(false);
    }
    expect(external).not.toHaveBeenCalled();
  });

  it('keeps the first interruption when close and late answers follow', async () => {
    const { input, output } = streams();
    const result = within(prompt('Question? ', input, output));
    input.write('\x03');
    input.emit('close');
    input.emit('end');
    input.write('yes\n');
    await expect(result).rejects.toMatchObject({ exitCode: 130 });
  });

  it('sanitizes output errors and restores raw mode', async () => {
    const { input, output } = streams();
    const result = within(prompt('Question? ', input, output));
    output.emit('error', new Error('sensitive-dummy'));
    await expect(result).rejects.toMatchObject({ exitCode: 1, message: 'Interactive prompt failed.' });
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
  });

  it('cleans up after a synchronous question write failure', async () => {
    const { input, output } = streams();
    vi.spyOn(output, 'write').mockImplementation(() => { throw new Error('sensitive-dummy'); });
    await expect(within(prompt('Question? ', input, output))).rejects.toMatchObject({
      exitCode: 1, message: 'Interactive prompt failed.',
    });
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
    expect(input.listenerCount('error')).toBe(0);
    expect(output.listenerCount('resize')).toBe(0);
  });

  it('sanitizes synchronous output failure while editing an answer', async () => {
    const { input, output } = streams();
    const result = within(prompt('Question? ', input, output));
    vi.spyOn(output, 'write').mockImplementation(() => { throw new Error('sensitive-dummy'); });
    input.write('y\x7f');
    await expect(result).rejects.toMatchObject({ exitCode: 1, message: 'Interactive prompt failed.' });
    expect(input.isRaw).toBe(false);
  });

  it('sanitizes asynchronous output failure without an unhandled error', async () => {
    const { input } = streams();
    const output = new Writable({
      write(_chunk, _encoding, callback) {
        setImmediate(() => callback(new Error('sensitive-dummy')));
      },
    });
    const result = within(prompt('Question? ', input, output));
    input.write('yes\n');
    await expect(result).rejects.toMatchObject({ exitCode: 1, message: 'Interactive prompt failed.' });
    expect(input.isRaw).toBe(false);
  });

  it.each(['\x03', '\x04'])('handles a delayed output error after interruption %j', async (key) => {
    const { input } = streams();
    let failWrite: (error: Error) => void;
    const output = new Writable({
      write(_chunk, _encoding, callback) { failWrite = callback; },
    });
    const result = within(prompt('Question? ', input, output));
    input.write(key);
    await expect(result).rejects.toMatchObject({ exitCode: key === '\x03' ? 130 : 1 });
    expect(input.isRaw).toBe(false);
    failWrite!(new Error('sensitive-dummy'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.listenerCount('error')).toBe(0);
    expect(input.listenerCount('error')).toBe(0);
  });

  it('cleans up the output error listener after delayed successful output following interruption', async () => {
    const { input } = streams();
    const writes: Array<(error?: Error) => void> = [];
    const output = new Writable({
      write(_chunk, _encoding, callback) { writes.push(callback); },
    });
    const result = within(prompt('Question? ', input, output));
    input.write('\x03');
    await expect(result).rejects.toMatchObject({ exitCode: 130 });
    for (let index = 0; index < writes.length; index++) writes[index]();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.listenerCount('error')).toBe(0);
  });

  it('handles input failure followed by a delayed failure of the final answer output', async () => {
    const { input } = streams();
    let failFinalWrite: (error: Error) => void;
    const output = new Writable({
      write(chunk, _encoding, callback) {
        if (chunk.toString() === (_name === 'hidden' ? '\n' : '')) failFinalWrite = callback;
        else callback();
      },
    });
    const result = within(prompt('Question? ', input, output));
    input.write('yes\n');
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(failFinalWrite!).toBeTypeOf('function');
    input.emit('error', new Error('sensitive-input-dummy'));
    await expect(result).rejects.toMatchObject({ exitCode: 1, message: 'Interactive prompt failed.' });
    failFinalWrite!(new Error('sensitive-output-dummy'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.listenerCount('error')).toBe(0);
    expect(input.isRaw).toBe(false);
  });

  it('cleans up after output closes before a delayed write callback fails', async () => {
    const { input } = streams();
    let failWrite: (error: Error) => void;
    const output = new Writable({
      write(_chunk, _encoding, callback) { failWrite = callback; },
    });
    const result = within(prompt('Question? ', input, output));
    output.destroy();
    await expect(result).rejects.toMatchObject({ exitCode: 1 });
    failWrite!(new Error('sensitive-dummy'));
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(output.listenerCount('error')).toBe(0);
    expect(output.listenerCount('close')).toBe(0);
    expect(input.isRaw).toBe(false);
  });

  it('cleans up a partially initialized readline when enabling raw mode throws', async () => {
    const { input, output } = streams();
    input.setRawMode.mockImplementationOnce(() => { throw new Error('sensitive-dummy'); });
    await expect(within(prompt('Question? ', input, output))).rejects.toMatchObject({
      exitCode: 1, message: 'Interactive prompt failed.',
    });
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
    expect(input.listenerCount('error')).toBe(0);
    expect(input.listenerCount('end')).toBe(0);
  });

  it.each(['ended', 'destroyed'] as const)('rejects an already %s output', async (state) => {
    const { input, output } = streams();
    if (state === 'ended') output.end();
    else output.destroy();
    await expect(within(prompt('Question? ', input, output))).rejects.toMatchObject({ exitCode: 1 });
    expect(input.isRaw).toBe(false);
  });

  it.each(['end', 'destroy'] as const)('rejects when output.%s() closes the output during a prompt', async (method) => {
    const { input, output } = streams();
    const result = within(prompt('Question? ', input, output));
    output[method]();
    await expect(result).rejects.toMatchObject({ exitCode: 1 });
    expect(input.isRaw).toBe(false);
  });

  it('restores raw mode even when initialization changes it before throwing', async () => {
    const { input, output } = streams();
    input.setRawMode.mockImplementationOnce(function (mode) {
      input.isRaw = mode;
      throw new Error('sensitive-dummy');
    });
    await expect(within(prompt('Question? ', input, output))).rejects.toMatchObject({ exitCode: 1 });
    expect(input.isRaw).toBe(false);
    expect(input.listenerCount('keypress')).toBe(0);
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
