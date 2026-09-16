# Notebooks, Markdown preview and WYSIWYG editors

## Notebooks (Jupyter, etc.)

Each notebook cell is a real VS Code text editor, so inside a cell the complete
Helix model applies: modes, selections, `mi(`, `gw`, `:` commands and so on.
The status bar shows the mode as usual.

Two conventions bridge the cell editor and the cell list:

- **`Esc` in normal mode** (with no pending keys) leaves cell editing and
  focuses the cell in the list, like Jupyter's command mode. Disable with
  `helicode.notebook.escapeQuitsCellEdit`.
- **Cell list bindings** (`notebookEditorFocused && !inputFocus`):

| Key | Action |
| --- | --- |
| `j` / `k` | focus next / previous cell |
| `gg` / `G` | first / last cell |
| `Enter`, `i`, `a` | edit the focused cell (enters the editor in normal mode) |
| `o` / `O` | insert code cell below / above |
| `dd` | delete cell |
| `yy` / `x` / `p` / `P` | copy / cut / paste below / paste above |
| `u` / `U` | notebook undo / redo |
| `J` / `K` | move cell down / up |
| `m` / `c` | change cell to Markdown / code |
| `zc` / `zo` / `ZC` / `ZO` | collapse / expand cell input / output |
| `Space Enter` | execute cell |
| `Space a` | run all |
| `Space c` | clear all outputs |
| `Space r` | restart kernel (Jupyter) |
| `Ctrl-d` | focus cell output |

Markdown cells render when you leave them, which gives a live "WYSIWYG-like"
loop: `Enter`/`i` to edit the source with Helix keys, `Esc` `Esc` to render.

## Markdown preview

`:markdown-preview` (`:preview`) opens VS Code's built-in preview beside the
source; it scrolls in sync with the editor, so all Helix navigation in the
source drives the preview. Inside the preview panel `Ctrl-w h/j/k/l/w/q`
work to move focus back to editors or close the preview.

## WYSIWYG Markdown editors and other webviews

VS Code hosts WYSIWYG editors (Markdown Editor, Office Viewer, Milkdown-based
extensions, etc.) in webviews. A webview owns its keyboard input: extensions
cannot intercept plain characters typed into it, and there is no `type`
command to override there. Helicode therefore cannot provide modal editing
inside such editors. What works:

- keybindings with modifiers that the webview does not consume are still
  routed through VS Code, so the `Ctrl-w` window bindings above apply when the
  webview id is `markdown.preview`; other webviews can be added with your own
  `keybindings.json` entries using `activeWebviewPanelId`;
- the source view of the same file (open with "Reopen Editor With..." >
  Text Editor) has full Helix support, and the preview keeps up.

This is a VS Code platform limit, not something an extension can work around
without embedding its own editor.
