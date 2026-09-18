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
  with the same `textobjects.scm` queries as Helix.
- **`:` commands.** `:w`, `:q`, `:wq`, `:x`, `:e`, `:bc`, `:sort`, `:reflow`,
  `:pipe`, `:sh`, `:set`, `:theme`, `:goto` and 80+ more, with completion and
  history in a VSCodeVim-like prompt.
- **Counts, registers, macros.** `3w`, `"ay`, `"+p`, `Q`/`q`, `.` (repeat last
  insert), `Alt-.` (repeat last motion), jumplist (`Ctrl-o`/`Ctrl-i`/`Ctrl-s`).
- **Notebooks.** Cell editors use the full Helix model; the cell list gets
  Helix-style navigation (`j`/`k`/`gg`/`G`/`o`/`O`/`dd`/`yy`/`p`/`u`).
- **Corral integration.** With the [Corral](https://github.com/s-tatsuya/corral)
  extension installed, `Ctrl-w` window mode gains `c` (terminal), `S`/`V`
  (split with a shell), `a`/`A`/`i`/`e` (agents), `m`/`D` (review comments),
  `d`/`]`/`[` (agent changes), `P` (popup), `;` (last pane), `W` (worktree);
  `:corral <cmd>` runs the Corral CLI and `:popup <cmd>` inserts a popup's
  output. Without Corral these keys only show a status message.
- **Any VS Code command from Helix keys.** `:vscode-command` / `:vsc <id> [json args]`
  runs a VS Code command and can be bound in `helicode.keys`, e.g. to reach
  [Corral](https://github.com/s-tatsuya/corral) pane commands from `Ctrl-w`:
  `"C-w": { "c": ":vsc corral.newTerminal" }`.

See [docs/keymap.md](docs/keymap.md) for the complete coverage matrix and
[docs/commands.md](docs/commands.md) for `:` commands.

## Install (local build)

The development environment is fully managed with Nix; nothing is installed
globally.

```sh
git clone <this repo> helicode && cd helicode
nix develop                 # or `direnv allow` with the provided .envrc
npm ci
npm run package             # typecheck + tests + production build + helicode-*.vsix
code --install-extension helicode-0.1.0.vsix
```

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

## Documentation

- [docs/keymap.md](docs/keymap.md) - every Helix key and whether it is supported
- [docs/commands.md](docs/commands.md) - every Helix `:` command and its status
- [docs/architecture.md](docs/architecture.md) - how the selection model, key
  dispatch, insert mode and tree-sitter integration work
- [docs/notebooks-and-webviews.md](docs/notebooks-and-webviews.md) - notebooks,
  the Markdown preview and the limits of WYSIWYG webview editors
- [docs/tree-sitter.md](docs/tree-sitter.md) - bundled grammars and how to add more
- [docs/development.md](docs/development.md) - Nix workflow, tests, packaging

## License

MIT. Tree-sitter queries under `queries/` are from the Helix editor (MPL-2.0),
grammar WASM binaries come from `@vscode/tree-sitter-wasm` (MIT, individual
grammar licenses in `node_modules/@vscode/tree-sitter-wasm/cgmanifest.json`).
