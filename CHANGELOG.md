# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `deleteNamespace` / CLI `delete-namespace` による namespace 単位の一括削除コマンド
- `tryGetSecret` / `hasSecret` / `listNamespaces` のシュガー関数
- CLI `list --refs`: key を `lsec://<namespace>/<key>` 参照形式で1行1件出力するオプション（`lsec run` の環境変数値にそのままコピペできる。`--ns` / `--all` と併用可）。参照として表現できない key（`/`・空白を含む名前、`global` というリテラル名の namespace）は stdout から除外して stderr に警告する。逆変換関数 `formatSecretRef` をライブラリ API としても公開
- CLI `run`: 1Password CLI の `op run` 相当のシークレット注入コマンド。`lsec://<namespace>/<key>` 参照記法（親プロセスの環境変数・`--dotenv` で指定した `.env` の両方に対応）を解決し、指定したコマンドの実行中だけ環境変数として子プロセスに渡す（`SecretRef` / `isSecretRef` / `parseSecretRef` / `EnvFileEntry` / `parseEnvFile` / `ResolveEnvOptions` / `resolveEnv` をライブラリ API としても公開）。オプション名は `op run --env-file` に倣わず `--dotenv` とした（`--env-file` は Node.js v20.6+ 自身のランタイムフラグと衝突し、lsec 自身のコードより先に Node に横取りされるため）

### Changed

- CLI `get` コマンドの出力に、TTY 実行時は末尾改行を付与するよう変更
- CLI の bin 名（コマンド名）を `local-secret` から `lsec` に変更し、旧コマンド名は廃止（npm パッケージ名・保存ディレクトリ・`LOCAL_SECRET_CONFIG_DIR` 環境変数は変更なし）

### Fixed

- `SecretStore` の namespace / key に `constructor` / `__proto__` / `toString` など `Object.prototype` 由来の名前を渡すと、未登録なのに登録済みと誤判定される（`has`）、意図しない `TypeError` が発生する（`get` / `tryGet`。`lsec run` の参照解決経由でも到達可能）、`set` で `namespace: "__proto__"` を指定すると実プロセスの `Object.prototype` 自体が汚染される、といった問題を修正。`readStoreFile` / `emptyStoreData` が返す `global` / `namespaces` / 各 namespace コンテナを null-prototype 化し、`set` / `rotateMasterKey` が新規コンテナを作る箇所も同様にした。同じ欠陥クラスが `resolveEnv`（`lsec run` の環境変数マージ）にもあり、`__proto__` という名前の環境変数が無言で消えていたため、あわせて修正

## [0.1.0] - 2026-07-12

### Added

- AES-256-GCM によるシークレットの暗号化・復号（マシン固有のマスター鍵を初回アクセス時に自動生成）
- `SecretStore` クラスによるシークレットの保存・取得・一覧・削除（`global` / `namespace` の 2 階層管理）
- 既定インスタンスに委譲する関数群（`getSecret` / `setSecret` / `deleteSecret` など）の公開 API
- `SecretNotFoundError` / `CryptoError` / `StoreError` のエラークラス
- Commander ベースの CLI（bin: `local-secret`）
- ユニットテスト・E2E テストスイート

### Fixed

- git 経由インストール時に `dist` がビルドされていなかった問題を、`prepare` スクリプト追加により修正

[Unreleased]: https://github.com/gendosu/local-secret/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/gendosu/local-secret/releases/tag/v0.1.0
