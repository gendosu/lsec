# lsec

> English version: [README.md](./README.md)

lsec は、ローカルマシン上にシークレット（API キー・トークン・パスワードなど）を暗号化して保存する、単一バイナリとして配布される CLI + Node.js 用ライブラリです。CLI は単一バイナリのため実行時に Node.js を必要とせず、nodenv / mise などのバージョン切り替えの影響を受けません。

## プロジェクト概要

パスワードを AES-256-GCM で暗号化し、マシン固有のマスター鍵で復号する汎用のローカルシークレットストアです(保存先は `~/.config/local-secret/`)。任意のアプリ・スクリプトが、ローカルに秘密情報を暗号化保存・取得するためのライブラリと CLI（`lsec`）を提供します。

- 名前付きシークレット（key → 文字列値）の保存・取得・一覧・削除
- `global` と `namespace` の 2 階層での名前管理
- AES-256-GCM による値の暗号化（認証付き・改ざん検知）
- マシン固有のランダムマスター鍵を初回アクセス時に自動生成
- クラス型ライブラリ API（`SecretStore`）と、既定インスタンスに委譲する関数群
- Commander ベースの CLI（bin: `lsec`）
- 1Password CLI の `op run` 相当のシークレット注入コマンド（`lsec run`）。`lsec://<namespace>/<key>` 参照を、指定したコマンドの実行中だけ環境変数として解決する

値は文字列のみを扱います（構造化 JSON 値やリモート同期はスコープ外です）。

ライブラリと Node.js 上で動かす CLI は、次のメジャーバージョンのみに対応します。

| Node.js メジャー版 | 最低バージョン |
| --- | --- |
| 22 | 22.12.0 |
| 24 | 24.0.0 |
| 26 | 26.0.0 |

対応範囲は `^22.12.0 || ^24.0.0 || ^26.0.0` です。CI では各メジャー版の最低版と最新版を検証します。対応メジャー版の最新パッチ版を推奨します。新しいメジャー版は、明示的な検証と `engines.node`・CI・本ドキュメントの更新を経て対応に追加します。

ビルド済みバイナリ版 CLI は Node.js を必要とせず、このサポート方針の影響を受けません。

## インストール方法

### CLI（推奨: バイナリ）

GitHub Releases からビルド済みのバイナリをダウンロードして使う方法を推奨します。実行時に Node.js は不要です。

#### ワンライナーでインストール（推奨）

macOS（Apple Silicon / Intel）・Linux（x86_64 / arm64）共通で、次の1行でインストールできます。OS・CPU の自動判別、最新リリースのダウンロード、SHA256 チェックサムの検証、`~/.local/bin/lsec` への配置までを自動で行います（リポジトリとそのリリースが公開されている場合に利用できます）。

```bash
curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | sh
```

環境変数で配置先とバージョンを変更できます（環境変数はパイプの `sh` 側に付けます）。

```bash
# 配置先を変更する（既定: ~/.local/bin）
curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | LSEC_INSTALL_DIR="$HOME/bin" sh

# バージョンを固定する（既定: latest）
curl -fsSL https://raw.githubusercontent.com/gendosu/lsec/main/install.sh | LSEC_VERSION=v0.3.0 sh
```

#### GitHub CLI でダウンロード

このリポジトリにアクセスできるアカウントで認証済みの [GitHub CLI](https://cli.github.com/)（`gh auth login`）が必要です。ブラウザ経由のダウンロードと違い、`gh` は quarantine 属性を付与しないため、macOS Gatekeeper にブロックされずそのまま実行できます。

```bash
# macOS (Apple Silicon)
mkdir -p ~/.local/bin
gh release download --repo gendosu/lsec --pattern lsec-darwin-arm64 --output ~/.local/bin/lsec --clobber
chmod +x ~/.local/bin/lsec
```

#### curl で手動ダウンロード

リポジトリ（およびそのリリース）が公開されている場合のみ利用できます。

```bash
# macOS (Apple Silicon)
mkdir -p ~/.local/bin
curl -fsSL -o ~/.local/bin/lsec https://github.com/gendosu/lsec/releases/latest/download/lsec-darwin-arm64
chmod +x ~/.local/bin/lsec
```

`~/.local/bin` が PATH に含まれていない場合は、シェルの設定ファイルで PATH に追加してください。

| アセット | 対象プラットフォーム |
| --- | --- |
| `lsec-darwin-arm64` | macOS（Apple Silicon） |
| `lsec-darwin-x64` | macOS（Intel） |
| `lsec-linux-x64` | Linux（x86_64） |
| `lsec-linux-arm64` | Linux（arm64） |
| `SHA256SUMS` | 上記4バイナリの SHA256 チェックサム一覧 |

配布しているバイナリは未署名です。ブラウザ経由でダウンロードした場合、macOS Gatekeeper にブロックされ実行できないことがあります。その場合は quarantine 属性を解除してください（`curl` でのダウンロードでは通常この属性は付与されないため発生しません）。

```bash
xattr -d com.apple.quarantine <path>
```

### ソースからビルド

[mise](https://mise.jdx.dev/getting-started.html) をインストールし、リポジトリルートで以下のコマンドを実行してください。`mise.toml` は開発ツールのバージョン指定ファイルを有効にしています。Node.js は `.node-version`、pnpm は `package.json` の `packageManager`、単一バイナリのビルドに使う Bun は `.bun-version` で選択します。これらの開発用バージョンと、前述のライブラリの実行要件は別です。

`mise` が PATH にない場合は、各コマンドの `mise` をインストール先の絶対パス（既定のインストールなら `"$HOME/.local/bin/mise"`）に置き換えてください。

リポジトリの設定内容を確認してから、この設定を信頼し、ツールをインストールします。

開発には `.node-version` で指定した Node.js 26 を使用します。この開発用の指定と、上記の利用者向け対応バージョンは別のものです。

```bash
mise trust
mise install
```

スクリプトや非対話シェルでは、自動 activation に依存せず [mise exec](https://mise.jdx.dev/cli/exec.html) を使います。`MISE_ACTIVATE_AGGRESSIVE=1` は、nodenv の shim など、[競合する PATH のエントリより mise のツールを優先する設定](https://mise.jdx.dev/configuration/settings.html#activate_aggressive)です。pnpm の子プロセス（`prepare` スクリプトの npm を含む）も、選択した Node.js を使用できます。この指定は各コマンドにのみ適用されます。

バージョンと、pnpm の子プロセスが使う Node.js の実行ファイルを確認します。

```bash
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- node --version
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm --version
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- bun --version
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm exec node -p 'JSON.stringify({version:process.version,execPath:process.execPath})'
```

バージョンがリポジトリの指定と一致し、子プロセスの `execPath` が mise の Node.js インストール先を指すことを確認してください。

依存関係をインストールし、ライブラリのビルドとテストを実行します。

```bash
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm install --frozen-lockfile
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm build
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm test:unit
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm test:e2e
```

`bin/lsec` に単一バイナリを生成し、起動確認と同じ E2E スイートをバイナリに対して実行します。

```bash
MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm build:bun
./bin/lsec --version
LSEC_E2E_CLI="$PWD/bin/lsec" MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm test:e2e
```

対話シェルで使う場合は、そのシェルが実際に読み込む初期化ファイル（例: 対話 Bash の `~/.bashrc`、Zsh の `~/.zshrc`）で、nodenv/anyenv の初期化と他の PATH 変更の後に mise の activation を配置してください。Bash のログインシェルでは、nodenv/anyenv の初期化後に `~/.bash_profile` から `~/.bashrc` を読み込む必要がある場合もあります。Bash では `eval "$(mise activate bash)"`、Zsh では `eval "$(mise activate zsh)"` を使い、新しいシェルを開いてリポジトリルートで `command -v node` と `command -v pnpm` を実行し、mise のツールが優先されることを確認します。非対話実行では、上記の明示的なコマンドを使用してください。

Dev Container の `.devcontainer/postCreate.sh` も同じ trust/install の順序と、依存導入用の `CI=true MISE_ACTIVATE_AGGRESSIVE=1 mise exec -- pnpm install --frozen-lockfile` を使用します。

### ライブラリとして使う場合

npm への公開は準備済みですが、当面は git 経由でインストールしてください。

```bash
# pnpm（SSH 経由）
pnpm add git+ssh://git@github.com/gendosu/lsec.git

# HTTPS 経由でクローンする場合
pnpm add git+https://github.com/gendosu/lsec.git
```

npm 公開後は次のようにインストールできます。

```bash
pnpm add lsec
```

## CLI の使い方

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
# 値を設定（対話プロンプトで1回入力・入力値は非表示）
lsec set github_token

# パイプ入力で設定（スクリプト向け。末尾の改行1個は自動で除去される）
echo -n "ghp_xxxxx" | lsec set github_token --stdin

# namespace を指定して設定
lsec set password --ns imap --stdin <<< "p@ss"

# 取得（非TTY時は改行なしで stdout に出力するので $(...) で使える。TTY（ターミナル直接実行）時は末尾に改行が付く）
lsec get github_token
TOKEN=$(lsec get github_token)

# namespace を指定して取得
lsec get password --ns imap

# 存在確認（値は出力しない。登録済みなら exit 0、未登録なら exit 1）
lsec has github_token && echo "registered"
lsec has password --ns imap

# 一覧表示（--ns 省略時は global、--all は全 namespace）
lsec list
lsec list --ns imap
lsec list --all

# --refs は key を lsec://<namespace>/<key> 参照形式で1行1件出力する
# （lsec run の環境変数値にそのままコピペできる）
lsec list --all --refs
# => lsec://global/github_token
#    lsec://imap/password

# 削除（未登録の key を指定しても冪等に成功する）
lsec delete github_token

# 使用済みの namespace 一覧
lsec namespaces

# namespace ごと削除（TTY では対象 key 件数を表示して y/N 確認。--yes で確認をスキップ）
lsec delete-namespace imap
lsec delete-namespace imap --yes

# 非TTY（パイプ・スクリプト実行）では --yes が必須。無いとハングせずエラーで終了する
lsec delete-namespace imap --yes < /dev/null

# master.key をローテーション（新しい鍵を生成し、global/全 namespace の値を再暗号化して置き換える）
# TTY では確認プロンプトを表示。--yes で確認をスキップし、非TTY では --yes が必須
lsec rotate-key
lsec rotate-key --yes

# シークレットを、指定したコマンド実行中だけ環境変数として注入する（1Password CLI の `op run` 相当）
# "--" より前が lsec run 自身のオプション、"--" より後が実行したいコマンドと、そのコマンド自身の引数
GITHUB_TOKEN="lsec://global/github_token" lsec run -- gh api user
GITHUB_TOKEN="lsec://global/github_token" lsec run -- npm run dev

# --dotenv を使う場合（ファイル内の値が lsec://... 参照ならそれを解決し、そうでなければリテラルな値としてそのまま渡す）
lsec run --dotenv .env -- npm run dev
```

シェル履歴に値が残る `--value <v>` のようなオプションは提供していません。値は対話プロンプト（非表示）か `--stdin` のいずれかで渡してください。未登録の key を `get` した場合など、エラー時は stderr にメッセージを出力し非ゼロの終了コードで終了します。

## ライブラリ API の使い方

### SecretStore クラス

```ts
import { SecretStore } from 'lsec';

// 既定: ~/.config/local-secret を使用
const store = new SecretStore();

// appName を指定して ~/.config/<appName> を使う場合
const namedStore = new SecretStore({ appName: 'my-app' });

// configDir をフルパスで上書き（主にテスト隔離用）
const testStore = new SecretStore({ configDir: '/tmp/my-app-config' });

// 保存（namespace 省略時は global）
store.set('github_token', 'ghp_xxxxx');
store.set('password', 'p@ss', { namespace: 'imap' });

// 取得（未登録の場合は SecretNotFoundError を throw）
const token = store.get('github_token');

// 取得（未登録の場合は例外を投げず undefined を返す）
const maybeToken = store.tryGet('missing_key'); // => undefined

// 登録済みかどうかの確認
store.has('github_token'); // => true / false

// 削除（削除できれば true、未登録なら false）
store.delete('github_token');

// key 名の一覧（namespace 省略時は global）
store.list(); // => ['github_token', ...]
store.list({ namespace: 'imap' }); // => ['password']

// 使用済みの namespace 名の一覧
store.namespaces(); // => ['imap', 'aws']

// namespace ごと削除（削除できれば true、未登録なら false。global は対象外）
store.deleteNamespace('imap');

// master.key をローテーション（新しい鍵で全値を再暗号化して置き換え、再暗号化した件数を返す）
store.rotateMasterKey(); // => 3
```

`SecretNotFoundError` / `CryptoError` / `StoreError` もライブラリからエクスポートされているので、必要に応じて捕捉できます。

```ts
import { getSecret, SecretNotFoundError } from 'lsec';

try {
  getSecret('missing_key');
} catch (err) {
  if (err instanceof SecretNotFoundError) {
    console.error('シークレットが未登録です');
  }
}
```

### 既定インスタンスに委譲する関数

インスタンスを自分で管理したくない場合、内部で遅延生成された既定の `SecretStore`（`~/.config/local-secret` 固定）に委譲する関数も利用できます。

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
rotateMasterKey(); // => 3（再暗号化した件数）
```

用意されている関数は `setSecret` / `getSecret` / `tryGetSecret` / `hasSecret` / `deleteSecret` / `listSecrets` / `listNamespaces` / `deleteNamespace` / `rotateMasterKey` の 9 本です。`configDir` の注入はできません。それが必要な場合は `SecretStore` クラスを直接使ってください。

### `lsec run` の解決ロジック（ライブラリ API）

CLI の `run` コマンド（前述）が使っている、参照解決の純ロジックもライブラリ API として公開されています。CLI を経由せず、自前のツールから同じ解決規則を使いたい場合に利用できます。

```ts
import { isSecretRef, parseSecretRef, parseEnvFile, resolveEnv, SecretStore } from 'lsec';

isSecretRef('lsec://work/token'); // => true
parseSecretRef('lsec://work/token'); // => { namespace: 'work', key: 'token' }
parseSecretRef('lsec://global/api_key'); // => { key: 'api_key' }（global は namespace 省略と同義）

parseEnvFile('GITHUB_TOKEN=lsec://global/gh_token\nPLAIN=hello\n');
// => [{ key: 'GITHUB_TOKEN', value: 'lsec://global/gh_token' }, { key: 'PLAIN', value: 'hello' }]

const store = new SecretStore();
const env = resolveEnv({
  processEnv: process.env,
  envFileEntries: parseEnvFile('GITHUB_TOKEN=lsec://global/gh_token\n'),
  resolveSecret: (ref) => store.get(ref.key, { namespace: ref.namespace }),
});
```

## 脅威モデルの注意書き

マスター鍵（`master.key`）は暗号文（`secrets.json`）の隣、同一ディレクトリに保存されます。これは「真の暗号化」ではなく **事故時の露出防止(秘密の二分割＋難読化)** であることを明示しておきます。

| 脅威 | 平文保存の場合 | lsec（本ライブラリ）の場合 |
| --- | --- | --- |
| A: `secrets.json` だけが事故で漏れる（誤 `git add` / バックアップ同期 / 貼り付け） | 露出 | 守れる（暗号文のみ。鍵は別ファイル `master.key`） |
| B: 同一ユーザ権限の攻撃者が `~/.config/local-secret` を丸ごと読む | 露出 | 露出（鍵と暗号文が隣接しており差は無い） |
| C: root / ディスク全体アクセス | 露出 | 露出（差は無い） |

個人用のローカル CLI / ライブラリとして、脅威 A（事故漏えい）の防止に価値を置いた設計です。**脅威 B・C（同一ユーザ権限の攻撃者や root）には防御力を持ちません。** より強い保護が必要な場合は、パスフレーズ由来鍵や OS キーチェーン連携などを別途検討してください（本ライブラリの対象外です）。

## ストレージ仕様

パッケージは `lsec` にリネームされましたが、保存先ディレクトリ名は後方互換のため `local-secret` のまま変更していません。

保存先は `os.homedir()` 基準の `~/.config/local-secret/` に固定です（`appName` を指定した場合は `~/.config/<appName>/`）。

| ファイル | パス | 内容 |
| --- | --- | --- |
| `master.key` | `~/.config/local-secret/master.key` | 32 バイトの乱数（`crypto.randomBytes(32)`）。ファイルは `0o600`、ディレクトリは `0o700`。初回アクセス時に自動生成される。 |
| `secrets.json` | `~/.config/local-secret/secrets.json` | `0o600`。一意な `.tmp` ファイルを排他的に新規作成してから `rename` する原子的書き込み。 |
| `master.key.bak` | `~/.config/local-secret/master.key.bak` | ローテーション前の鍵の復旧用バックアップ。`0o600` で排他的に新規作成し、正常終了時に削除する。残存時は復旧確認が終わるまで更新を拒否する（「master.key のローテーション」を参照）。 |

`secrets.json` の構造:

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

key 名・namespace 名は平文で保存され、**値のみ**が AES-256-GCM で暗号化されます（一覧表示や運用性のための意図的な選択）。各値は保存ごとに新しい IV を用いるため、同じ値でも暗号文は毎回変わります。

## 並行アクセスと処理中断

`SecretStore` の全操作・既定インスタンスの関数・CLI のストア操作は、保存先に `0o700` の `.lsec.lock` ディレクトリを作って、同じ実体ディレクトリへのアクセスを直列化します。読み込み、現行鍵の選択・初回生成、暗号化・復号、変更、保存、ローテーションの後始末まで同じロックを保持します。相対パスやディレクトリへの symlink が同じストアを指す場合も共通のロックを使い、別ストアは独立して処理できます。同じキーへの保存はロック取得順に上書きされます。各呼び出しの直列化であり、複数回の呼び出しを一つのトランザクションにはしません。

同期 API は busy loop を避け、10 ms 間隔で最大5秒待機します。待機中は**呼び出し元のスレッド・イベントループが停止**します。期限切れや取得失敗は、その操作の鍵・データへアクセスする前に `StoreError` を返します。読み取りでもロック用メタデータを作るため、保存先ディレクトリへの書き込み権限が必要です。constructor・import の遅延性と、未登録キーの読み取りで鍵を生成しない挙動を維持します。API の引数・データ形式は変わらず、既存ストアの変換は不要です。鍵とデータは、一意な名前の一時ファイルを `0o600` で排他的に新規作成して保存し、自分の作業ファイルだけを片付けます。既存の旧固定名 `.tmp` は変更しません。

正常終了・例外時はロックを解放します。解放失敗は、変更を保存済みでも `StoreError` を返すため、再試行前に結果を確認してください。本体処理も失敗した場合は、両方のエラーを cause に保持します。`SIGKILL` などの異常終了では、ロックや非公開の一時ファイルが残る場合があります。経過時間や PID の生死を根拠に**ロックを自動回収・強奪しません**。後続の操作は待機期限後に失敗します。

残存ロックから復旧するには、ストアを使う**すべてのプロセスを停止**し、鍵・データ・バックアップ・一時ファイルを非公開の場所へ保全します。**`.lsec.lock` をコピーしない隔離コピー**で、対応する鍵と全保存値を検証してください。`master.key.bak` があれば以下のローテーション復旧手順に従い、無条件で現行鍵へ上書きしないでください。鍵とデータの組み合わせの確認・必要な復元が完了してから、空の `.lsec.lock` ディレクトリだけを `rmdir` で除去し、実ストアの全値を再確認します。その後に復旧バックアップを除去して処理を再開します。動作中の所有者のロックは除去しないでください。ロックが空でない場合やファイルの整合性を確認できない場合は、保全して調査してください。

この排他は、ローカルファイルシステム上で同じ規約に従う本バージョンのプロセス間で機能します。旧版や直接ファイル編集との同時利用は避けてください。分散・ネットワークファイルシステム上の排他や、電源断を含む永続トランザクションは保証範囲外です。

## master.key のローテーション

`lsec rotate-key`（ライブラリ側は `SecretStore#rotateMasterKey()` / `rotateMasterKey()`）で、新しい `master.key` を生成し、`global` と全 `namespace` の値をすべて新しい鍵で再暗号化できます。

- **既存インスタンスの継続利用**: 別インスタンスや CLI のローテーションが正常完了した後は、既存の `SecretStore` インスタンスと既定インスタンスの関数も、次の読み取り・書き込み・ローテーションで現行鍵を使います。読み取りを含む全ストア操作が同じロックに参加し、ローテーション全体を保護するため、鍵と暗号文の整合性を維持します。
- **永続化前の中断**: 全値の復号と再暗号化を先にメモリ上で完了させます。復号に失敗すると `CryptoError` を投げ、鍵・データ・バックアップを変更せず中断します。
- **永続化の順序**: (1) 有効な現行鍵から `master.key.bak` を排他的に新規作成 → (2) rename で `master.key` を置換 → (3) rename で `secrets.json` を置換 → (4) バックアップを削除。2ファイルの置換は単一トランザクションではありません。(2) と (3) の間の失敗では旧データにバックアップ鍵が必要です。(3) の後の失敗（バックアップ削除失敗を含む）では新データに現行鍵が必要です。削除失敗時は新鍵とデータの保存が完了したことを明示する `StoreError` を投げます。
- **復旧待ち**: `master.key.bak` のパスが残っている間は、不正なファイル・ディレクトリ・リンク切れの symlink も含め、`set`・`delete`・`deleteNamespace`・`rotateMasterKey` を `StoreError` で拒否します。未登録項目の削除、同一・新規インスタンス、次の CLI プロセスも対象です。再試行でバックアップを上書きしません。復旧待ち中の読み取りはディスク上の現行鍵を使い、バックアップや古いキャッシュへフォールバックせず、現行鍵が欠落していても新しく生成しません。`has`・`list`・`namespaces` は利用できます。失敗時の自動ロールバックや自動バックアップ削除は行いません。

ローテーションの失敗・中断後に手動復旧する場合:

1. ストアを使う**すべてのプロセスを停止**します。変更前に `master.key`・`secrets.json`・`master.key.bak` の存在するものを非公開の場所へ保全コピーします。以下の検証用コピーとは別に原本を残し、権限（鍵・データは `0o600`、ディレクトリは `0o700`）を維持します。
2. **`.lsec.lock` を含めない隔離コピー上で**現行 `master.key` が32バイトであることと、**global と全 namespace の全値**を復号できることを確認します。下の例は平文を出力せず検証します。全値を復号できたら、その鍵を維持します。保存が完了し、後始末だけ失敗した可能性があるためです。1件の `get` 成功だけでは不十分です。
3. 現行鍵で全値を復号できない場合に限り、別の隔離コピーで有効な32バイトのバックアップを `master.key` にコピーして、再度全値を検証します。どちらの鍵でも全値を復号できなければ、すべてのファイルを保全して調査し、実ストアの鍵の上書きやバックアップの削除を行わないでください。空ストアは復号で鍵の世代を識別できないため、有効な現行鍵がある場合は維持します。
4. 原本の保全コピーを残したまま、検証済みの正しい鍵とデータの組み合わせを復元します。全利用プロセスの停止後もロックが残っていれば、空の `.lsec.lock` ディレクトリだけを `rmdir` で除去します。他のプロセスを停止した状態で実ストアの全値を再確認し、**確認後にだけ `master.key.bak` を明示的に削除**して、更新や `rotate-key` を再開します。

検証例（npm パッケージ `lsec` をインストールしたプロジェクトで実行し、`RECOVERY_DIR` に隔離コピーの絶対パス、最終確認時は復元したストアのパスを指定）:

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

## `run`: コマンド実行中だけシークレットを環境変数として注入する（`op run` 相当）

`lsec run` は、1Password CLI の `op run` と同様のことを行います。シークレットの平文をシェル履歴や設定ファイルに残さず、指定したコマンドの実行中だけ、解決済みの値を環境変数として子プロセスに渡します。コマンド終了後、その値は残りません。

```
lsec run [--dotenv <path>] -- <command> [args...]
```

- `<command>` の前には `--` を置くことを推奨します。`lsec run` 自身のオプション（`--dotenv` など）と、実行したいコマンド自身のオプション（例: `npm run dev --watch` の `--watch`）を明確に区別できます（`--` を省略しても `<command>` 以降はそのまま渡されるようになっていますが、`--dotenv` のようなオプションは必ず `<command>` より前に書いてください）。
- **オプション名は `--env-file` ではなく `--dotenv` です。** 1Password CLI の `op run --env-file` と同じ名前にしたかったのですが、`--env-file` は Node.js v20.6 以降のランタイム自身が予約しているフラグ名で、argv 中のどこに書かれていても lsec のコード自身が起動する前に Node が横取りしてしまう（存在しないファイルを指定するとエラーメッセージも exit code も lsec のものではなく Node 自身のものになる）ため、意図的に別名にしています。
- 子プロセスの環境変数は次の 2 系統を組み合わせます（`op run` と同じ構成）。
  1. **親プロセスの環境変数**
  2. `--dotenv <path>` で指定した `.env` ファイル内のエントリ（`--dotenv` のエントリは同名の親環境変数より優先されます。同じキーが複数ある場合は最後のエントリが優先され、空文字も有効です）
- **参照解決より先に上書きを適用**します。各変数の最終値が `lsec://<namespace>/<key>` 参照の場合だけ解決し、それ以外の最終値はそのまま渡します。上書きされた参照は構文解析も取得も行わないため、不正・未登録の参照でも有効な最終値に置き換わればエラーになりません。

### `lsec://<namespace>/<key>` 参照記法

`set` で保存した key を、`run` が解決できる参照として指定する記法です。`global` namespace の場合は `lsec://global/<key>` と書きます（`--ns` を省略した場合と同じ、既定の `global` を指します。namespace という名前の namespace ではありません）。namespace・key のいずれも `/` と空白を含められません（含む key を `set` で保存した場合、`run` からは参照できません）。

```bash
lsec set github_token --stdin <<< "ghp_xxxxx"
GITHUB_TOKEN="lsec://global/github_token" lsec run -- gh api user

lsec set token --ns work --stdin <<< "work-token"
WORK_TOKEN="lsec://work/token" lsec run -- npm run dev
```

### `.env` を使う場合

プロジェクトの `.env` には、実際の値ではなく `lsec://<namespace>/<key>` 参照を書けます。参照でない行はリテラルな値としてそのまま渡されます。対応しているのは `KEY=VALUE` 形式・`#` から始まる行コメント（行頭のみ。値の末尾に書いた `#` はコメントにならず値の一部になります）・空行・単純な引用符（`"..."` / `'...'`）の除去のみです。シェルのような変数展開やコマンド置換は一切行わず（値は常にリテラル文字列として扱われます）、`export KEY=VALUE` のような shell 構文にも対応していません。

```
# .env
GITHUB_TOKEN=lsec://global/github_token
PLAIN_VALUE=not-a-secret
```

```bash
lsec run --dotenv .env -- npm run dev
```

### 解決・起動に失敗した場合

上書き後の最終値に、存在しない namespace/key への参照や不正な参照形式（`lsec://<namespace>/<key>` の形に一致しない）が残る場合は、コマンドを起動する前に検出され、stderr にエラーを出力して exit 1 で終了します（子プロセスは実行されません）。存在しない `--dotenv` のパスや壊れた `.env` の内容も起動前にエラーになります。後のエントリで上書きされる場合も、ファイル全体の構文解析は行います。シークレットの値がエラーメッセージに含まれることはありません。

保存値は一般の文字列であり、`SecretStore.set` / `get` では NUL（`\0`）を含む文字列もそのまま保存・取得できます。環境変数への注入には別の制約があります。`run` はすべての `--dotenv` の上書きと最終値の参照解決後に、NUL を含む値や文字列以外の値を子プロセスの起動前に拒否し、変数名と問題種別だけを表示して exit 1 で終了します。`.env` ファイル内のリテラル値にも同じ制約を適用します。診断の例:

```text
Error: Invalid value for environment variable "TOKEN": NUL bytes are not allowed.
```

プロセスの起動に失敗した場合も、`run` はランタイムの元の例外や解決済みの値を表示せず、固定の診断メッセージを出して exit 1 で終了します。既知の原因は、コマンドが見つからない（`ENOENT`）、実行権限がない（`EACCES`）、引数や環境変数が大きすぎる（`E2BIG`）、引数や環境変数が不正（`ERR_INVALID_ARG_VALUE`）として識別できます。それ以外の起動失敗には汎用の診断を表示します。

子プロセスの終了コード・シグナルは、そのまま `lsec run` 自身の終了コードとして伝播します（シグナルで終了した場合は `128 + シグナル番号`）。

Linux / macOS では、`lsec run` が受け取った各 `SIGTERM` / `SIGINT` を直接起動した子プロセスへ転送し、その子の終了を待ちます。子が既定のシグナル処理で終了すれば、それぞれ終了コードは 143 / 130 です。子がシグナルを処理して後片付け後に独自のコードで終了する場合は、そのコードを維持します。子がシグナルを無視する、または実行を続ける場合、`lsec run` も待機を続けます。タイムアウトや `SIGKILL` への強制切り替えは行いません。転送に失敗した場合は引数や環境変数の値を含まない固定の診断を表示し、子の終了監視を続けます。

端末の Ctrl-C は共通のフォアグラウンドプロセスグループを通じて親子の両方へ届くため、転送によって子へ同じシグナルが再度届く場合があります。子の後片付け処理は繰り返しの受信に対応させてください。転送対象は直接の子だけです。シェルや npm などのラッパーが起動した孫以降のプロセスは、ラッパー自身の転送処理にも依存します。daemon 化したプロセス、lsec への `SIGKILL`、Windows のシグナル動作は保証範囲外であり、lsec の停止によってシークレットを持つすべての子孫プロセスが停止する保証はありません。

出力のマスキング（子プロセスの標準出力・標準エラー出力に紛れ込んだシークレット値の置換）は行いません。`stdio` を子プロセスに直結（inherit）しているため、対話的なコマンド（プロンプトの表示・パスワード入力など）もそのまま動作します。

## `LOCAL_SECRET_CONFIG_DIR` 環境変数

CLI (`lsec`) は、環境変数 `LOCAL_SECRET_CONFIG_DIR` が設定されている場合、`~/.config/local-secret` の代わりにそのパスを `configDir` として使用します。主にテストや隔離環境での利用を想定した上級者向けオプションです。

```bash
LOCAL_SECRET_CONFIG_DIR=/tmp/my-isolated-config lsec set foo --stdin <<< "bar"
LOCAL_SECRET_CONFIG_DIR=/tmp/my-isolated-config lsec get foo
```

ライブラリ側で同等のことをしたい場合は `new SecretStore({ configDir: '...' })` を使ってください。

## ライセンス

MIT
