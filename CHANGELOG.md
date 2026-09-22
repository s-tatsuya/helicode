# Changelog

## Unreleased

### Changed

- **Third-party licensing is now documented and shipped.** `THIRD-PARTY-NOTICES.md`
  lists every component the extension carries - Helix (MPL-2.0), the
  tree-sitter runtime, the bundled grammar binaries (MIT / Apache-2.0) and
  smol-toml (BSD-3-Clause) - with its origin and copyright notice, and it is
  packaged in the `.vsix` together with `licenses/` (MPL-2.0 and Apache-2.0
  full texts, the `tree-sitter-elixir` NOTICE) and `grammars.json`. The files
  ported from Helix carry an `SPDX-License-Identifier: MPL-2.0` header,
  `docs/LICENSE-tutor.md` covers the tutorials copied from `runtime/tutor`,
  and both READMEs gained an Acknowledgements section. Helicode's own code is
  unchanged and stays MIT.

### Fixed

- **`v` + `j`/`k` no longer drops the selection.** With soft wrap on, visual
  line movement asks VS Code's `cursorMove` to honour the wrapped rows; the
  selection change that causes was reported back while the command was still
  running and was mistaken for a selection the user made, which replaced the
  range being extended with a bare cursor. Selections Helicode writes itself
  (and cursors VS Code moves on its behalf) are now recognised as its own.
- **`j`/`k` keep their column with soft wrap on.** Every cursor write resets
  the column VS Code remembers for vertical movement, so moving across a short
  line pulled the cursor to that line's column and kept it there. Helicode now
  tracks the column inside the wrapped row itself, like Helix does.
- Holding a key does not repeat on macOS unless the system's press-and-hold
  feature is off; both READMEs now say so (`defaults write
  com.microsoft.VSCode ApplePressAndHoldEnabled -bool false`).

## 0.2.0 (2026-09-19)

Closes the remaining gaps against Helix and makes one keymap drive the whole
VS Code window.

### Added

- **Helix undo history.** `u`/`U` now step one revision per command and per
  insert session instead of following VS Code's word-based undo stack, and the
  selection a command ran on is restored. `Alt-u`/`Alt-U` take counts, and
  `:earlier`/`:later` take time spans (`:earlier 10s`, `:later 1m30s`).
  `helicode.undo: vscode` keeps the previous behaviour.
- **Git hunks.** `]g`, `[g`, `]G`, `[G` and the `mig`/`mag` textobject work on
  the real diff against `HEAD` through VS Code's built-in Git extension, with
  a fallback to dirty-diff navigation outside git.
- **Which-key infobox.** Minor modes (`g`, `m`, `Space`, `Ctrl-w`, `[`, `]`,
  `z`) and key prompts (`mi`, `ms`, `mr`, `md`, `"`) list the keys you can
  press next (`helicode.autoInfo`, `helicode.autoInfoDelay`).
- **11 more bundled tree-sitter grammars**: HTML, XML, JSON, YAML, TOML, Lua,
  Markdown, Zig, Elixir, Make, HCL/Terraform, plus a standalone C grammar.
  `:tree-sitter-install` downloads Kotlin, Swift, Scala, OCaml and Haskell on
  demand (checksums pinned in `grammars.json`), `:tree-sitter-uninstall`
  removes them and `:tree-sitter-grammars` lists everything. New textobject
  queries for Markdown, XML, Make and HCL.
- **`Ctrl-r <register>` in every prompt** (`:`, `/`, `?`, `s`, shell commands).
- **Register list and picker.** `"` shows the registers with a preview,
  `:registers` prints their contents and `:select-register` picks one.
- **Helix `config.toml` import.** `:config-import` (and the
  `Helicode: Import Helix config.toml` command) reads `[keys.*]` and the
  supported `[editor]` options; Helicode offers this once on the first start
  (`helicode.importHelixConfig`).
- **One keymap for the whole window.** `Ctrl-w` window mode is registered as a
  VS Code chord, so it also works in terminals, lists, views and webviews
  (`helicode.windowKeysEverywhere`: `all`, `editors-and-views` or `off`), and
  VS Code lists and trees get `j`/`k`,
  `gg`/`G`, `Ctrl-d`/`Ctrl-u`, `h`/`l`, `/` and explorer file operations
  (`helicode.listNavigation`).
- **`helicode.passthroughKeys`** hands any key back to VS Code without editing
  `keybindings.json`.
- **Web extension host support.** A second bundle (`dist/extension-web.js`)
  runs on vscode.dev and github.dev; everything except shell commands works.
- **Japanese localization.** Settings and commands are localized
  (`package.nls.ja.json`), with a Japanese README and `:tutor ja`.
  `:tutor` otherwise follows the VS Code display language.
- **Marketplace metadata**: icon, gallery banner, categories and a publish
  workflow (`.github/workflows/publish.yml`, VS Code Marketplace and Open VSX).

### Changed

- Window mode carries the same letters as
  [Corral](https://github.com/s-tatsuya/corral)'s `ctrl+b` prefix table
  (`z`, `x`, `=`, `1`-`8`, `;`, `,`, `r`, `R`, `g`, `E`, `?` added), and pane
  keys fall back to the built-in VS Code commands when Corral is absent.
  `Space t` opens the same Corral set as a menu, including a worktree submenu.
- Tree-sitter grammars and queries are read through `vscode.workspace.fs`, so
  they work over remote connections and in the web host.
- `zm` (`align_view_middle`) reveals the cursor instead of reporting that it is
  unsupported.

### Fixed

- Notebook cell navigation uses the notebook commands rather than generic list
  commands, so `j`/`k` follow the cell order.

## 0.1.0 (2026-09-17)

Initial release.

- Helix selection model (anchor/head ranges, multiple selections, primary selection) on top of VS Code.
- Normal, insert and select modes; goto, match, view, window, space and unimpaired minor modes.
- Counts, registers (`"`, `_`, `+`, `*`, `/`, `:`, `@`, `.`, `%`, `#`, `a-z`), macros, `.` repeat, `Alt-.` repeat motion, jumplist.
- Surround (`ms`/`mr`/`md`), textobjects (`mi`/`ma`), jump labels (`gw`).
- Tree-sitter (WASM) textobjects, object navigation, node selection and bracket matching with Helix's queries.
- `:` command line with completion, history and 80+ Helix typed commands.
- Notebook cell-list bindings, Markdown preview helpers.
- Nix based development environment, unit and integration tests.
