// Generates the `contributes.keybindings` section of package.json.
//
// Printable keys reach the extension through the `type` command; everything
// else (Escape, Enter, Tab, arrows, Ctrl/Alt combinations) must be declared as
// VS Code keybindings that forward to `helicode.key` with the Helix key name.
//
// Three groups are generated:
//   1. editor keys      - the Helix keymap itself (normal/select/insert)
//   2. "everywhere" keys - `Ctrl-w` window mode as chords in terminals, lists,
//                          views and webviews, so one keymap drives the whole
//                          VS Code window (and matches Corral's prefix table)
//   3. context keys      - notebook cell list, Helicode prompts, the infobox
//
// Every binding is guarded with `!helicode.pass<Key>` so `helicode.passthroughKeys`
// can hand any key back to VS Code.
import { readFileSync, writeFileSync } from 'node:fs';

const NOT_INSERT = "editorTextFocus && helicode.active && helicode.mode != 'insert'";
const INSERT = "editorTextFocus && helicode.active && helicode.mode == 'insert'";
const ANY = 'editorTextFocus && helicode.active';

/** `ctrl+w` -> `helicode.passCtrlW` (must match passthroughContextKey in src/extension.ts). */
function passContext(key) {
  const camel = key
    .toLowerCase()
    .split('+')
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join('');
  return `helicode.pass${camel.replace(/[^A-Za-z0-9]/g, '')}`;
}

/** The first key of a chord decides whether the whole chord is passed through. */
function guard(key, when) {
  const first = key.split(' ')[0];
  return `${when} && !${passContext(first)}`;
}

const bindings = [];
const add = (key, helix, when, extra = {}) => bindings.push({ key, command: 'helicode.key', args: { key: helix }, when: guard(key, when), ...extra });
const raw = (key, command, when, extra = {}) => bindings.push({ key, command, when: guard(key, when), ...extra });

// ---- 1. Normal / select mode -------------------------------------------
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

// ---- 2. Window mode everywhere -----------------------------------------
//
// Outside a text editor there is no Helix state, so these run the VS Code
// commands directly. They are chords (`ctrl+w` then a key), which VS Code
// resolves before handing keys to a terminal, so the same `Ctrl-w` table
// works in terminals, lists, views and webviews. The letters match Corral's
// `ctrl+b` prefix table, and Corral commands are called when it is installed
// (`helicode.command` falls back to the built-in editor-group commands).
const WINDOW_CHORDS = [
  ['h', 'workbench.action.focusLeftGroup'],
  ['left', 'workbench.action.focusLeftGroup'],
  ['ctrl+h', 'workbench.action.focusLeftGroup'],
  ['j', 'workbench.action.focusBelowGroup'],
  ['down', 'workbench.action.focusBelowGroup'],
  ['ctrl+j', 'workbench.action.focusBelowGroup'],
  ['k', 'workbench.action.focusAboveGroup'],
  ['up', 'workbench.action.focusAboveGroup'],
  ['ctrl+k', 'workbench.action.focusAboveGroup'],
  ['l', 'workbench.action.focusRightGroup'],
  ['right', 'workbench.action.focusRightGroup'],
  ['ctrl+l', 'workbench.action.focusRightGroup'],
  ['w', 'workbench.action.focusNextGroup'],
  ['ctrl+w', 'workbench.action.focusNextGroup'],
  ['shift+h', 'workbench.action.moveActiveEditorGroupLeft'],
  ['shift+j', 'workbench.action.moveActiveEditorGroupDown'],
  ['shift+k', 'workbench.action.moveActiveEditorGroupUp'],
  ['shift+l', 'workbench.action.moveActiveEditorGroupRight'],
  ['s', 'workbench.action.splitEditorDown'],
  ['ctrl+s', 'workbench.action.splitEditorDown'],
  ['v', 'workbench.action.splitEditor'],
  ['ctrl+v', 'workbench.action.splitEditor'],
  ['t', 'workbench.action.toggleEditorGroupLayout'],
  ['ctrl+t', 'workbench.action.toggleEditorGroupLayout'],
  ['q', 'workbench.action.closeActiveEditor'],
  ['ctrl+q', 'workbench.action.closeActiveEditor'],
  ['o', 'workbench.action.joinAllGroups'],
  ['ctrl+o', 'workbench.action.joinAllGroups'],
  ['n', 'workbench.action.nextEditorInGroup'],
  ['p', 'workbench.action.previousEditorInGroup'],
  ['1', 'workbench.action.focusFirstEditorGroup'],
  ['2', 'workbench.action.focusSecondEditorGroup'],
  ['3', 'workbench.action.focusThirdEditorGroup'],
  ['4', 'workbench.action.focusFourthEditorGroup'],
  ['5', 'workbench.action.focusFifthEditorGroup'],
  ['6', 'workbench.action.focusSixthEditorGroup'],
  ['7', 'workbench.action.focusSeventhEditorGroup'],
  ['8', 'workbench.action.focusEighthEditorGroup'],
  ['=', 'workbench.action.evenEditorWidths'],
];

/** Corral commands reachable from the same chords (no-ops without Corral). */
const WINDOW_CHORDS_CORRAL = [
  ['c', 'corral_new_terminal'],
  ['shift+s', 'corral_split_down'],
  ['shift+v', 'corral_split_right'],
  ['z', 'corral_zoom_pane'],
  ['x', 'corral_close_pane'],
  [';', 'corral_focus_last_pane'],
  [',', 'corral_rename_terminal'],
  ['a', 'corral_pick_agent'],
  ['shift+a', 'corral_spawn_agent'],
  ['i', 'corral_prompt_agent'],
  ['shift+e', 'corral_focus_view'],
  ['shift+d', 'corral_send_review'],
  ['d', 'corral_review_changes'],
  ['shift+p', 'corral_popup'],
  ['g', 'corral_lazygit'],
  ['r', 'corral_apply_layout'],
  ['shift+r', 'corral_save_layout'],
  ['shift+w', 'corral_new_worktree'],
  ['shift+/', 'corral_show_keymap'],
];

// Contexts outside a Helicode editor where `Ctrl-w` should still drive panes.
// In terminals the chord takes `Ctrl-w` away from readline (delete word), so
// it only applies at the `all` level.
const EVERYWHERE = [
  { name: 'terminal', when: "terminalFocus && config.helicode.windowKeysEverywhere == 'all'" },
  { name: 'list', when: "listFocus && !inputFocus && config.helicode.windowKeysEverywhere != 'off'" },
  { name: 'other', when: "!editorTextFocus && !terminalFocus && !listFocus && !inputFocus && config.helicode.windowKeysEverywhere != 'off'" },
];
for (const ctx of EVERYWHERE) {
  const when = `${ctx.when} && helicode.active`;
  for (const [key, command] of WINDOW_CHORDS) raw(`ctrl+w ${key}`, command, when);
  for (const [key, command] of WINDOW_CHORDS_CORRAL) {
    bindings.push({ key: `ctrl+w ${key}`, command: 'helicode.command', args: command, when: guard('ctrl+w', when) });
  }
}

// ---- 3. Helix-style navigation in lists, trees and views ----------------
//
// The explorer, search results, the SCM view, the problems panel and every
// other VS Code list get `j`/`k`/`gg`/`G`/`Ctrl-d`/`Ctrl-u` so navigation
// feels the same outside the editor. Opt out with `helicode.listNavigation`.
const LIST = 'listFocus && !inputFocus && helicode.active && config.helicode.listNavigation';
const LIST_KEYS = [
  ['j', 'list.focusDown'],
  ['k', 'list.focusUp'],
  ['h', 'list.collapse'],
  ['l', 'list.expand'],
  ['g g', 'list.focusFirst'],
  ['shift+g', 'list.focusLast'],
  ['ctrl+d', 'list.focusPageDown'],
  ['ctrl+u', 'list.focusPageUp'],
  ['ctrl+f', 'list.focusPageDown'],
  ['ctrl+b', 'list.focusPageUp'],
  ['enter', 'list.select'],
  ['o', 'list.select'],
  ['space', 'list.toggleExpand'],
  ['/', 'list.find'],
  ['n', 'list.focusDown'],
  ['shift+n', 'list.focusUp'],
  ['z c', 'list.collapse'],
  ['z o', 'list.expand'],
  ['shift+z shift+c', 'list.collapseAll'],
];
for (const [key, command] of LIST_KEYS) raw(key, command, LIST);
// Explorer-specific file operations (Helix-ish: `%` new file, `d` delete, `r` rename).
const EXPLORER = `filesExplorerFocus && !inputFocus && helicode.active && config.helicode.listNavigation`;
for (const [key, command] of [
  ['%', 'explorer.newFile'],
  ['shift+5', 'explorer.newFile'],
  ['shift+a', 'explorer.newFolder'],
  ['r', 'renameFile'],
  ['d', 'deleteFile'],
  ['y', 'filesExplorer.copy'],
  ['p', 'filesExplorer.paste'],
  ['x', 'filesExplorer.cut'],
]) {
  raw(key, command, EXPLORER);
}

// ---- Notebook cell list (no cell editor focused) -------------------------
const NB = 'notebookEditorFocused && !inputFocus && helicode.active';
const nb = (key, command, extra = {}) => raw(key, command, NB, extra);
nb('j', 'notebook.focusNextEditor');
nb('k', 'notebook.focusPreviousEditor');
nb('g g', 'notebook.focusTop');
nb('shift+g', 'notebook.focusBottom');
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
nb('slash', 'notebook.find');
nb('escape', 'notebook.cell.quitEdit');

// ---- Markdown preview / webviews -----------------------------------------
const WV = "activeWebviewPanelId == 'markdown.preview' && helicode.active";
for (const [key, command] of [
  ['ctrl+w h', 'workbench.action.focusLeftGroup'],
  ['ctrl+w l', 'workbench.action.focusRightGroup'],
  ['ctrl+w j', 'workbench.action.focusBelowGroup'],
  ['ctrl+w k', 'workbench.action.focusAboveGroup'],
  ['ctrl+w q', 'workbench.action.closeActiveEditor'],
  ['ctrl+w w', 'workbench.action.focusNextGroup'],
]) {
  raw(key, command, WV);
}

// ---- Helicode prompts: Ctrl-r inserts a register --------------------------
bindings.push({ key: 'ctrl+r', command: 'helicode.promptKey', args: { key: 'C-r' }, when: 'helicode.promptOpen && inQuickOpen' });

// ---- The which-key infobox owns the keyboard while it is open -------------
// Printable keys arrive through the QuickPick's own input; modifier
// combinations have to be forwarded explicitly.
const INFOBOX = 'helicode.infobox && inQuickOpen';
for (const c of ctrlNormal) add(`ctrl+${c}`, `C-${c}`, INFOBOX);
for (const [k, helix] of Object.entries(altKeys)) add(`alt+${k}`, helix, INFOBOX);
for (const k of ['up', 'down', 'left', 'right', 'home', 'end', 'pageup', 'pagedown']) add(`alt+${k}`, `A-${k}`, INFOBOX);
add('tab', 'tab', INFOBOX);
add('shift+tab', 'S-tab', INFOBOX);
add('backspace', 'backspace', INFOBOX);

const pkgPath = new URL('../package.json', import.meta.url);
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
pkg.contributes.keybindings = bindings;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
console.log(`wrote ${bindings.length} keybindings`);
