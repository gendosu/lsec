# Changelog

> English version: [CHANGELOG.md](./CHANGELOG.md)

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.6.0] - 2026-11-04

### 追加

- 解決済みの環境変数の値を子プロセス起動前に検証する `validateRunEnv` を公開。エラーメッセージに値を含めない。

### 変更

- **破壊的変更**: Node.js 用ライブラリと Node.js 上で動かす CLI の対応範囲を `^22.12.0 || ^24.0.0 || ^26.0.0`（最低版: 22.12.0・24.0.0・26.0.0）に限定。保守・検証する LTS 系列と対応範囲を一致させるため、EOL の Node.js 20・23・25 と未検証の将来メジャー版を対象外にする。CI では各メジャー版の最低版と最新版を検証する。ビルド済みバイナリには影響しない。
- 開発用の Node.js 型定義を最低対応メジャーの22系に合わせ、非対話コマンドと Dev Container のセットアップで mise 管理のツールを一貫して使用するようにした。

### 修正

- 同じストアを共有するプロセス間で、読み取り・更新・初回鍵生成・ローテーション全体を排他する。同期ロックの待機を最大5秒に制限し、異常終了で残ったロックは明示的な復旧まで保持する。一意な一時ファイルを排他的に作成し、他処理のファイルの上書き・削除を防ぐ。公開同期 API と既存の保存形式は維持する。
- 既存の `SecretStore` インスタンスと既定インスタンスの関数が、鍵を必要とする操作ごとに現行の master.key を読み込むようにした。別インスタンスや CLI のローテーションが正常完了した後も、読み取り・書き込み・再ローテーションが新しい鍵に追従し、復号失敗や旧鍵による保存を防ぐ。不正な鍵や読み取れない鍵では、古い鍵にフォールバックせず保存前に失敗する。操作中の競合も、ストア単位の排他で保護する。
- マスター鍵のローテーション失敗・中断後も復旧用の鍵を保持する。バックアップを排他的に新規作成し、残存中はすべての更新を拒否する。鍵・データ保存後の削除失敗も含め、失敗した永続化段階をエラーで示す。手動復旧とバックアップ削除の前にストアの全値を検証する手順を記載した。
- `lsec run` の起動エラーから復号済みシークレットが漏れる問題を修正。子プロセス起動前に最終的な環境変数を検証し、同期・非同期の起動エラーを固定の診断メッセージに置き換える。
- `lsec run` / `resolveEnv` で、dotenv による上書きをすべて適用してから各変数の最終値だけを参照解決するようにした。上書き済みの不正・未登録参照による失敗を防ぎ、dotenv の重複キーは空文字を含めて最後の値を採用する。
- `lsec run` が受け取った SIGTERM・SIGINT を直接の子プロセスへ転送し、終了を待って子の終了ステータスを返すようにした。
- 対話プロンプトの中断を明示的な失敗とし、Ctrl-C は130、EOF・入出力障害は1で終了するようにした。部分入力は保存・確認承認せず、端末状態を復元する。明示的な否定・空の確認回答は従来どおり終了コード0でキャンセルする。
- インストーラの取得・チェックサム検証・起動確認・置換に失敗した場合、既存の実行ファイルを保持するようにした。配置先と同じファイルシステム上で検証を終えてから単一の rename で置き換え、失敗時や INT・TERM による中断時には一時ファイルを削除する。

## [0.5.1] - 2026-11-03

### 修正

- ビルド済みの x64 バイナリ（ `lsec-linux-x64` 、 `lsec-darwin-x64` ）を bun の baseline 版でビルドするようにした。これまでは AVX2 に対応していない x64 CPU で `Illegal instruction` により起動できなかった

## [0.5.0] - 2026-11-03

### 変更

- **Breaking**: 対応する Node.js の範囲（ `engines.node` ）を `>=20` から `^20.18.3 || ^22.12.0 || >=23.1.0` に引き上げ。npm 版 CLI が `package.json` を JSON モジュールとして import するようになり、これより古いリリースでは読み込めない（20.9）か、実行のたびに `ExperimentalWarning` が出るため。ビルド済みバイナリには影響しない
- 開発環境: Node / pnpm / bun のバージョンを mise で管理（ `.node-version` 、 `package.json` の `packageManager` 、 `.bun-version` ）
- 開発環境: `build:bin` スクリプトを `build:bun` に改名

### 修正

- `lsec --version` が `0.1.0` 固定を表示していた問題を修正し、パッケージのバージョンを表示するようにした

## [0.4.1] - 2026-08-24

### 修正

- インストールスクリプトのデフォルト配置先を `~/bin` から `~/.local/bin` に変更（XDG の慣例に合わせた）

## [0.4.0] - 2026-08-24

### 追加

- クロスプラットフォーム対応のワンライナーインストールスクリプト（ `install.sh` ）: OS/CPU（darwin/linux × arm64/x64）を検出し、GitHub Releases から対応するバイナリをダウンロード（デフォルトは最新版、 `LSEC_VERSION` でバージョン指定可能）、 `SHA256SUMS` で検証した上で `~/bin/lsec` にインストール（ `LSEC_INSTALL_DIR` でインストール先を変更可能）

### 変更

- README: インストール手順の先頭に `install.sh` のワンライナーを配置

## [0.3.0] - 2026-08-20

### 変更

- **破壊的変更**: CLI `set` のシークレット値入力を2回（確認再入力あり）から1回に変更。確認再入力とその不一致エラーを廃止した。また、入力が画面に表示されなくても入力待ちであることが分かるよう、プロンプト文言に「(input is hidden)」のヒントを追加

### 修正

- CLI `set` が質問文の消えた真っ白な行のまま隠し入力を待つ問題を修正。readline の初回行リフレッシュが `promptHiddenPassword` の書き込んだ質問文を消していたため、質問を `rl.question()` 経由で出力し、`_writeToOutput` フックから質問文のみ再描画するようにした（入力文字は非表示のまま）

## [0.2.1] - 2026-08-20

### 追加

- README: プリビルドバイナリの GitHub CLI / curl によるダウンロード手順

### 変更

- README: 読みやすさ向上のため CLI 使用方法セクションをライブラリ API セクションより前に移動

## [0.2.0] - 2026-08-19

### Added

- bun による単一バイナリビルド `pnpm build:bin`（`bin/lsec` を生成）
- GitHub Actions によるリリースワークフロー。`v*` タグの push で darwin-arm64 / darwin-x64 / linux-x64 / linux-arm64 の4バイナリと `SHA256SUMS` をビルドし、GitHub Releases に添付
- CI にバイナリ検証ジョブを追加（bun でビルドした `bin/lsec` に対して e2e スイート全体を実行。リリースワークフローでも linux-x64 バイナリに対して実行）。e2e テストは `LSEC_E2E_CLI` 環境変数で対象バイナリを差し替え可能
- `deleteNamespace` / CLI `delete-namespace` による namespace 単位の一括削除コマンド
- `tryGetSecret` / `hasSecret` / `listNamespaces` のシュガー関数
- CLI `list --refs`: key を `lsec://<namespace>/<key>` 参照形式で1行1件出力するオプション（`lsec run` の環境変数値にそのままコピペできる。`--ns` / `--all` と併用可）。参照として表現できない key（`/`・空白を含む名前、`global` というリテラル名の namespace）は stdout から除外して stderr に警告する。逆変換関数 `formatSecretRef` をライブラリ API としても公開
- CLI `run`: 1Password CLI の `op run` 相当のシークレット注入コマンド。`lsec://<namespace>/<key>` 参照記法（親プロセスの環境変数・`--dotenv` で指定した `.env` の両方に対応）を解決し、指定したコマンドの実行中だけ環境変数として子プロセスに渡す（`SecretRef` / `isSecretRef` / `parseSecretRef` / `EnvFileEntry` / `parseEnvFile` / `ResolveEnvOptions` / `resolveEnv` をライブラリ API としても公開）。オプション名は `op run --env-file` に倣わず `--dotenv` とした（`--env-file` は Node.js v20.6+ 自身のランタイムフラグと衝突し、lsec 自身のコードより先に Node に横取りされるため）

### Changed

- パッケージ名を `local-secret` から `lsec` にリネーム（リポジトリも `github.com/gendosu/lsec` へ移動。保存先 `~/.config/local-secret` と環境変数 `LOCAL_SECRET_CONFIG_DIR` は互換性のため変更なし）
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
