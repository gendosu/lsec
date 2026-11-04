import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const installer = fileURLToPath(new URL('../install.sh', import.meta.url));
const roots: string[] = [];
const oldBinary = '#!/bin/sh\nprintf "old-version\\n"\n';

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function commandPath(command: string): string {
  return execFileSync('/bin/sh', ['-c', 'command -v "$1"', 'sh', command], { encoding: 'utf8' }).trim();
}

function fixture(options: { smokeCode?: number; fresh?: boolean } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lsec-install-test-'));
  roots.push(root);
  const binDir = path.join(root, 'commands');
  const installDir = path.join(root, 'install with spaces', 'bin');
  const tmpDir = path.join(root, 'tmp');
  const target = path.join(installDir, 'lsec');
  const smokeLog = path.join(root, 'smoke.log');
  const downloadLog = path.join(root, 'downloads.log');
  const moveLog = path.join(root, 'move.json');
  const stagingLog = path.join(root, 'staging.log');
  const checksumLog = path.join(root, 'checksum.log');
  const releaseBinary = path.join(root, 'release-binary');
  const releaseSums = path.join(root, 'SHA256SUMS');
  const newBinary = `#!/bin/sh\nprintf '%s\\n' "$0" >> "$SMOKE_LOG"\nprintf 'new-version\\n'\nexit ${options.smokeCode ?? 0}\n`;
  fs.mkdirSync(binDir);
  fs.mkdirSync(tmpDir);
  fs.writeFileSync(releaseBinary, newBinary);
  const checksum = createHash('sha256').update(newBinary).digest('hex');
  fs.writeFileSync(releaseSums, ['linux-x64', 'linux-arm64', 'darwin-x64', 'darwin-arm64']
    .map((platform) => `${checksum}  lsec-${platform}\n`).join(''));
  if (!options.fresh) {
    fs.mkdirSync(installDir, { recursive: true });
    fs.writeFileSync(target, oldBinary, { mode: 0o751 });
  }

  function stub(command: string, body: string) {
    const file = path.join(binDir, command);
    fs.rmSync(file, { force: true });
    fs.writeFileSync(file, `#!${process.execPath}\nconst fs = require('node:fs');\nconst { execFileSync } = require('node:child_process');\nconst args = process.argv.slice(2);\n${body}\n`, { mode: 0o755 });
  }

  for (const command of ['awk', 'chmod', 'mkdir', 'rm']) {
    fs.symlinkSync(commandPath(command), path.join(binDir, command));
  }
  stub('uname', "process.stdout.write(args[0] === '-s' ? 'Linux\\n' : 'x86_64\\n');");
  stub('curl', `
    const url = args.at(-1);
    fs.appendFileSync(${JSON.stringify(downloadLog)}, url + '\\n');
    fs.copyFileSync(url.endsWith('/SHA256SUMS') ? ${JSON.stringify(releaseSums)} : ${JSON.stringify(releaseBinary)}, args[args.indexOf('-o') + 1]);
  `);
  stub('mktemp', `
    const output = execFileSync(${JSON.stringify(commandPath('mktemp'))}, args, { encoding: 'utf8' });
    fs.appendFileSync(${JSON.stringify(stagingLog)}, output);
    process.stdout.write(output);
  `);
  stub('mv', `
    const source = args.at(-2);
    const destination = args.at(-1);
    fs.writeFileSync(${JSON.stringify(moveLog)}, JSON.stringify({
      source, destination, sourceDevice: fs.statSync(source).dev,
      destinationDevice: fs.statSync(${JSON.stringify(installDir)}).dev,
      smokePaths: fs.existsSync(${JSON.stringify(smokeLog)}) ? fs.readFileSync(${JSON.stringify(smokeLog)}, 'utf8').trim().split('\\n') : [],
    }));
    execFileSync(${JSON.stringify(commandPath('mv'))}, args, { stdio: 'inherit' });
  `);
  for (const command of ['sha256sum', 'shasum']) {
    stub(command, `
      fs.appendFileSync(${JSON.stringify(checksumLog)}, ${JSON.stringify(command + '\n')});
      execFileSync(${JSON.stringify(commandPath(command))}, args, { stdio: 'inherit' });
    `);
  }

  const env = {
    HOME: root, PATH: binDir, TMPDIR: tmpDir,
    LSEC_INSTALL_DIR: installDir, SMOKE_LOG: smokeLog,
  };
  return {
    root, binDir, installDir, tmpDir, target, smokeLog, downloadLog, moveLog,
    stagingLog, checksumLog, releaseBinary, releaseSums, newBinary, env, stub,
    run: (extraEnv: Record<string, string> = {}) => spawnSync('/bin/sh', [installer], {
      env: { ...env, ...extraEnv }, encoding: 'utf8', timeout: 10_000,
    }),
    expectOldBinary: () => {
      expect(fs.readFileSync(target, 'utf8')).toBe(oldBinary);
      expect(fs.statSync(target).mode & 0o777).toBe(0o751);
      expect(execFileSync(target, ['--version'], { encoding: 'utf8' })).toBe('old-version\n');
    },
    expectClean: () => {
      expect(fs.readdirSync(tmpDir)).toEqual([]);
      if (fs.existsSync(installDir)) {
        expect(fs.readdirSync(installDir).filter((name) => name.startsWith('.lsec-install.'))).toEqual([]);
      }
      if (fs.existsSync(stagingLog)) {
        for (const dir of fs.readFileSync(stagingLog, 'utf8').trim().split('\n')) {
          expect(fs.existsSync(dir)).toBe(false);
        }
      }
    },
  };
}

describe('install.sh', () => {
  it('preserves the working executable when a checksum-valid release fails its smoke check', () => {
    const f = fixture({ smokeCode: 42 });
    const result = f.run();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(42);
    expect(result.stdout).not.toContain('Installed:');
    f.expectOldBinary();
    f.expectClean();
  });
});
