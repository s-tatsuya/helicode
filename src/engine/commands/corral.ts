/**
 * Bridges to the Corral extension (panes, agents, review, worktrees). Each
 * command is a no-op with a status error when Corral is not installed, so the
 * default keymap can include them safely.
 *
 * The bindings mirror Corral's own prefix table (`ctrl+b <key>`), so `Ctrl-w`
 * in Helicode and the Corral prefix drive the same pane grid with the same
 * letters. Keys Helix already defines (`s`, `v`, `h j k l`, `H J K L`, `w`,
 * `q`, `o`, `t`, `n`, `f`) keep their Helix meaning and are implemented by
 * Helicode itself; everything else in the table is forwarded to Corral.
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';

let known: Set<string> | undefined;

/** Refresh the command cache (Corral may be installed while we run). */
export function resetCorralCache(): void {
  known = undefined;
}

async function hasCommand(id: string): Promise<boolean> {
  if (!known || !known.has(id)) known = new Set(await vscode.commands.getCommands(true));
  return known.has(id);
}

/** True when the Corral extension is present. */
export async function corralAvailable(): Promise<boolean> {
  return hasCommand('corral.newTerminal');
}

function corral(id: string, ...args: unknown[]): CommandFn {
  return async (cx) => {
    if (!(await hasCommand(id))) {
      cx.setError(`${id} needs the Corral extension (https://github.com/s-tatsuya/corral)`);
      return;
    }
    await vscode.commands.executeCommand(id, ...args);
  };
}

/**
 * A Corral command with a plain VS Code fallback: without Corral the pane grid
 * is still driven with the built-in editor-group commands, so `Ctrl-w` keeps
 * working the same way.
 */
function corralOr(id: string, fallback: string, ...args: unknown[]): CommandFn {
  return async (cx) => {
    const target = (await hasCommand(id)) ? id : fallback;
    await vscode.commands.executeCommand(target, ...args);
    await new Promise((r) => setTimeout(r, 0));
    const st = cx.engine.active();
    st?.syncFromVscode();
    st?.decorate();
  };
}

// ---- panes (Corral prefix: c s v z = x q o 1-8 n p , / ; e r R) -----------
export const corralNewTerminal = corral('corral.newTerminal');
export const corralSplitDown = corral('corral.splitDown');
export const corralSplitRight = corral('corral.splitRight');
export const corralZoomPane = corralOr('corral.zoomPane', 'workbench.action.toggleMaximizeEditorGroup');
export const corralEvenPanes = corralOr('corral.evenPanes', 'workbench.action.evenEditorWidths');
export const corralClosePane = corralOr('corral.closePane', 'workbench.action.closeEditorsInGroup');
export const corralOnlyPane = corralOr('corral.onlyPane', 'workbench.action.joinAllGroups');
export const corralFocusLastPane = corral('corral.focusLastPane');
export const corralFocusView = corral('corral.focusView');
export const corralApplyLayout = corral('corral.applyLayout');
export const corralSaveLayout = corral('corral.saveLayout');
export const corralShowKeymap = corral('corral.showKeymap');
export const corralRenameTerminal = corralOr('corral.renameTerminal', 'workbench.action.terminal.rename');
export const corralOpenSelectedPath = corral('corral.openSelectedPath');

/** `Ctrl-w 1` .. `Ctrl-w 8`: focus pane N (tmux/Corral numbering). */
const FOCUS_GROUP = [
  'workbench.action.focusFirstEditorGroup',
  'workbench.action.focusSecondEditorGroup',
  'workbench.action.focusThirdEditorGroup',
  'workbench.action.focusFourthEditorGroup',
  'workbench.action.focusFifthEditorGroup',
  'workbench.action.focusSixthEditorGroup',
  'workbench.action.focusSeventhEditorGroup',
  'workbench.action.focusEighthEditorGroup',
];

export function focusPane(n: number): CommandFn {
  return async (cx) => {
    const id = FOCUS_GROUP[n - 1];
    if (!id) return;
    await vscode.commands.executeCommand(id);
    await new Promise((r) => setTimeout(r, 0));
    const st = cx.engine.active();
    st?.syncFromVscode();
    st?.decorate();
  };
}

export const nextTabInPane: CommandFn = (cx) => runAndSync(cx, 'workbench.action.nextEditorInGroup');
export const prevTabInPane: CommandFn = (cx) => runAndSync(cx, 'workbench.action.previousEditorInGroup');

async function runAndSync(cx: CommandContext, id: string): Promise<void> {
  await vscode.commands.executeCommand(id);
  await new Promise((r) => setTimeout(r, 0));
  const st = cx.engine.active();
  st?.syncFromVscode();
  st?.decorate();
}

// ---- agents (a A i e S) ---------------------------------------------------
export const corralPickAgent = corral('corral.pickAgent');
export const corralSpawnAgent = corral('corral.spawnAgent');
export const corralPromptAgent = corral('corral.promptAgent');
export const corralAskAgent = corral('corral.askAgentAboutSelection');
export const corralAcpSession = corral('corral.acpNewSession');
export const corralRestartAgent = corral('corral.restartAgent');

// ---- review and changes (m D d ] [ ) --------------------------------------
export const corralCommentHere = corral('corral.review.commentHere');
export const corralSendReview = corral('corral.review.sendAll');
export const corralFixThis = corral('corral.review.fixThis');
export const corralResolveThread = corral('corral.review.resolve');
export const corralReviewChanges = corral('corral.changes.reviewAll');
export const corralNextChange = corral('corral.changes.next');
export const corralPrevChange = corral('corral.changes.prev');
export const corralChangeBaseline = corral('corral.changes.setBaseline');
export const corralOpenDiff = corral('corral.changes.openDiff');

// ---- popups (P g) ---------------------------------------------------------
export const corralPopup = corral('corral.popup');
export const corralLazygit = corral('corral.popup', { command: 'lazygit' });

// ---- worktrees (W) --------------------------------------------------------
export const corralNewWorktree = corral('corral.worktree.new');
export const corralOpenWorktree = corral('corral.worktree.open');
export const corralReviewWorktree = corral('corral.worktree.review');
export const corralMergeWorktree = corral('corral.worktree.merge');
export const corralRemoveWorktree = corral('corral.worktree.remove');

/** `:corral <command> [args]` -> the same commands as the `corral` CLI, output in a scratch editor / status line. */
export async function corralCli(cx: CommandContext, args: string[]): Promise<void> {
  if (!(await hasCommand('corral.cli'))) {
    cx.setError(':corral needs the Corral extension');
    return;
  }
  if (args.length === 0) {
    cx.setError('usage: :corral <command> [args...]   (e.g. :corral panes, :corral review, :corral send claude "run the tests")');
    return;
  }
  const out = (await vscode.commands.executeCommand('corral.cli', ...args)) as string | undefined;
  const text = (out ?? '').trim();
  if (!text) {
    cx.setStatus(`corral ${args[0]}: ok`);
    return;
  }
  if (text.split('\n').length === 1 && text.length < 120) {
    cx.setStatus(text);
    return;
  }
  const doc = await vscode.workspace.openTextDocument({ content: text, language: text.startsWith('{') || text.startsWith('[') ? 'json' : 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
}
