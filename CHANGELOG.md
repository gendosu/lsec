# Changelog

> 日本語版: [CHANGELOG.ja.md](./CHANGELOG.ja.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/gendosu/lsec/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gendosu/lsec/releases/tag/v0.1.0
