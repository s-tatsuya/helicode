/**
 * `[` / `]` family: diagnostics, VCS changes, tree-sitter objects.
 * (paragraphs and add_newline live in movement.ts / changes.ts)
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { Range, range as mkRange, putCursor, cursor as rangeCursor, primary, Direction, selection as mkSelection } from '../../core/range';
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
// VCS changes (delegated to VS Code's dirty diff)
// ---------------------------------------------------------------------------

export const gotoNextChange: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.editor.nextChange');
export const gotoPrevChange: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.editor.previousChange');
export const gotoFirstChange: CommandFn = async (cx) => {
  await vscode.commands.executeCommand('cursorTop');
  await vsCommandAndSync(cx, 'workbench.action.editor.nextChange');
};
export const gotoLastChange: CommandFn = async (cx) => {
  await vscode.commands.executeCommand('cursorBottom');
  await vsCommandAndSync(cx, 'workbench.action.editor.previousChange');
};

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
