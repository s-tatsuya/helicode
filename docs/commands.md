# `:` command coverage

Typed commands from `helix-term/src/commands/typed.rs` (Helix master, 2026-09)
and their status in Helicode. Press `:` in normal mode to open the prompt;
type a command (aliases work), or pick one with the arrow keys. `:<number>`
goes to that line. History is kept in the `:` register.

Legend: ✅ Helix semantics, 🟡 delegated to a VS Code feature (close but not identical), ❌ unavailable.

| Command | Aliases | Status | Notes |
| --- | --- | --- | --- |
| `:quit` | `:q` | ✅ | closes the current editor (prompts when dirty) |
| `:quit!` | `:q!` | ✅ | reverts and closes |
| `:open` | `:o`, `:edit`, `:e` | ✅ | relative to workspace/file; missing files open as untitled; `:e` with no arg opens Quick Open; file completion |
| `:buffer-close` | `:bc`, `:bclose` | ✅ | |
| `:buffer-close!` | `:bc!` | ✅ | |
| `:buffer-close-others` / `!` | `:bco` | 🟡 | closes other editors in the group |
| `:buffer-close-all` / `!` | `:bca` | ✅ | |
| `:buffer-next` / `:buffer-previous` | `:bn` / `:bp` | ✅ | |
| `:write` | `:w` | ✅ | optional path (`:w other.txt` writes a copy and opens it) |
| `:write!` | `:w!` | ✅ | creates directories |
| `:write-buffer-close` / `!` | `:wbc` | ✅ | |
| `:new` | `:n` | ✅ | |
| `:format` | `:fmt` | 🟡 | `editor.action.formatDocument` |
| `:indent-style` | | ✅ | `t` or 1-16 |
| `:line-ending` | | ✅ | `lf` / `crlf` |
| `:earlier` / `:later` | `:ear` / `:lat` | ✅ | step counts and time spans (`:earlier 10s`, `:later 1m30s`) with `helicode.undo: helix` |
| `:write-quit` | `:wq`, `:x`, `:xit`, `:exit` | ✅ | |
| `:write-quit!` | `:wq!`, `:x!` | ✅ | |
| `:write-all` / `!` | `:wa` | ✅ | |
| `:write-quit-all` / `!` | `:wqa`, `:xa` | ✅ | |
| `:quit-all` / `!` | `:qa` | ✅ | closes all editors (VS Code window stays open) |
| `:cquit` / `!` | `:cq` | 🟡 | closes the window; no exit code |
| `:theme` | | ✅ | sets `workbench.colorTheme`; theme completion |
| `:yank-join` | | ✅ | |
| `:clipboard-yank` / `:clipboard-yank-join` | | ✅ | |
| `:primary-clipboard-*` | | 🟡 | mapped to the system clipboard |
| `:clipboard-paste-after` / `-before` / `-replace` | | ✅ | |
| `:show-clipboard-provider` | | ✅ | |
| `:change-current-directory` | `:cd` | 🟡 | opens the folder as workspace |
| `:show-directory` | `:pwd` | ✅ | |
| `:push-directory` / `:pop-directory` / `:show-directory-stack` | | ❌ | single workspace directory |
| `:encoding` | | 🟡 | opens the encoding picker |
| `:character-info` | `:char` | ✅ | |
| `:reload` / `:reload-all` | `:rl` / `:rla` | 🟡 | `workbench.action.files.revert` |
| `:update` | `:u` | ✅ | |
| `:lsp-workspace-command` | | 🟡 | command palette |
| `:lsp-restart` | | 🟡 | best-effort per language (TS, rust-analyzer, Python, Go, ...) |
| `:lsp-stop` | | ❌ | VS Code manages servers |
| `:tree-sitter-scopes` | | ✅ | node type chain at the cursor (bundled grammars) |
| `:registers` | `:reg` | ✅ | contents of every register, in a scratch buffer |
| `:tree-sitter-highlight-name` | | 🟡 | `Developer: Inspect Editor Tokens and Scopes` |
| `:tree-sitter-layers` | | 🟡 | reports the grammar in use (no injections) |
| `:tree-sitter-subtree` | `:ts-subtree` | ✅ | opens the S-expression beside |
| `:debug-start` / `:debug-remote` / `:debug-eval` | `:dbg` | 🟡 | VS Code debug commands |
| `:vsplit` / `:hsplit` | `:vs` / `:hs`, `:sp` | ✅ | optional files |
| `:vsplit-new` / `:hsplit-new` | `:vnew` / `:hnew` | ✅ | |
| `:tutor` | | ✅ | opens the tutor; `:tutor ja` picks a language, otherwise the VS Code display language |
| `:goto` | `:g` | ✅ | also `:<n>` |
| `:set-language` | `:lang` | ✅ | language completion |
| `:set-option` / `:toggle-option` / `:get-option` | `:set` / `:toggle` / `:get` | 🟡 | Helix option names are mapped to VS Code / Helicode settings (see below); unknown `a.b` names are treated as VS Code settings |
| `:sort` | | ✅ | `--reverse`/`-r`, `--insensitive`/`-i`, `:sort!`; also `:rsort` |
| `:reflow` | | ✅ | width argument or `helicode.textWidth`, keeps comment prefixes |
| `:config-reload` | | ✅ | re-applies `helicode.keys` |
| `:config-import` | `:import-helix-config` | ✅ | reads a Helix `config.toml` and applies `[keys.*]` and the supported `[editor]` options; `!` writes to the workspace settings |
| `:config-open` / `:config-open-workspace` | | 🟡 | settings.json files |
| `:log-open` | | ✅ | Helicode output channel |
| `:insert-output` / `:append-output` | | ✅ | |
| `:pipe` / `:pipe-to` | `:\|` | ✅ | |
| `:run-shell-command` | `:sh`, `:!` | ✅ | output opens in a scratch editor |
| `:reset-diff-change` | `:diffget`, `:diffg` | 🟡 | `git.revertSelectedRanges` |
| `:select-register` | | ✅ | pick the register for the next yank/paste from a list |
| `:clear-register` / `:set-register` | | ✅ | |
| `:redraw` | | ✅ | |
| `:move` / `:move!` | `:mv` | ✅ | renames the file (workspace edit) |
| `:yank-diagnostic` | | ✅ | |
| `:read` | `:r` | ✅ | |
| `:echo` / `:noop` | | ✅ | |
| `:workspace-trust` / `-untrust` / `-exclude` | | 🟡 | opens the trust editor |

### Tree-sitter grammars

| Command | Aliases | Notes |
| --- | --- | --- |
| `:tree-sitter-grammars` | | lists bundled, installed and installable grammars |
| `:tree-sitter-install` | `:ts-install` | downloads an optional grammar (checksum verified) into the extension's storage; with no argument, the grammar for the current language |
| `:tree-sitter-uninstall` | `:ts-uninstall` | removes a grammar installed that way |

Helicode-specific additions: `:vscode-command` / `:vsc <command.id> [json args]` (run any VS Code command, e.g. `:vsc corral.splitRight`; bindable through `helicode.keys`), `:corral <command> [args]` (Corral CLI from the editor: `:corral panes`, `:corral review`, `:corral send claude "run tests"`), `:popup` / `:pop <command>` (run the command in a [Corral](https://github.com/s-tatsuya/corral) popup terminal, interactive and floating, then replace the selection / insert at the cursor with its output; `:popup!` only runs it), `:helicode-toggle`, `:keymap` (opens the keymap
reference), `:markdown-preview` (`:preview`), `:registers`, `:config-import`,
`:tree-sitter-install`. `:tutor` takes a language (`:tutor ja`) and otherwise
follows the VS Code display language.

## Option mapping for `:set` / `:toggle` / `:get`

| Helix option | Setting |
| --- | --- |
| `search.smart-case` | `helicode.search.smartCase` |
| `search.wrap-around` | `helicode.search.wrapAround` |
| `scrolloff` | `helicode.scrolloff` |
| `jump-label-alphabet` | `helicode.jumpLabelAlphabet` |
| `text-width` | `helicode.textWidth` |
| `line-number` (`absolute`/`relative`) | `editor.lineNumbers` |
| `cursorline` | `editor.renderLineHighlight` |
| `soft-wrap.enable` | `editor.wordWrap` |
| `auto-format` | `editor.formatOnSave` |
| `auto-pairs` | `editor.autoClosingBrackets` |
| `rulers` | `editor.rulers` |
| `indent-guides.render` | `editor.guides.indentation` |
| `whitespace.render` | `editor.renderWhitespace` |
| `auto-save` | `files.autoSave` |
| `bufferline` | `workbench.editor.showTabs` |
| `insert-final-newline` / `trim-trailing-whitespace` / `trim-final-newlines` | `files.*` |
| `lsp.display-inlay-hints` | `editor.inlayHints.enabled` |
| `auto-info` | `helicode.autoInfo` |
| `undo` (`helix`/`vscode`) | `helicode.undo` |

Example: `:toggle line-number relative absolute`, `:set soft-wrap.enable true`.

## Prompts

Every prompt (`:`, `/`, `?`, `s`, `S`, `K`, shell commands) is a VS Code
QuickPick with history and completion. `Ctrl-r` followed by a register name
inserts that register's content, like Helix.
