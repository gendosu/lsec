#!/usr/bin/env node
/**
 * Commander-based CLI (bin: lsec) for local-secret.
 *
 * See design spec §6 (CLI 仕様) and §3 (依存方向 - cli -> secret-store):
 * docs/superpowers/specs/2026-06-30-local-secret-design.html
 *
 * This module only uses the library's public API surface (./index.js) —
 * it never imports secret-store.ts / crypto.ts / store-file.ts / paths.ts
 * directly. It constructs the SecretStore class directly (not the sugar
 * functions) because `namespaces()` and configDir injection (for test
 * isolation, and for anyone who wants a non-default configDir) are only
 * available on the class, not on the default-instance sugar functions.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { constants as osConstants } from 'node:os';
import { Command } from 'commander';
import { formatSecretRef, parseEnvFile, resolveEnv, SecretStore, type EnvFileEntry } from './index.js';
import { promptConfirm, promptHiddenPassword } from './prompt.js';

/**
 * Environment variable used to override the configDir used by every command
 * in this process. Primarily for e2e test isolation (a temp directory is
 * injected here instead of the real `~/.config/local-secret`), but also
 * usable by anyone who wants a non-default storage location.
 */
const CONFIG_DIR_ENV_VAR = 'LOCAL_SECRET_CONFIG_DIR';

function createStore(): SecretStore {
  const configDir = process.env[CONFIG_DIR_ENV_VAR];
  return configDir ? new SecretStore({ configDir }) : new SecretStore();
}

/** Reads all of `stream` and returns it as a UTF-8 string with one trailing `\n` (or `\r\n`) stripped, if present. */
async function readStdin(stream: NodeJS.ReadableStream = process.stdin): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (raw.endsWith('\r\n')) return raw.slice(0, -2);
  if (raw.endsWith('\n')) return raw.slice(0, -1);
  return raw;
}

/**
 * Resolves the value to store for `set`: from stdin (--stdin, for scripts)
 * or from a hidden interactive prompt entered twice (default, for terminals).
 * Throws if the two interactive entries don't match, if the resolved value
 * is empty, or if an interactive prompt is requested on a non-terminal
 * stdin (which would otherwise hang waiting for input).
 */
async function resolveSetValue(useStdin: boolean): Promise<string> {
  let value: string;
  if (useStdin) {
    value = await readStdin();
  } else {
    if (!process.stdin.isTTY) {
      throw new Error(
        'Input is not a terminal, so an interactive prompt cannot be shown. Pipe the value in and pass --stdin instead.'
      );
    }
    const entered = await promptHiddenPassword('Enter secret value: ');
    const confirmed = await promptHiddenPassword('Confirm secret value: ');
    if (entered !== confirmed) {
      throw new Error('The two entered values do not match.');
    }
    value = entered;
  }
  if (value === '') {
    throw new Error('Secret value must not be empty.');
  }
  return value;
}

function printError(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
}

/**
 * Spawns `command` with `args`, using `env` as the child's *entire*
 * environment (nothing is inherited implicitly — `run`'s caller already
 * folded every pass-through `process.env` entry into `env` via {@link
 * resolveEnv}) and inheriting stdio, so interactive/TTY-aware commands
 * (pagers, prompts, etc.) behave the same as if run directly in the shell.
 *
 * Resolves to the exit code to propagate to the parent process: the
 * child's own exit code, or `128 + <signal number>` if it was killed by a
 * signal (the common shell/`op run` convention), or `1` if neither is
 * available. Rejects if the child could not be spawned at all (e.g. the
 * command does not exist).
 */
function runChildProcess(command: string, args: string[], env: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      if (signal) {
        resolve(128 + (osConstants.signals[signal] ?? 0));
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

const program = new Command();

program
  .name('lsec')
  .description('Encrypted local secret store (library + CLI)')
  .version('0.1.0')
  // Without this, a bare `--version`/`--help` appearing anywhere in argv
  // (e.g. because the user forgot the "--" before <command> in `run`, see
  // below) is swallowed by *this* top-level program instead of being passed
  // through to the child command, silently doing the wrong thing instead of
  // running <command> at all.
  .enablePositionalOptions();

program
  .command('set')
  .description('Store an encrypted secret value under <key>')
  .argument('<key>', 'Secret key name')
  .option('--ns <namespace>', 'Namespace to store the secret in (default: global)')
  .option('--stdin', 'Read the value from stdin instead of an interactive hidden prompt')
  .action(async (key: string, opts: { ns?: string; stdin?: boolean }) => {
    const value = await resolveSetValue(Boolean(opts.stdin));
    const store = createStore();
    store.set(key, value, { namespace: opts.ns });
    const location = opts.ns ? ` in namespace "${opts.ns}"` : '';
    process.stderr.write(`Secret "${key}" saved${location}.\n`);
  });

program
  .command('get')
  .description(
    'Print the decrypted value of <key> to stdout (no trailing newline when piped; adds one in a terminal)'
  )
  .argument('<key>', 'Secret key name')
  .option('--ns <namespace>', 'Namespace to read the secret from (default: global)')
  .action((key: string, opts: { ns?: string }) => {
    const store = createStore();
    const value = store.get(key, { namespace: opts.ns });
    process.stdout.write(value);
    if (process.stdout.isTTY) process.stdout.write('\n');
  });

program
  .command('has')
  .description(
    'Check whether <key> is registered, without printing anything: exit 0 if present, exit 1 if not'
  )
  .argument('<key>', 'Secret key name')
  .option('--ns <namespace>', 'Namespace to check (default: global)')
  .action((key: string, opts: { ns?: string }) => {
    const store = createStore();
    if (!store.has(key, { namespace: opts.ns })) {
      process.exitCode = 1;
    }
  });

program
  .command('list')
  .description('List registered secret key names')
  .option('--ns <namespace>', 'Namespace to list (default: global)')
  .option('--all', 'List keys across every namespace, including global')
  .option('--refs', 'Print each key as a copy-pastable lsec://<namespace>/<key> reference (the format `lsec run` resolves)')
  .action((opts: { ns?: string; all?: boolean; refs?: boolean }) => {
    if (opts.ns && opts.all) {
      throw new Error('--ns and --all are mutually exclusive.');
    }
    const store = createStore();
    // namespace `undefined` = the global container; formatSecretRef and the
    // grouped display below both render it as "global".
    const sections: Array<[string | undefined, string[]]> = opts.all
      ? [
          [undefined, store.list()],
          ...store.namespaces().map((namespace): [string | undefined, string[]] => [
            namespace,
            store.list({ namespace }),
          ]),
        ]
      : [[opts.ns, store.list({ namespace: opts.ns })]];

    if (opts.refs) {
      for (const [namespace, keys] of sections) {
        for (const key of keys) {
          try {
            console.log(formatSecretRef({ namespace, key }));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`Warning: skipping "${key}": ${msg}`);
          }
        }
      }
    } else if (opts.all) {
      for (const [namespace, keys] of sections) {
        if (keys.length === 0) continue;
        console.log(`${namespace ?? 'global'}:`);
        for (const key of keys) {
          console.log(`  ${key}`);
        }
      }
    } else {
      for (const [, keys] of sections) {
        for (const key of keys) {
          console.log(key);
        }
      }
    }
  });

program
  .command('delete')
  .description('Remove a secret. Succeeds (idempotently) even if <key> was not registered.')
  .argument('<key>', 'Secret key name')
  .option('--ns <namespace>', 'Namespace to delete from (default: global)')
  .action((key: string, opts: { ns?: string }) => {
    const store = createStore();
    const removed = store.delete(key, { namespace: opts.ns });
    process.stderr.write(
      removed ? `Secret "${key}" deleted.\n` : `Secret "${key}" was not found; nothing to delete.\n`
    );
  });

program
  .command('delete-namespace')
  .description(
    'Remove an entire namespace, including every key stored in it. Succeeds (idempotently) even if <namespace> was not registered.'
  )
  .argument('<namespace>', 'Namespace to delete')
  .option('-y, --yes', 'Skip the interactive confirmation prompt')
  .action(async (namespace: string, opts: { yes?: boolean }) => {
    const store = createStore();
    if (!opts.yes) {
      if (!process.stdin.isTTY) {
        throw new Error(
          'Input is not a terminal, so an interactive prompt cannot be shown. Pass --yes instead.'
        );
      }
      const keyCount = store.list({ namespace }).length;
      const confirmed = await promptConfirm(
        `Delete namespace "${namespace}" and its ${keyCount} key(s)? [y/N] `
      );
      if (!confirmed) {
        process.stderr.write('Aborted.\n');
        return;
      }
    }
    const removed = store.deleteNamespace(namespace);
    process.stderr.write(
      removed
        ? `Namespace "${namespace}" deleted.\n`
        : `Namespace "${namespace}" was not found; nothing to delete.\n`
    );
  });

program
  .command('rotate-key')
  .description('Generate a new master.key and re-encrypt all stored secrets under it')
  .option('-y, --yes', 'Skip the interactive confirmation prompt')
  .action(async (opts: { yes?: boolean }) => {
    const store = createStore();
    if (!opts.yes) {
      if (!process.stdin.isTTY) {
        throw new Error(
          'Input is not a terminal, so an interactive prompt cannot be shown. Pass --yes instead.'
        );
      }
      const confirmed = await promptConfirm('Rotate master.key and re-encrypt all stored secrets? [y/N] ');
      if (!confirmed) {
        process.stderr.write('Aborted.\n');
        return;
      }
    }
    const count = store.rotateMasterKey();
    process.stderr.write(`master.key rotated; re-encrypted ${count} secret(s).\n`);
  });

program
  .command('run')
  .description(
    'Run <command> [args...] with lsec://<namespace>/<key> references in the environment (and --dotenv, if given) ' +
      'resolved into real secret values, only for the duration of the child process (like 1Password\'s `op run`). ' +
      'Use "--" before <command> so its own flags are passed through instead of being parsed by this command ' +
      '(NOTE: --env-file is deliberately not used as the flag name here — it collides with Node.js\'s own ' +
      '`--env-file` runtime flag, which Node intercepts before this CLI even runs, regardless of where in argv it appears).'
  )
  .option(
    '--dotenv <path>',
    'Load additional KEY=VALUE entries from a .env-style file; values may be lsec://<namespace>/<key> references'
  )
  .argument('<command>', 'Command to execute')
  .argument('[args...]', 'Arguments to pass to <command>')
  // Once <command> (the first positional argument) is seen, every remaining
  // token — including ones that look like options, e.g. "--version" meant
  // for <command> itself — is treated as a plain positional argument for
  // *this* command instead of being parsed as an option of `run` or of the
  // top-level `lsec` program (see also `program.enablePositionalOptions()`
  // above). This is what makes `lsec run node --version` correctly run node
  // instead of silently printing lsec's own version.
  .passThroughOptions()
  .action(async (command: string, args: string[], opts: { dotenv?: string }) => {
    const store = createStore();

    let envFileEntries: EnvFileEntry[] | undefined;
    if (opts.dotenv) {
      let content: string;
      try {
        content = readFileSync(opts.dotenv, 'utf-8');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(`Could not read --dotenv file "${opts.dotenv}": ${msg}`);
      }
      envFileEntries = parseEnvFile(content);
    }

    const env = resolveEnv({
      processEnv: process.env,
      envFileEntries,
      resolveSecret: (ref) => store.get(ref.key, { namespace: ref.namespace }),
    });

    process.exitCode = await runChildProcess(command, args, env);
  });

program
  .command('namespaces')
  .description('List namespace names that have been used at least once')
  .action(() => {
    const store = createStore();
    for (const namespace of store.namespaces()) {
      console.log(namespace);
    }
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  printError(err);
  process.exit(1);
});
