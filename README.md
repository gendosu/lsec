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

Using it as a library requires Node.js 20 or later. The binary CLI does not require Node.js.

## Installation

### CLI (recommended: binary)

We recommend downloading a prebuilt binary from GitHub Releases. Node.js is not required at runtime.

#### With the GitHub CLI (recommended)

Requires the [GitHub CLI](https://cli.github.com/) authenticated with an account that can access this repository (`gh auth login`). Unlike browser downloads, `gh` does not set the quarantine attribute, so macOS Gatekeeper does not block the downloaded binary.

```bash
# macOS (Apple Silicon)
mkdir -p ~/bin
gh release download --repo gendosu/lsec --pattern lsec-darwin-arm64 --output ~/bin/lsec --clobber
chmod +x ~/bin/lsec
```

#### With curl

Available only while the repository (and its releases) is publicly accessible.

```bash
# macOS (Apple Silicon)
mkdir -p ~/bin
curl -fsSL -o ~/bin/lsec https://github.com/gendosu/lsec/releases/latest/download/lsec-darwin-arm64
chmod +x ~/bin/lsec
```

If `~/bin` is not on your PATH, add it in your shell's configuration file.

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

`bun` is required (used to build the single binary).

```bash
pnpm install
pnpm build:bin
```

This produces a single binary at `bin/lsec`.

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
| `secrets.json` | `~/.config/local-secret/secrets.json` | `0o600`. Written atomically by writing to a `.tmp` file and then `rename`-ing it. |
| `master.key.bak` | `~/.config/local-secret/master.key.bak` | A backup of the pre-rotation `master.key`, present only temporarily while `rotate-key` is running. Automatically removed on successful completion (see "Rotating master.key" for details). |

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

## Rotating master.key

`lsec rotate-key` (or, on the library side, `SecretStore#rotateMasterKey()` / `rotateMasterKey()`) generates a new `master.key` and re-encrypts every value in `global` and all `namespace`s with the new key.

- **All-or-nothing**: Decryption under the current key is fully completed in memory before anything is written. If even one value fails to decrypt (e.g., a corrupted `master.key`), a `CryptoError` is thrown and the operation aborts — neither `master.key` nor `secrets.json` on disk is modified.
- **Write order (crash resilience)**: (1) copy the current `master.key` to `master.key.bak` → (2) atomically write the new key to `master.key` (via rename) → (3) atomically write the re-encrypted `secrets.json` → (4) delete `master.key.bak` on success. Because full atomicity across two files isn't achievable, if the process crashes between steps (2) and (3), you can end up with `master.key` already replaced by the new key while `secrets.json` is still encrypted under the old key. If that happens, **restore the old key by copying `master.key.bak` over `master.key`**. Once restored, the existing `secrets.json` can be decrypted normally again, and you can re-run `rotate-key`.

```bash
# Example recovery steps (if the process crashes during rotate-key)
cp ~/.config/local-secret/master.key.bak ~/.config/local-secret/master.key
lsec get some_key   # confirm it decrypts with the old key
lsec rotate-key     # run the rotation again
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

### When resolution fails

A reference to a nonexistent namespace/key, a malformed reference (one that doesn't match the `lsec://<namespace>/<key>` shape), a nonexistent `--dotenv` path, or malformed `.env` content are all detected before the command is launched; an error is printed to stderr and the process exits with 1 (the child process never runs). Secret values are never included in error messages.

The child process's exit code or signal propagates directly as `lsec run`'s own exit code (if terminated by a signal, it's `128 + signal number`).

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
