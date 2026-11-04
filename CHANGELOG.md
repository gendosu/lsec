# Changelog

> 日本語版: [CHANGELOG.ja.md](./CHANGELOG.ja.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-11-04

### Added

- Export `validateRunEnv` to validate resolved environment values before starting a child process, without including values in error messages.

### Changed

- **Breaking**: Limit the Node.js library and Node.js CLI to `^22.12.0 || ^24.0.0 || ^26.0.0` (minimum versions: 22.12.0, 24.0.0, and 26.0.0). Drop support for EOL Node.js 20, 23, and 25 and exclude unverified future majors so the supported range matches the LTS lines we maintain and test. CI covers the minimum and latest release of each supported major. Prebuilt binaries are unaffected.
- Align development Node.js type definitions with the minimum supported major (22), and use mise-managed tools consistently in non-interactive commands and Dev Container setup.

### Fixed

- Serialize reads, updates, initial key creation, and rotation across processes sharing a store. Bound synchronous lock waits to 5 seconds and preserve stale locks for explicit recovery after abrupt exits. Exclusively create unique private temporary files so one operation cannot overwrite or remove another operation’s work. Preserve the synchronous API and existing store format.
- Existing `SecretStore` instances and default-instance functions now reload the current master key for each operation that needs it. After another instance or the CLI successfully rotates the key, subsequent reads, writes, and rotations follow the new key instead of failing to decrypt or saving values with an obsolete key. Invalid or unreadable keys fail before saving instead of falling back to an old key. Operations are now serialized with the store lock.
- Preserve the recovery key after failed or interrupted master key rotation. Backups are created exclusively, and all updates are blocked while a backup remains. Rotation errors identify the failed persistence stage, including cleanup after successful key/data saves. Document full-store verification before manual recovery and backup removal.
- Prevent `lsec run` startup errors from exposing decrypted secrets. Validate the final environment before spawning and replace synchronous and asynchronous startup errors with fixed diagnostics.
- Apply all dotenv overrides before resolving secret references in `lsec run` / `resolveEnv`. Only each variable's final value is resolved, so overwritten invalid or missing references no longer cause failures; duplicate dotenv keys use the last value, including empty strings.
- Forward SIGTERM and SIGINT received by `lsec run` to its direct child, wait for the child to exit, and propagate its exit status.
- Make interrupted interactive prompts fail explicitly: Ctrl-C exits with 130, and EOF or input/output failures exit with 1. Partial input is never saved or accepted as confirmation, and terminal state is restored. Explicit negative or empty confirmations still cancel with exit 0.
- Preserve the installed executable when an installer download, checksum, startup check, or replacement fails. Stage and validate on the destination filesystem before replacing the binary with a single rename, and clean up temporary files on failure or INT/TERM interruption.

## [0.5.1] - 2026-11-03

### Fixed

- Prebuilt x64 binaries ( `lsec-linux-x64` , `lsec-darwin-x64` ) are now built against bun's baseline target. Previously they crashed with `Illegal instruction` on x64 CPUs without AVX2

## [0.5.0] - 2026-11-03

### Changed

- **Breaking**: Raise the supported Node.js range ( `engines.node` ) from `>=20` to `^20.18.3 || ^22.12.0 || >=23.1.0`. The npm CLI now imports `package.json` as a JSON module; older releases fail to load it (20.9) or print an `ExperimentalWarning` on every run. The prebuilt binary is unaffected
- Development: Node / pnpm / bun versions are managed with mise ( `.node-version` , `packageManager` in `package.json` , `.bun-version` )
- Development: rename the `build:bin` script to `build:bun`

### Fixed

- `lsec --version` reported a hard-coded `0.1.0` ; it now reports the package version

## [0.4.1] - 2026-08-24

### Fixed

- Install script: default install destination changed from `~/bin` to `~/.local/bin`, matching common XDG conventions

## [0.4.0] - 2026-08-24

### Added

- Cross-platform one-liner install script ( `install.sh` ): detects OS/CPU (darwin/linux x arm64/x64), downloads the matching binary from GitHub Releases (latest by default, pinnable via `LSEC_VERSION` ), verifies it against `SHA256SUMS` , and installs to `~/bin/lsec` (overridable via `LSEC_INSTALL_DIR` )

### Changed

- README: lead the installation section with the `install.sh` one-liner

## [0.3.0] - 2026-08-20

### Changed

- **Breaking**: CLI `set` now asks for the secret value once instead of twice — the confirmation re-entry (and its mismatch error) was removed. The prompt wording gains an "(input is hidden)" hint so it is clear the CLI is waiting for input even though nothing is echoed

### Fixed

- Fixed CLI `set` waiting for hidden input on a completely blank line: readline's first line refresh erased the question written by `promptHiddenPassword`. The question is now routed through `rl.question()` and re-emitted from the `_writeToOutput` hook, so every refresh redraws it while typed characters stay hidden

## [0.2.1] - 2026-08-20

### Added

- README: GitHub CLI and curl download instructions for the prebuilt binary

### Changed

- README: moved the CLI usage section before the library API section for improved reading flow

## [0.2.0] - 2026-08-19

### Added

- Single-binary build via bun, `pnpm build:bin` (produces `bin/lsec`)
- A GitHub Actions release workflow: pushing a `v*` tag builds the four binaries (darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64) plus `SHA256SUMS` and attaches them to GitHub Releases
- Added a binary-verification job to CI (runs the full e2e suite against `bin/lsec` built with bun; the release workflow also runs it against the linux-x64 binary). The e2e tests let you swap the target binary via the `LSEC_E2E_CLI` environment variable
- A bulk namespace-deletion command via `deleteNamespace` / the CLI's `delete-namespace`
- Sugar functions `tryGetSecret` / `hasSecret` / `listNamespaces`
- CLI `list --refs`: an option that prints each key as an `lsec://<namespace>/<key>` reference, one per line (can be pasted directly as an environment variable value for `lsec run`; combinable with `--ns` / `--all`). Keys that can't be represented as a reference (names containing `/` or whitespace, or a namespace literally named `global`) are excluded from stdout and warned about on stderr. Also exposes the inverse conversion function `formatSecretRef` as a library API
- CLI `run`: a secret-injection command equivalent to the 1Password CLI's `op run`. Resolves `lsec://<namespace>/<key>` references (supporting both parent-process environment variables and a `.env` file specified via `--dotenv`) and passes them to the child process as environment variables only for the duration of the specified command (also exposes `SecretRef` / `isSecretRef` / `parseSecretRef` / `EnvFileEntry` / `parseEnvFile` / `ResolveEnvOptions` / `resolveEnv` as library APIs). The option was named `--dotenv` rather than following `op run --env-file`'s naming, because `--env-file` collides with a runtime flag reserved by Node.js itself since v20.6 and gets intercepted by Node before lsec's own code runs

### Changed

- Renamed the package from `local-secret` to `lsec` (the repository also moved to `github.com/gendosu/lsec`; the storage location `~/.config/local-secret` and the `LOCAL_SECRET_CONFIG_DIR` environment variable are unchanged for compatibility)
- Changed the CLI `get` command to append a trailing newline to its output when run in a TTY
- Changed the CLI's bin name (command name) from `local-secret` to `lsec` and removed the old command name (the npm package name, storage directory, and `LOCAL_SECRET_CONFIG_DIR` environment variable are unchanged)

### Fixed

- Fixed a class of bugs where passing `Object.prototype`-derived names such as `constructor` / `__proto__` / `toString` as a `SecretStore` namespace or key would cause: `has` to incorrectly report an unregistered key as registered; `get` / `tryGet` to throw an unintended `TypeError` (also reachable via `lsec run`'s reference resolution); and `set` with `namespace: "__proto__"` to pollute the actual process's `Object.prototype` itself. The `global` / `namespaces` objects and each namespace container returned by `readStoreFile` / `emptyStoreData` are now null-prototype objects, as are the new containers created by `set` / `rotateMasterKey`. The same class of defect also existed in `resolveEnv` (the environment-variable merge used by `lsec run`), where an environment variable named `__proto__` was silently dropped; this was fixed as well

## [0.1.0] - 2026-07-12

### Added

- Secret encryption/decryption via AES-256-GCM (a machine-specific master key is generated automatically on first access)
- Storing, retrieving, listing, and deleting secrets via the `SecretStore` class (two-tier management: `global` / `namespace`)
- A public API of functions that delegate to a default instance (`getSecret` / `setSecret` / `deleteSecret`, etc.)
- Error classes `SecretNotFoundError` / `CryptoError` / `StoreError`
- A Commander-based CLI (bin: `local-secret`)
- Unit test and E2E test suites

### Fixed

- Fixed `dist` not being built on git-based installs, by adding a `prepare` script

[Unreleased]: https://github.com/gendosu/lsec/compare/v0.6.0...HEAD
[0.6.0]: https://github.com/gendosu/lsec/releases/tag/v0.6.0
[0.5.1]: https://github.com/gendosu/lsec/releases/tag/v0.5.1
[0.5.0]: https://github.com/gendosu/lsec/releases/tag/v0.5.0
[0.4.1]: https://github.com/gendosu/lsec/releases/tag/v0.4.1
[0.4.0]: https://github.com/gendosu/lsec/releases/tag/v0.4.0
[0.3.0]: https://github.com/gendosu/lsec/releases/tag/v0.3.0
[0.2.1]: https://github.com/gendosu/lsec/releases/tag/v0.2.1
[0.2.0]: https://github.com/gendosu/lsec/releases/tag/v0.2.0
[0.1.0]: https://github.com/gendosu/lsec/releases/tag/v0.1.0
