// Generates the `contributes.keybindings` section of package.json.
//
// Printable keys reach the extension through the `type` command; everything
// else (Escape, Enter, Tab, arrows, Ctrl/Alt combinations) must be declared as
// VS Code keybindings that forward to `helicode.key` with the Helix key name.
import { readFileSync, writeFileSync } from 'node:fs';

const NOT_INSERT = "editorTextFocus && helicode.active && helicode.mode != 'insert'";
const INSERT = "editorTextFocus && helicode.active && helicode.mode == 'insert'";
const ANY = 'editorTextFocus && helicode.active';

/** [vscode key, helix key name, when] */
const bindings = [];
const add = (key, helix, when, extra = {}) => bindings.push({ key, command: 'helicode.key', args: { key: helix }, when, ...extra });

// ---- Normal / select mode ----------------------------------------------
add('escape', 'esc', `${NOT_INSERT} && !suggestWidgetVisible && !findWidgetVisible && !renameInputVisible && !parameterHintsVisible`);
add('enter', 'ret', NOT_INSERT);
add('tab', 'tab', NOT_INSERT);
add('shift+tab', 'S-tab', NOT_INSERT);
add('backspace', 'backspace', NOT_INSERT);
add('shift+backspace', 'S-backspace', NOT_INSERT);
add('delete', 'del', NOT_INSERT);
add('insert', 'ins', NOT_INSERT);
for (const k of ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown']) {
  add(k, k, NOT_INSERT);
  add(`alt+${k}`, `A-${k}`, NOT_INSERT);
  add(`shift+${k}`, `S-${k}`, NOT_INSERT);
}
add('alt+shift+down', 'A-S-down', NOT_INSERT);

// Ctrl combinations used by Helix normal mode + window mode + view mode.
const ctrlNormal = ['a', 'b', 'c', 'd', 'f', 'i', 'o', 's', 'u', 'w', 'x', 'z', 'h', 'j', 'k', 'l', 'q', 't', 'v', 'e', 'y', 'n', 'p', 'g', 'r'];
for (const c of ctrlNormal) add(`ctrl+${c}`, `C-${c}`, NOT_INSERT);

// Alt combinations (letters, punctuation) used by Helix.
const altKeys = {
  '.': 'A-.',
  '`': 'A-`',
  d: 'A-d',
  c: 'A-c',
  'shift+c': 'A-C',
  s: 'A-s',
  '-': 'A-minus',
  'shift+-': 'A-_',
  ';': 'A-;',
  'shift+;': 'A-:',
  o: 'A-o',
  i: 'A-i',
  'shift+i': 'A-I',
  p: 'A-p',
  n: 'A-n',
  e: 'A-e',
  b: 'A-b',
  a: 'A-a',
  x: 'A-x',
  u: 'A-u',
  'shift+u': 'A-U',
  'shift+j': 'A-J',
  'shift+k': 'A-K',
  ',': 'A-,',
  'shift+9': 'A-(',
  'shift+0': 'A-)',
  'shift+\\': 'A-|',
  'shift+1': 'A-!',
  'shift+8': 'A-*',
  k: 'A-k',
  j: 'A-j',
  h: 'A-h',
  l: 'A-l',
  w: 'A-w',
  f: 'A-f',
  t: 'A-t',
  g: 'A-g',
  m: 'A-m',
  r: 'A-r',
  v: 'A-v',
  y: 'A-y',
  z: 'A-z',
  q: 'A-q',
};
for (const [k, helix] of Object.entries(altKeys)) add(`alt+${k}`, helix, NOT_INSERT);

// ---- Insert mode --------------------------------------------------------
add('escape', 'esc', `${INSERT} && !suggestWidgetVisible && !findWidgetVisible && !renameInputVisible && !parameterHintsVisible && !inlineSuggestionVisible && !inSnippetMode`);
add('ctrl+s', 'C-s', INSERT);
add('ctrl+x', 'C-x', `${INSERT} && !suggestWidgetVisible`);
add('ctrl+r', 'C-r', INSERT);
add('ctrl+w', 'C-w', INSERT);
add('alt+backspace', 'A-backspace', INSERT);
add('alt+d', 'A-d', INSERT);
add('alt+delete', 'A-del', INSERT);
add('ctrl+u', 'C-u', INSERT);
add('ctrl+k', 'C-k', INSERT);
add('ctrl+h', 'C-h', INSERT);
add('ctrl+d', 'C-d', INSERT);
add('ctrl+j', 'C-j', `${INSERT} && !suggestWidgetVisible`);
// Enter/Tab/arrows in insert mode are left to VS Code (suggest, snippets, auto-indent).

// A hard escape hatch that always returns to normal mode.
bindings.push({ key: 'ctrl+alt+escape', command: 'helicode.normalMode', when: ANY });

// ---- Notebook cell list (no cell editor focused) -------------------------
const NB = 'notebookEditorFocused && !inputFocus && helicode.active';
const nb = (key, command, extra = {}) => bindings.push({ key, command, when: NB, ...extra });
nb('j', 'list.focusDown');
nb('k', 'list.focusUp');
nb('g g', 'list.focusFirst');
nb('shift+g', 'list.focusLast');
nb('enter', 'notebook.cell.edit');
nb('i', 'notebook.cell.edit');
nb('a', 'notebook.cell.edit');
nb('o', 'notebook.cell.insertCodeCellBelow');
nb('shift+o', 'notebook.cell.insertCodeCellAbove');
nb('d d', 'notebook.cell.delete');
nb('y y', 'notebook.cell.copy');
nb('x', 'notebook.cell.cut');
nb('p', 'notebook.cell.paste');
nb('shift+p', 'notebook.cell.pasteAbove');
nb('u', 'notebook.undo');
nb('shift+u', 'notebook.redo');
nb('shift+j', 'notebook.cell.moveDown');
nb('shift+k', 'notebook.cell.moveUp');
nb('m', 'notebook.cell.changeToMarkdown');
nb('c', 'notebook.cell.changeToCode');
nb('z c', 'notebook.cell.collapseCellInput');
nb('z o', 'notebook.cell.expandCellInput');
nb('shift+z shift+c', 'notebook.cell.collapseCellOutput');
nb('shift+z shift+o', 'notebook.cell.expandCellOutput');
nb('ctrl+d', 'notebook.cell.focusInOutput');
nb('space enter', 'notebook.cell.execute');
nb('space a', 'notebook.execute');
nb('space c', 'notebook.clearAllCellsOutputs');
nb('space r', 'jupyter.restartkernel');
nb('escape', 'notebook.cell.quitEdit');

// ---- Markdown preview / webviews -----------------------------------------
const WV = "activeWebviewPanelId == 'markdown.preview' && helicode.active";
bindings.push({ key: 'ctrl+w h', command: 'workbench.action.focusLeftGroup', when: WV });
bindings.push({ key: 'ctrl+w l', command: 'workbench.action.focusRightGroup', when: WV });
bindings.push({ key: 'ctrl+w j', command: 'workbench.action.focusBelowGroup', when: WV });
bindings.push({ key: 'ctrl+w k', command: 'workbench.action.focusAboveGroup', when: WV });
bindings.push({ key: 'ctrl+w q', command: 'workbench.action.closeActiveEditor', when: WV });
bindings.push({ key: 'ctrl+w w', command: 'workbench.action.focusNextGroup', when: WV });

const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes.keybindings = bindings;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`wrote ${bindings.length} keybindings`);
