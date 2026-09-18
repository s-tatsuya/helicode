# Keymap coverage

Every default Helix binding (from `helix-term/src/keymap/default.rs`, Helix
master as of 2026-09) and its status in Helicode.

Legend:

- ✅ implemented with Helix semantics (selection model, counts, registers)
- 🟡 implemented by delegating to a VS Code feature; behaviour is close but not identical
- ❌ not available (reason given)

`(TS)` needs a tree-sitter grammar for the file (see [tree-sitter.md](tree-sitter.md)),
`(LSP)` needs a language extension providing the feature.

## Normal mode

### Movement

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `h`, `Left` | `move_char_left` | ✅ | grapheme aware |
| `j`, `Down` | `move_visual_line_down` | ✅ | sticky column; with word wrap on, uses VS Code visual lines for a single cursor |
| `k`, `Up` | `move_visual_line_up` | ✅ | |
| `l`, `Right` | `move_char_right` | ✅ | |
| `w` / `b` / `e` | `move_next_word_start` / `move_prev_word_start` / `move_next_word_end` | ✅ | port of `movement.rs` incl. newline skipping and char classes |
| `W` / `B` / `E` | long word variants | ✅ | |
| `t` / `f` / `T` / `F` | `find_till_char` / `find_next_char` / `till_prev_char` / `find_prev_char` | ✅ | not confined to the line; `Enter` targets line endings; counts |
| `Alt-.` | `repeat_last_motion` | ✅ | repeats `f`/`t`/`m`/`[`/`]` motions |
| `Home` / `End` | `goto_line_start` / `goto_line_end` | ✅ | |
| `Ctrl-b`, `PageUp` / `Ctrl-f`, `PageDown` | `page_up` / `page_down` | ✅ | cursor kept in view with `scrolloff` |
| `Ctrl-u` / `Ctrl-d` | `page_cursor_half_up` / `page_cursor_half_down` | ✅ | |
| `Ctrl-i`, `Tab` / `Ctrl-o` | `jump_forward` / `jump_backward` | ✅ | jumplist shared across files |
| `Ctrl-s` | `save_selection` | ✅ | |
| `<n>G`, `<n>gg` | `goto_line` | ✅ | |

### Changes

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `r` | `replace` | ✅ | `Enter` inserts a newline, grapheme aware |
| `R` | `replace_with_yanked` | ✅ | |
| `~` / `` ` `` / ``Alt-` `` | `switch_case` / `switch_to_lowercase` / `switch_to_uppercase` | ✅ | |
| `i` / `a` / `I` / `A` | `insert_mode` / `append_mode` / `insert_at_line_start` / `insert_at_line_end` | ✅ | anchors survive the insert session; `a` restores the cursor on `Esc` like Helix |
| `o` / `O` | `open_below` / `open_above` | ✅ | copies indentation, then VS Code re-indents (`helicode.openLineUsesEditorIndent`) |
| `.` | repeat last insert | ✅ | replays the entering command and typed keys |
| `u` / `U` | `undo` / `redo` | 🟡 | VS Code undo stack; an insert session may become several undo steps (VS Code groups typing by word) |
| `Alt-u` / `Alt-U` | `earlier` / `later` | 🟡 | mapped to undo/redo (no time-based history) |
| `y` / `p` / `P` | `yank` / `paste_after` / `paste_before` | ✅ | linewise paste detection, counts, per-selection values |
| `"<reg>` | `select_register` | ✅ | registers `"`, `_`, `+`, `*`, `/`, `:`, `@`, `.`, `%`, `#`, `a-z` |
| `>` / `<` | `indent` / `unindent` | ✅ | |
| `=` | `format_selections` | 🟡 (LSP) | `editor.action.formatSelection` |
| `d` / `Alt-d` | `delete_selection` / `delete_selection_noyank` | ✅ | |
| `c` / `Alt-c` | `change_selection` / `change_selection_noyank` | ✅ | whole-line selections open a line above like Helix |
| `Ctrl-a` / `Ctrl-x` | `increment` / `decrement` | ✅ | decimal/hex/octal/binary, dates, times; `"#` increments by selection index |
| `Q` / `q` | `record_macro` / `replay_macro` | ✅ | recorded to `@` (or the selected register) |
| `Ctrl-z` | `suspend` | ❌ | not applicable in VS Code |

#### Shell

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `\|` | `shell_pipe` | ✅ | `$SHELL -c` or `helicode.shell`, cwd = workspace folder |
| `Alt-\|` | `shell_pipe_to` | ✅ | |
| `!` | `shell_insert_output` | ✅ | |
| `Alt-!` | `shell_append_output` | ✅ | |
| `$` | `shell_keep_pipe` | ✅ | |

### Selection manipulation

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `s` | `select_regex` | ✅ | live preview while typing |
| `S` | `split_selection` | ✅ | |
| `Alt-s` | `split_selection_on_newline` | ✅ | |
| `Alt-minus` | `merge_selections` | ✅ | |
| `Alt-_` | `merge_consecutive_selections` | ✅ | |
| `&` | `align_selections` | ✅ | |
| `_` | `trim_selections` | ✅ | |
| `;` | `collapse_selection` | ✅ | |
| `Alt-;` | `flip_selections` | ✅ | |
| `Alt-:` | `ensure_selections_forward` | ✅ | |
| `,` | `keep_primary_selection` | ✅ | |
| `Alt-,` | `remove_primary_selection` | ✅ | |
| `C` / `Alt-C` | `copy_selection_on_next_line` / `copy_selection_on_prev_line` | ✅ | skips lines that are too short, visual columns |
| `(` / `)` | `rotate_selections_backward` / `rotate_selections_forward` | ✅ | |
| `Alt-(` / `Alt-)` | `rotate_selection_contents_backward` / `rotate_selection_contents_forward` | ✅ | |
| `%` | `select_all` | ✅ | |
| `x` | `extend_line_below` | ✅ | |
| `X` | `extend_to_line_bounds` | ✅ | |
| `Alt-x` | `shrink_to_line_bounds` | ✅ | |
| `J` / `Alt-J` | `join_selections` / `join_selections_space` | ✅ | comment-token aware for common languages |
| `K` / `Alt-K` | `keep_selections` / `remove_selections` | ✅ | |
| `Ctrl-c` | `toggle_comments` | 🟡 | `editor.action.commentLine` |
| `Alt-o`, `Alt-Up` | `expand_selection` | ✅ (TS) | |
| `Alt-i`, `Alt-Down` | `shrink_selection` | ✅ (TS) | remembers expansion history like Helix |
| `Alt-p`, `Alt-Left` / `Alt-n`, `Alt-Right` | `select_prev_sibling` / `select_next_sibling` | ✅ (TS) | |
| `Alt-I`, `Alt-Shift-Down` | `select_all_children` | ✅ (TS) | |
| `Alt-a` | `select_all_siblings` | ✅ (TS) | |
| `Alt-e` / `Alt-b` | `move_parent_node_end` / `move_parent_node_start` | ✅ (TS) | |

### Search

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `/` / `?` | `search` / `rsearch` | ✅ | incremental, smart case, wrap around, history in `/` register; JS regex syntax |
| `n` / `N` | `search_next` / `search_prev` | ✅ | |
| `*` | `search_selection_detect_word_boundaries` | ✅ | |
| `Alt-*` | `search_selection` | ✅ | |

### Minor modes

#### View mode (`z`, sticky `Z`)

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `z`, `c` | `align_view_center` | ✅ | |
| `t` | `align_view_top` | ✅ | |
| `b` | `align_view_bottom` | ✅ | |
| `m` | `align_view_middle` | ❌ | VS Code cannot scroll horizontally on demand; reveals the cursor |
| `j`, `Down` / `k`, `Up` | `scroll_down` / `scroll_up` | ✅ | |
| `Ctrl-f`, `PageDown` / `Ctrl-b`, `PageUp` | `page_down` / `page_up` | ✅ | |
| `Ctrl-d`, `Space` / `Ctrl-u`, `Backspace` | `page_cursor_half_down` / `page_cursor_half_up` | ✅ | |
| `/` `?` `n` `N` | search | ✅ | |

#### Goto mode (`g`)

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `g` | `goto_file_start` | ✅ | `<n>gg` goes to line n |
| `\|` | `goto_column` | ✅ | |
| `e` | `goto_last_line` | ✅ | |
| `f` | `goto_file` | ✅ | resolves relative to the file and workspace folders, supports `path:line` |
| `h` / `l` / `s` | `goto_line_start` / `goto_line_end` / `goto_first_nonwhitespace` | ✅ | |
| `t` / `c` / `b` | `goto_window_top` / `goto_window_center` / `goto_window_bottom` | ✅ | |
| `d` / `D` / `y` / `r` / `i` | definition / declaration / type definition / references / implementation | 🟡 (LSP) | VS Code commands; jumplist entry pushed before the jump |
| `a` | `goto_last_accessed_file` | ✅ | |
| `m` | `goto_last_modified_file` | ✅ | |
| `n` / `p` | `goto_next_buffer` / `goto_previous_buffer` | 🟡 | editor tabs order |
| `k` / `j` | `move_line_up` / `move_line_down` | ✅ | |
| `.` | `goto_last_modification` | ✅ | |
| `w` | `goto_word` | ✅ | two-letter labels, `jumpLabelAlphabet` |

#### Match mode (`m`)

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `m` | `match_brackets` | ✅ (TS) | tree-sitter aware with plaintext fallback (`()[]{}<>‘’“”«»「」（）`) |
| `s<char>` | `surround_add` | ✅ | pairs, any char, `Enter` for newlines |
| `r<from><to>` | `surround_replace` | ✅ | `m` = closest pair, counts select outer pairs |
| `d<char>` | `surround_delete` | ✅ | |
| `a<obj>` / `i<obj>` | `select_textobject_around` / `select_textobject_inner` | ✅ | see textobjects below |

Textobjects after `mi` / `ma`:

| Key | Object | Status |
| --- | --- | --- |
| `w` / `W` | word / WORD | ✅ |
| `p` | paragraph | ✅ |
| `(` `)` `[` `]` `{` `}` `<` `>` `'` `"` `` ` `` and any other char | surround pair | ✅ |
| `m` | closest surround pair | ✅ (TS aware) |
| `f` | function | ✅ (TS) |
| `t` | type / class | ✅ (TS) |
| `a` | argument / parameter | ✅ (TS) |
| `c` | comment | ✅ (TS) |
| `T` | test | ✅ (TS) |
| `e` | data structure entry | ✅ (TS) |
| `x` | (X)HTML element | ✅ (TS, needs an html grammar) |
| `g` | VCS change | ❌ | no diff hunk API in VS Code |

#### Window mode (`Ctrl-w`, also `Space w`)

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `w`, `Ctrl-w` | `rotate_view` | 🟡 | focus next editor group |
| `s`, `Ctrl-s` / `v`, `Ctrl-v` | `hsplit` / `vsplit` | ✅ | |
| `t`, `Ctrl-t` | `transpose_view` | 🟡 | toggles the group layout |
| `f` / `F` | `goto_file_hsplit` / `goto_file_vsplit` | ✅ | |
| `q`, `Ctrl-q` | `wclose` | ✅ | closes the group (or the editor when there is one group) |
| `o`, `Ctrl-o` | `wonly` | 🟡 | joins all groups |
| `h`/`j`/`k`/`l` (+ `Ctrl-`, arrows) | `jump_view_*` | ✅ | |
| `H`/`J`/`K`/`L` | `swap_view_*` | ✅ | moves the active group |
| `n s` / `n v` | `hsplit_new` / `vsplit_new` | ✅ | |

#### Space mode (`Space`)

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `f` / `F` | `file_picker` / `file_picker_in_current_directory` | 🟡 | Quick Open |
| `e` / `.` | `file_explorer` / `file_explorer_in_current_buffer_directory` | 🟡 | Explorer view |
| `b` | `buffer_picker` | 🟡 | "Show All Editors" |
| `j` | `jumplist_picker` | ✅ | own QuickPick |
| `s` / `S` | symbol pickers | 🟡 (LSP) | Go to Symbol in Editor / Workspace |
| `d` / `D` | diagnostics pickers | 🟡 | Problems panel |
| `g` | `changed_file_picker` | 🟡 | Source Control view |
| `a` | `code_action` | 🟡 (LSP) | |
| `'` | `last_picker` | ✅ | |
| `G ...` | debug (sticky) | 🟡 | mapped to VS Code debug commands (`l` start, `c` continue, `n` step over, `i`/`o` step in/out, `b` breakpoint, `t` stop, `h` pause, `r` restart, `v` variables, `Ctrl-c`/`Ctrl-l` edit breakpoint/logpoint) |
| `w ...` | window mode | ✅ | same as `Ctrl-w` |

Window mode also carries Corral keys (no-ops unless the Corral extension is installed): `c` new terminal, `S`/`V` split with a shell, `a` jump to agent, `A` spawn agent, `i` prompt agent, `e` ask agent about selection, `m` review comment here, `D` send review, `d` review changes, `]`/`[` next/previous change, `P` popup, `;` last pane, `W` new agent worktree.
| `y` / `Y` / `p` / `P` / `R` | clipboard yank/paste/replace | ✅ | |
| `/` | `global_search` | 🟡 | Search view seeded with the selection |
| `k` | `hover` | 🟡 (LSP) | |
| `r` | `rename_symbol` | 🟡 (LSP) | |
| `h` | `select_references_to_symbol_under_cursor` | 🟡 | `editor.action.selectHighlights` |
| `c` / `C` / `Alt-c` | toggle comments | 🟡 | VS Code comment commands |
| `?` | `command_palette` | ✅ | |

#### Unimpaired (`[` / `]`)

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `]d` / `[d` / `]D` / `[D` | diagnostics | ✅ | own implementation over `vscode.languages.getDiagnostics`, wraps |
| `]g` / `[g` | next/prev change | 🟡 | VS Code dirty-diff navigation |
| `]G` / `[G` | last/first change | 🟡 | approximated |
| `]f` `[f` `]t` `[t` `]a` `[a` `]c` `[c` `]T` `[T` `]e` `[e` `]x` `[x` | tree-sitter objects | ✅ (TS) | |
| `]p` / `[p` | paragraphs | ✅ | |
| `]Space` / `[Space` | `add_newline_below` / `add_newline_above` | ✅ | |

## Insert mode

| Key | Command | Status | Notes |
| --- | --- | --- | --- |
| `Escape` | `normal_mode` | ✅ | first `Esc` closes an open completion/parameter hint (as in Helix) |
| `Ctrl-s` | `commit_undo_checkpoint` | ✅ | |
| `Ctrl-x` | `completion` | 🟡 | trigger suggest |
| `Ctrl-r <reg>` | `insert_register` | ✅ | |
| `Ctrl-w`, `Alt-Backspace` | `delete_word_backward` | ✅ | |
| `Alt-d`, `Alt-Delete` | `delete_word_forward` | ✅ | |
| `Ctrl-u` / `Ctrl-k` | `kill_to_line_start` / `kill_to_line_end` | ✅ | |
| `Ctrl-h`, `Backspace` / `Ctrl-d`, `Delete` | delete char | ✅ | Backspace/Delete use VS Code's own handling |
| `Ctrl-j`, `Enter` | `insert_newline` | ✅ | Enter uses VS Code (auto-indent, suggestions) |
| `Tab` / `Shift-Tab` | `smart_tab` / `insert_tab` | 🟡 | VS Code tab handling (snippets, suggest) |
| arrows, `PageUp/Down`, `Home`, `End` | movement | ✅ | native VS Code cursor movement |

Printable characters, IME composition and VS Code features (auto-closing pairs,
snippets, suggestions, inline completions) are untouched in insert mode.

## Select mode

All normal-mode keys work; the following extend instead of move: `h j k l`,
`w b e W B E`, `t f T F`, `n N`, `Home End`, `gg`, `g|`, `ge`, `gk`, `gj`, `gw`,
`Alt-e`, `Alt-b`, `]d`, `[d`, `]p`, `[p`, tree-sitter objects, `mm`. `v` and
`Esc` return to normal mode. ✅

## Picker / prompt keys

Helix's picker and prompt keys (`Ctrl-n`/`Ctrl-p`, `Tab` completion, `Ctrl-r`
register insertion in prompts) are provided by VS Code's QuickPick instead:
arrow keys move through completions/history, `Enter` accepts, `Esc` cancels.
`Ctrl-r <reg>` inside prompts is not available. 🟡

## Not mapped on purpose

- `Ctrl-z` (suspend): not applicable.
- Helix's popup/completion-menu keys are VS Code's own.
- `Cmd`-based VS Code shortcuts are never overridden; `Ctrl`/`Alt` keys are only
  overridden while `editorTextFocus && helicode.active` and (for most of them) not in insert mode.
