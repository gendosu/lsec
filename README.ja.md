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

ライブラリとして使う場合は Node.js 20 以上が必要です。バイナリ版 CLI は Node.js 不要です。

## インストール方法

### CLI（推奨: バイナリ）

GitHub Releases からビルド済みのバイナリをダウンロードして使う方法を推奨します。実行時に Node.js は不要です。

```bash
# macOS (Apple Silicon)
mkdir -p ~/bin
curl -fsSL -o ~/bin/lsec https://github.com/gendosu/lsec/releases/latest/download/lsec-darwin-arm64
chmod +x ~/bin/lsec
```

`~/bin` が PATH に含まれていない場合は、シェルの設定ファイルで PATH に追加してください。

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

`bun` が必要です（単一バイナリのビルドに使用します）。

```bash
pnpm install
pnpm build:bin
```

`bin/lsec` に単一バイナリが生成されます。

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

CLI の `run` コマンド（後述）が使っている、参照解決の純ロジックもライブラリ API として公開されています。CLI を経由せず、自前のツールから同じ解決規則を使いたい場合に利用できます。

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
# 値を設定（対話プロンプトで非表示入力・確認のため2回入力）
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
| `secrets.json` | `~/.config/local-secret/secrets.json` | `0o600`。`.tmp` ファイルへ書き込んで `rename` する原子的書き込み。 |
| `master.key.bak` | `~/.config/local-secret/master.key.bak` | `rotate-key` 実行中のみ一時的に存在する、ローテーション前の `master.key` のバックアップ。正常終了時は自動削除される（詳細は「master.key のローテーション」を参照）。 |

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

## master.key のローテーション

`lsec rotate-key`（ライブラリ側は `SecretStore#rotateMasterKey()` / `rotateMasterKey()`）で、新しい `master.key` を生成し、`global` と全 `namespace` の値をすべて新しい鍵で再暗号化できます。

- **all-or-nothing**: 現行鍵での復号は書き込み前にすべてメモリ上で完了させます。1件でも復号に失敗した場合（`master.key` の破損など）は `CryptoError` を投げて中断し、ディスク上の `master.key` / `secrets.json` は一切変更されません。
- **書き込み順序（クラッシュ耐性）**: (1) 現行 `master.key` を `master.key.bak` としてコピー → (2) 新しい鍵を `master.key` に原子的に書き込み（rename） → (3) 再暗号化済みの `secrets.json` を原子的に書き込み → (4) 成功したら `master.key.bak` を削除。2つのファイルにまたがる完全な原子性は実現できないため、(2) と (3) の間でプロセスがクラッシュした場合、`master.key` は新しい鍵に置き換わっているのに `secrets.json` はまだ旧鍵で暗号化されたまま、という状態が起こり得ます。この場合は **`master.key.bak` を `master.key` に上書きコピーして旧鍵を復元してください**。復元後は既存の `secrets.json` を通常どおり復号でき、`rotate-key` を再実行できます。

```bash
# 復旧手順の例（rotate-key 実行中にクラッシュした場合）
cp ~/.config/local-secret/master.key.bak ~/.config/local-secret/master.key
lsec get some_key   # 旧鍵で復号できることを確認
lsec rotate-key     # 改めてローテーションを実行
```

## `run`: コマンド実行中だけシークレットを環境変数として注入する（`op run` 相当）

`lsec run` は、1Password CLI の `op run` と同様のことを行います。シークレットの平文をシェル履歴や設定ファイルに残さず、指定したコマンドの実行中だけ、解決済みの値を環境変数として子プロセスに渡します。コマンド終了後、その値は残りません。

```
lsec run [--dotenv <path>] -- <command> [args...]
```

- `<command>` の前には `--` を置くことを推奨します。`lsec run` 自身のオプション（`--dotenv` など）と、実行したいコマンド自身のオプション（例: `npm run dev --watch` の `--watch`）を明確に区別できます（`--` を省略しても `<command>` 以降はそのまま渡されるようになっていますが、`--dotenv` のようなオプションは必ず `<command>` より前に書いてください）。
- **オプション名は `--env-file` ではなく `--dotenv` です。** 1Password CLI の `op run --env-file` と同じ名前にしたかったのですが、`--env-file` は Node.js v20.6 以降のランタイム自身が予約しているフラグ名で、argv 中のどこに書かれていても lsec のコード自身が起動する前に Node が横取りしてしまう（存在しないファイルを指定するとエラーメッセージも exit code も lsec のものではなく Node 自身のものになる）ため、意図的に別名にしています。
- 解決対象は次の 2 系統です（`op run` と同じ構成）。
  1. **親プロセスの環境変数**のうち、値が `lsec://<namespace>/<key>` 参照になっているもの
  2. `--dotenv <path>` で指定した `.env` ファイル内のエントリ（`--dotenv` のエントリは同名の親環境変数より優先されます）
- 参照でない値（親環境変数・`.env` の両方とも）はそのまま素通しします。親環境変数で参照になっていないものには一切手を加えません。

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

### 解決に失敗した場合

存在しない namespace/key への参照、不正な参照形式（`lsec://<namespace>/<key>` の形に一致しない）、存在しない `--dotenv` のパスや壊れた `.env` の内容は、いずれもコマンドを起動する前に検出され、stderr にエラーを出力して exit 1 で終了します（子プロセスは実行されません）。シークレットの値がエラーメッセージに含まれることはありません。

子プロセスの終了コード・シグナルは、そのまま `lsec run` 自身の終了コードとして伝播します（シグナルで終了した場合は `128 + シグナル番号`）。

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
