// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * `[` / `]` family: diagnostics, VCS changes, tree-sitter objects.
 * (paragraphs and add_newline live in movement.ts / changes.ts)
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { Range, range as mkRange, putCursor, cursor as rangeCursor, primary, Direction, selection as mkSelection, withDirection, cursorLine } from '../../core/range';
import { Hunk, nextHunk, prevHunk, hunkAt } from '../../core/diff';
import { documentHunks } from '../../vscode/git';
import { TextDoc } from '../../core/text';
import { getSyntax } from '../../treesitter';
import { transformSelection, vsCommandAndSync } from './util';

// ---------------------------------------------------------------------------
// Diagnostics
// ---------------------------------------------------------------------------

function sortedDiagnostics(cx: CommandContext): { start: number; end: number; d: vscode.Diagnostic }[] {
  const doc = cx.doc;
  return vscode.languages
    .getDiagnostics(cx.vs.document.uri)
    .map((d) => ({ start: doc.offset(d.range.start), end: doc.offset(d.range.end), d }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
}

function gotoDiag(cx: CommandContext, which: 'next' | 'prev' | 'first' | 'last'): void {
  const diags = sortedDiagnostics(cx);
  if (diags.length === 0) {
    cx.setError('No diagnostics');
    return;
  }
  const text = cx.doc.text;
  const p = primary(cx.selection);
  const cur = rangeCursor(text, p);
  let target: { start: number; end: number; d: vscode.Diagnostic } | undefined;
  if (which === 'first') target = diags[0];
  else if (which === 'last') target = diags[diags.length - 1];
  else if (which === 'next') target = diags.find((d) => d.start > cur) ?? (cx.engine.config.wrapAround ? diags[0] : undefined);
  else target = [...diags].reverse().find((d) => d.start < cur) ?? (cx.engine.config.wrapAround ? diags[diags.length - 1] : undefined);
  if (!target) return;
  const r: Range = cx.extend ? putCursor(text, p, target.start, true) : mkRange(target.start, Math.max(target.end, target.start + 1));
  cx.editor.setSelection(mkSelection([r]));
  cx.setStatus(target.d.message.split('\n')[0]);
}

export const gotoNextDiag: CommandFn = (cx) => gotoDiag(cx, 'next');
export const gotoPrevDiag: CommandFn = (cx) => gotoDiag(cx, 'prev');
export const gotoFirstDiag: CommandFn = (cx) => gotoDiag(cx, 'first');
export const gotoLastDiag: CommandFn = (cx) => gotoDiag(cx, 'last');

// ---------------------------------------------------------------------------
// VCS changes (helix-term commands.rs goto_next_change_impl over git HEAD hunks)
// ---------------------------------------------------------------------------

/** Helix `hunk_range`: whole lines of the hunk; a pure removal is a one-char range at its line. */
export function hunkRange(doc: TextDoc, hunk: Hunk): Range {
  const anchor = doc.lineStart(hunk.afterStart);
  if (hunk.afterStart === hunk.afterEnd) return mkRange(anchor, Math.min(anchor + 1, doc.length));
  const head = hunk.afterEnd >= doc.lineCount ? doc.length : doc.lineStart(hunk.afterEnd);
  return mkRange(anchor, head);
}

async function gotoChange(cx: CommandContext, which: 'next' | 'prev' | 'first' | 'last'): Promise<void> {
  const hunks = await documentHunks(cx.vs.document);
  if (hunks === undefined) {
    // Not a git file: fall back to VS Code's dirty-diff navigation.
    if (which === 'first') await vscode.commands.executeCommand('cursorTop');
    if (which === 'last') await vscode.commands.executeCommand('cursorBottom');
    await vsCommandAndSync(cx, which === 'prev' || which === 'last' ? 'workbench.action.editor.previousChange' : 'workbench.action.editor.nextChange');
    return;
  }
  if (hunks.length === 0) {
    cx.setError('No changes');
    return;
  }
  const doc = cx.doc;
  const text = doc.text;
  const count = cx.count;
  const forward = which === 'next' || which === 'last';
  transformSelection(cx, (r) => {
    let idx: number | undefined;
    if (which === 'first') idx = 0;
    else if (which === 'last') idx = hunks.length - 1;
    else {
      const line = cursorLine(doc, r);
      idx = which === 'next' ? nextHunk(hunks, line) : prevHunk(hunks, line);
      if (idx === undefined) return r;
      idx = which === 'next' ? Math.min(idx + count - 1, hunks.length - 1) : Math.max(idx - (count - 1), 0);
    }
    const target = hunkRange(doc, hunks[idx]);
    if (cx.extend) {
      const head = target.head < r.anchor ? target.anchor : target.head;
      return mkRange(r.anchor, head);
    }
    return withDirection(target, forward ? Direction.Forward : Direction.Backward);
  });
  void text;
}

export const gotoNextChange: CommandFn = (cx) => gotoChange(cx, 'next');
export const gotoPrevChange: CommandFn = (cx) => gotoChange(cx, 'prev');
export const gotoFirstChange: CommandFn = (cx) => gotoChange(cx, 'first');
export const gotoLastChange: CommandFn = (cx) => gotoChange(cx, 'last');

/** `mig` / `mag`: the hunk under the cursor (Helix textobject_change; inside == around). */
export async function changeTextobject(cx: CommandContext): Promise<((r: Range) => Range) | undefined> {
  const hunks = await documentHunks(cx.vs.document);
  if (hunks === undefined) {
    cx.setError('textobject `g` needs a file tracked by git');
    return undefined;
  }
  const doc = cx.doc;
  return (r) => {
    const idx = hunkAt(hunks, cursorLine(doc, r), false);
    return idx === undefined ? r : hunkRange(doc, hunks[idx]);
  };
}

// ---------------------------------------------------------------------------
// Tree-sitter object navigation
// ---------------------------------------------------------------------------

function gotoTsObject(objectName: string, dir: Direction): CommandFn {
  return async (cx) => {
    const motion = async (c: CommandContext) => {
      const syntax = await getSyntax(c.vs.document);
      if (!syntax) {
        c.setError('tree-sitter is not available for this document');
        return;
      }
      const text = c.doc.text;
      transformSelection(c, (r) => {
        let last = r;
        for (let i = 0; i < c.count; i++) {
          const span = syntax.gotoObject(rangeCursor(text, last), objectName, dir);
          if (!span) break;
          const next = mkRange(span[0], span[1]);
          if (next.anchor === last.anchor && next.head === last.head) break;
          last = next;
        }
        if (last === r) return r;
        if (c.extend) return putCursor(text, r, rangeCursor(text, last), true);
        return last;
      });
    };
    cx.engine.lastMotion = motion;
    await motion(cx);
  };
}

export const gotoNextFunction = gotoTsObject('function', Direction.Forward);
export const gotoPrevFunction = gotoTsObject('function', Direction.Backward);
export const gotoNextClass = gotoTsObject('class', Direction.Forward);
export const gotoPrevClass = gotoTsObject('class', Direction.Backward);
export const gotoNextParameter = gotoTsObject('parameter', Direction.Forward);
export const gotoPrevParameter = gotoTsObject('parameter', Direction.Backward);
export const gotoNextComment = gotoTsObject('comment', Direction.Forward);
export const gotoPrevComment = gotoTsObject('comment', Direction.Backward);
export const gotoNextTest = gotoTsObject('test', Direction.Forward);
export const gotoPrevTest = gotoTsObject('test', Direction.Backward);
export const gotoNextEntry = gotoTsObject('entry', Direction.Forward);
export const gotoPrevEntry = gotoTsObject('entry', Direction.Backward);
export const gotoNextXmlElement = gotoTsObject('xml-element', Direction.Forward);
export const gotoPrevXmlElement = gotoTsObject('xml-element', Direction.Backward);
