# Helicode

Visual Studio Code 用の Helix キーバインド拡張機能です。Helix のキーを
VS Code のコマンドに読み替えるのではなく、Helix の編集モデルそのものを
VS Code の上に実装しています。

English: [README.md](README.md)

- **選択優先の編集。** すべてのカーソルは Helix と同じくアンカーとヘッドを
  持つ選択範囲です。`w`、`e`、`b`、`x`、`%`、`s`、`S`、`C`、`,`、`(`、`)`、
  `&`、`_`、`;`、`Alt-;` などは、マルチカーソルやプライマリ選択も含めて
  Helix と同じように動きます。
- **マイナーモード。** `g` goto、`m` match (`mm`、`ms`、`mr`、`md`、`mi`、
  `ma`)、`z`/`Z` view、`Ctrl-w` window、`Space` space、`[`/`]` unimpaired。
- **ジャンプラベル。** `gw` で画面上のすべての単語に 2 文字のラベルを表示
  します。
- **tree-sitter (WASM)。** `mi f` / `ma f` / `mi c` / `]f` / `[t` / `Alt-o` /
  `Alt-i` / `Alt-n` / `Alt-p` / `mm` は `web-tree-sitter` による本物の構文木を
  使い、クエリも Helix の `textobjects.scm` をそのまま使います。文法は 27 個
  同梱 (TypeScript、Python、Rust、Go、HTML、JSON、YAML、TOML、Markdown ...)、
  `:tree-sitter-install kotlin` で追加もできます。
- **`:` コマンド。** `:w`、`:q`、`:wq`、`:x`、`:e`、`:bc`、`:sort`、`:reflow`、
  `:pipe`、`:sh`、`:set`、`:theme`、`:goto` ほか 90 以上。補完と履歴つきです。
- **回数、レジスタ、マクロ。** `3w`、`"ay`、`"+p`、`Q`/`q`、`.` (直前の挿入を
  繰り返す)、`Alt-.` (直前の移動を繰り返す)、ジャンプリスト
  (`Ctrl-o`/`Ctrl-i`/`Ctrl-s`)。`"` でレジスタ一覧、`:registers` で中身の一覧、
  プロンプト内では `Ctrl-r` でレジスタを挿入できます。
- **Helix の取り消し履歴。** VS Code のように単語単位ではなく、コマンド 1 回と
  挿入セッション 1 回がそれぞれ 1 ステップです。`Alt-u`、`:earlier 10s`、
  `:later 1m30s` のような時間指定の巻き戻しもできます。
- **git の変更。** `]g`/`[g`/`]G`/`[G` と `mig`/`mag` は、VS Code 組み込みの
  Git 拡張機能を通して `HEAD` との実際の差分 (hunk) を対象にします。
- **キー候補のポップアップ。** マイナーモードやキー入力待ちの間に次に押せる
  キーを一覧表示します (Helix の `auto-info` 相当、`helicode.autoInfo`)。
- **ウィンドウ全体で同じキーマップ。** `Ctrl-w` のウィンドウモードはターミナル、
  リスト、ビュー、Webview でも使えます。VS Code のリストでも `j`/`k`/`gg`/`G`
  で移動できます (`helicode.windowKeysEverywhere`、`helicode.listNavigation`)。
- **既存の Helix 設定。** `:config-import` で `~/.config/helix/config.toml`
  (またはワークスペースの `.helix/config.toml`) を読み込み、`[keys.*]` と
  対応している `[editor]` の設定を取り込みます。
- **ノートブック。** セルのエディタでは Helix の編集モデルがそのまま使え、
  セル一覧も Helix 風に操作できます (`j`/`k`/`gg`/`G`/`o`/`O`/`dd`/`yy`/`p`/`u`)。
- **Web とリモート。** デスクトップ版のほか、SSH / Dev Container / WSL、
  Web 版 (vscode.dev、github.dev) でも動きます。実プロセスが必要なシェル
  コマンドだけは Web 版で使えません。
- **Corral との連携。** `Ctrl-w` のウィンドウモードは
  [Corral](https://github.com/s-tatsuya/corral) の `ctrl+b` プレフィックス表と
  同じ割り当てになっているので、エディタ、ターミナルのペイン、エージェントを
  1 つのキーマップで操作できます。`c` 新しいターミナル、`S`/`V` シェルで分割、
  `z`/`x`/`=`/`1`-`8`/`;` ペイン操作、`a`/`A`/`i`/`e` エージェント、
  `m`/`D`/`d` レビュー、`P`/`g` ポップアップ、`r`/`R` レイアウト、
  `W` ワークツリー。`Space t` から同じ操作をメニューで選べます。
  `:corral <cmd>` は Corral の CLI を実行し、`:popup <cmd>` はポップアップの
  出力を挿入します。Corral がない場合、ペイン操作は VS Code 組み込みの
  コマンドにフォールバックし、エージェント関連はメッセージを表示します。
- **Helix のキーから任意の VS Code コマンド。**
  `:vscode-command` / `:vsc <id> [json args]` で任意のコマンドを実行でき、
  `helicode.keys` で好きなキーに割り当てられます。

キーの対応表は [docs/keymap.md](docs/keymap.md)、`:` コマンドの一覧は
[docs/commands.md](docs/commands.md) にあります。

## インストール

Marketplace (または Open VSX) で **Helicode** を検索するか、次を実行します。

```sh
code --install-extension s-tatsuya.helicode
```

### 自分でビルドする

開発環境は Nix で完結しています。グローバルには何もインストールしません。

```sh
git clone <このリポジトリ> helicode && cd helicode
nix develop                 # または付属の .envrc で direnv allow
npm ci
npm run package             # 型チェック + テスト + 本番ビルド + helicode-*.vsix
code --install-extension helicode-0.1.0.vsix
```

初回のビルドでは `grammars.json` に載っている tree-sitter の文法を
ダウンロードします (`npm run fetch-grammars -- --all` で任意の文法も取得)。
一度取得すればオフラインでもビルドできます。

Nix を使わない場合は Node.js 22 だけあれば動きます。Windows での手順は
[README.md](README.md#windows-no-nix) を参照してください。

## チュートリアル

`:tutor` で開きます。VS Code の表示言語が日本語なら日本語版
([docs/tutor.ja.txt](docs/tutor.ja.txt)) が開きます。明示的に指定するなら
`:tutor ja` です。

## 設定

| 設定 | 既定値 | 説明 |
| --- | --- | --- |
| `helicode.enabled` | `true` | 全体の有効 / 無効 (`Helicode: Toggle`、`:helicode-toggle`) |
| `helicode.search.smartCase` | `true` | Helix の `search.smart-case` |
| `helicode.search.wrapAround` | `true` | Helix の `search.wrap-around` |
| `helicode.scrolloff` | `5` | カーソルの上下に残す行数 |
| `helicode.jumpLabelAlphabet` | `abcdefghijklmnopqrstuvwxyz` | `gw` のラベルに使う文字 |
| `helicode.defaultYankRegister` | `"` | `+` にするとシステムのクリップボードを使う |
| `helicode.textWidth` | `80` | `:reflow` の幅 |
| `helicode.shell` | `[]` (`$SHELL -c`、Windows は PowerShell) | `\|`、`!`、`$`、`:sh` が使うシェル |
| `helicode.shell.output` | `beside` | `:sh` の出力を開く場所 (`beside`、`here`、`below`) |
| `helicode.openLineUsesEditorIndent` | `true` | `o`/`O` のあと言語の規則で字下げし直す |
| `helicode.notebook.escapeQuitsCellEdit` | `true` | ノーマルモードの Escape でセルの編集を抜ける |
| `helicode.treeSitter.enabled` | `true` | tree-sitter の機能を有効にする |
| `helicode.treeSitter.maxFileSizeKB` | `2048` | これより大きいファイルは解析しない |
| `helicode.treeSitter.extraGrammars` | `{}` | 自前の文法 `.wasm` を追加する |
| `helicode.keys` | `{}` | Helix の `config.toml` 形式でキーマップを上書き |
| `helicode.undo` | `helix` | `helix` (コマンド / 挿入セッション単位、時間指定あり) または `vscode` |
| `helicode.autoInfo` | `true` | キー候補のポップアップ |
| `helicode.autoInfoDelay` | `400` | ポップアップが出るまでの時間 (ミリ秒) |
| `helicode.passthroughKeys` | `[]` | Helicode が横取りしないキー。例 `["ctrl+f"]` |
| `helicode.windowKeysEverywhere` | `all` | エディタ外でも `Ctrl-w` を使う: `all` (ターミナル含む) / `editors-and-views` / `off` |
| `helicode.listNavigation` | `true` | VS Code のリストで `j`/`k`/`gg`/`G` |
| `helicode.importHelixConfig` | `ask` | 既存の Helix 設定を取り込むか |

キーマップの上書きは Helix と同じ記法とコマンド名を使います。

```jsonc
"helicode.keys": {
  "normal": {
    "C-s": ":w",                       // : コマンド
    "g": { "a": "code_action" },       // 入れ子のマイナーモード
    "X": ["extend_line_up", "extend_to_line_bounds"]
  },
  "insert": { "j": { "k": "normal_mode" } }
}
```

## 既存の Helix 設定を使う

`:config-import` (またはコマンドパレットの `Helicode: Import Helix config.toml`)
を実行すると、`.helix/config.toml`、`$XDG_CONFIG_HOME/helix`、
`~/.config/helix` の順に最初に見つかった設定を読み込みます。

- `[keys.normal]`、`[keys.select]`、`[keys.insert]` は `helicode.keys` に
  取り込まれます。すでに `helicode.keys` にある項目が優先されます。
- `[editor]` のうち VS Code に対応する設定 (`scrolloff`、`text-width`、
  `line-number`、`cursorline`、`auto-pairs`、`auto-format`、`rulers`、`shell`、
  `default-yank-register`、`auto-info` など) は対応する設定に書き込まれます。

初回起動時に一度だけ取り込むかどうかを確認します。この挙動は
`helicode.importHelixConfig` (`ask`、`always`、`never`) で変えられます。

## うまく動かないとき

### キーを長押ししても繰り返されない (macOS)

`x`、`j`、`k`、`d` のような印字できるキーは VS Code の `type` コマンド経由で
Helicode に届きます。macOS の「押し続けてアクセント文字を選ぶ」機能
(`ApplePressAndHoldEnabled`、既定で有効) は Electron アプリでこの経路のキー
リピートを止めてしまうため、`x` を長押ししても 1 行しか消えず、`j` や `k` も
1 回しか動きません。次を一度だけ実行し、ウィンドウの再読み込みではなく VS Code
を完全に終了してから起動し直してください。

```sh
defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
# Insiders は com.microsoft.VSCodeInsiders
```

元に戻す (アクセント文字のポップアップを復活させる) には
`defaults delete com.microsoft.VSCode ApplePressAndHoldEnabled` を実行します。
リピートの速さは「システム設定 > キーボード」の「キーのリピート速度 /
リピート入力認識までの時間」で決まります。なお回数指定 (`10j`、`5x`、`3dd`)
はキーリピートに関係なく使えます。

## ドキュメント

- [docs/keymap.md](docs/keymap.md) - Helix のすべてのキーと対応状況
- [docs/commands.md](docs/commands.md) - すべての `:` コマンドと対応状況
- [docs/architecture.md](docs/architecture.md) - 選択モデル、キーの処理、
  挿入モード、取り消し履歴、tree-sitter の仕組み
- [docs/notebooks-and-webviews.md](docs/notebooks-and-webviews.md) -
  ノートブック、Markdown プレビュー、Webview の制約
- [docs/tree-sitter.md](docs/tree-sitter.md) - 同梱の文法と追加方法
- [docs/development.md](docs/development.md) - Nix での開発、テスト、公開

## 謝辞

- **[Helix](https://github.com/helix-editor/helix)** (Blaž Hrastnik 氏と
  コントリビューターの皆さん)。選択優先の編集モデル、キーマップ、コマンド名、
  テキストオブジェクトのクエリ、チュートリアルはすべて Helix のものであり、
  その実装が本拡張の仕様そのものです。Helicode は非公式の独立したプロジェクト
  であり、Helix プロジェクトとは提携していません。
- **[tree-sitter](https://github.com/tree-sitter/tree-sitter)** (Max Brunsfeld
  氏)、[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) に列挙した各文法の
  作者の皆さん、および VS Code 本体が使う WASM をビルドしている
  **[@vscode/tree-sitter-wasm](https://github.com/microsoft/vscode-tree-sitter-wasm)**。
- **[smol-toml](https://github.com/squirrelchat/smol-toml)** (`:config-import`
  で `config.toml` を読むために使用)。
- **[Corral](https://github.com/s-tatsuya/corral)** (`Ctrl-w` のペイン操作は
  Corral のプレフィックス表に合わせています)。
- 先行するモーダル編集拡張 **VSCodeVim**、**Dance**、
  **vscode-helix-emulation**。VS Code 上で何ができるかを学ばせてもらいました
  (コードの流用はしていません)。

## ライセンス

Helicode 本体は **MIT** ([LICENSE](LICENSE)) です。同梱している第三者の成果物
はそれぞれのライセンスに従います。

- **MPL-2.0** (Helix 由来): `queries/` の tree-sitter クエリ、
  `docs/tutor*.txt` のチュートリアル、`SPDX-License-Identifier: MPL-2.0`
  ヘッダーを持つソースファイル (Helix から移植した部分)。これらは MPL のまま
  であり、拡張全体を MIT で配布できるのは MPL-2.0 § 3.3 (Larger Work) に
  よります。全文は [licenses/MPL-2.0.txt](licenses/MPL-2.0.txt)。ソースコード
  形式は本リポジトリと <https://github.com/helix-editor/helix> で入手できます。
- **MIT / Apache-2.0 / BSD-3-Clause**: tree-sitter ランタイム、`wasm/` に同梱
  した文法バイナリ、`smol-toml`。

各コンポーネントの入手元と著作権表示は
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) にまとめてあり、
[licenses/](licenses) とともに `.vsix` にも同梱しています。文法バイナリの URL、
SHA-256、ライセンスは `grammars.json` に記録しています。
