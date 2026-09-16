/**
 * View mode (z / Z), window mode (C-w), space mode (pickers, LSP, clipboard,
 * comments) and goto-LSP commands. Most of these map onto VS Code commands.
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { primary, cursor as rangeCursor, from, to } from '../../core/range';
import { vsCommand, vsCommandAndSync, firstVisibleLine, lastVisibleLine, visibleLineCount, exitSelectMode } from './util';
import { Jump } from '../engine';

// ---------------------------------------------------------------------------
// View alignment / scrolling
// ---------------------------------------------------------------------------

function cursorLineOf(cx: CommandContext): number {
  return cx.doc.lineOf(rangeCursor(cx.doc.text, primary(cx.selection)));
}

export const alignViewCenter: CommandFn = (cx) => {
  const line = cursorLineOf(cx);
  cx.vs.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.InCenter);
};

export const alignViewTop: CommandFn = (cx) => {
  const line = cursorLineOf(cx);
  cx.vs.revealRange(new vscode.Range(line, 0, line, 0), vscode.TextEditorRevealType.AtTop);
};

export const alignViewBottom: CommandFn = async (cx) => {
  const line = cursorLineOf(cx);
  const height = visibleLineCount(cx.vs);
  const top = Math.max(0, line - height + 1 + cx.engine.config.scrolloff);
  cx.vs.revealRange(new vscode.Range(top, 0, top, 0), vscode.TextEditorRevealType.AtTop);
};

export const alignViewMiddle: CommandFn = (cx) => {
  // Horizontal centering is not exposed by VS Code; reveal the cursor instead.
  cx.editor.revealCursor();
};

// ---------------------------------------------------------------------------
// Window mode
// ---------------------------------------------------------------------------

export const rotateView: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.focusNextGroup');
export const hsplit: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.splitEditorDown');
export const vsplit: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.splitEditor');
export const hsplitNew: CommandFn = async (cx) => {
  await vsCommand('workbench.action.newGroupBelow');
  await vsCommandAndSync(cx, 'workbench.action.files.newUntitledFile');
};
export const vsplitNew: CommandFn = async (cx) => {
  await vsCommand('workbench.action.newGroupRight');
  await vsCommandAndSync(cx, 'workbench.action.files.newUntitledFile');
};
export const transposeView: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.toggleEditorGroupLayout');
export const wclose: CommandFn = async (cx) => {
  if (vscode.window.tabGroups.all.length > 1) await vsCommandAndSync(cx, 'workbench.action.closeEditorsInGroup');
  else await vsCommandAndSync(cx, 'workbench.action.closeActiveEditor');
};
export const wonly: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.joinAllGroups');
export const jumpViewLeft: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.focusLeftGroup');
export const jumpViewRight: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.focusRightGroup');
export const jumpViewUp: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.focusAboveGroup');
export const jumpViewDown: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.focusBelowGroup');
export const swapViewLeft: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.moveActiveEditorGroupLeft');
export const swapViewRight: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.moveActiveEditorGroupRight');
export const swapViewUp: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.moveActiveEditorGroupUp');
export const swapViewDown: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.moveActiveEditorGroupDown');

function gotoFileSplit(direction: 'down' | 'right'): CommandFn {
  return async (cx) => {
    await vsCommand(direction === 'down' ? 'workbench.action.splitEditorDown' : 'workbench.action.splitEditor');
    await cx.engine.execute('goto_file', { editor: cx.engine.active() });
  };
}
export const gotoFileHsplit = gotoFileSplit('down');
export const gotoFileVsplit = gotoFileSplit('right');

// ---------------------------------------------------------------------------
// Space mode: pickers
// ---------------------------------------------------------------------------

function picker(id: string, command: string, ...args: unknown[]): CommandFn {
  return async (cx) => {
    cx.engine.lastPicker = id;
    await vsCommand(command, ...args);
  };
}

export const filePicker = picker('file', 'workbench.action.quickOpen');
export const filePickerInCurrentDirectory: CommandFn = async (cx) => {
  cx.engine.lastPicker = 'file_current_dir';
  const uri = cx.vs.document.uri;
  const rel = vscode.workspace.asRelativePath(vscode.Uri.joinPath(uri, '..'), false);
  await vsCommand('workbench.action.quickOpen', rel && rel !== '.' && !rel.startsWith('/') ? rel + '/' : '');
};
export const fileExplorer = picker('explorer', 'workbench.view.explorer');
export const fileExplorerInCurrentBufferDirectory = picker('explorer_current', 'workbench.files.action.showActiveFileInExplorer');
export const bufferPicker = picker('buffer', 'workbench.action.showAllEditors');
export const symbolPicker = picker('symbol', 'workbench.action.gotoSymbol');
export const workspaceSymbolPicker = picker('workspace_symbol', 'workbench.action.showAllSymbols');
export const diagnosticsPicker: CommandFn = async (cx) => {
  cx.engine.lastPicker = 'diagnostics';
  await vsCommand('workbench.actions.view.problems');
  await vsCommand('workbench.action.problems.focus');
};
export const workspaceDiagnosticsPicker = picker('workspace_diagnostics', 'workbench.actions.view.problems');
export const changedFilePicker = picker('changed_files', 'workbench.view.scm');
export const commandPalette = picker('command', 'workbench.action.showCommands');

export const lastPicker: CommandFn = async (cx) => {
  const id = cx.engine.lastPicker;
  const map: Record<string, CommandFn> = {
    file: filePicker,
    file_current_dir: filePickerInCurrentDirectory,
    explorer: fileExplorer,
    explorer_current: fileExplorerInCurrentBufferDirectory,
    buffer: bufferPicker,
    symbol: symbolPicker,
    workspace_symbol: workspaceSymbolPicker,
    diagnostics: diagnosticsPicker,
    workspace_diagnostics: workspaceDiagnosticsPicker,
    changed_files: changedFilePicker,
    command: commandPalette,
    jumplist: jumplistPicker,
  };
  const fn = id ? map[id] : undefined;
  if (fn) await fn(cx);
  else cx.setError('No last picker');
};

export const jumplistPicker: CommandFn = async (cx) => {
  cx.engine.lastPicker = 'jumplist';
  const jumps = cx.engine.jumplist.all();
  if (jumps.length === 0) {
    cx.setError('Jumplist is empty');
    return;
  }
  const items = await Promise.all(
    [...jumps].reverse().map(async (j): Promise<vscode.QuickPickItem & { jump: Jump }> => {
      let preview = '';
      let line = 0;
      try {
        const doc = await vscode.workspace.openTextDocument(j.uri);
        const p = primary(j.selection);
        const pos = doc.positionAt(Math.min(p.anchor, p.head));
        line = pos.line + 1;
        preview = doc.lineAt(pos.line).text.trim();
      } catch {
        /* ignore */
      }
      return { label: `${vscode.workspace.asRelativePath(j.uri, false)}:${line}`, description: preview, jump: j };
    }),
  );
  const picked = await vscode.window.showQuickPick(items, { placeHolder: 'Jumplist' });
  if (picked) await cx.engine.gotoJump(picked.jump);
};

// ---------------------------------------------------------------------------
// LSP
// ---------------------------------------------------------------------------

function lsp(command: string, pushJump = false): CommandFn {
  return async (cx) => {
    if (pushJump) cx.engine.pushJump(cx.editor);
    await vsCommandAndSync(cx, command);
  };
}

export const gotoDefinition = lsp('editor.action.revealDefinition', true);
export const gotoDeclaration = lsp('editor.action.revealDeclaration', true);
export const gotoTypeDefinition = lsp('editor.action.goToTypeDefinition', true);
export const gotoReference = lsp('editor.action.goToReferences', true);
export const gotoImplementation = lsp('editor.action.goToImplementation', true);
export const hover = lsp('editor.action.showHover');
export const renameSymbol = lsp('editor.action.rename');
export const codeAction = lsp('editor.action.quickFix');
export const signatureHelp = lsp('editor.action.triggerParameterHints');
export const completion = lsp('editor.action.triggerSuggest');
export const selectReferencesToSymbolUnderCursor: CommandFn = async (cx) => {
  // VS Code's "select all occurrences" is the closest analogue; it operates on the word under the cursor.
  await vsCommandAndSync(cx, 'editor.action.selectHighlights');
};

// ---------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------

export const toggleComments: CommandFn = async (cx) => {
  await vsCommandAndSync(cx, 'editor.action.commentLine');
  exitSelectMode(cx);
};
export const toggleLineComments = toggleComments;
export const toggleBlockComments: CommandFn = async (cx) => {
  await vsCommandAndSync(cx, 'editor.action.blockComment');
  exitSelectMode(cx);
};

// ---------------------------------------------------------------------------
// Debug (DAP) -> VS Code debug commands
// ---------------------------------------------------------------------------

export const dapLaunch = lsp('workbench.action.debug.start');
export const dapRestart = lsp('workbench.action.debug.restart');
export const dapToggleBreakpoint = lsp('editor.debug.action.toggleBreakpoint');
export const dapContinue = lsp('workbench.action.debug.continue');
export const dapPause = lsp('workbench.action.debug.pause');
export const dapStepIn = lsp('workbench.action.debug.stepInto');
export const dapStepOut = lsp('workbench.action.debug.stepOut');
export const dapNext = lsp('workbench.action.debug.stepOver');
export const dapVariables = lsp('workbench.debug.action.focusVariablesView');
export const dapTerminate = lsp('workbench.action.debug.stop');
export const dapEditCondition = lsp('editor.debug.action.editBreakpoint');
export const dapEditLog = lsp('editor.debug.action.addLogPoint');
export const dapSwitchThread = lsp('workbench.debug.action.focusCallStackView');
export const dapSwitchStackFrame = lsp('workbench.debug.action.focusCallStackView');
export const dapEnableExceptions = lsp('workbench.debug.action.focusBreakpointsView');
export const dapDisableExceptions = lsp('workbench.debug.action.focusBreakpointsView');

export { firstVisibleLine, lastVisibleLine, from, to };
