import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { copyFileSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { cleanupTmpConfigDir, createTmpConfigDir, runCli } from './helpers.js';

const execute = promisify(execFile);
const harness = fileURLToPath(new URL('./prompt-pty.py', import.meta.url));
const cli = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const hiddenQuestion = 'Enter secret value (input is hidden): ';
const secret = 'pty-sensitive-dummy';
let configDir: string;

beforeEach(() => { configDir = createTmpConfigDir(); });
afterEach(() => { cleanupTmpConfigDir(configDir); });

async function prompt(args: string[], question: string, input: string) {
  const command = process.env.LSEC_E2E_CLI
    ? [process.env.LSEC_E2E_CLI, ...args]
    : [process.execPath, cli, ...args];
  const { stdout } = await execute('python3', [harness, JSON.stringify({ command, prompt: question, input })], {
    env: { ...process.env, LOCAL_SECRET_CONFIG_DIR: configDir },
    timeout: 15000,
  });
  const result = JSON.parse(stdout) as {
    stdout: string; stderr: string; exitCode: number; terminalRestored: boolean;
  };
  expect(result.terminalRestored).toBe(true);
  return result;
}

function snapshot() {
  return readdirSync(configDir).sort().map((name) => [name, readFileSync(join(configDir, name))]);
}

async function seed() {
  expect((await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, secret)).exitCode).toBe(0);
}

const interruptions = [
  ['Ctrl-C', '\x03', 130],
  ['partial input + Ctrl-C', 'y' + secret + '\x03', 130],
  ['Ctrl-D / EOF', '\x04', 1],
] as const;

describe('interactive set (PTY)', () => {
  it.each(interruptions)('%s fails without creating a store', async (_label, input, code) => {
    const result = await prompt(['set', 'token'], hiddenQuestion, input);
    expect(result.exitCode).toBe(code);
    expect(result.stderr).toContain('Error: Interactive');
    expect(result.stderr).not.toContain('saved');
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(snapshot()).toEqual([]);
  });

  it.each(interruptions)('%s preserves the existing value and files', async (_label, input, code) => {
    await seed();
    const before = snapshot();
    const result = await prompt(['set', 'token', '--ns', 'work'], hiddenQuestion, input);
    expect(result.exitCode).toBe(code);
    expect(result.stderr).not.toContain('saved');
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect(snapshot()).toEqual(before);
    expect((await runCli(['get', 'token', '--ns', 'work'], configDir)).stdout).toBe(secret);
  });

  it('saves a submitted value without displaying it', async () => {
    const result = await prompt(['set', 'token'], hiddenQuestion, secret + '\r');
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('saved');
    expect(result.stdout + result.stderr).not.toContain(secret);
    expect((await runCli(['get', 'token'], configDir)).stdout).toBe(secret);
  });

  it('rejects an explicitly submitted empty value', async () => {
    const result = await prompt(['set', 'token'], hiddenQuestion, '\r');
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('must not be empty');
    expect(snapshot()).toEqual([]);
  });
});

describe.each([
  ['rotate-key', ['rotate-key'], 'Rotate master.key and re-encrypt all stored secrets? [y/N] '],
  ['delete-namespace', ['delete-namespace', 'work'], 'Delete namespace "work" and its 1 key(s)? [y/N] '],
] as const)('%s confirmation (PTY)', (name, args, question) => {
  it.each(interruptions)('%s leaves keys, data, and the namespace untouched', async (_label, input, code) => {
    await seed();
    const before = snapshot();
    const result = await prompt([...args], question, input);
    expect(result.exitCode).toBe(code);
    expect(result.stderr).toContain('Error: Interactive');
    expect(result.stderr).not.toMatch(/rotated|deleted|Aborted/);
    expect(snapshot()).toEqual(before);
    expect((await runCli(['get', 'token', '--ns', 'work'], configDir)).stdout).toBe(secret);
  });

  it.each(interruptions)('%s also preserves an existing recovery backup', async (_label, input, code) => {
    await seed();
    copyFileSync(join(configDir, 'master.key'), join(configDir, 'master.key.bak'));
    const before = snapshot();
    const result = await prompt([...args], question, input);
    expect(result.exitCode).toBe(code);
    expect(snapshot()).toEqual(before);
  });

  it.each(['n\r', '\r'])('%j explicitly cancels with exit 0', async (input) => {
    await seed();
    const before = snapshot();
    const result = await prompt([...args], question, input);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('Aborted.');
    expect(snapshot()).toEqual(before);
  });

  it('performs the operation only after y + Enter', async () => {
    await seed();
    const keyBefore = readFileSync(join(configDir, 'master.key'));
    const result = await prompt([...args], question, 'y\r');
    expect(result.exitCode).toBe(0);
    if (name === 'rotate-key') {
      expect(result.stderr).toContain('rotated');
      expect(readFileSync(join(configDir, 'master.key'))).not.toEqual(keyBefore);
      expect((await runCli(['get', 'token', '--ns', 'work'], configDir)).stdout).toBe(secret);
    } else {
      expect(result.stderr).toContain('deleted');
      expect((await runCli(['namespaces'], configDir)).stdout).not.toContain('work');
    }
  });
});
