import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
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

function fixture(options: { smokeCode?: number; fresh?: boolean; binary?: string } = {}) {
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
  const newBinary = options.binary ?? `#!/bin/sh\nprintf '%s\\n' "$0" >> "$SMOKE_LOG"\nprintf 'new-version\\n'\nexit ${options.smokeCode ?? 0}\n`;
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
      destinationDevice: fs.statSync(destination).dev,
      smokePaths: fs.existsSync(${JSON.stringify(smokeLog)}) ? fs.readFileSync(${JSON.stringify(smokeLog)}, 'utf8').trim().split('\\n') : [],
    }));
    execFileSync(${JSON.stringify(commandPath('mv'))}, args, { stdio: 'inherit' });
  `);
  for (const command of ['sha256sum', 'shasum']) {
    stub(command, `
      const { createHash } = require('node:crypto');
      fs.appendFileSync(${JSON.stringify(checksumLog)}, ${JSON.stringify(command + '\n')});
      const expectedArgs = ${command === 'sha256sum' ? 1 : 3};
      if (args.length !== expectedArgs || (expectedArgs === 3 && (args[0] !== '-a' || args[1] !== '256'))) process.exit(2);
      const file = args.at(-1);
      process.stdout.write(createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '  ' + file + '\\n');
    `);
  }

  const env = {
    HOME: root, PATH: binDir, TMPDIR: tmpDir,
    LSEC_INSTALL_DIR: installDir, SMOKE_LOG: smokeLog,
  };
  return {
    root, binDir, installDir, tmpDir, target, smokeLog, downloadLog, moveLog,
    stagingLog, checksumLog, releaseBinary, releaseSums, newBinary, env, stub,
    run: (extraEnv: Record<string, string | undefined> = {}) => spawnSync('/bin/sh', [installer], {
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

  it.each([
    'binary download', 'checksum download', 'missing checksum', 'checksum mismatch',
    'sha256sum', 'shasum', 'mkdir', 'mktemp', 'chmod', 'mv', 'unlaunchable binary',
  ])('preserves the working executable and cleans up after failure at %s', (failure) => {
    const f = fixture(failure === 'unlaunchable binary' ? { binary: '#!/nonexistent/lsec-interpreter\n' } : {});
    if (failure === 'binary download') f.stub('curl', 'process.exit(23);');
    else if (failure === 'checksum download') {
      f.stub('curl', `
        if (args.at(-1).endsWith('/SHA256SUMS')) process.exit(23);
        fs.copyFileSync(${JSON.stringify(f.releaseBinary)}, args[args.indexOf('-o') + 1]);
      `);
    } else if (failure === 'missing checksum') fs.writeFileSync(f.releaseSums, '');
    else if (failure === 'checksum mismatch') fs.appendFileSync(f.releaseBinary, '\n# altered download\n');
    else if (failure === 'sha256sum' || failure === 'shasum') {
      if (failure === 'shasum') fs.unlinkSync(path.join(f.binDir, 'sha256sum'));
      const checksum = createHash('sha256').update(f.newBinary).digest('hex');
      f.stub(failure, `process.stdout.write(${JSON.stringify(checksum + '  lsec\n')}); process.exit(73);`);
    } else if (failure !== 'unlaunchable binary') f.stub(failure, 'process.exit(73);');

    const result = f.run();

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('Installed:');
    f.expectOldBinary();
    f.expectClean();
  });

  it.each([false, true])('installs a validated executable on the destination filesystem (fresh: %s)', (fresh) => {
    const f = fixture({ fresh });
    const unusableTmp = path.join(f.root, 'missing temporary directory');
    const result = f.run({ TMPDIR: unusableTmp });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`Installed: ${f.target}`);
    expect(fs.readFileSync(f.target, 'utf8')).toBe(f.newBinary);
    expect(fs.statSync(f.target).mode & 0o111).toBe(0o111);
    const move = JSON.parse(fs.readFileSync(f.moveLog, 'utf8'));
    expect(path.dirname(path.dirname(move.source))).toBe(f.installDir);
    expect(path.basename(path.dirname(move.source))).toMatch(/^\.lsec-install\./);
    expect(path.basename(move.source)).toBe('lsec');
    expect(move.sourceDevice).toBe(move.destinationDevice);
    expect(move.smokePaths).toEqual([move.source]);
    expect(fs.readFileSync(f.downloadLog, 'utf8').trim().split('\n')).toEqual([
      'https://github.com/gendosu/lsec/releases/latest/download/lsec-linux-x64',
      'https://github.com/gendosu/lsec/releases/latest/download/SHA256SUMS',
    ]);
    expect(fs.existsSync(unusableTmp)).toBe(false);
    expect(execFileSync(f.target, ['--version'], { env: f.env, encoding: 'utf8' })).toBe('new-version\n');
    f.expectClean();
  });

  it('uses the isolated HOME for the default install directory and preserves PATH guidance', () => {
    const f = fixture();
    const target = path.join(f.root, '.local', 'bin', 'lsec');
    const result = f.run({ LSEC_INSTALL_DIR: undefined });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(fs.readFileSync(target, 'utf8')).toBe(f.newBinary);
    expect(result.stdout).toContain(`Installed: ${target}`);
    expect(result.stdout).toContain(`NOTE: ${path.dirname(target)} is not on your PATH.`);
    f.expectOldBinary();
    f.expectClean();
  });

  it('replaces an existing file symlink without modifying the linked executable', () => {
    const f = fixture();
    const linked = path.join(f.root, 'linked-lsec');
    fs.renameSync(f.target, linked);
    fs.symlinkSync(linked, f.target);

    const result = f.run();

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(fs.lstatSync(f.target).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(f.target, 'utf8')).toBe(f.newBinary);
    expect(fs.readFileSync(linked, 'utf8')).toBe(oldBinary);
    expect(fs.statSync(linked).mode & 0o777).toBe(0o751);
    f.expectClean();
  });

  it.each(['smoke', 'download', 'mv'])('leaves no executable after a failed fresh installation (%s)', (failure) => {
    const f = fixture({ fresh: true, smokeCode: failure === 'smoke' ? 42 : 0 });
    if (failure !== 'smoke') f.stub(failure === 'download' ? 'curl' : 'mv', 'process.exit(73);');

    const result = f.run();

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('Installed:');
    expect(fs.existsSync(f.target)).toBe(false);
    f.expectClean();
  });

  it.each(['directory', 'directory symlink'])('rejects a destination that is a %s without changing its contents', (kind) => {
    const f = fixture();
    const directory = path.join(f.root, 'existing-directory');
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'keep'), 'existing content');
    fs.unlinkSync(f.target);
    if (kind === 'directory') fs.renameSync(directory, f.target);
    else fs.symlinkSync(directory, f.target);
    const contents = kind === 'directory' ? f.target : directory;

    const result = f.run();

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('install target is a directory');
    expect(result.stdout).not.toContain('Installed:');
    expect(fs.readdirSync(contents)).toEqual(['keep']);
    expect(fs.readFileSync(path.join(contents, 'keep'), 'utf8')).toBe('existing content');
    if (kind === 'directory symlink') expect(fs.readlinkSync(f.target)).toBe(directory);
    expect(fs.existsSync(f.moveLog)).toBe(false);
    f.expectClean();
  });

  it('cannot move into a destination directory created just before placement', () => {
    const f = fixture();
    f.stub('mv', `
      fs.unlinkSync(${JSON.stringify(f.target)});
      fs.mkdirSync(${JSON.stringify(f.target)});
      fs.writeFileSync(${JSON.stringify(path.join(f.target, 'keep'))}, 'concurrent directory');
      execFileSync(${JSON.stringify(commandPath('mv'))}, args, { stdio: 'inherit' });
    `);

    const result = f.run();

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stdout).not.toContain('Installed:');
    expect(fs.readdirSync(f.target)).toEqual(['keep']);
    f.expectClean();
  });

  it.each([
    ['download', 'SIGINT'], ['download', 'SIGTERM'],
    ['placement', 'SIGINT'], ['placement', 'SIGTERM'],
  ] as const)('stops and cleans up during %s after %s', async (phase, signal) => {
    const f = fixture();
    if (phase === 'download') f.stub('curl', `
      const url = args.at(-1);
      fs.appendFileSync(${JSON.stringify(f.downloadLog)}, url + '\\n');
      fs.copyFileSync(url.endsWith('/SHA256SUMS') ? ${JSON.stringify(f.releaseSums)} : ${JSON.stringify(f.releaseBinary)}, args[args.indexOf('-o') + 1]);
      if (!url.endsWith('/SHA256SUMS')) {
        process.on('SIGTERM', () => process.exit(0));
        process.stdout.write('command-ready:' + process.pid + '\\n');
        setInterval(() => {}, 1000);
      }
    `);
    else f.stub('mv', `
      process.on('SIGTERM', () => process.exit(143));
      process.stdout.write('command-ready:' + process.pid + '\\n');
      setInterval(() => {}, 1000);
    `);
    const child = spawn('/bin/sh', [installer], { env: f.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let workerPid: number | undefined;
    const closed = new Promise<number | null>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', resolve);
    });
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      const ready = /command-ready:(\d+)\n/.exec(stdout);
      if (ready && workerPid === undefined) {
        workerPid = Number(ready[1]);
        child.kill(signal);
        // A foreground download can defer sh's trap; placement must stop its own child.
        if (phase === 'download') process.kill(workerPid, 'SIGTERM');
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const code = await Promise.race([
        closed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`Installer did not stop: ${stderr}`)), 10_000);
        }),
      ]);
      expect(workerPid).toBeDefined();
      expect(code).toBe(signal === 'SIGINT' ? 130 : 143);
      expect(stdout).not.toContain('Installed:');
      expect(fs.readFileSync(f.downloadLog, 'utf8').trim().split('\n')).toHaveLength(phase === 'download' ? 1 : 2);
      expect(fs.existsSync(f.moveLog)).toBe(false);
      f.expectOldBinary();
      f.expectClean();
    } finally {
      clearTimeout(timer);
      if (workerPid !== undefined) {
        try { process.kill(workerPid, 'SIGKILL'); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
        }
      }
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await closed;
    }
  }, 15_000);

  it.each([
    ['Linux', 'x86_64', 'linux-x64', 'sha256sum'],
    ['Linux', 'aarch64', 'linux-arm64', 'sha256sum'],
    ['Darwin', 'arm64', 'darwin-arm64', 'shasum'],
    ['Darwin', 'amd64', 'darwin-x64', 'shasum'],
  ])('selects the %s/%s asset (%s) and verifies it with %s', (os, cpu, platform, checksum) => {
    const f = fixture();
    f.stub('uname', `process.stdout.write(args[0] === '-s' ? ${JSON.stringify(os + '\n')} : ${JSON.stringify(cpu + '\n')});`);
    if (checksum === 'shasum') fs.unlinkSync(path.join(f.binDir, 'sha256sum'));
    const result = f.run({ LSEC_VERSION: 'v0.3.0' });

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(fs.readFileSync(f.downloadLog, 'utf8').trim().split('\n')).toEqual([
      `https://github.com/gendosu/lsec/releases/download/v0.3.0/lsec-${platform}`,
      'https://github.com/gendosu/lsec/releases/download/v0.3.0/SHA256SUMS',
    ]);
    expect(fs.readFileSync(f.checksumLog, 'utf8')).toBe(`${checksum}\n`);
    f.expectClean();
  });
});
