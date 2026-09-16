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
| `helicode.shell` | `[]` (`$SHELL -c`) | Shell used by `\|`, `!`, `$`, `:sh` |
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
