/**
 * Hidden (no-echo) interactive prompt for local-secret's CLI.
 *
 * Ported from local-secret's src/lib/prompt.ts (promptHiddenPassword), which
 * this library generalizes from IMAP passwords to arbitrary secret values.
 * See design spec §6 (CLI 仕様 - set の値入力):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 */
import * as readline from 'node:readline';
import type { Readable, Writable } from 'node:stream';

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
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    const rlAny = rl as unknown as { _writeToOutput: (s: string) => void };
    // Suppress echo of typed characters; the question is written directly below.
    rlAny._writeToOutput = (_str: string) => { /* no-op: prevent echoing typed chars */ };
    output.write(question);
    rl.question('', (answer) => {
      rl.close();
      output.write('\n');
      resolve(answer);
    });
    rl.on('error', reject);
  });
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
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input, output, terminal: true });
    rl.question(question, (answer) => {
      rl.close();
      resolve(/^y/i.test(answer.trim()));
    });
    rl.on('error', reject);
  });
}
