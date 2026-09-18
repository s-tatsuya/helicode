/**
 * `:` command line (Helix typable commands), rendered as a QuickPick with
 * completion, aliases and history (VSCodeVim-like feel: Enter runs the typed
 * text, arrow keys pick a completion).
 */
import * as vscode from 'vscode';
import * as path from 'node:path';
import { CommandContext } from '../engine/types';
import { Engine } from '../engine/engine';
import { from, to, fragment, primary, cursor as rangeCursor, selection as mkSelection, range as mkRange, lineRange } from '../core/range';
import { gotoLineWithoutJumplist } from '../engine/commands/movement';
import { pasteImpl } from '../engine/commands/changes';
import { shellImpl, ShellBehavior, runShell, insertOutputAtSelections } from '../engine/commands/shell';
import { getSyntax, showLog, bundledGrammars, supportsLanguage } from '../treesitter';
import { vsCommand, vsCommandAndSync, exitSelectMode } from '../engine/commands/util';
import { Change } from '../core/changes';
import { lineEnd } from '../core/text';

export interface TypedCommand {
  name: string;
  aliases: string[];
  doc: string;
  /** args: already split; bang: trailing `!` on the command name */
  run: (cx: CommandContext, args: string[], bang: boolean, raw: string) => Promise<void> | void;
  /** Completion kind for the first argument. */
  completer?: 'file' | 'theme' | 'language' | 'option' | 'none';
}

const commands: TypedCommand[] = [];
const byName = new Map<string, TypedCommand>();

function def(name: string, aliases: string[], doc: string, run: TypedCommand['run'], completer?: TypedCommand['completer']): void {
  const c: TypedCommand = { name, aliases, doc, run, completer };
  commands.push(c);
  byName.set(name, c);
  for (const a of aliases) byName.set(a, c);
}

export function allTypedCommands(): readonly TypedCommand[] {
  return commands;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function writeDoc(cx: CommandContext, pathArg: string | undefined, force: boolean): Promise<boolean> {
  const doc = cx.vs.document;
  if (pathArg) {
    const target = resolveUserPath(pathArg, doc.uri);
    if (force) await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    const bytes = Buffer.from(doc.getText(), 'utf8');
    await vscode.workspace.fs.writeFile(target, bytes);
    if (doc.isUntitled || doc.uri.toString() !== target.toString()) {
      // Reopen under the new path (VS Code's "save as" semantics).
      const opened = await vscode.workspace.openTextDocument(target);
      await vscode.window.showTextDocument(opened);
      if (doc.isUntitled) await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor').then(undefined, () => undefined);
    }
    cx.setStatus(`'${vscode.workspace.asRelativePath(target, false)}' written`);
    return true;
  }
  if (doc.isUntitled) {
    const ok = await vscode.commands.executeCommand('workbench.action.files.saveAs');
    return !!ok;
  }
  const ok = await doc.save();
  if (ok) cx.setStatus(`'${vscode.workspace.asRelativePath(doc.uri, false)}' written`);
  else cx.setError('write failed');
  return ok;
}

function resolveUserPath(p: string, relativeTo: vscode.Uri): vscode.Uri {
  if (p.startsWith('~/')) p = path.join(process.env.HOME ?? '', p.slice(2));
  if (path.isAbsolute(p)) return vscode.Uri.file(p);
  const folder = vscode.workspace.getWorkspaceFolder(relativeTo) ?? vscode.workspace.workspaceFolders?.[0];
  if (relativeTo.scheme === 'file' && !folder) return vscode.Uri.file(path.resolve(path.dirname(relativeTo.fsPath), p));
  return folder ? vscode.Uri.joinPath(folder.uri, p) : vscode.Uri.file(path.resolve(p));
}

async function closeEditor(force: boolean): Promise<void> {
  if (force) await vsCommand('workbench.action.revertAndCloseActiveEditor');
  else await vsCommand('workbench.action.closeActiveEditor');
}

async function openFile(cx: CommandContext, p: string): Promise<void> {
  const uri = resolveUserPath(p, cx.vs.document.uri);
  try {
    await vscode.workspace.fs.stat(uri);
  } catch {
    // Helix opens a new buffer for missing files.
    const doc = await vscode.workspace.openTextDocument(uri.with({ scheme: 'untitled' }));
    await vscode.window.showTextDocument(doc);
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
}

// ---------------------------------------------------------------------------
// Command definitions (helix-term/src/commands/typed.rs)
// ---------------------------------------------------------------------------

def('quit', ['q'], 'Close the current view.', (_cx, _a, bang) => closeEditor(bang));
def('quit!', ['q!'], 'Force close the current view, ignoring unsaved changes.', () => closeEditor(true));
def(
  'open',
  ['o', 'edit', 'e'],
  'Open a file from disk into the current view.',
  async (cx, args) => {
    if (!args.length) {
      await vsCommand('workbench.action.quickOpen');
      return;
    }
    for (const a of args) await openFile(cx, a);
  },
  'file',
);
def('buffer-close', ['bc', 'bclose'], 'Close the current buffer.', (_cx, _a, bang) => closeEditor(bang));
def('buffer-close!', ['bc!', 'bclose!'], 'Close the current buffer forcefully, ignoring unsaved changes.', () => closeEditor(true));
def('buffer-close-others', ['bco', 'bcloseother'], 'Close all buffers but the currently focused one.', () => vsCommand('workbench.action.closeOtherEditors'));
def('buffer-close-others!', ['bco!', 'bcloseother!'], 'Force close all buffers but the currently focused one.', () => vsCommand('workbench.action.closeOtherEditors'));
def('buffer-close-all', ['bca', 'bcloseall'], 'Close all buffers without quitting.', () => vsCommand('workbench.action.closeAllEditors'));
def('buffer-close-all!', ['bca!', 'bcloseall!'], 'Force close all buffers ignoring unsaved changes without quitting.', async () => {
  await vsCommand('workbench.action.revertAndCloseActiveEditor');
  await vsCommand('workbench.action.closeAllEditors');
});
def('buffer-next', ['bn', 'bnext'], 'Goto next buffer.', () => vsCommand('workbench.action.nextEditor'));
def('buffer-previous', ['bp', 'bprev'], 'Goto previous buffer.', () => vsCommand('workbench.action.previousEditor'));
def('write', ['w'], 'Write changes to disk. Accepts an optional path (:write some/path.txt)', (cx, args, bang) => writeDoc(cx, args[0], bang).then(() => undefined), 'file');
def('write!', ['w!'], 'Force write changes to disk creating necessary subdirectories.', (cx, args) => writeDoc(cx, args[0], true).then(() => undefined), 'file');
def('write-buffer-close', ['wbc'], 'Write changes to disk and closes the buffer.', async (cx, args, bang) => {
  if (await writeDoc(cx, args[0], bang)) await closeEditor(false);
});
def('write-buffer-close!', ['wbc!'], 'Force write changes to disk and closes the buffer.', async (cx, args) => {
  if (await writeDoc(cx, args[0], true)) await closeEditor(false);
});
def('new', ['n'], 'Create a new scratch buffer.', () => vsCommand('workbench.action.files.newUntitledFile'));
def('format', ['fmt'], 'Format the file using an external formatter or language server.', () => vsCommand('editor.action.formatDocument'));
def('indent-style', [], "Set the indentation style for editing. ('t' for tabs or 1-16 for number of spaces.)", (cx, args) => {
  const a = args[0];
  if (!a) {
    const o = cx.vs.options;
    cx.setStatus(o.insertSpaces === false ? 'tabs' : `${o.tabSize} spaces`);
    return;
  }
  if (a === 't' || a === 'tab' || a === 'tabs') cx.vs.options = { insertSpaces: false };
  else {
    const n = Number(a);
    if (n >= 1 && n <= 16) cx.vs.options = { insertSpaces: true, tabSize: n };
    else cx.setError("invalid indent style: use 't' or 1-16");
  }
});
def('line-ending', [], "Set the document's default line ending. Options: crlf, lf.", async (cx, args) => {
  const a = args[0]?.toLowerCase();
  if (!a) {
    cx.setStatus(cx.vs.document.eol === vscode.EndOfLine.CRLF ? 'crlf' : 'lf');
    return;
  }
  if (a !== 'lf' && a !== 'crlf') {
    cx.setError('invalid line ending: use lf or crlf');
    return;
  }
  await cx.vs.edit((eb) => eb.setEndOfLine(a === 'lf' ? vscode.EndOfLine.LF : vscode.EndOfLine.CRLF));
});
def('earlier', ['ear'], 'Jump back to an earlier point in edit history. Accepts a number of steps.', async (_cx, args) => {
  const n = Math.max(1, Number(args[0]) || 1);
  for (let i = 0; i < n; i++) await vsCommand('undo');
});
def('later', ['lat'], 'Jump to a later point in edit history. Accepts a number of steps.', async (_cx, args) => {
  const n = Math.max(1, Number(args[0]) || 1);
  for (let i = 0; i < n; i++) await vsCommand('redo');
});
def('write-quit', ['wq', 'x', 'xit', 'exit'], 'Write changes to disk and close the current view.', async (cx, args, bang) => {
  if (await writeDoc(cx, args[0], bang)) await closeEditor(false);
});
def('write-quit!', ['wq!', 'x!', 'xit!', 'exit!'], 'Write changes to disk and close the current view forcefully.', async (cx, args) => {
  if (await writeDoc(cx, args[0], true)) await closeEditor(true);
});
def('write-all', ['wa'], 'Write changes from all buffers to disk.', async (cx) => {
  const ok = await vscode.workspace.saveAll(false);
  cx.setStatus(ok ? 'all buffers written' : 'write-all failed');
});
def('write-all!', ['wa!'], 'Forcefully write changes from all buffers to disk.', async () => {
  await vscode.workspace.saveAll(true);
});
def('write-quit-all', ['wqa', 'xa'], 'Write changes from all buffers to disk and close all views.', async () => {
  await vscode.workspace.saveAll(false);
  await vsCommand('workbench.action.closeAllEditors');
});
def('write-quit-all!', ['wqa!', 'xa!'], 'Forcefully write changes from all buffers to disk and close all views.', async () => {
  await vscode.workspace.saveAll(true);
  await vsCommand('workbench.action.closeAllEditors');
});
def('quit-all', ['qa'], 'Close all views.', () => vsCommand('workbench.action.closeAllEditors'));
def('quit-all!', ['qa!'], 'Force close all views ignoring unsaved changes.', async () => {
  await vsCommand('workbench.action.revertAndCloseActiveEditor');
  await vsCommand('workbench.action.closeAllEditors');
});
def('cquit', ['cq'], 'Quit with exit code (closes the window in VS Code).', () => vsCommand('workbench.action.closeWindow'));
def('cquit!', ['cq!'], 'Force quit (closes the window in VS Code).', () => vsCommand('workbench.action.closeWindow'));
def(
  'theme',
  [],
  'Change the editor theme (show current theme if no name specified).',
  async (cx, args) => {
    if (!args.length) {
      cx.setStatus(String(vscode.workspace.getConfiguration('workbench').get('colorTheme')));
      return;
    }
    await vscode.workspace.getConfiguration('workbench').update('colorTheme', args.join(' '), vscode.ConfigurationTarget.Global);
  },
  'theme',
);
def('yank-join', [], 'Yank joined selections. A separator can be provided as first argument. Default value is newline.', async (cx, args) => {
  const sep = args.length ? args.join(' ') : cx.doc.eol;
  const values = cx.selection.ranges.map((r) => fragment(cx.doc.text, r));
  await cx.engine.registers.write(cx.register ?? cx.engine.config.defaultYankRegister, [values.join(sep)]);
  cx.setStatus(`joined and yanked ${values.length} selection(s)`);
});
def('clipboard-yank', [], 'Yank main selection into system clipboard.', async (cx) => {
  await cx.engine.registers.write('+', [fragment(cx.doc.text, primary(cx.selection))]);
  cx.setStatus('yanked main selection to system clipboard');
});
def('clipboard-yank-join', [], 'Yank joined selections into system clipboard.', async (cx, args) => {
  const sep = args.length ? args.join(' ') : cx.doc.eol;
  await cx.engine.registers.write('+', [cx.selection.ranges.map((r) => fragment(cx.doc.text, r)).join(sep)]);
  cx.setStatus('joined and yanked selections to system clipboard');
});
def('primary-clipboard-yank', [], 'Yank main selection into system primary clipboard.', (cx) => byName.get('clipboard-yank')!.run(cx, [], false, ''));
def('primary-clipboard-yank-join', [], 'Yank joined selections into system primary clipboard.', (cx, a) => byName.get('clipboard-yank-join')!.run(cx, a, false, ''));
def('clipboard-paste-after', [], 'Paste system clipboard after selections.', (cx) => cx.engine.execute('paste_clipboard_after', { editor: cx.editor }));
def('clipboard-paste-before', [], 'Paste system clipboard before selections.', (cx) => cx.engine.execute('paste_clipboard_before', { editor: cx.editor }));
def('clipboard-paste-replace', [], 'Replace selections with content of system clipboard.', (cx) => cx.engine.execute('replace_selections_with_clipboard', { editor: cx.editor }));
def('primary-clipboard-paste-after', [], 'Paste primary clipboard after selections.', (cx) => cx.engine.execute('paste_clipboard_after', { editor: cx.editor }));
def('primary-clipboard-paste-before', [], 'Paste primary clipboard before selections.', (cx) => cx.engine.execute('paste_clipboard_before', { editor: cx.editor }));
def('primary-clipboard-paste-replace', [], 'Replace selections with content of system primary clipboard.', (cx) => cx.engine.execute('replace_selections_with_clipboard', { editor: cx.editor }));
def('show-clipboard-provider', [], 'Show clipboard provider name in status bar.', (cx) => cx.setStatus('VS Code clipboard (vscode.env.clipboard)'));
def(
  'change-current-directory',
  ['cd'],
  'Change the current working directory (opens the folder in VS Code).',
  async (cx, args) => {
    if (!args.length) {
      await vsCommand('workbench.action.files.openFolder');
      return;
    }
    const uri = resolveUserPath(args[0], cx.vs.document.uri);
    await vsCommand('vscode.openFolder', uri, { forceNewWindow: false });
  },
  'file',
);
def('show-directory', ['pwd'], 'Show the current working directory.', (cx) => {
  const f = vscode.workspace.getWorkspaceFolder(cx.vs.document.uri) ?? vscode.workspace.workspaceFolders?.[0];
  cx.setStatus(f ? f.uri.fsPath : process.cwd());
});
def('encoding', [], 'Set encoding (opens the encoding picker).', () => vsCommand('workbench.action.editor.changeEncoding'));
def('character-info', ['char'], 'Get info about the character under the primary cursor.', (cx) => {
  const text = cx.doc.text;
  const c = rangeCursor(text, primary(cx.selection));
  const cp = text.codePointAt(c);
  if (cp === undefined) {
    cx.setStatus('(end of file)');
    return;
  }
  const chStr = String.fromCodePoint(cp);
  const hex = cp.toString(16).toUpperCase().padStart(4, '0');
  const utf8 = Buffer.from(chStr, 'utf8')
    .toString('hex')
    .replace(/(..)/g, '$1 ')
    .trim();
  cx.setStatus(`"${chStr}" (U+${hex}) Dec ${cp} Hex ${hex} UTF-8: ${utf8}`);
});
def('reload', ['rl'], 'Discard changes and reload from the source file.', () => vsCommand('workbench.action.files.revert'));
def('reload-all', ['rla'], 'Discard changes and reload all documents from the source files.', () => vsCommand('workbench.action.files.revert'));
def('update', ['u'], 'Write changes only if the file has been modified.', async (cx) => {
  if (cx.vs.document.isDirty) await writeDoc(cx, undefined, false);
});
def('lsp-workspace-command', [], 'Open workspace command picker', () => vsCommand('workbench.action.showCommands'));
def('lsp-restart', [], 'Restarts the language servers used by the current file (best effort).', async (cx) => {
  const candidates: Record<string, string[]> = {
    typescript: ['typescript.restartTsServer'],
    typescriptreact: ['typescript.restartTsServer'],
    javascript: ['typescript.restartTsServer'],
    javascriptreact: ['typescript.restartTsServer'],
    rust: ['rust-analyzer.restartServer'],
    python: ['python.analysis.restartLanguageServer', 'python.restartLanguageServer'],
    go: ['go.languageserver.restart'],
    java: ['java.clean.workspace'],
    csharp: ['dotnet.restartServer', 'csharp.restartServer'],
    dart: ['dart.restartAnalysisServer'],
    haskell: ['haskell.restartServer'],
    nix: ['nix.restartLanguageServer'],
  };
  const all = await vscode.commands.getCommands(true);
  const list = candidates[cx.vs.document.languageId] ?? [];
  const found = list.find((c) => all.includes(c));
  if (found) {
    await vsCommand(found);
    cx.setStatus(`ran ${found}`);
  } else cx.setError(`no known restart command for ${cx.vs.document.languageId}; use "Developer: Restart Extension Host"`);
});
def('lsp-stop', [], 'Stops language servers (not supported; VS Code manages servers).', (cx) => cx.setError('lsp-stop is not available in VS Code'));
def('tree-sitter-scopes', [], 'Display tree sitter scopes at the cursor.', async (cx) => {
  const syntax = await getSyntax(cx.vs.document);
  if (!syntax) {
    cx.setError('tree-sitter is not available for this document');
    return;
  }
  const c = rangeCursor(cx.doc.text, primary(cx.selection));
  await vscode.window.showInformationMessage(syntax.scopesAt(c).join(' > '), { modal: false });
});
def('tree-sitter-highlight-name', [], 'Display name of the highlight scope under the cursor (TextMate scopes in VS Code).', () => vsCommand('editor.action.inspectTMScopes'));
def('tree-sitter-layers', [], 'Display language names of tree-sitter injection layers under the cursor.', (cx) => cx.setStatus(supportsLanguage(cx.vs.document.languageId) ? cx.vs.document.languageId : `no grammar for ${cx.vs.document.languageId}`));
def('tree-sitter-subtree', ['ts-subtree'], 'Display the smallest tree-sitter subtree that spans the primary selection.', async (cx) => {
  const syntax = await getSyntax(cx.vs.document);
  if (!syntax) {
    cx.setError('tree-sitter is not available for this document');
    return;
  }
  const p = primary(cx.selection);
  const node = syntax.root.namedDescendantForIndex(from(p), Math.max(from(p), to(p) - 1));
  const content = node ? node.toString() : '(none)';
  const doc = await vscode.workspace.openTextDocument({ content, language: 'scheme' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
});
def('debug-start', ['dbg'], 'Start a debug session.', () => vsCommand('workbench.action.debug.start'));
def('debug-remote', ['dbg-tcp'], 'Connect to a debug adapter (opens the debug view).', () => vsCommand('workbench.view.debug'));
def('debug-eval', [], 'Evaluate expression in current debug context.', () => vsCommand('workbench.debug.action.focusRepl'));
def(
  'vsplit',
  ['vs'],
  'Open the file in a vertical split.',
  async (cx, args) => {
    await vsCommand('workbench.action.splitEditor');
    for (const a of args) await openFile(cx, a);
  },
  'file',
);
def('vsplit-new', ['vnew'], 'Open a scratch buffer in a vertical split.', (cx) => cx.engine.execute('vsplit_new', { editor: cx.editor }));
def(
  'hsplit',
  ['hs', 'sp'],
  'Open the file in a horizontal split.',
  async (cx, args) => {
    await vsCommand('workbench.action.splitEditorDown');
    for (const a of args) await openFile(cx, a);
  },
  'file',
);
def('hsplit-new', ['hnew'], 'Open a scratch buffer in a horizontal split.', (cx) => cx.engine.execute('hsplit_new', { editor: cx.editor }));
def('tutor', [], 'Open the tutorial.', async (cx) => {
  const uri = vscode.Uri.joinPath(extensionUri!, 'docs', 'tutor.txt');
  try {
    const bytes = await vscode.workspace.fs.readFile(uri);
    const doc = await vscode.workspace.openTextDocument({ content: Buffer.from(bytes).toString('utf8'), language: 'plaintext' });
    await vscode.window.showTextDocument(doc);
  } catch {
    cx.setError('tutor file not found');
  }
});
def('goto', ['g'], 'Goto line number.', (cx, args) => {
  const n = Number(args[0]);
  if (!Number.isFinite(n)) {
    cx.setError('usage: :goto <line>');
    return;
  }
  cx.engine.pushJump(cx.editor);
  gotoLineWithoutJumplist(cx, n, cx.extend);
});
def(
  'set-language',
  ['lang'],
  'Set the language of current buffer (show current language if no value specified).',
  async (cx, args) => {
    if (!args.length) {
      cx.setStatus(cx.vs.document.languageId);
      return;
    }
    await vscode.languages.setTextDocumentLanguage(cx.vs.document, args[0]);
  },
  'language',
);
def(
  'set-option',
  ['set'],
  'Set a config option at runtime (Helix option names are mapped to Helicode/VS Code settings).',
  async (cx, args) => {
    if (args.length < 2) {
      cx.setError('usage: :set <option> <value>');
      return;
    }
    await setOption(cx, args[0], args.slice(1).join(' '));
  },
  'option',
);
def(
  'toggle-option',
  ['toggle'],
  'Toggle a config option at runtime.',
  async (cx, args) => {
    if (!args.length) {
      cx.setError('usage: :toggle <option> [values...]');
      return;
    }
    await toggleOption(cx, args[0], args.slice(1));
  },
  'option',
);
def(
  'get-option',
  ['get'],
  'Get the current value of a config option.',
  (cx, args) => {
    if (!args.length) {
      cx.setError('usage: :get <option>');
      return;
    }
    const v = getOption(cx, args[0]);
    cx.setStatus(`${args[0]} = ${JSON.stringify(v)}`);
  },
  'option',
);
def('sort', [], 'Sort ranges in selection. Accepts --reverse / -r and --insensitive / -i.', async (cx, args, bang) => {
  const reverse = bang || args.includes('--reverse') || args.includes('-r');
  const insensitive = args.includes('--insensitive') || args.includes('-i');
  await sortSelections(cx, reverse, insensitive);
});
def('rsort', [], 'Sort ranges in selection in reverse order.', (cx) => sortSelections(cx, true, false));
def('reflow', [], 'Hard-wrap the current selection of lines to a given width.', async (cx, args) => {
  const width = Number(args[0]) || vscode.workspace.getConfiguration('helicode').get<number>('textWidth', 80);
  await reflow(cx, width);
});
def('config-reload', [], 'Refresh user config.', (cx) => {
  cx.engine.applyKeymapOverrides();
  cx.setStatus('config reloaded');
});
def('config-open', [], 'Open the user settings.json file.', () => vsCommand('workbench.action.openSettingsJson'));
def('config-open-workspace', [], 'Open the workspace settings file.', () => vsCommand('workbench.action.openWorkspaceSettingsFile'));
def('log-open', [], 'Open the Helicode log (output channel).', () => showLog());
def('insert-output', [], 'Run shell command, inserting output before each selection.', (cx, _a, _b, raw) => shellImpl(cx, raw, ShellBehavior.Insert));
def('append-output', [], 'Run shell command, appending output after each selection.', (cx, _a, _b, raw) => shellImpl(cx, raw, ShellBehavior.Append));
def('pipe', ['|'], 'Pipe each selection to the shell command.', (cx, _a, _b, raw) => shellImpl(cx, raw, ShellBehavior.Replace));
def('pipe-to', [], 'Pipe each selection to the shell command, ignoring output.', (cx, _a, _b, raw) => shellImpl(cx, raw, ShellBehavior.Ignore));
def('run-shell-command', ['sh', '!'], 'Run a shell command', async (cx, _a, _b, raw) => {
  if (!raw.trim()) {
    cx.setError('usage: :sh <command>');
    return;
  }
  const res = await runShell(cx, raw, undefined);
  const out = (res.stdout + (res.stderr ? '\n' + res.stderr : '')).trim();
  if (!out) {
    cx.setStatus(res.code === 0 ? 'Command succeeded' : `Command failed (${res.code})`);
    return;
  }
  const doc = await vscode.workspace.openTextDocument({ content: out, language: 'plaintext' });
  const where = vscode.workspace.getConfiguration('helicode').get<'beside' | 'here' | 'below'>('shell.output', 'beside');
  if (where === 'below') await vsCommand('workbench.action.newGroupBelow');
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: where === 'beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active, preserveFocus: where === 'beside' });
});
def(
  'popup',
  ['pop'],
  'Run a command in a Corral popup terminal (interactive, in a floating window) and put its output at the selections: replaces a non-empty selection, otherwise inserts at the cursor. `:popup!` only runs the command. Needs the Corral extension.',
  async (cx, _a, bang, raw) => {
    if (!raw.trim()) {
      cx.setError('usage: :popup <command>');
      return;
    }
    const available = (await vscode.commands.getCommands(true)).includes('corral.popup');
    if (!available) {
      cx.setError(':popup needs the Corral extension (corral.popup command not found)');
      return;
    }
    const p = primary(cx.selection);
    const selectionText = to(p) - from(p) > 1 ? fragment(cx.doc.text, p) : undefined;
    const folder = vscode.workspace.getWorkspaceFolder(cx.vs.document.uri) ?? vscode.workspace.workspaceFolders?.[0];
    cx.setStatus(`popup: ${raw}`);
    const res = (await vscode.commands.executeCommand('corral.popup', { command: raw, selection: selectionText, cwd: folder?.uri.fsPath, returnOutput: true })) as
      | { output: string; exitCode?: number; cancelled?: boolean; captured: boolean }
      | undefined;
    if (!res || res.cancelled) {
      cx.setStatus('popup cancelled');
      return;
    }
    if (bang) {
      cx.setStatus(`popup finished (${res.exitCode ?? '?'})`);
      return;
    }
    if (!res.captured) {
      cx.setError('popup output was not captured (terminal shell integration unavailable)');
      return;
    }
    await insertOutputAtSelections(cx, res.output, selectionText !== undefined ? ShellBehavior.Replace : ShellBehavior.Insert);
    cx.setStatus(`popup: inserted ${res.output.length} chars (exit ${res.exitCode ?? '?'})`);
  },
);
def('reset-diff-change', ['diffget', 'diffg'], 'Reset the diff change at the cursor position.', () => vsCommand('git.revertSelectedRanges'));
def('clear-register', [], 'Clear given register. If no argument is provided, clear all registers.', (cx, args) => {
  cx.engine.registers.clear(args[0]);
  cx.setStatus(args[0] ? `Register ${args[0]} cleared` : 'All registers cleared');
});
def('set-register', [], 'Set contents of the given register.', async (cx, args, _b, raw) => {
  if (!args.length) {
    cx.setError('usage: :set-register <reg> <value>');
    return;
  }
  const value = raw.slice(raw.indexOf(args[0]) + args[0].length).trimStart();
  await cx.engine.registers.write(args[0], [value]);
});
def('redraw', [], 'Clear and re-render the whole UI', (cx) => cx.editor.refresh());
def(
  'move',
  ['mv'],
  'Move the current buffer and its corresponding file to a different path',
  async (cx, args, bang) => {
    if (!args.length) {
      cx.setError('usage: :move <path>');
      return;
    }
    const target = resolveUserPath(args[0], cx.vs.document.uri);
    if (bang) await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
    await cx.vs.document.save();
    const edit = new vscode.WorkspaceEdit();
    edit.renameFile(cx.vs.document.uri, target, { overwrite: bang });
    await vscode.workspace.applyEdit(edit);
    const doc = await vscode.workspace.openTextDocument(target);
    await vscode.window.showTextDocument(doc);
  },
  'file',
);
def('move!', ['mv!'], 'Move the current buffer and its file, creating necessary subdirectories', (cx, args) => byName.get('move')!.run(cx, args, true, ''), 'file');
def('yank-diagnostic', [], 'Yank diagnostic(s) under primary cursor to register, or clipboard by default', async (cx, args) => {
  const doc = cx.doc;
  const c = rangeCursor(doc.text, primary(cx.selection));
  const pos = doc.position(c);
  const diags = vscode.languages.getDiagnostics(cx.vs.document.uri).filter((d) => d.range.contains(pos));
  if (!diags.length) {
    cx.setError('No diagnostics under primary cursor');
    return;
  }
  await cx.engine.registers.write(args[0] ?? '+', diags.map((d) => d.message));
  cx.setStatus(`Yanked ${diags.length} diagnostic(s) to register ${args[0] ?? '+'}`);
});
def(
  'read',
  ['r'],
  'Load a file into buffer',
  async (cx, args) => {
    if (!args.length) {
      cx.setError('usage: :read <file>');
      return;
    }
    const uri = resolveUserPath(args[0], cx.vs.document.uri);
    const bytes = await vscode.workspace.fs.readFile(uri);
    const content = Buffer.from(bytes).toString('utf8').replace(/\r\n|\n/g, cx.doc.eol);
    await pasteImpl(cx, [content], 1 /* Paste.After */, 1);
  },
  'file',
);
def('echo', [], 'Prints the given arguments to the statusline.', (cx, _a, _b, raw) => cx.setStatus(raw));
def('noop', [], 'Does nothing.', () => {});
def('workspace-trust', [], 'Manage workspace trust.', () => vsCommand('workbench.trust.manage'));
def('workspace-untrust', [], 'Manage workspace trust.', () => vsCommand('workbench.trust.manage'));
def('workspace-exclude', [], 'Manage workspace trust.', () => vsCommand('workbench.trust.manage'));
def('push-directory', ['pushd'], 'Not supported in VS Code (single workspace directory).', (cx) => cx.setError('pushd is not available in VS Code'));
def('pop-directory', ['popd'], 'Not supported in VS Code (single workspace directory).', (cx) => cx.setError('popd is not available in VS Code'));
def('show-directory-stack', [], 'Not supported in VS Code.', (cx) => cx.setError('directory stack is not available in VS Code'));
// Helicode extras
def('helicode-toggle', [], 'Enable/disable Helicode key handling.', () => vsCommand('helicode.toggle'));
def('keymap', [], 'Show the Helicode keymap reference.', () => vsCommand('helicode.showKeymapHelp'));
def('tree-sitter-grammars', [], 'List bundled tree-sitter grammars.', (cx) => cx.setStatus('bundled grammars: ' + bundledGrammars().join(', ')));
def('markdown-preview', ['preview'], 'Open the markdown preview to the side (VS Code built-in).', () => vsCommand('markdown.showPreviewToSide'));
def(
  'vscode-command',
  ['vsc'],
  'Run a VS Code command by id: `:vsc <command.id> [json args...]`. Lets `helicode.keys` bind keys to any extension command (e.g. Corral panes).',
  async (cx, args) => {
    if (args.length === 0) {
      cx.setError('usage: :vscode-command <command.id> [json-arg ...]');
      return;
    }
    const [id, ...rest] = args;
    const parsed = rest.map((a) => {
      try {
        return JSON.parse(a);
      } catch {
        return a;
      }
    });
    await vsCommandAndSync(cx, id, ...parsed);
  },
);

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

/** Helix option -> VS Code setting (section, key). */
const OPTION_MAP: Record<string, [string, string]> = {
  'search.smart-case': ['helicode', 'search.smartCase'],
  'search.wrap-around': ['helicode', 'search.wrapAround'],
  scrolloff: ['helicode', 'scrolloff'],
  'jump-label-alphabet': ['helicode', 'jumpLabelAlphabet'],
  'text-width': ['helicode', 'textWidth'],
  'line-number': ['editor', 'lineNumbers'],
  'cursorline': ['editor', 'renderLineHighlight'],
  'soft-wrap.enable': ['editor', 'wordWrap'],
  'auto-format': ['editor', 'formatOnSave'],
  'auto-pairs': ['editor', 'autoClosingBrackets'],
  'rulers': ['editor', 'rulers'],
  'indent-guides.render': ['editor', 'guides.indentation'],
  'mouse': ['editor', 'mouseWheelZoom'],
  'true-color': ['workbench', 'colorTheme'],
  'auto-save': ['files', 'autoSave'],
  'whitespace.render': ['editor', 'renderWhitespace'],
  'bufferline': ['workbench', 'editor.showTabs'],
  'file-picker.hidden': ['files', 'exclude'],
  'idle-timeout': ['editor', 'quickSuggestionsDelay'],
  'completion-trigger-len': ['editor', 'quickSuggestions'],
  'inline-diagnostics': ['editor', 'inlayHints.enabled'],
  'lsp.display-inlay-hints': ['editor', 'inlayHints.enabled'],
  'insert-final-newline': ['files', 'insertFinalNewline'],
  'trim-trailing-whitespace': ['files', 'trimTrailingWhitespace'],
  'trim-final-newlines': ['files', 'trimFinalNewlines'],
};

function optionTarget(name: string): [string, string] {
  if (OPTION_MAP[name]) return OPTION_MAP[name];
  if (name.includes('.')) {
    const i = name.indexOf('.');
    return [name.slice(0, i), name.slice(i + 1)];
  }
  return ['helicode', name];
}

function getOption(cx: CommandContext, name: string): unknown {
  const [section, key] = optionTarget(name);
  return vscode.workspace.getConfiguration(section, cx.vs.document).get(key);
}

function parseValue(v: string): unknown {
  if (v === 'true') return true;
  if (v === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  try {
    return JSON.parse(v);
  } catch {
    return v.replace(/^"(.*)"$/, '$1');
  }
}

async function setOption(cx: CommandContext, name: string, value: string): Promise<void> {
  const [section, key] = optionTarget(name);
  let v = parseValue(value);
  // Friendly translations for booleans on VS Code enums.
  if (section === 'editor' && key === 'wordWrap' && typeof v === 'boolean') v = v ? 'on' : 'off';
  if (section === 'editor' && key === 'lineNumbers' && typeof v === 'string') v = v === 'relative' ? 'relative' : v === 'absolute' ? 'on' : v;
  await vscode.workspace.getConfiguration(section).update(key, v, vscode.ConfigurationTarget.Global);
  cx.setStatus(`${name} = ${JSON.stringify(v)}`);
}

async function toggleOption(cx: CommandContext, name: string, values: string[]): Promise<void> {
  const [section, key] = optionTarget(name);
  const cur = vscode.workspace.getConfiguration(section, cx.vs.document).get(key);
  let next: unknown;
  if (values.length >= 2) {
    const parsed = values.map(parseValue);
    const idx = parsed.findIndex((p) => JSON.stringify(p) === JSON.stringify(cur));
    next = parsed[(idx + 1) % parsed.length];
  } else if (typeof cur === 'boolean') next = !cur;
  else if (cur === 'on' || cur === 'off') next = cur === 'on' ? 'off' : 'on';
  else if (cur === 'relative' || cur === 'on') next = cur === 'relative' ? 'on' : 'relative';
  else {
    cx.setError(`cannot toggle ${name} (current value: ${JSON.stringify(cur)}); pass explicit values`);
    return;
  }
  await vscode.workspace.getConfiguration(section).update(key, next, vscode.ConfigurationTarget.Global);
  cx.setStatus(`${name} = ${JSON.stringify(next)}`);
}

// ---------------------------------------------------------------------------
// :sort / :reflow
// ---------------------------------------------------------------------------

async function sortSelections(cx: CommandContext, reverse: boolean, insensitive: boolean): Promise<void> {
  const text = cx.doc.text;
  let sel = cx.selection;
  // A single selection is split on newlines first (Helix sorts lines then).
  if (sel.ranges.length === 1) {
    const r = sel.ranges[0];
    const { splitOnNewline } = await import('../core/search');
    sel = splitOnNewline(text, sel);
    // Trim trailing newline from each piece so the sort compares content only.
    sel = mkSelection(
      sel.ranges.map((x) => {
        const t = text.slice(from(x), to(x));
        const trimmed = t.replace(/\r?\n$/, '');
        return mkRange(from(x), from(x) + trimmed.length);
      }),
      0,
    );
    void r;
  }
  const fragments = sel.ranges.map((r) => text.slice(from(r), to(r)));
  const sorted = fragments.slice().sort((a, b) => (insensitive ? a.toLowerCase().localeCompare(b.toLowerCase()) : a < b ? -1 : a > b ? 1 : 0));
  if (reverse) sorted.reverse();
  const changes: Change[] = sel.ranges.map((r, i) => ({ from: from(r), to: to(r), text: sorted[i] }));
  await cx.editor.apply(changes);
  exitSelectMode(cx);
}

async function reflow(cx: CommandContext, width: number): Promise<void> {
  const doc = cx.doc;
  const text = doc.text;
  const changes: Change[] = [];
  for (const r of cx.selection.ranges) {
    const [sl, el] = lineRange(doc, r);
    const start = doc.lineStart(sl);
    const end = lineEnd(doc, el);
    const original = text.slice(start, end);
    const lines = original.split(/\r?\n/);
    const indent = /^[ \t]*/.exec(lines[0])?.[0] ?? '';
    const prefix = /^[ \t]*((?:\/\/|#|;|--|>|\*)+ ?)/.exec(lines[0])?.[1] ?? '';
    const words = lines
      .map((l) => l.replace(/^[ \t]*/, '').replace(prefix ? new RegExp('^' + prefix.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' ?') : /^$/, ''))
      .join(' ')
      .split(/\s+/)
      .filter(Boolean);
    const out: string[] = [];
    let cur = indent + prefix;
    let curLen = cur.length;
    let hasWord = false;
    for (const w of words) {
      if (hasWord && curLen + 1 + w.length > width) {
        out.push(cur);
        cur = indent + prefix + w;
        curLen = cur.length;
      } else {
        cur += (hasWord ? ' ' : '') + w;
        curLen = cur.length;
      }
      hasWord = true;
    }
    out.push(cur);
    const replacement = out.join(doc.eol);
    if (replacement !== original) changes.push({ from: start, to: end, text: replacement });
  }
  await cx.editor.apply(changes);
}

// ---------------------------------------------------------------------------
// Parsing and the command line UI
// ---------------------------------------------------------------------------

export function splitArgs(s: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out.push(m[1] !== undefined ? m[1].replace(/\\(.)/g, '$1') : m[2] !== undefined ? m[2] : m[3]);
  return out;
}

export async function runTypedLine(engine: Engine, line: string, cx: CommandContext): Promise<void> {
  const trimmed = line.trim().replace(/^:+/, '');
  if (!trimmed) return;
  // `:123` -> goto line
  if (/^\d+$/.test(trimmed)) {
    engine.pushJump(cx.editor);
    gotoLineWithoutJumplist(cx, Number(trimmed), cx.extend);
    return;
  }
  const m = /^(\S+?)(!?)(?:\s+([\s\S]*))?$/.exec(trimmed);
  if (!m) return;
  let name = m[1];
  let bang = m[2] === '!';
  const raw = m[3] ?? '';
  // Allow ":w!" style where the bang is part of the name in the table.
  let cmd = byName.get(name + (bang ? '!' : '')) ?? byName.get(name);
  if (!cmd && name.startsWith('!')) {
    cmd = byName.get('!');
    bang = false;
  }
  if (!cmd) {
    engine.setError(`no such command: '${name}'`);
    return;
  }
  const args = splitArgs(raw);
  try {
    await cmd.run(cx, args, bang, raw);
  } catch (e) {
    engine.setError(`${cmd.name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let extensionUri: vscode.Uri | undefined;

export function installCommandLine(engine: Engine, extUri: vscode.Uri): void {
  extensionUri = extUri;
  engine.runTyped = async (line, cx) => {
    if (line.trim()) {
      await runTypedLine(engine, line, cx);
      return;
    }
    await showCommandLine(engine, cx);
  };
}

interface CmdItem extends vscode.QuickPickItem {
  value: string;
  itemKind?: 'history' | 'command';
}

function commandItems(filter: string): CmdItem[] {
  const f = filter.toLowerCase();
  const items: CmdItem[] = [];
  for (const c of commands) {
    const names = [c.name, ...c.aliases];
    if (f && !names.some((n) => n.toLowerCase().startsWith(f))) continue;
    items.push({ label: c.name, description: c.aliases.length ? c.aliases.map((a) => ':' + a).join(' ') : '', detail: c.doc, value: c.name, itemKind: 'command' });
  }
  return items;
}

/** Show the `:` prompt. Enter runs the typed text; selecting an item inserts its name. */
export function showCommandLine(engine: Engine, cx: CommandContext): Promise<void> {
  const history = engine.registers.readSync(':') ?? [];
  return new Promise<void>((resolve) => {
    const qp = vscode.window.createQuickPick<CmdItem>();
    qp.placeholder = ':';
    qp.matchOnDescription = true;
    qp.matchOnDetail = false;
    qp.title = 'Helicode command';
    const historyItems = (): CmdItem[] => history.slice(0, 30).map((h) => ({ label: ':' + h, value: h, itemKind: 'history', description: 'history' }));
    qp.items = [...historyItems(), ...commandItems('')];
    let accepted = false;
    let currentValue = '';
    qp.onDidChangeValue((v) => {
      currentValue = v;
      const first = v.replace(/^:+/, '').split(/\s+/)[0] ?? '';
      const hasArgs = /\s/.test(v.trim());
      if (!v.trim()) qp.items = [...historyItems(), ...commandItems('')];
      else if (!hasArgs) qp.items = [...history.filter((h) => h.startsWith(first)).slice(0, 10).map((h) => ({ label: ':' + h, value: h, itemKind: 'history' as const, description: 'history' })), ...commandItems(first)];
      else {
        const cmd = byName.get(first.replace(/!$/, ''));
        qp.items = cmd ? [{ label: ':' + v.trim(), value: v.trim(), description: cmd.doc, alwaysShow: true }] : [];
        void completeArgs(cmd, v, cx).then((extra) => {
          if (qp.value === v && extra.length) qp.items = [{ label: ':' + v.trim(), value: v.trim(), alwaysShow: true }, ...extra];
        });
      }
    });
    qp.onDidAccept(async () => {
      const active = qp.activeItems[0];
      const typed = qp.value.trim();
      let line: string;
      if (!typed) line = active ? active.value : '';
      else if (active && active.itemKind === 'command' && !/\s/.test(typed) && active.value !== typed.replace(/^:/, '') && typed.replace(/^:/, '').length < active.value.length && !byName.has(typed.replace(/^:/, '').replace(/!$/, ''))) {
        // Complete the command name from the active item when the typed prefix is not itself a command.
        line = active.value;
      } else if (active && active.itemKind === 'history' && !typed) line = active.value;
      else if (active && !active.itemKind && active.value.startsWith(typed.replace(/^:/, ''))) line = active.value;
      else line = typed;
      accepted = true;
      qp.hide();
      if (!line) {
        resolve();
        return;
      }
      await engine.registers.push(':', line.replace(/^:+/, ''));
      const st = engine.active();
      const context = st ? engine.makeContext(st) : cx;
      await runTypedLine(engine, line, context);
      resolve();
    });
    qp.onDidHide(() => {
      if (!accepted) resolve();
      qp.dispose();
    });
    void currentValue;
    qp.show();
  });
}

async function completeArgs(cmd: TypedCommand | undefined, value: string, cx: CommandContext): Promise<CmdItem[]> {
  if (!cmd) return [];
  const parts = value.trim().split(/\s+/);
  const partial = parts.length > 1 ? parts[parts.length - 1] : '';
  const prefix = parts.slice(0, -1).join(' ');
  switch (cmd.completer) {
    case 'file': {
      const base = partial.includes('/') ? partial.slice(0, partial.lastIndexOf('/') + 1) : '';
      const dir = resolveUserPath(base || '.', cx.vs.document.uri);
      try {
        const entries = await vscode.workspace.fs.readDirectory(dir);
        const frag = partial.slice(base.length);
        return entries
          .filter(([n]) => n.startsWith(frag))
          .slice(0, 50)
          .map(([n, t]) => {
            const p = base + n + (t & vscode.FileType.Directory ? '/' : '');
            return { label: `:${prefix} ${p}`, value: `${prefix} ${p}`, description: t & vscode.FileType.Directory ? 'dir' : 'file' };
          });
      } catch {
        return [];
      }
    }
    case 'theme': {
      const themes: string[] = [];
      for (const ext of vscode.extensions.all) {
        const contrib = (ext.packageJSON as { contributes?: { themes?: { label?: string; id?: string }[] } }).contributes?.themes ?? [];
        for (const t of contrib) themes.push(t.id ?? t.label ?? '');
      }
      return themes
        .filter((t) => t && t.toLowerCase().includes(partial.toLowerCase()))
        .slice(0, 50)
        .map((t) => ({ label: `:${prefix} ${t}`, value: `${prefix} ${t}` }));
    }
    case 'language': {
      const langs = await vscode.languages.getLanguages();
      return langs
        .filter((l) => l.startsWith(partial))
        .slice(0, 50)
        .map((l) => ({ label: `:${prefix} ${l}`, value: `${prefix} ${l}` }));
    }
    case 'option':
      return Object.keys(OPTION_MAP)
        .filter((o) => o.startsWith(partial))
        .map((o) => ({ label: `:${prefix} ${o}`, value: `${prefix} ${o}` }));
    default:
      return [];
  }
}
