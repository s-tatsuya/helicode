// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
import * as vscode from 'vscode';
import { CommandContext } from '../types';
import { Range, Selection, transform, lineRange, from, to, direction, Direction, cursor as rangeCursor } from '../../core/range';
import { Key, keyChar } from '../../core/keys';
import type { KeyEntry } from '../engine';
import { TextDoc } from '../../core/text';

/** Apply `f` to every range and set the result as the selection. */
export function transformSelection(cx: CommandContext, f: (r: Range, index: number) => Range): void {
  cx.editor.setSelection(transform(cx.editor.selection, f));
}

export function exitSelectMode(cx: CommandContext): void {
  if (cx.engine.mode === 'select') cx.engine.setMode('normal');
}

/** Lines covered by the selection (deduplicated, sorted). */
export function selectedLines(doc: TextDoc, sel: Selection): number[] {
  const lines = new Set<number>();
  for (const r of sel.ranges) {
    const [s, e] = lineRange(doc, r);
    for (let l = s; l <= e; l++) lines.add(l);
  }
  return [...lines].sort((a, b) => a - b);
}

/** True if every range spans whole lines. */
export function selectionIsLinewise(doc: TextDoc, sel: Selection): boolean {
  return sel.ranges.every((r) => {
    const f = from(r);
    const t = to(r);
    const [sl, el] = lineRange(doc, r);
    return f === doc.lineStart(sl) && (t === doc.lineStart(el + 1) || (t === doc.length && el === doc.lineCount - 1));
  });
}

/**
 * Wait for the next key and resolve with it (Esc resolves undefined).
 * `entries` are the choices shown in the which-key infobox while waiting.
 */
export function nextKey(cx: CommandContext, hint?: string, entries?: KeyEntry[]): Promise<Key | undefined> {
  if (hint) cx.engine.setNextKeyHint(hint, entries);
  return new Promise((resolve) => {
    cx.onNextKey((k) => {
      resolve(k.code === 'esc' && !k.ctrl && !k.alt ? undefined : k);
    });
  });
}

/** Next key as a character; `ret` maps to the document EOL, `tab` to "\t". */
export async function nextChar(cx: CommandContext, hint?: string, entries?: KeyEntry[]): Promise<string | undefined> {
  const k = await nextKey(cx, hint, entries);
  if (!k) return undefined;
  if (k.code === 'ret' && !k.ctrl && !k.alt) return cx.doc.eol;
  return keyChar(k);
}

export function indentUnit(vs: vscode.TextEditor): string {
  const { insertSpaces, tabSize } = vs.options;
  const size = typeof tabSize === 'number' ? tabSize : 4;
  return insertSpaces === false ? '\t' : ' '.repeat(size);
}

export function tabWidth(vs: vscode.TextEditor): number {
  const { tabSize } = vs.options;
  return typeof tabSize === 'number' ? tabSize : 4;
}

/** Number of visible lines in the editor (approximate for wrapped lines). */
export function visibleLineCount(vs: vscode.TextEditor): number {
  let n = 0;
  for (const r of vs.visibleRanges) n += r.end.line - r.start.line + 1;
  return Math.max(1, n);
}

export function firstVisibleLine(vs: vscode.TextEditor): number {
  return vs.visibleRanges.length ? vs.visibleRanges[0].start.line : 0;
}

export function lastVisibleLine(vs: vscode.TextEditor): number {
  return vs.visibleRanges.length ? vs.visibleRanges[vs.visibleRanges.length - 1].end.line : 0;
}

export function primaryCursor(cx: CommandContext): number {
  const p = cx.selection.ranges[cx.selection.primaryIndex];
  return rangeCursor(cx.doc.text, p);
}

export function keepDirection(r: Range, start: number, end: number): Range {
  return direction(r) === Direction.Forward ? { anchor: start, head: end } : { anchor: end, head: start };
}

/** Execute a VS Code command, swallowing "command not found" errors. */
export async function vsCommand<T = unknown>(command: string, ...args: unknown[]): Promise<T | undefined> {
  try {
    return (await vscode.commands.executeCommand(command, ...args)) as T;
  } catch (e) {
    console.warn('[helicode] command failed', command, e);
    return undefined;
  }
}

/** Run a VS Code command that may move the cursor, then resync the Helix selection. */
export async function vsCommandAndSync(cx: CommandContext, command: string, ...args: unknown[]): Promise<void> {
  await vsCommand(command, ...args);
  await new Promise((r) => setTimeout(r, 0));
  const st = cx.engine.active();
  st?.syncFromVscode();
  st?.decorate();
}
