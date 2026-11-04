/**
 * Hidden (no-echo) interactive prompt for local-secret's CLI.
 *
 * Ported from local-secret's src/lib/prompt.ts (promptHiddenPassword), which
 * this library generalizes from IMAP passwords to arbitrary secret values.
 * See design spec §6 (CLI 仕様 - set の値入力):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 */
import * as readline from 'node:readline';
import { PassThrough, type Readable, type Writable } from 'node:stream';

/** Internal CLI error; never includes the input or an underlying I/O message. */
export class PromptError extends Error {
  constructor(readonly reason: 'SIGINT' | 'EOF' | 'IO') {
    super(reason === 'SIGINT' ? 'Interactive prompt interrupted.'
      : reason === 'EOF' ? 'Interactive input ended before an answer was submitted.'
      : 'Interactive prompt failed.');
    this.name = 'PromptError';
  }

  get exitCode(): number {
    return this.reason === 'SIGINT' ? 130 : 1;
  }
}

function promptLine(question: string, input: Readable, output: Writable, hidden: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    const terminal = input as Readable & { isRaw?: boolean; setRawMode?: (mode: boolean) => unknown };
    const wasRaw = Boolean(terminal.isRaw);
    let rl: readline.Interface | undefined;
    let settled = false;
    let answered = false;
    let pendingOutput = 0;
    let outputFailed = false;
    let outputErrorSeen = false;
    let outputClosed = false;
    // readline also writes cursor controls outside _writeToOutput. Forward
    // through an owned stream so synchronous failures during editing reject
    // the prompt rather than escaping from an input event handler.
    const display = new PassThrough();
    Object.defineProperty(display, 'columns', { get: () => (output as NodeJS.WriteStream).columns });
    function writeOutput(chunk: string | Buffer, onSuccess?: () => void): void {
      pendingOutput++;
      try {
        output.write(chunk, (error) => {
          pendingOutput--;
          if (error) outputFailed = true;
          else onSuccess?.();
          releaseOutputErrorListener();
        });
      } catch {
        pendingOutput--;
        onError();
      }
    }
    function forwardOutput(chunk: Buffer): void {
      if (!settled) writeOutput(chunk);
    }
    display.on('data', forwardOutput);
    const onResize = () => display.emit('resize');
    // Construction can throw after readline attaches listeners but before it
    // returns an interface. Track only those additions so cleanup still works.
    const tracked = [
      ...['error', 'end', 'keypress'].map((event) => ({ stream: input, event })),
      { stream: display, event: 'resize' },
    ].map(({ stream, event }) => ({
      stream, event, before: stream.listeners(event), added: [] as ReturnType<Readable['listeners']>,
    }));

    function finish(error?: PromptError, answer?: string): void {
      if (settled) return;
      settled = true;
      try {
        rl?.close();
      } catch {
        error = new PromptError('IO');
      } finally {
        try {
          if (terminal.setRawMode && Boolean(terminal.isRaw) !== wasRaw) terminal.setRawMode(wasRaw);
        } catch {
          error = new PromptError('IO');
        }
        for (const { stream, event, added } of tracked) {
          for (const listener of added) stream.removeListener(event, listener as (...args: unknown[]) => void);
        }
        input.removeListener('end', onEnd);
        input.removeListener('close', onEnd);
        input.removeListener('error', onError);
        releaseOutputErrorListener();
        output.removeListener('finish', onError);
        output.removeListener('resize', onResize);
        rl?.removeListener('error', onError);
        rl?.removeListener('SIGINT', onInterrupt);
        rl?.removeListener('close', onEnd);
        display.removeListener('data', forwardOutput);
        display.destroy();
      }
      if (error) reject(error);
      else resolve(answer!);
    }

    function onEnd(): void {
      if (!answered) finish(new PromptError('EOF'));
    }
    function onInterrupt(): void {
      if (!answered) finish(new PromptError('SIGINT'));
    }
    function onError(): void {
      finish(new PromptError('IO'));
    }
    function releaseOutputErrorListener(): void {
      // Cancellation can finish before an earlier write fails. Keep the error
      // handler until all write callbacks AND any subsequent error event run.
      if (settled && (outputClosed || (pendingOutput === 0 && (!outputFailed || outputErrorSeen)))) {
        output.removeListener('error', onOutputError);
        output.removeListener('close', onOutputClose);
      }
    }
    function onOutputError(): void {
      outputErrorSeen = true;
      onError();
      releaseOutputErrorListener();
    }
    function onOutputClose(): void {
      outputClosed = true;
      onError();
      releaseOutputErrorListener();
    }

    // Run before readline's EOF handler, which can emit an unterminated line
    // as an answer. Only Enter submits a secret or a destructive confirmation.
    input.on('end', onEnd);
    input.on('close', onEnd);
    output.on('error', onOutputError);
    output.on('close', onOutputClose);
    output.on('finish', onError);
    output.on('resize', onResize);
    try {
      if (input.readableEnded || input.destroyed) {
        onEnd();
        return;
      }
      if (output.destroyed || output.writableEnded) {
        onError();
        return;
      }
      try {
        rl = readline.createInterface({ input, output: display, terminal: true });
      } finally {
        for (const entry of tracked) {
          entry.added = entry.stream.listeners(entry.event).filter((listener) =>
            !entry.before.includes(listener) && listener !== onEnd && listener !== onError);
        }
      }
      rl.on('error', onError);
      rl.on('SIGINT', onInterrupt);
      rl.on('close', onEnd);
      // readline must receive the stream error before our cleanup removes its
      // error listener; EventEmitter may already be dispatching both handlers.
      input.on('error', onError);
      if (hidden) {
        const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
        // Line refresh erases the prompt before this hook runs. Re-emit only
        // the question, swallowing both the partial line and typed characters.
        rlAny._writeToOutput = (str) => {
          if (str.startsWith(question)) display.write(question);
        };
      }
      rl.question(question, (answer) => {
        if (settled || answered) return;
        answered = true;
        // A barrier after the question/echo detects pending output failures
        // before accepting the answer, including a hidden prompt's newline.
        writeOutput(hidden ? '\n' : '', () => finish(undefined, answer));
      });
    } catch {
      onError();
    }
  });
}

/**
 * Prompts the user for a line of input on `input`/`output` without echoing
 * the typed characters back (suitable for secret values entered at a
 * terminal). Resolves with the entered line (without its trailing newline).
 */
export function promptHiddenPassword(
  question: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<string> {
  return promptLine(question, input, output, true);
}

/**
 * Prompts the user with a y/N confirmation on `input`/`output`, echoing the
 * typed characters normally. Resolves `true` only for an answer starting
 * with `y`/`Y` (matching the conventional "default no" y/N phrasing);
 * anything else (including an empty answer) resolves `false`.
 */
export function promptConfirm(
  question: string,
  input: Readable = process.stdin,
  output: Writable = process.stdout
): Promise<boolean> {
  return promptLine(question, input, output, false).then((answer) => /^y/i.test(answer.trim()));
}
