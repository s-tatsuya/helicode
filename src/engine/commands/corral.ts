/**
 * Bridges to the Corral extension (panes, agents, review). Each command is a
 * no-op with a status error when Corral is not installed, so the default
 * keymap can include them safely.
 */
import * as vscode from 'vscode';
import { CommandFn } from '../types';

let known: Set<string> | undefined;

async function corralCommand(id: string, ...args: unknown[]): Promise<boolean> {
  if (!known || !known.has(id)) known = new Set(await vscode.commands.getCommands(true));
  return known.has(id);
}

function corral(id: string, ...args: unknown[]): CommandFn {
  return async (cx) => {
    if (!(await corralCommand(id))) {
      cx.setError(`${id} needs the Corral extension`);
      return;
    }
    await vscode.commands.executeCommand(id, ...args);
  };
}

export const corralNewTerminal = corral('corral.newTerminal');
export const corralSplitDown = corral('corral.splitDown');
export const corralSplitRight = corral('corral.splitRight');
export const corralPickAgent = corral('corral.pickAgent');
export const corralSpawnAgent = corral('corral.spawnAgent');
export const corralPromptAgent = corral('corral.promptAgent');
export const corralAskAgent = corral('corral.askAgentAboutSelection');
export const corralCommentHere = corral('corral.review.commentHere');
export const corralSendReview = corral('corral.review.sendAll');
export const corralReviewChanges = corral('corral.changes.reviewAll');
export const corralNextChange = corral('corral.changes.next');
export const corralPrevChange = corral('corral.changes.prev');
export const corralPopup = corral('corral.popup');
export const corralFocusLastPane = corral('corral.focusLastPane');
export const corralNewWorktree = corral('corral.worktree.new');

/** `:corral <command> [args]` -> the same commands as the `corral` CLI, output in a scratch editor / status line. */
export async function corralCli(cx: Parameters<CommandFn>[0], args: string[]): Promise<void> {
  if (!(await corralCommand('corral.cli'))) {
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
