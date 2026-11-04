import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { writeFileAtomic } from '../src/atomic-file.js';

vi.mock('node:fs', async (original) => ({ ...await original<typeof fs>() }));
vi.mock('node:crypto', async (original) => ({ ...await original<typeof crypto>() }));
const dirs: string[] = [];
function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsec-atomic-'));
  dirs.push(dir);
  return { dir, file: path.join(dir, 'target') };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

it('replaces the target privately without touching a legacy temporary symlink', () => {
  const { dir, file } = fixture();
  const other = path.join(dir, 'other');
  fs.writeFileSync(other, 'other-dummy', { mode: 0o640 });
  fs.symlinkSync(other, `${file}.tmp`);
  writeFileAtomic(file, 'new-dummy');
  expect(fs.readFileSync(file, 'utf8')).toBe('new-dummy');
  expect(fs.statSync(file).mode & 0o777).toBe(0o600);
  expect(fs.readlinkSync(`${file}.tmp`)).toBe(other);
  expect(fs.readFileSync(other, 'utf8')).toBe('other-dummy');
  expect(fs.statSync(other).mode & 0o777).toBe(0o640);
  expect(fs.readdirSync(dir).sort()).toEqual(['other', 'target', 'target.tmp']);
});

it.each(['openSync', 'writeFileSync', 'fchmodSync', 'closeSync', 'renameSync'] as const)(
  'preserves the original and closes/cleans its own file if %s fails', (method) => {
    const { dir, file } = fixture();
    fs.writeFileSync(file, 'original-dummy');
    const cause = new Error('injected failure');
    const original = fs[method] as (...args: unknown[]) => unknown;
    const close = vi.spyOn(fs, 'closeSync');
    vi.spyOn(fs, method).mockImplementation((...args: unknown[]) => {
      if (method === 'closeSync') original(...args);
      throw cause;
    });
    expect(() => writeFileAtomic(file, 'new-dummy')).toThrow(cause);
    if (method !== 'openSync') expect(close).toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(fs.readFileSync(file, 'utf8')).toBe('original-dummy');
    expect(fs.readdirSync(dir)).toEqual(['target']);
  }
);

it.each(['file', 'symlink'])('never removes or overwrites another owner on an exclusive-create collision (%s)', (kind) => {
  const { dir, file } = fixture();
  const id = '00000000-0000-4000-8000-000000000000';
  vi.spyOn(crypto, 'randomUUID').mockReturnValue(id);
  const temp = `${file}.${id}.tmp`;
  if (kind === 'file') fs.writeFileSync(temp, 'other-dummy');
  else fs.symlinkSync(path.join(dir, 'absent'), temp);
  const before = fs.lstatSync(temp);
  expect(() => writeFileAtomic(file, 'new-dummy')).toThrow();
  expect(fs.lstatSync(temp).ino).toBe(before.ino);
  expect(fs.existsSync(file)).toBe(false);
  if (kind === 'file') expect(fs.readFileSync(temp, 'utf8')).toBe('other-dummy');
  else expect(fs.existsSync(path.join(dir, 'absent'))).toBe(false);
});
