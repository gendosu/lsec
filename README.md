# lsec

> 日本語版: [README.ja.md](./README.ja.md)

lsec is a CLI + Node.js library, distributed as a single binary, that encrypts and stores secrets (API keys, tokens, passwords, etc.) on your local machine. Because the CLI ships as a single binary, it doesn't require Node.js at runtime and is unaffected by version switchers like nodenv / mise.

## Project Overview

A general-purpose local secret store that encrypts values with AES-256-GCM and decrypts them with a machine-specific master key (stored at `~/.config/local-secret/`). It provides a library and CLI (`lsec`) that any app or script can use to encrypt, store, and retrieve secrets locally.

- Store, retrieve, list, and delete named secrets (key → string value)
- Two-tier name management: `global` and `namespace`
- Values encrypted with AES-256-GCM (authenticated, tamper-evident)
- A machine-specific random master key is generated automatically on first access
- A class-based library API (`SecretStore`), plus a set of functions that delegate to a default instance
- A Commander-based CLI (bin: `lsec`)
- A secret-injection command equivalent to the 1Password CLI's `op run` (`lsec run`). It resolves `lsec://<namespace>/<key>` references into environment variables only for the duration of the specified command's execution

Values are strings only (structured JSON values and remote sync are out of scope).

The library and the CLI running on Node.js support only these major versions:

| Node.js major | Minimum version |
| --- | --- |
| 22 | 22.12.0 |
| 24 | 24.0.0 |
| 26 | 26.0.0 |

The supported range is `^22.12.0 || ^24.0.0 || ^26.0.0`. CI tests the minimum and latest release of each supported major. Use the latest patch release of a supported major. Additional major versions require explicit validation and updates to `engines.node`, CI, and this documentation before they are supported.

The prebuilt binary CLI does not require Node.js and is unaffected by this support policy.

## Installation

### CLI (recommended: binary)

We recommend downloading a prebuilt binary from GitHub Releases. Node.js is not required at runtime.

#### One-liner install (recommended)

On macOS (Apple Silicon / Intel) and Linux (x86_64 / arm64), a single line installs the CLI. It detects your OS/CPU, downloads the latest release binary, verifies its SHA256 checksum, and places it at `~/.local/bin/lsec` (available while the repository and its releases are publicly accessible).

```bash
curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | sh
```

Environment variables change the destination and the version (put them on the `sh` side of the pipe):

```bash
# Change the install directory (default: ~/.local/bin)
curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | LSEC_INSTALL_DIR="$HOME/bin" sh

# Pin a specific version (default: latest)
curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | LSEC_VERSION=v0.3.0 sh
```

#### With the GitHub CLI

Requires the [GitHub CLI](https://cli.github.com/) authenticated with an account that can access this repository (`gh auth login`). Unlike browser downloads, `gh` does not set the quarantine attribute, so macOS Gatekeeper does not block the downloaded binary.

```bash
# macOS (Apple Silicon)
mkdir -p ~/.local/bin
gh release download --repo gendosu/lsec --pattern lsec-darwin-arm64 --output ~/.local/bin/lsec --clobber
chmod +x ~/.local/bin/lsec
```

#### Manual download with curl

Available only while the repository (and its releases) is publicly accessible.

```bash
# macOS (Apple Silicon)
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/lsec https://github.com/gendosu/lsec/releases/latest/download/lsec-darwin-arm64
chmod +x ~/.local/bin/lsec
```

If `~/.local/bin` is not on your PATH, add it in your shell's configuration file.

| Asset | Target platform |
| --- | --- |
| `lsec-darwin-arm64` | macOS (Apple Silicon) |
| `lsec-darwin-x64` | macOS (Intel) |
| `lsec-linux-x64` | Linux (x86_64) |
| `lsec-linux-arm64` | Linux (arm64) |
| `SHA256SUMS` | SHA256 checksums for the four binaries above |

The distributed binaries are unsigned. If you download one through a browser, macOS Gatekeeper may block it from running. In that case, remove the quarantine attribute (this normally doesn't happen with `curl` downloads, since they don't set that attribute).

```bash
xattr -d com.apple.quarantine <path>
```

### Building from source

Install [mise](https://mise.jdx.dev/getting-started.html) and run the following commands from the repository root. `mise.toml` enables the version files for the development tools: `.node-version` selects Node.js, `package.json`'s `packageManager` selects pnpm, and `.bun-version` selects Bun (used to build the single binary). These development versions are separate from the library's runtime requirements above.

If `mise` is not on PATH, replace it in each command with its absolute path, such as `"$HOME/.local/bin/mise"` for the default installation.

Review the repository configuration, then trust it and install its tools:

Development uses Node.js 26, as selected by `.node-version`. This development setting is separate from the supported runtime versions listed above.

```bash
mise trust
mise install
```

Use [mise exec](https://mise.jdx.dev/cli/exec.html) in scripts and non-interactive shells without relying on automatic shell activation. `MISE_ACTIVATE_AGGRESSIVE=1` [keeps mise's tools ahead of competing PATH entries](https://mise.jdx.dev/configuration/settings.html#activate_aggressive), including nodenv shims. This also ensures that pnpm's child processes (including npm in the `prepare` script) use the selected Node.js. The setting applies only to each command.

Check the versions and the Node.js executable used by a pnpm child process:

```bash
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- node --version
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm --version
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- bun --version
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm exec node -p 'JSON.stringify({version:process.version,execPath:process.execPath})'
```

The versions should match the repository's version files, and the child process's `execPath` should point to mise's Node.js installation.

Install dependencies, build the library, and run the tests:

```bash
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm install --frozen-lockfile
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm build
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm test:unit
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm test:e2e
```

The interactive E2E tests require Python 3 (`python3`) and a POSIX PTY. CI verifies Python availability before running these tests; they are not skipped when Python is missing.

Build the single binary at `bin/lsec`, then check it and run the same E2E suite against it:

```bash
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm build:bun
./bin/lsec --version
LSEC_E2E_CLI="$PWD/bin/lsec" MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm test:e2e
```

For interactive use, place mise activation after nodenv/anyenv initialization and other PATH changes in the startup file your shell actually reads (for example, `~/.bashrc` for interactive Bash or `~/.zshrc` for Zsh). Bash login shells may need to source `~/.bashrc` from `~/.bash_profile` after initializing nodenv/anyenv. Use `eval "$(mise activate bash)"` for Bash or `eval "$(mise activate zsh)"` for Zsh, then open a new shell and run `command -v node` and `command -v pnpm` in the repository root to check that mise's tools take precedence. Non-interactive execution should keep using the explicit commands above.

The Dev Container's `.devcontainer/postCreate.sh` uses the same trust/install sequence and `CI=true MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm install --frozen-lockfile` for dependency installation.

### Using it as a library

Publishing to npm is ready to go, but for now, please install via git.

```bash
# pnpm (via SSH)
pnpm add git+ssh://git@github.com/gendosu/lsec.git

# To clone via HTTPS
pnpm add git+https://github.com/gendosu/lsec.git
```

Once published to npm, you'll be able to install it like this:

```bash
pnpm add lsec
```

## CLI Usage

```
lsec set <key> [--ns <namespace>] [--stdin]
lsec get <key> [--ns <namespace>]
lsec has <key> [--ns <namespace>]
lsec list [--ns <namespace>] [--all] [--refs]
lsec delete <key> [--ns <namespace>]
lsec namespaces
lsec delete-namespace <namespace> [--yes]
lsec rotate-key [--yes]
lsec run [--dotenv <path>] -- <command> [args...]
```

```bash
# Set a value (a single interactive prompt; input is hidden)
lsec set github_token

# Set via piped input (for scripts; a single trailing newline is stripped automatically)
echo -n "ghp_xxxxx" | lsec set github_token --stdin

# Set with a namespace
lsec set password --ns imap --stdin <<< "p@ss"

# Get (in non-TTY mode, prints to stdout with no trailing newline, so it works with $(...). In TTY mode (run directly in a terminal), a trailing newline is appended)
lsec get github_token
TOKEN=$(lsec get github_token)

# Get with a namespace
lsec get password --ns imap

# Check existence (doesn't print the value; exits 0 if registered, 1 if not)
lsec has github_token && echo "registered"
lsec has password --ns imap

# List (global if --ns is omitted; --all lists every namespace)
lsec list
lsec list --ns imap
lsec list --all

# --refs prints each key as an lsec://<namespace>/<key> reference, one per line
# (can be pasted directly as an environment variable value for lsec run)
lsec list --all --refs
# => lsec://global/github_token
#    lsec://imap/password

# Delete (idempotent; succeeds even if the key isn't registered)
lsec delete github_token

# List namespaces in use
lsec namespaces

# Delete an entire namespace (in TTY mode, shows the number of affected keys and asks y/N; --yes skips the prompt)
lsec delete-namespace imap
lsec delete-namespace imap --yes

# In non-TTY mode (piped/script execution), --yes is required; without it, the command exits with an error instead of hanging
lsec delete-namespace imap --yes < /dev/null

# Rotate master.key (generates a new key and re-encrypts all values across global and every namespace)
# Shows a confirmation prompt in TTY mode; --yes skips it, and --yes is required in non-TTY mode
lsec rotate-key
lsec rotate-key --yes

# Inject a secret as an environment variable only for the duration of the specified command (equivalent to the 1Password CLI's `op run`)
# Everything before "--" is an option for lsec run itself; everything after "--" is the command to run along with its own arguments
GITHUB_TOKEN="lsec://global/github_token" lsec run -- gh api user
GITHUB_TOKEN="lsec://global/github_token" lsec run -- npm run dev

# Using --dotenv (values in the file that are lsec://... references are resolved; anything else is passed through as a literal value)
lsec run --dotenv .env -- npm run dev
```

There is no `--value <v>`-style option, since that would leave the value in your shell history. Pass values either via the hidden interactive prompt or `--stdin`. On errors — such as `get`-ing an unregistered key — a message is printed to stderr and the process exits with a non-zero exit code.

During interactive input or confirmation, Ctrl-C exits with code 130; EOF (including Ctrl-D when it closes the prompt) or an input/output failure exits with code 1. Interrupted `set` input is not saved, and interrupted `delete-namespace` / `rotate-key` confirmation does not perform the operation. Input is submitted only with Enter; a partial value or `y` followed by EOF does not count as an answer. An explicit negative or empty confirmation still prints `Aborted.` and exits with code 0.

## Library API Usage

### The SecretStore class

```ts
import { SecretStore } from 'lsec';

// Default: uses ~/.config/local-secret
const store = new SecretStore();

// To use ~/.config/<appName> with a custom appName
const namedStore = new SecretStore({ appName: 'my-app' });

// Override configDir with a full path (mainly for test isolation)
const testStore = new SecretStore({ configDir: '/tmp/my-app-config' });

// Set a value (namespace defaults to global if omitted)
store.set('github_token', 'ghp_xxxxx');
store.set('password', 'p@ss', { namespace: 'imap' });

// Get a value (throws SecretNotFoundError if not registered)
const token = store.get('github_token');

// Get a value (returns undefined instead of throwing if not registered)
const maybeToken = store.tryGet('missing_key'); // => undefined

// Check whether a key is registered
store.has('github_token'); // => true / false

// Delete (returns true if deleted, false if not registered)
store.delete('github_token');

// List key names (namespace defaults to global if omitted)
store.list(); // => ['github_token', ...]
store.list({ namespace: 'imap' }); // => ['password']

// List namespaces that have been used
store.namespaces(); // => ['imap', 'aws']

// Delete an entire namespace (returns true if deleted, false if not registered; global is not affected)
store.deleteNamespace('imap');

// Rotate master.key (re-encrypts all values with a new key and returns the number of values re-encrypted)
store.rotateMasterKey(); // => 3
```

`SecretNotFoundError`, `CryptoError`, and `StoreError` are also exported from the library, so you can catch them as needed.

```ts
import { getSecret, SecretNotFoundError } from 'lsec';

try {
  getSecret('missing_key');
} catch (err) {
  if (err instanceof SecretNotFoundError) {
    console.error('Secret is not registered');
  }
}
```

### Functions that delegate to a default instance

If you don't want to manage an instance yourself, you can use functions that delegate to a default `SecretStore` (fixed to `~/.config/local-secret`), lazily created internally.

```ts
import {
  setSecret,
  getSecret,
  tryGetSecret,
  hasSecret,
  deleteSecret,
  listSecrets,
  listNamespaces,
  deleteNamespace,
  rotateMasterKey,
} from 'lsec';

setSecret('github_token', 'ghp_xxxxx'); // global
setSecret('password', 'p@ss', { namespace: 'imap' });

getSecret('password', { namespace: 'imap' }); // => 'p@ss'
tryGetSecret('missing_key'); // => undefined
hasSecret('github_token'); // => true / false
deleteSecret('github_token'); // => true / false
listSecrets(); // => ['github_token', ...]
listSecrets({ namespace: 'imap' }); // => ['password']
listNamespaces(); // => ['imap', 'aws']
deleteNamespace('imap'); // => true / false
rotateMasterKey(); // => 3 (number of values re-encrypted)
```

There are nine functions available: `setSecret`, `getSecret`, `tryGetSecret`, `hasSecret`, `deleteSecret`, `listSecrets`, `listNamespaces`, `deleteNamespace`, and `rotateMasterKey`. They don't support injecting a `configDir`; if you need that, use the `SecretStore` class directly.

### `lsec run`'s resolution logic (library API)

The pure reference-resolution logic used by the CLI's `run` command (described above) is also exposed as a library API. Use it if you want to apply the same resolution rules from your own tooling without going through the CLI.

```ts
import { isSecretRef, parseSecretRef, parseEnvFile, resolveEnv, SecretStore } from 'lsec';

isSecretRef('lsec://work/token'); // => true
parseSecretRef('lsec://work/token'); // => { namespace: 'work', key: 'token' }
parseSecretRef('lsec://global/api_key'); // => { key: 'api_key' } (global is equivalent to omitting the namespace)

parseEnvFile('GITHUB_TOKEN=lsec://global/gh_token\nPLAIN=hello\n');
// => [{ key: 'GITHUB_TOKEN', value: 'lsec://global/gh_token' }, { key: 'PLAIN', value: 'hello' }]

const store = new SecretStore();
const env = resolveEnv({
  processEnv: process.env,
  envFileEntries: parseEnvFile('GITHUB_TOKEN=lsec://global/gh_token\n'),
  resolveSecret: (ref) => store.get(ref.key, { namespace: ref.namespace }),
});
```

## Threat Model Notes

The master key (`master.key`) is stored right next to the ciphertext (`secrets.json`), in the same directory. To be explicit: this is not "true encryption" but rather **protection against accidental exposure (splitting the secret in two, plus obfuscation)**.

| Threat | Plaintext storage | With lsec (this library) |
| --- | --- | --- |
| A: only `secrets.json` leaks by accident (an errant `git add` / backup sync / paste) | Exposed | Protected (only ciphertext leaks; the key lives in a separate file, `master.key`) |
| B: an attacker with the same user's privileges reads all of `~/.config/local-secret` | Exposed | Exposed (the key and ciphertext sit side by side, so there's no difference) |
| C: root / full-disk access | Exposed | Exposed (no difference) |

As a personal, local CLI / library, this design places its value on preventing threat A (accidental leaks). **It provides no defense against threats B and C (an attacker with the same user's privileges, or root).** If you need stronger protection, consider a passphrase-derived key or OS keychain integration separately — those are out of scope for this library.

## Storage Specification

The package was renamed to `lsec`, but the storage directory name remains `local-secret` for backward compatibility.

The storage location is fixed at `~/.config/local-secret/`, relative to `os.homedir()` (or `~/.config/<appName>/` if `appName` is specified).

| File | Path | Contents |
| --- | --- | --- |
| `master.key` | `~/.config/local-secret/master.key` | 32 random bytes (`crypto.randomBytes(32)`). File permissions are `0o600`, directory permissions are `0o700`. Generated automatically on first access. |
| `secrets.json` | `~/.config/local-secret/secrets.json` | `0o600`. Written by exclusively creating a unique private `.tmp` file and then renaming it. |
| `master.key.bak` | `~/.config/local-secret/master.key.bak` | A recovery backup of the pre-rotation key, created exclusively with mode `0o600`. Removed on successful rotation; if it remains, updates are blocked until recovery is verified (see "Rotating master.key"). |

The structure of `secrets.json`:

```json
{
  "version": 1,
  "global": {
    "github_token": "<base64(iv | authTag | ciphertext)>"
  },
  "namespaces": {
    "imap": {
      "password": "<base64(iv | authTag | ciphertext)>"
    },
    "aws": {
      "secret_access_key": "<base64(iv | authTag | ciphertext)>"
    }
  }
}
```

Key names and namespace names are stored in plaintext; **only the values** are encrypted with AES-256-GCM (a deliberate choice for listing and operability). Each value uses a fresh IV on every save, so the ciphertext differs each time even for the same value.

## Concurrent access and interrupted operations

Every `SecretStore` operation, default-instance function, and CLI store operation serializes access to the same physical config directory using a private `0o700` `.lsec.lock` directory. The lock covers reading, key selection/initial creation, encryption/decryption, changes, persistence, and rotation cleanup. Relative paths and directory symlinks to the same store share the lock; separate stores remain independent. Same-key writes take effect in lock acquisition order. Each call is serialized; multiple separate calls are not one transaction.

The synchronous API waits without busy spinning, retrying every 10 ms for up to 5 seconds. This **blocks the calling thread/event loop** while waiting. A timeout or acquisition error raises `StoreError` before accessing the key/data for that operation. Reads also create lock metadata and therefore require write permission on the config directory. Constructors and imports remain lazy, and missing-key reads do not generate a master key. No API arguments or stored data formats change; existing stores need no migration. Key/data writes use unique, exclusively created `0o600` temporary files and clean up only their own files. An existing legacy `.tmp` path is left untouched.

Normal completion and exceptions release the lock. A release failure raises `StoreError` even if the operation already saved its changes; inspect the result before retrying. If the operation also failed, both errors remain in the error cause. `SIGKILL` or another abrupt exit can leave the lock and private temporary files behind. **Locks are never automatically stolen or deleted**, even if old or apparently associated with a dead process. Subsequent operations fail after the wait deadline.

To recover a stale lock, stop **all processes** using this store, preserve private copies of the key/data/backup and any temporary files, and verify the matching key and every stored value in an isolated copy **without copying `.lsec.lock`**. If `master.key.bak` exists, follow the rotation recovery procedure below; do not blindly copy it over the current key. Once the key/data pair is verified and any restoration is complete, remove only the empty `.lsec.lock` directory with `rmdir`, verify all values in the live store, and only then remove a recovery backup and resume operations. Never remove an active owner's lock. If the lock directory is not empty or the files cannot be verified, preserve them and investigate.

This coordination applies to cooperating processes running this version on a local filesystem. Avoid simultaneous use with older versions or direct file editors. Distributed/network filesystems and durable transactions across power loss are outside this guarantee.

## Rotating master.key

`lsec rotate-key` (or, on the library side, `SecretStore#rotateMasterKey()` / `rotateMasterKey()`) generates a new `master.key` and re-encrypts every value in `global` and all `namespace`s with the new key.

- **Existing instances**: After a rotation by another instance or the CLI completes successfully, existing `SecretStore` instances and the default-instance functions use the current key on their next read, write, or rotation. All store operations, including reads, hold the same lock throughout rotation so the key and ciphertext stay consistent.
- **Before persistence**: All values are decrypted and re-encrypted in memory first. A decryption failure raises `CryptoError` without changing the key, data, or backup.
- **Persistence order**: (1) exclusively create `master.key.bak` from the valid current key → (2) replace `master.key` by rename → (3) replace `secrets.json` by rename → (4) remove the backup. These two file replacements are not one transaction. A failure between (2) and (3) leaves old data requiring the backup key. A failure after (3), including backup removal failure, leaves new data requiring the current key. Cleanup failure raises `StoreError` explicitly stating that the new key and data were saved.
- **Recovery pending**: Any remaining `master.key.bak` path (including an invalid file, directory, or dangling symlink) blocks `set`, `delete`, `deleteNamespace`, and `rotateMasterKey` with `StoreError`, including deletion of missing entries. This applies to existing instances, new instances, and subsequent CLI processes. The backup is never overwritten on retry. Reads use the current on-disk key while recovery is pending; they do not fall back to the backup or a cached old key, and a missing current key is not regenerated. `has`, `list`, and `namespaces` remain available. There is no automatic rollback or backup deletion on failure.

For manual recovery after a failed or interrupted rotation:

1. Stop **all processes** using the store. Preserve private copies of `master.key`, `secrets.json`, and `master.key.bak` wherever present before changing anything. Keep these originals separate from the working copies used below; retain file permissions (`0o600` for keys/data, `0o700` for directories).
2. In an **isolated copy without `.lsec.lock`**, verify that the current `master.key` is 32 bytes and decrypts **every value in global and every namespace**. The example below performs this check without printing plaintext. If all values decrypt, keep that key: rotation may have completed and only cleanup failed. One successful `get` is insufficient.
3. Only if the current key cannot decrypt all values, test a separate isolated copy with the valid 32-byte backup copied to its `master.key`. Verify every value again. If neither key decrypts all values, preserve all files and investigate; do not overwrite the live key or remove the backup. An empty store cannot identify a key generation by decryption, so retain a valid current key when one exists.
4. Restore the verified matching key/data pair, preserving the original copies. If a lock remains after all store users have stopped, remove only the empty `.lsec.lock` directory with `rmdir`. Verify every value again at the actual store path while all other processes remain stopped. Only then explicitly remove `master.key.bak` from that store and resume updates or `rotate-key`.

Example verification, run from a project with the npm package `lsec` installed (set `RECOVERY_DIR` to the isolated copy, or to the restored store for the final verification):

```bash
RECOVERY_DIR=/absolute/path/to/isolated-copy node --input-type=module <<'JS'
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SecretStore } from 'lsec';

const configDir = process.env.RECOVERY_DIR;
if (readFileSync(join(configDir, 'master.key')).length !== 32) {
  throw new Error('A valid existing 32-byte master.key is required.');
}
const store = new SecretStore({ configDir });
let count = 0;
for (const key of store.list()) { store.get(key); count++; }
for (const namespace of store.namespaces()) {
  for (const key of store.list({ namespace })) {
    store.get(key, { namespace });
    count++;
  }
}
console.log(`Verified all ${count} stored values; no plaintext printed.`);
JS
```

## `run`: inject secrets as environment variables only for the duration of a command (equivalent to `op run`)

`lsec run` does the same kind of thing as the 1Password CLI's `op run`. Without leaving secret plaintext in your shell history or config files, it passes resolved values to a child process as environment variables only for the duration of the specified command. After the command finishes, those values are gone.

```
lsec run [--dotenv <path>] -- <command> [args...]
```

- We recommend placing `--` before `<command>`. This clearly separates `lsec run`'s own options (like `--dotenv`) from the options of the command you want to run itself (e.g., the `--watch` in `npm run dev --watch`). (Even without `--`, everything after `<command>` is still passed through as-is, but options like `--dotenv` must always be written before `<command>`.)
- **The option is named `--dotenv`, not `--env-file`.** We wanted to match the 1Password CLI's `op run --env-file` name, but `--env-file` is a flag name reserved by the Node.js runtime itself since v20.6, and Node intercepts it before lsec's own code even starts, no matter where it appears in argv (if you point it at a nonexistent file, the resulting error message and exit code come from Node itself, not from lsec). We chose a different name deliberately to avoid that collision.
- There are two sources of references to resolve (matching `op run`'s structure):
  1. **The parent process's environment variables** whose values are `lsec://<namespace>/<key>` references
  2. Entries in the `.env` file specified via `--dotenv <path>` (entries from `--dotenv` take precedence over parent environment variables of the same name)
- Values that aren't references (in either parent environment variables or `.env`) are passed through unchanged. Parent environment variables that aren't references are left completely untouched.

### The `lsec://<namespace>/<key>` reference syntax

This is the syntax for referring to a key saved via `set` in a form that `run` can resolve. For the `global` namespace, write `lsec://global/<key>` (this refers to the default `global` namespace — the same one used when `--ns` is omitted — not a namespace literally named "namespace"). Neither the namespace nor the key may contain `/` or whitespace (if a key containing those was saved via `set`, it cannot be referenced from `run`).

```bash
lsec set github_token --stdin <<< "ghp_xxxxx"
GITHUB_TOKEN="lsec://global/github_token" lsec run -- gh api user

lsec set token --ns work --stdin <<< "work-token"
WORK_TOKEN="lsec://work/token" lsec run -- npm run dev
```

### Using a `.env` file

In your project's `.env`, you can write `lsec://<namespace>/<key>` references instead of actual values. Lines that aren't references are passed through as literal values. Only the following are supported: `KEY=VALUE` syntax; line comments starting with `#` (only at the start of a line — a `#` written at the end of a value does not start a comment and becomes part of the value); blank lines; and stripping of simple quotes (`"..."` / `'...'`). No shell-like variable expansion or command substitution is performed (values are always treated as literal strings), and shell syntax such as `export KEY=VALUE` is not supported.

```
# .env
GITHUB_TOKEN=lsec://global/github_token
PLAIN_VALUE=not-a-secret
```

```bash
lsec run --dotenv .env -- npm run dev
```

### When resolution or startup fails

A reference to a nonexistent namespace/key, a malformed reference (one that doesn't match the `lsec://<namespace>/<key>` shape), a nonexistent `--dotenv` path, or malformed `.env` content are all detected before the command is launched; an error is printed to stderr and the process exits with 1 (the child process never runs). Secret values are never included in error messages.

Stored values are general strings: `SecretStore.set` / `get` can round-trip strings containing NUL (`\0`) bytes. Environment-variable injection has stricter requirements. After resolving references and applying all `--dotenv` overrides, `run` rejects NUL-containing or non-string values before launching the child, prints only the variable name and problem type, and exits with 1. This also applies to literal values in `.env` files. For example:

```text
Error: Invalid value for environment variable "TOKEN": NUL bytes are not allowed.
```

If process startup fails, `run` exits with 1 and prints a fixed diagnostic, without exposing the runtime's original error or resolved values. Known causes include command not found (`ENOENT`), permission denied (`EACCES`), oversized arguments or environment (`E2BIG`), and invalid process arguments or environment (`ERR_INVALID_ARG_VALUE`). Other startup failures receive a generic diagnostic.

The child process's exit code or signal propagates directly as `lsec run`'s own exit code (if terminated by a signal, it's `128 + signal number`).

On Linux and macOS, `lsec run` forwards each `SIGTERM` or `SIGINT` it receives to its directly launched child and waits for that child to exit. With default signal handling, the resulting exit codes are 143 and 130 respectively. If the child handles the signal and exits with its own code after cleanup, that code is preserved. If it ignores the signal or keeps running, `lsec run` keeps waiting; it does not impose a timeout or escalate to `SIGKILL`. A failed signal delivery produces a fixed diagnostic without exposing arguments or environment values, and the child remains monitored.

Terminal Ctrl-C can reach both parent and child through their shared foreground process group, so forwarding may deliver the signal again. Child cleanup handlers should tolerate repeated signals. Forwarding targets only the direct child: grandchildren launched by shells, npm, or other wrappers depend on the wrapper's own forwarding behavior. Daemonized processes, `SIGKILL` sent to lsec, and Windows signal behavior are outside this guarantee; stopping lsec does not guarantee that every descendant holding secrets has stopped.

No output masking is performed (i.e., no redaction of secret values that leak into the child process's stdout/stderr). Because `stdio` is directly inherited by the child process, interactive commands (prompts, password entry, etc.) work as expected.

## The `LOCAL_SECRET_CONFIG_DIR` environment variable

If the environment variable `LOCAL_SECRET_CONFIG_DIR` is set, the CLI (`lsec`) uses that path as `configDir` instead of `~/.config/local-secret`. This is an advanced option intended mainly for testing and isolated environments.

```bash
LOCAL_SECRET_CONFIG_DIR=/tmp/my-isolated-config lsec set foo --stdin <<< "bar"
LOCAL_SECRET_CONFIG_DIR=/tmp/my-isolated-config lsec get foo
```

If you want to do the equivalent from the library, use `new SecretStore({ configDir: '...' })`.

## License

MIT
