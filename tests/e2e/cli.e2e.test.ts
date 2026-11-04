import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { runStoreWorker } from './store-process.js';
import pkg from '../../package.json' with { type: 'json' };
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanupTmpConfigDir, createTmpConfigDir, runCli } from './helpers.js';

let configDir: string;

beforeEach(() => {
  configDir = createTmpConfigDir();
});

afterEach(() => {
  cleanupTmpConfigDir(configDir);
});

describe('lsec CLI (e2e)', () => {
  it('--version は package.json の version を出力する', async () => {
    const result = await runCli(['--version'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(pkg.version);
  });

  it('set(--stdin) -> get -> list -> delete -> namespaces で global の一連が動作する', async () => {
    const setResult = await runCli(['set', 'api_key', '--stdin'], configDir, 'sekret-value\n');
    expect(setResult.exitCode).toBe(0);
    expect(setResult.stdout).toBe('');

    const getResult = await runCli(['get', 'api_key'], configDir);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toBe('sekret-value');
    expect(getResult.stdout.endsWith('\n')).toBe(false);

    const listResult = await runCli(['list'], configDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout.split('\n').filter(Boolean)).toEqual(['api_key']);

    const deleteResult = await runCli(['delete', 'api_key'], configDir);
    expect(deleteResult.exitCode).toBe(0);

    const listAfterDeleteResult = await runCli(['list'], configDir);
    expect(listAfterDeleteResult.exitCode).toBe(0);
    expect(listAfterDeleteResult.stdout.trim()).toBe('');

    const namespacesResult = await runCli(['namespaces'], configDir);
    expect(namespacesResult.exitCode).toBe(0);
    expect(namespacesResult.stdout.trim()).toBe('');
  });

  it('--ns で名前空間を指定した set/get/list/namespaces/list --all が動作する', async () => {
    const setResult = await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, 'work-token');
    expect(setResult.exitCode).toBe(0);

    const getResult = await runCli(['get', 'token', '--ns', 'work'], configDir);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toBe('work-token');

    // global の list には "work" namespace の key は出てこない
    const globalListResult = await runCli(['list'], configDir);
    expect(globalListResult.exitCode).toBe(0);
    expect(globalListResult.stdout.trim()).toBe('');

    const nsListResult = await runCli(['list', '--ns', 'work'], configDir);
    expect(nsListResult.exitCode).toBe(0);
    expect(nsListResult.stdout.split('\n').filter(Boolean)).toEqual(['token']);

    const namespacesResult = await runCli(['namespaces'], configDir);
    expect(namespacesResult.exitCode).toBe(0);
    expect(namespacesResult.stdout).toContain('work');

    const listAllResult = await runCli(['list', '--all'], configDir);
    expect(listAllResult.exitCode).toBe(0);
    expect(listAllResult.stdout).toContain('work:');
    expect(listAllResult.stdout).toContain('token');
  });

  it('未登録 key の get は非ゼロ終了し、stdout は空で stderr にメッセージを出す', async () => {
    const result = await runCli(['get', 'does-not-exist'], configDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain('does-not-exist');
  });

  it('未登録 key の delete は冪等に成功する（非ゼロにならない）', async () => {
    const result = await runCli(['delete', 'does-not-exist'], configDir);
    expect(result.exitCode).toBe(0);
  });

  it('set で入力が空文字の場合は非ゼロ終了する', async () => {
    const result = await runCli(['set', 'empty-key', '--stdin'], configDir, '');
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('list に --ns と --all を同時指定するとエラーになる', async () => {
    const result = await runCli(['list', '--ns', 'work', '--all'], configDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain('mutually exclusive');
  });

  it('list --refs は global の key を lsec://global/<key> 形式で1行1件出力する', async () => {
    await runCli(['set', 'api_key', '--stdin'], configDir, 'v1');

    const result = await runCli(['list', '--refs'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['lsec://global/api_key']);
  });

  it('list --ns <ns> --refs は lsec://<ns>/<key> 形式で出力する', async () => {
    await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, 'v1');

    const result = await runCli(['list', '--ns', 'work', '--refs'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['lsec://work/token']);
  });

  it('list --all --refs は全 namespace の key をグルーピングなしのフラットな参照一覧で出力する', async () => {
    await runCli(['set', 'api_key', '--stdin'], configDir, 'v1');
    await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, 'v2');

    const result = await runCli(['list', '--all', '--refs'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual([
      'lsec://global/api_key',
      'lsec://work/token',
    ]);
    // --refs ではグルーピング見出し（"work:"）やインデントを出さない
    expect(result.stdout).not.toContain('work:');
    expect(result.stdout).not.toContain('  ');
  });

  it('list --refs は参照として表現できない key（空白入り等）を stdout から除外し stderr に警告する', async () => {
    await runCli(['set', 'has space', '--stdin'], configDir, 'v1');
    await runCli(['set', 'api_key', '--stdin'], configDir, 'v2');

    const result = await runCli(['list', '--refs'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.split('\n').filter(Boolean)).toEqual(['lsec://global/api_key']);
    expect(result.stderr).toContain('has space');
  });

  it('delete-namespace --yes で namespace ごと削除され、namespaces() から消える', async () => {
    const setResult = await runCli(['set', 'a', '--ns', 'imap', '--stdin'], configDir, 'va');
    expect(setResult.exitCode).toBe(0);
    await runCli(['set', 'b', '--ns', 'imap', '--stdin'], configDir, 'vb');

    const deleteResult = await runCli(['delete-namespace', 'imap', '--yes'], configDir);
    expect(deleteResult.exitCode).toBe(0);

    const namespacesResult = await runCli(['namespaces'], configDir);
    expect(namespacesResult.exitCode).toBe(0);
    expect(namespacesResult.stdout.trim()).toBe('');

    const listResult = await runCli(['list', '--ns', 'imap'], configDir);
    expect(listResult.exitCode).toBe(0);
    expect(listResult.stdout.trim()).toBe('');
  });

  it('存在しない namespace への delete-namespace --yes は冪等に成功する（非ゼロにならない）', async () => {
    const result = await runCli(['delete-namespace', 'does-not-exist', '--yes'], configDir);
    expect(result.exitCode).toBe(0);
  });

  it('非 TTY で --yes を付けない delete-namespace はエラーで非ゼロ終了する（ハングしない）', async () => {
    const result = await runCli(['delete-namespace', 'imap'], configDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });

  it('has は存在する key で exit 0、未登録 key で exit 1 を返し、標準出力には何も出さない', async () => {
    const setResult = await runCli(['set', 'api_key', '--stdin'], configDir, 'sekret-value');
    expect(setResult.exitCode).toBe(0);

    const hasResult = await runCli(['has', 'api_key'], configDir);
    expect(hasResult.exitCode).toBe(0);
    expect(hasResult.stdout).toBe('');
    expect(hasResult.stderr).toBe('');

    const hasMissingResult = await runCli(['has', 'does-not-exist'], configDir);
    expect(hasMissingResult.exitCode).toBe(1);
    expect(hasMissingResult.stdout).toBe('');
    expect(hasMissingResult.stderr).toBe('');
  });

  it('has --ns は namespace ごとに存在確認を分離する（global と ns を混同しない）', async () => {
    const setResult = await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, 'work-token');
    expect(setResult.exitCode).toBe(0);

    const hasInNsResult = await runCli(['has', 'token', '--ns', 'work'], configDir);
    expect(hasInNsResult.exitCode).toBe(0);

    const hasInGlobalResult = await runCli(['has', 'token'], configDir);
    expect(hasInGlobalResult.exitCode).toBe(1);
  });

  it('LOCAL_SECRET_CONFIG_DIR で指定したディレクトリ配下に secrets.json / master.key が作られる（実ホームを汚染しない）', async () => {
    const setResult = await runCli(['set', 'k', '--stdin'], configDir, 'v');
    expect(setResult.exitCode).toBe(0);

    const { existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    expect(existsSync(join(configDir, 'secrets.json'))).toBe(true);
    expect(existsSync(join(configDir, 'master.key'))).toBe(true);
  });

  it('rotate-key --yes で master.key が置き換わり、前後で get が同値を返す', async () => {
    await runCli(['set', 'api_key', '--stdin'], configDir, 'sekret-value');
    await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, 'work-token');

    const { readFileSync, existsSync } = await import('node:fs');
    const { join } = await import('node:path');
    const keyBefore = readFileSync(join(configDir, 'master.key'));

    const rotateResult = await runCli(['rotate-key', '--yes'], configDir);
    expect(rotateResult.exitCode).toBe(0);
    expect(rotateResult.stderr).toContain('2');

    const keyAfter = readFileSync(join(configDir, 'master.key'));
    expect(keyAfter.equals(keyBefore)).toBe(false);
    expect(existsSync(join(configDir, 'master.key.bak'))).toBe(false);

    const getResult = await runCli(['get', 'api_key'], configDir);
    expect(getResult.exitCode).toBe(0);
    expect(getResult.stdout).toBe('sekret-value');

    const getNsResult = await runCli(['get', 'token', '--ns', 'work'], configDir);
    expect(getNsResult.exitCode).toBe(0);
    expect(getNsResult.stdout).toBe('work-token');
  });

  it('空ストアに対する rotate-key --yes は 0 件で成功する', async () => {
    const result = await runCli(['rotate-key', '--yes'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain('0');
  });

  it.each(['data persistence', 'backup cleanup'])(
    '%s の中断後は別 CLI の更新を拒否し、全値確認後に復旧できる',
    async (stage) => {
      const values = [
        { key: 'token', namespace: undefined, value: 'global-recovery-dummy' },
        { key: 'token', namespace: 'work', value: 'work-recovery-dummy' },
        { key: 'token', namespace: 'aws', value: 'aws-recovery-dummy' },
      ];
      for (const { key, namespace, value } of values) {
        const result = await runCli(
          ['set', key, ...(namespace ? ['--ns', namespace] : []), '--stdin'], configDir, value
        );
        expect(result.exitCode).toBe(0);
      }
      const keyPath = path.join(configDir, 'master.key');
      const secretsPath = path.join(configDir, 'secrets.json');
      const backupPath = path.join(configDir, 'master.key.bak');
      const oldKey = fs.readFileSync(keyPath);
      const rotated = stage === 'data persistence'
        ? await runStoreWorker({ configDir, failAt: 'data', operations: [['rotateMasterKey']] })
          .then((result) => ({ exitCode: result.code, stderr: result.error?.message ?? '' }))
        : await runCli(['rotate-key', '--yes'], configDir);
      if (stage === 'data persistence') {
        expect(rotated.exitCode).not.toBe(0);
        expect(rotated.stderr).toContain('secrets.json persistence');
      } else {
        expect(rotated.exitCode).toBe(0);
        // Represents a crash after data persistence but before backup removal.
        fs.writeFileSync(backupPath, oldKey, { mode: 0o600 });
      }
      const before = [keyPath, secretsPath, backupPath].map((file) => fs.readFileSync(file));
      expect(before[0]).not.toEqual(oldKey);
      expect(before[2]).toEqual(oldKey);
      for (const args of [
        ['rotate-key', '--yes'], ['rotate-key', '--yes'],
        ['set', 'token', '--stdin'], ['set', 'token', '--ns', 'work', '--stdin'],
        ['delete', 'token'], ['delete', 'missing'], ['delete-namespace', 'work', '--yes'],
      ]) {
        const result = await runCli(args, configDir, 'replacement-recovery-dummy');
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(/recovery/i);
        expect(result.stderr).not.toContain('replacement-recovery-dummy');
        expect([keyPath, secretsPath, backupPath].map((file) => fs.readFileSync(file))).toEqual(before);
      }
      if (stage === 'data persistence') {
        const failedRead = await runCli(['get', 'token'], configDir);
        expect(failedRead.exitCode).not.toBe(0);
        expect(failedRead.stdout).toBe('');
        fs.copyFileSync(backupPath, keyPath);
      }
      for (const { key, namespace, value } of values) {
        const result = await runCli(['get', key, ...(namespace ? ['--ns', namespace] : [])], configDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(value);
      }
      fs.unlinkSync(backupPath);
      expect((await runCli(['set', 'recovered', '--stdin'], configDir, 'recovered-dummy')).exitCode).toBe(0);
      expect((await runCli(['rotate-key', '--yes'], configDir)).exitCode).toBe(0);
      for (const { key, namespace, value } of values) {
        const result = await runCli(['get', key, ...(namespace ? ['--ns', namespace] : [])], configDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(value);
      }
      expect((await runCli(['get', 'recovered'], configDir)).stdout).toBe('recovered-dummy');
      expect(fs.existsSync(backupPath)).toBe(false);
    }
  );

  it.each(['get', 'tryGet', 'set', 'rotateMasterKey'] as const)(
    'CLI のローテーション後、既存ライブラリの最初の %s が現行鍵に追従する',
    async (firstOperation) => {
      const { SecretStore } = await import('../../dist/index.js');
      const { readFileSync, existsSync } = await import('node:fs');
      const { join } = await import('node:path');
      const store = new SecretStore({ configDir });
      store.set('original', 'global-value');
      store.set('token', 'work-value', { namespace: 'work' });
      const keyBefore = readFileSync(join(configDir, 'master.key'));

      const rotation = await runCli(['rotate-key', '--yes'], configDir);
      expect(rotation.exitCode).toBe(0);
      expect(rotation.stderr).toContain('re-encrypted 2 secret(s).');
      expect(readFileSync(join(configDir, 'master.key')).equals(keyBefore)).toBe(false);
      expect(existsSync(join(configDir, 'master.key.bak'))).toBe(false);

      switch (firstOperation) {
        case 'get':
          expect(store.get('original')).toBe('global-value');
          break;
        case 'tryGet':
          expect(store.tryGet('token', { namespace: 'work' })).toBe('work-value');
          break;
        case 'set':
          store.set('later', 'later-value');
          break;
        case 'rotateMasterKey':
          expect(store.rotateMasterKey()).toBe(2);
          break;
      }

      expect(store.get('original')).toBe('global-value');
      expect(store.tryGet('token', { namespace: 'work' })).toBe('work-value');
      store.set('later', 'later-value');
      store.set('token', 'updated-work-value', { namespace: 'work' });
      const reader = new SecretStore({ configDir });
      for (const [key, value, namespace] of [
        ['original', 'global-value', undefined],
        ['later', 'later-value', undefined],
        ['token', 'updated-work-value', 'work'],
      ] as const) {
        expect(reader.get(key, { namespace })).toBe(value);
        const args = ['get', key, ...(namespace ? ['--ns', namespace] : [])];
        const result = await runCli(args, configDir);
        expect(result.exitCode).toBe(0);
        expect(result.stdout).toBe(value);
      }
    }
  );

  it('非TTY で --yes を付けない rotate-key はエラーで非ゼロ終了する（ハングしない）', async () => {
    await runCli(['set', 'api_key', '--stdin'], configDir, 'sekret-value');

    const result = await runCli(['rotate-key'], configDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});

describe('run (op run 相当のシークレット注入コマンド)', () => {
  it('参照を含まないコマンドもそのまま実行され、子プロセスの標準出力がそのまま伝播する', async () => {
    const result = await runCli(
      ['run', '--', process.execPath, '-e', 'console.log("hello-from-child")'],
      configDir
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('hello-from-child');
  });

  it('親プロセスの環境変数が lsec://global/<key> 参照の場合、解決された値が子プロセスに渡る', async () => {
    await runCli(['set', 'api_key', '--stdin'], configDir, 'sekret-value');

    const result = await runCli(
      ['run', '--', process.execPath, '-e', 'console.log(process.env.MY_TOKEN)'],
      configDir,
      undefined,
      { MY_TOKEN: 'lsec://global/api_key' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('sekret-value');
  });

  it('namespace を指定した lsec://<namespace>/<key> 参照も解決できる', async () => {
    await runCli(['set', 'token', '--ns', 'work', '--stdin'], configDir, 'work-token');

    const result = await runCli(
      ['run', '--', process.execPath, '-e', 'console.log(process.env.WORK_TOKEN)'],
      configDir,
      undefined,
      { WORK_TOKEN: 'lsec://work/token' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('work-token');
  });

  it('--dotenv の参照エントリは解決され、リテラルエントリはそのまま子プロセスに渡る', async () => {
    await runCli(['set', 'api_key', '--stdin'], configDir, 'sekret-value');

    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const envFilePath = join(configDir, '.env');
    writeFileSync(envFilePath, 'GITHUB_TOKEN=lsec://global/api_key\nPLAIN=hello\n');

    const result = await runCli(
      [
        'run',
        '--dotenv',
        envFilePath,
        '--',
        process.execPath,
        '-e',
        'console.log(process.env.GITHUB_TOKEN + ":" + process.env.PLAIN)',
      ],
      configDir
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('sekret-value:hello');
  });

  it('--dotenv のエントリは親プロセスの同名環境変数より優先される', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const envFilePath = join(configDir, '.env');
    writeFileSync(envFilePath, 'FOO=from-env-file\n');

    const result = await runCli(
      ['run', '--dotenv', envFilePath, '--', process.execPath, '-e', 'console.log(process.env.FOO)'],
      configDir,
      undefined,
      { FOO: 'from-parent-env' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe('from-env-file');
  });

  it('"--" を付けなくても <command> 自身のオプション（--version 等）が passthrough され、lsec 自身のオプションとして誤解釈されない', async () => {
    // Regression test: without passThroughOptions/enablePositionalOptions,
    // `lsec run node --version` used to be silently swallowed by the
    // top-level `lsec` program's own `--version`, printing lsec's version
    // (e.g. "0.1.0") and exiting 0 *without ever running <command>*.
    const result = await runCli(['run', process.execPath, '--version'], configDir);
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe(process.version);
  });

  it('子プロセスの終了コードがそのまま親の終了コードとして伝播する', async () => {
    const result = await runCli(['run', '--', process.execPath, '-e', 'process.exit(3)'], configDir);
    expect(result.exitCode).toBe(3);
  });

  it.each(['parent reference', 'dotenv reference', 'dotenv literal'])(
    '%s の NUL 値は値を表示せず拒否し、子プロセスを起動しない',
    async (source) => {
      const prefix = 'DUMMY_PRIVATE_PREFIX';
      const suffix = 'DUMMY_PRIVATE_SUFFIX';
      const value = `${prefix}\0${suffix}`;
      const otherValue = 'DUMMY_OTHER_RESOLVED_SECRET';
      expect((await runCli(['set', 'token', '--stdin'], configDir, value)).exitCode).toBe(0);
      expect((await runCli(['set', 'other', '--stdin'], configDir, otherValue)).exitCode).toBe(0);
      const extraEnv: Record<string, string> = { SAFE_TOKEN: 'lsec://global/other' };
      const args = ['run'];
      if (source === 'parent reference') {
        extraEnv.TOKEN = 'lsec://global/token';
      } else {
        const envFile = join(configDir, '.env');
        writeFileSync(envFile, `TOKEN=${source === 'dotenv literal' ? value : 'lsec://global/token'}\n`);
        args.push('--dotenv', envFile);
      }
      const marker = join(configDir, 'child-ran');
      args.push('--', process.execPath, '-e', 'require("node:fs").writeFileSync(process.argv[1], "ran")', marker);
      const result = await runCli(args, configDir, undefined, extraEnv);
      expect(result.exitCode).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toBe(
        'Error: Invalid value for environment variable "TOKEN": NUL bytes are not allowed.\n'
      );
      for (const secret of [value, prefix, suffix, otherValue]) {
        expect(result.stdout + result.stderr).not.toContain(secret);
      }
      expect(existsSync(marker)).toBe(false);
    }
  );

  it('NUL 入りの解決済み値を dotenv の正常値で上書きした場合は実行できる', async () => {
    expect((await runCli(['set', 'token', '--stdin'], configDir, 'DUMMY_PREFIX\0DUMMY_SUFFIX')).exitCode).toBe(0);
    const envFile = join(configDir, '.env');
    writeFileSync(envFile, 'TOKEN=safe-replacement\n');
    const result = await runCli(
      ['run', '--dotenv', envFile, '--', process.execPath, '-e', 'console.log(process.env.TOKEN)'],
      configDir,
      undefined,
      { TOKEN: 'lsec://global/token' }
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe('safe-replacement\n');
    expect(result.stderr).toBe('');
  });

  it.each(['ENOENT', 'EACCES'])('参照解決後の起動失敗 %s は安全な診断で exit 1 になる', async (code) => {
    const value = 'DUMMY_RESOLVED_STARTUP_SECRET';
    expect((await runCli(['set', 'token', '--stdin'], configDir, value)).exitCode).toBe(0);
    const command = join(configDir, 'child-command');
    if (code === 'EACCES') writeFileSync(command, '#!/bin/sh\nexit 0\n', { mode: 0o600 });
    const result = await runCli(['run', '--', command], configDir, undefined, { TOKEN: 'lsec://global/token' });
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(`(${code})`);
    expect(result.stderr).not.toContain(command);
    expect(result.stderr).not.toContain(value);
  });

  it('子プロセスがシグナルで終了した場合、128 + シグナル番号が親の終了コードとして伝播する', async () => {
    // SIGTERM = 15 on Linux/macOS -> 128 + 15 = 143.
    const result = await runCli(['run', '--', 'sh', '-c', 'kill -TERM $$'], configDir);
    expect(result.exitCode).toBe(143);
  });

  it('未登録キーへの参照を解決しようとした場合、spawn 前に exit 1 となり子プロセスは実行されない（登録済みの別シークレットも一切出力されない）', async () => {
    await runCli(['set', 'other_key', '--stdin'], configDir, 'other-sekret-value');

    const result = await runCli(
      ['run', '--', process.execPath, '-e', 'console.log("should-not-run")'],
      configDir,
      undefined,
      { MISSING: 'lsec://global/does-not-exist' }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain('does-not-exist');
    expect(result.stderr).toContain('MISSING');
    expect(result.stderr).not.toContain('other-sekret-value');
  });

  it('namespace/key に "constructor"/"toString" 等の Object.prototype 由来の名前を使った参照は TypeError にならず、通常の未登録エラーとして exit 1 になる（プロトタイプ汚染の回帰テスト）', async () => {
    // Regression test for a SecretStore bug: `lsec://constructor/toString`
    // used to resolve to `Object.prototype.toString` (a function) instead
    // of being treated as an unregistered secret, which crashed with a
    // low-level TypeError deep inside child_process.spawn (env values must
    // be strings) instead of the normal, clean "not found" error path.
    await runCli(['set', 'foo', '--stdin'], configDir, 'bar');

    const result = await runCli(
      ['run', '--', process.execPath, '-e', '1'],
      configDir,
      undefined,
      { P: 'lsec://constructor/toString' }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    // Assert the actual expected SecretNotFoundError-derived message, not
    // just "no TypeError" — the pre-fix TypeError's message ("Received
    // function toString") happens to also contain the substrings "toString"
    // and "P", so a substring-only assertion would not actually catch the
    // regression this test exists for.
    expect(result.stderr).toContain(
      'Could not resolve secret reference for environment variable "P": ' +
        'Secret "toString" was not found in namespace "constructor".'
    );
  });

  it('不正な参照形式は spawn 前に exit 1 となり子プロセスは実行されない', async () => {
    const result = await runCli(
      ['run', '--', process.execPath, '-e', 'console.log("should-not-run")'],
      configDir,
      undefined,
      { BAD_REF: 'lsec://onlynamespace' }
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr.length).toBeGreaterThan(0);
    expect(result.stderr).toContain('BAD_REF');
  });

  it('--dotenv に存在しないパスを指定すると exit 1 となり子プロセスは実行されない', async () => {
    const { join } = await import('node:path');
    const missingPath = join(configDir, 'does-not-exist.env');

    const result = await runCli(
      ['run', '--dotenv', missingPath, '--', process.execPath, '-e', 'console.log("should-not-run")'],
      configDir
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Could not read --dotenv file');
    expect(result.stderr).toContain(missingPath);
  });

  it('--dotenv の内容が不正な場合（引用符の閉じ忘れによる行崩れ）、エラーメッセージに元の行内容（シークレットかもしれない文字列）が含まれない', async () => {
    const { writeFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const envFilePath = join(configDir, '.env');
    // The unterminated quote on line 1 makes line 2 ("super-secret-line2\"")
    // look like a value with no "=", which used to leak into the error
    // message verbatim before the fix.
    writeFileSync(envFilePath, 'A="line1\nsuper-secret-line2"\n');

    const result = await runCli(
      ['run', '--dotenv', envFilePath, '--', process.execPath, '-e', 'console.log("should-not-run")'],
      configDir
    );
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('line 2');
    expect(result.stderr).not.toContain('super-secret-line2');
  });

  it('存在しないコマンドを実行しようとした場合はエラーで exit 1 となる（ハングしない）', async () => {
    const result = await runCli(['run', '--', 'this-command-does-not-exist-xyz'], configDir);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.length).toBeGreaterThan(0);
  });
});
