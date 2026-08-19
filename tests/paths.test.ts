import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ensureConfigDir, resolveConfigDir } from '../src/paths.js';

const createdDirs: string[] = [];

afterEach(() => {
  while (createdDirs.length > 0) {
    const dir = createdDirs.pop();
    if (dir) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
});

function makeTempParent(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'local-secret-paths-test-'));
  createdDirs.push(dir);
  return dir;
}

describe('resolveConfigDir', () => {
  it('resolves to ~/.config/local-secret by default (no options)', () => {
    expect(resolveConfigDir()).toBe(path.join(os.homedir(), '.config', 'local-secret'));
  });

  it('resolves to ~/.config/local-secret when called with an empty options object', () => {
    expect(resolveConfigDir({})).toBe(path.join(os.homedir(), '.config', 'local-secret'));
  });

  it('uses the provided appName instead of the default', () => {
    expect(resolveConfigDir({ appName: 'my-app' })).toBe(path.join(os.homedir(), '.config', 'my-app'));
  });

  it('uses the provided configDir as-is, ignoring appName default', () => {
    const configDir = path.join(os.tmpdir(), 'some', 'override', 'dir');
    expect(resolveConfigDir({ configDir })).toBe(configDir);
  });

  it('prefers configDir over appName when both are provided', () => {
    const configDir = path.join(os.tmpdir(), 'explicit', 'override');
    expect(resolveConfigDir({ configDir, appName: 'ignored-app-name' })).toBe(configDir);
  });
});

describe('ensureConfigDir', () => {
  it('creates the directory when it does not exist yet', () => {
    const parent = makeTempParent();
    const configDir = path.join(parent, 'config');
    expect(fs.existsSync(configDir)).toBe(false);

    ensureConfigDir(configDir);

    expect(fs.existsSync(configDir)).toBe(true);
    expect(fs.statSync(configDir).isDirectory()).toBe(true);
  });

  it('creates missing parent directories recursively', () => {
    const parent = makeTempParent();
    const configDir = path.join(parent, 'nested', 'deeply', 'config');

    ensureConfigDir(configDir);

    expect(fs.existsSync(configDir)).toBe(true);
    expect(fs.statSync(configDir).isDirectory()).toBe(true);
  });

  it('sets directory permissions to mode 0o700', () => {
    const parent = makeTempParent();
    const configDir = path.join(parent, 'config');

    ensureConfigDir(configDir);

    const mode = fs.statSync(configDir).mode & 0o777;
    expect(mode).toBe(0o700);
  });

  it('is idempotent when the directory already exists', () => {
    const parent = makeTempParent();
    const configDir = path.join(parent, 'config');

    ensureConfigDir(configDir);
    expect(() => ensureConfigDir(configDir)).not.toThrow();

    expect(fs.existsSync(configDir)).toBe(true);
  });
});
