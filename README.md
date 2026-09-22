# Helicode

Helix keybindings for Visual Studio Code. Helicode re-implements the Helix
editing model on top of the VS Code editor instead of translating Helix keys
into VS Code commands:

- **Selection-first editing.** Every cursor is a selection with an anchor and a
  head, exactly like Helix. `w`, `e`, `b`, `x`, `%`, `s`, `S`, `C`, `,`, `(`, `)`
  `&`, `_`, `;`, `Alt-;` and friends behave like they do in Helix, including
  multiple selections and the primary selection.
- **Minor modes.** `g` goto, `m` match (`mm`, `ms`, `mr`, `md`, `mi`, `ma`),
  `z`/`Z` view, `Ctrl-w` window, `Space` space mode, `[`/`]` unimpaired.
- **Jump labels.** `gw` shows two-letter labels on every visible word.
- **Tree-sitter (WASM).** `mi f` / `ma f` / `mi c` / `]f` / `[t` / `Alt-o` /
  `Alt-i` / `Alt-n` / `Alt-p` / `mm` use real syntax trees via `web-tree-sitter`,
  with the same `textobjects.scm` queries as Helix. 27 grammars are bundled
  (TypeScript, Python, Rust, Go, HTML, JSON, YAML, TOML, Markdown, ...) and
  `:tree-sitter-install kotlin` fetches more on demand.
- **`:` commands.** `:w`, `:q`, `:wq`, `:x`, `:e`, `:bc`, `:sort`, `:reflow`,
  `:pipe`, `:sh`, `:set`, `:theme`, `:goto` and 80+ more, with completion and
  history in a VSCodeVim-like prompt.
- **Counts, registers, macros.** `3w`, `"ay`, `"+p`, `Q`/`q`, `.` (repeat last
  insert), `Alt-.` (repeat last motion), jumplist (`Ctrl-o`/`Ctrl-i`/`Ctrl-s`).
  `"` lists the registers, `:registers` shows their contents, and `Ctrl-r`
  inserts one inside any prompt.
- **Helix undo history.** One revision per command and per insert session, not
  per typed word, plus time travel: `Alt-u`, `:earlier 10s`, `:later 1m30s`.
- **Git hunks.** `]g`/`[g`/`]G`/`[G` and the `mig`/`mag` textobject work on the
  real diff against `HEAD` through VS Code's built-in Git extension.
- **Which-key popup.** Minor modes and key prompts list what you can press
  next, like Helix's `auto-info` (`helicode.autoInfo`).
- **One keymap for the whole window.** `Ctrl-w` window mode also works in
  terminals, lists, views and webviews, and VS Code lists get `j`/`k`/`gg`/`G`
  navigation (`helicode.windowKeysEverywhere`, `helicode.listNavigation`).
- **Your Helix config.** `:config-import` reads `~/.config/helix/config.toml`
  (or `.helix/config.toml` in the workspace) and applies its `[keys.*]` tables
  and the `[editor]` options that have a VS Code equivalent.
- **Notebooks.** Cell editors use the full Helix model; the cell list gets
  Helix-style navigation (`j`/`k`/`gg`/`G`/`o`/`O`/`dd`/`yy`/`p`/`u`).
- **Web and remote.** Runs in the desktop app, over SSH / Dev Containers / WSL,
  and in the web extension host (vscode.dev, github.dev) - everything except
  the shell commands, which need a real process.
- **Corral integration.** `Ctrl-w` window mode carries the same letters as
  [Corral](https://github.com/s-tatsuya/corral)'s `ctrl+b` prefix table, so one
  keymap drives editors, terminal panes and agents: `c` terminal, `S`/`V` shell
  splits, `z`/`x`/`=`/`1`-`8`/`;` panes, `a`/`A`/`i`/`e` agents, `m`/`D`/`d`
  review, `P`/`g` popups, `r`/`R` layouts, `W` worktree. `Space t` opens the
  same set as a menu, `:corral <cmd>` runs the Corral CLI and `:popup <cmd>`
  inserts a popup's output. Without Corral the pane keys fall back to the
  built-in VS Code commands and the agent keys show a status message.
- **Any VS Code command from Helix keys.** `:vscode-command` / `:vsc <id> [json args]`
  runs a VS Code command and can be bound in `helicode.keys`, e.g. to reach
  [Corral](https://github.com/s-tatsuya/corral) pane commands from `Ctrl-w`:
  `"C-w": { "c": ":vsc corral.newTerminal" }`.

See [docs/keymap.md](docs/keymap.md) for the complete coverage matrix and
[docs/commands.md](docs/commands.md) for `:` commands.

## Install

From the Marketplace (or Open VSX): search for **Helicode**, or

```sh
code --install-extension s-tatsuya.helicode
```

### Local build

The development environment is fully managed with Nix; nothing is installed
globally.

```sh
git clone <this repo> helicode && cd helicode
nix develop                 # or `direnv allow` with the provided .envrc
npm ci
npm run package             # typecheck + tests + production build + helicode-*.vsix
code --install-extension helicode-0.1.0.vsix
```

The build downloads the tree-sitter grammars listed in `grammars.json` on its
first run (`npm run fetch-grammars -- --all` also fetches the optional ones);
afterwards it works offline.

For development, open the folder in VS Code and press F5 (Run Extension). The
`npm run watch` task rebuilds `dist/extension.js` on change.

### Windows (no Nix)

Only Node.js 22 is needed; the build scripts are plain Node and run in
PowerShell or cmd.

```powershell
winget install OpenJS.NodeJS.LTS        # or nvm-windows / fnm; Node 22 or newer
git clone <this repo> helicode; cd helicode
npm ci
npm run package                          # typecheck + tests + build + helicode-0.1.0.vsix
code --install-extension .\helicode-0.1.0.vsix
```

If PowerShell refuses to run `npm` (`npm.ps1 cannot be loaded`), run
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` once or call `npm.cmd`.
`npm run test:integration` also works on Windows (it downloads VS Code into
`.vscode-test\`). The `helicode.shell` commands (`|`, `!`, `:sh`) use
PowerShell on Windows unless you set `helicode.shell`. For a Dev Container /
WSL workflow, build inside the container instead and install the `.vsix`
there; see the Corral repository's `docs/devcontainer.md`.

Every push is also built on Windows, macOS and Linux by GitHub Actions
(`.github/workflows/ci.yml`), which uploads the `.vsix` as an artifact.

## Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `helicode.enabled` | `true` | Master switch (`Helicode: Toggle` command, `:helicode-toggle`) |
| `helicode.search.smartCase` | `true` | Helix `search.smart-case` |
| `helicode.search.wrapAround` | `true` | Helix `search.wrap-around` |
| `helicode.scrolloff` | `5` | Lines kept around the cursor when paging |
| `helicode.jumpLabelAlphabet` | `abcdefghijklmnopqrstuvwxyz` | Characters used for `gw` labels |
| `helicode.defaultYankRegister` | `"` | Set to `+` to yank/paste through the system clipboard |
| `helicode.textWidth` | `80` | Width for `:reflow` |
| `helicode.shell` | `[]` (`$SHELL -c`, PowerShell on Windows) | Shell used by `\|`, `!`, `$`, `:sh` |
| `helicode.shell.output` | `beside` | Where `:sh` output opens: `beside`, `here`, `below` |
| `helicode.openLineUsesEditorIndent` | `true` | `o`/`O` re-indent with language rules |
| `helicode.notebook.escapeQuitsCellEdit` | `true` | `Esc` in normal mode leaves a notebook cell |
| `helicode.treeSitter.enabled` | `true` | Enable WASM tree-sitter features |
| `helicode.treeSitter.maxFileSizeKB` | `2048` | Skip parsing larger files |
| `helicode.treeSitter.extraGrammars` | `{}` | Add your own grammar `.wasm` files |
| `helicode.keys` | `{}` | Keymap overrides in Helix `config.toml` style |
| `helicode.undo` | `helix` | `helix` (one step per command / insert session, time travel) or `vscode` |
| `helicode.autoInfo` | `true` | Which-key popup for minor modes and key prompts |
| `helicode.autoInfoDelay` | `400` | Delay before that popup appears (ms) |
| `helicode.passthroughKeys` | `[]` | Keys Helicode must not intercept, e.g. `["ctrl+f"]` |
| `helicode.windowKeysEverywhere` | `all` | `Ctrl-w` window mode outside editors: `all` (incl. terminals), `editors-and-views`, `off` |
| `helicode.listNavigation` | `true` | `j`/`k`/`gg`/`G` in VS Code lists and trees |
| `helicode.importHelixConfig` | `ask` | Import an existing Helix `config.toml` |

Keymap overrides use Helix's own notation and command names:

```jsonc
"helicode.keys": {
  "normal": {
    "C-s": ":w",                       // typed command
    "g": { "a": "code_action" },      // nested minor mode
    "X": ["extend_line_up", "extend_to_line_bounds"]
  },
  "insert": { "j": { "k": "normal_mode" } }
}
```

## Using your Helix configuration

`:config-import` (or the `Helicode: Import Helix config.toml` command) reads
the first config it finds in `.helix/config.toml`, `$XDG_CONFIG_HOME/helix` or
`~/.config/helix` and applies it:

- `[keys.normal]`, `[keys.select]` and `[keys.insert]` become `helicode.keys`
  entries, with your existing entries winning over the imported ones;
- the `[editor]` options that have a VS Code equivalent (`scrolloff`,
  `text-width`, `line-number`, `cursorline`, `auto-pairs`, `auto-format`,
  `rulers`, `shell`, `default-yank-register`, `auto-info`, ...) are written to
  the matching settings.

On the first start Helicode offers this once; `helicode.importHelixConfig`
controls that (`ask`, `always`, `never`).

## Troubleshooting

### Holding a key does not repeat (macOS)

Every printable Helix key (`x`, `j`, `k`, `d`, ...) reaches Helicode through
VS Code's `type` command, and macOS's "press and hold" feature (the accent
popup, `ApplePressAndHoldEnabled`, on by default) stops Electron apps from
delivering repeated key events on that path - so holding `x` deletes one line
and holding `j` moves one line. Run this once and then quit and restart VS
Code completely (not just reload the window):

```sh
defaults write com.microsoft.VSCode ApplePressAndHoldEnabled -bool false
# Insiders: com.microsoft.VSCodeInsiders
```

`defaults delete com.microsoft.VSCode ApplePressAndHoldEnabled` puts the
accent popup back. How fast keys repeat afterwards is System Settings >
Keyboard > Key Repeat / Delay Until Repeat. Counts never depend on key
repeat: `10j`, `5x`, `3dd`.

## Documentation

- [docs/keymap.md](docs/keymap.md) - every Helix key and whether it is supported
- [docs/commands.md](docs/commands.md) - every Helix `:` command and its status
- [docs/architecture.md](docs/architecture.md) - how the selection model, key
  dispatch, insert mode and tree-sitter integration work
- [docs/notebooks-and-webviews.md](docs/notebooks-and-webviews.md) - notebooks,
  the Markdown preview and the limits of WYSIWYG webview editors
- [docs/tree-sitter.md](docs/tree-sitter.md) - bundled grammars and how to add more
- [docs/development.md](docs/development.md) - Nix workflow, tests, packaging
- [README.ja.md](README.ja.md) - 日本語版の README (`:tutor ja` で日本語チュートリアル)

## Acknowledgements

- **[Helix](https://github.com/helix-editor/helix)** by Blaž Hrastnik and its
  contributors. Helicode exists because of it: the selection-first model, the
  keymap, the command names, the textobject queries and the tutorial all come
  from Helix, and its source is the specification this extension is written
  against. Helicode is an independent project and is not affiliated with or
  endorsed by the Helix project.
- **[tree-sitter](https://github.com/tree-sitter/tree-sitter)** by Max
  Brunsfeld, the grammar authors listed in
  [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), and
  **[@vscode/tree-sitter-wasm](https://github.com/microsoft/vscode-tree-sitter-wasm)**,
  which builds the WASM binaries VS Code itself uses.
- **[smol-toml](https://github.com/squirrelchat/smol-toml)**, which parses your
  `config.toml` for `:config-import`.
- **[Corral](https://github.com/s-tatsuya/corral)**, whose pane prefix table
  `Ctrl-w` mirrors so one keymap drives the whole window.
- The modal-editing extensions that came first - **VSCodeVim**, **Dance** and
  **vscode-helix-emulation** - for showing what works inside VS Code. No code
  was taken from them; only the problems they solved were studied.

## License

Helicode is **MIT** licensed (see [LICENSE](LICENSE)), with third-party
material under its own terms:

- **MPL-2.0** (Helix): the tree-sitter queries in `queries/`, the tutorials in
  `docs/tutor*.txt`, and every source file carrying an
  `SPDX-License-Identifier: MPL-2.0` header - the parts ported from the Helix
  source. Those files stay under the MPL; MPL-2.0 § 3.3 is what lets the
  extension as a whole ship under the MIT license. Full text:
  [licenses/MPL-2.0.txt](licenses/MPL-2.0.txt). Their Source Code Form is this
  repository and <https://github.com/helix-editor/helix>.
- **MIT / Apache-2.0 / BSD-3-Clause**: the tree-sitter runtime, the bundled
  grammar binaries in `wasm/`, and `smol-toml`.

Every component, its origin and its copyright notice is listed in
[THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md), which ships inside the
`.vsix` together with [licenses/](licenses). `grammars.json` records the URL,
SHA-256 and license of each grammar binary.
