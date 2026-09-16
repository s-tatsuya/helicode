/**
 * Selection manipulation commands.
 */
import { CommandContext, CommandFn } from '../types';
import {
  Range,
  Selection,
  range as mkRange,
  point,
  putCursor,
  cursor as rangeCursor,
  from,
  to,
  direction,
  withDirection,
  Direction,
  flip,
  lineRange,
  selection as mkSelection,
  primary,
  mergeAll,
  mergeConsecutive,
  transform,
  fragment,
  isEmpty,
  overlaps,
} from '../../core/range';
import { isAnyWhitespace, visualColumn, offsetAtVisualColumn, lineEndWithEol } from '../../core/text';
import { skipWhile, backwardsSkipWhile } from '../../core/words';
import { splitOnNewline } from '../../core/search';
import { transformSelection, tabWidth, exitSelectMode } from './util';

export const selectAll: CommandFn = (cx) => {
  cx.editor.setSelection(mkSelection([mkRange(0, cx.doc.length)]));
};

export const collapseSelection: CommandFn = (cx) => {
  const text = cx.doc.text;
  transformSelection(cx, (r) => point(rangeCursor(text, r)));
};

export const flipSelections: CommandFn = (cx) => transformSelection(cx, (r) => flip(r));

export const ensureSelectionsForward: CommandFn = (cx) => transformSelection(cx, (r) => withDirection(r, Direction.Forward));

export const keepPrimarySelection: CommandFn = (cx) => {
  cx.editor.setSelection(mkSelection([primary(cx.selection)]));
};

export const removePrimarySelection: CommandFn = (cx) => {
  const sel = cx.selection;
  if (sel.ranges.length === 1) {
    cx.setError('no selections remaining');
    return;
  }
  const ranges = sel.ranges.filter((_, i) => i !== sel.primaryIndex);
  cx.editor.setSelection(mkSelection(ranges, Math.min(sel.primaryIndex, ranges.length - 1)));
};

function rotateSelections(cx: CommandContext, dir: Direction): void {
  const sel = cx.selection;
  const n = sel.ranges.length;
  const idx = dir === Direction.Forward ? (sel.primaryIndex + cx.count) % n : (sel.primaryIndex + n - (cx.count % n)) % n;
  cx.editor.setSelection(mkSelection(sel.ranges, idx));
}

export const rotateSelectionsForward: CommandFn = (cx) => rotateSelections(cx, Direction.Forward);
export const rotateSelectionsBackward: CommandFn = (cx) => rotateSelections(cx, Direction.Backward);

async function rotateSelectionContents(cx: CommandContext, dir: Direction): Promise<void> {
  const text = cx.doc.text;
  const sel = cx.selection;
  const fragments = sel.ranges.map((r) => fragment(text, r));
  const n = fragments.length;
  const group = cx.count; // Helix rotates within groups of `count`... keeps it simple: whole list
  void group;
  const rotated = dir === Direction.Forward ? [fragments[n - 1], ...fragments.slice(0, n - 1)] : [...fragments.slice(1), fragments[0]];
  const changes = sel.ranges.map((r, i) => ({ from: from(r), to: to(r), text: rotated[i] }));
  // New ranges: same starts, new lengths.
  let delta = 0;
  const sorted = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => from(a.r) - from(b.r));
  const newRanges: Range[] = new Array(n);
  for (const { r, i } of sorted) {
    const start = from(r) + delta;
    const end = start + rotated[i].length;
    newRanges[i] = direction(r) === Direction.Forward ? mkRange(start, end) : mkRange(end, start);
    delta += rotated[i].length - (to(r) - from(r));
  }
  await cx.editor.apply(changes, { selection: mkSelection(newRanges, sel.primaryIndex) });
}

export const rotateSelectionContentsForward: CommandFn = (cx) => rotateSelectionContents(cx, Direction.Forward);
export const rotateSelectionContentsBackward: CommandFn = (cx) => rotateSelectionContents(cx, Direction.Backward);

export const mergeSelections: CommandFn = (cx) => cx.editor.setSelection(mergeAll(cx.selection));
export const mergeConsecutiveSelections: CommandFn = (cx) => cx.editor.setSelection(mergeConsecutive(cx.selection));

export const splitSelectionOnNewline: CommandFn = (cx) => {
  cx.editor.setSelection(splitOnNewline(cx.doc.text, cx.selection));
};

export const trimSelections: CommandFn = (cx) => {
  const text = cx.doc.text;
  const sel = cx.selection;
  const ranges: Range[] = [];
  for (const r of sel.ranges) {
    if (isEmpty(r)) continue;
    const frag = fragment(text, r);
    if ([...frag].every((c) => isAnyWhitespace(c))) continue;
    let start = from(r);
    let end = to(r);
    start = skipWhile(text, start, isAnyWhitespace) ?? start;
    end = backwardsSkipWhile(text, end, isAnyWhitespace) ?? end;
    ranges.push(withDirection(mkRange(start, end), direction(r)));
  }
  if (ranges.length) {
    const p = primary(sel);
    let idx = ranges.findIndex((r) => overlaps(r, p));
    if (idx < 0) idx = ranges.length - 1;
    cx.editor.setSelection(mkSelection(ranges, idx));
  } else {
    // collapse + keep primary
    const p = primary(sel);
    cx.editor.setSelection(mkSelection([point(rangeCursor(text, p))]));
  }
};

// ---------------------------------------------------------------------------
// Line extension (x / X / Alt-x)
// ---------------------------------------------------------------------------

function extendLineImpl(cx: CommandContext, above: boolean): void {
  const doc = cx.doc;
  const count = cx.count;
  transformSelection(cx, (r) => {
    const [startLine, endLine] = lineRange(doc, r);
    const start = doc.lineStart(startLine);
    const end = doc.lineStart(Math.min(endLine + 1, doc.lineCount));
    let anchor: number;
    let head: number;
    if (from(r) === start && to(r) === end) {
      if (above) {
        anchor = end;
        head = doc.lineStart(Math.max(0, startLine - count));
      } else {
        anchor = start;
        head = doc.lineStart(Math.min(endLine + count + 1, doc.lineCount));
      }
    } else if (above) {
      anchor = end;
      head = doc.lineStart(Math.max(0, startLine - (count - 1)));
    } else {
      anchor = start;
      head = doc.lineStart(Math.min(endLine + count, doc.lineCount));
    }
    return mkRange(anchor, head);
  });
}

export const extendLineBelow: CommandFn = (cx) => extendLineImpl(cx, false);
export const extendLineAbove: CommandFn = (cx) => extendLineImpl(cx, true);
export const extendLine: CommandFn = (cx) => extendLineImpl(cx, false);

export const extendToLineBounds: CommandFn = (cx) => {
  const doc = cx.doc;
  transformSelection(cx, (r) => {
    const [startLine, endLine] = lineRange(doc, r);
    const start = doc.lineStart(startLine);
    const end = doc.lineStart(Math.min(endLine + 1, doc.lineCount));
    return withDirection(mkRange(start, end), direction(r));
  });
};

export const shrinkToLineBounds: CommandFn = (cx) => {
  const doc = cx.doc;
  transformSelection(cx, (r) => {
    const [startLine, endLine] = lineRange(doc, r);
    if (startLine === endLine) return r;
    let start = doc.lineStart(startLine);
    let end = doc.lineStart(Math.min(endLine + 1, doc.lineCount));
    if (start !== from(r)) start = doc.lineStart(Math.min(startLine + 1, doc.lineCount));
    if (end !== to(r)) end = doc.lineStart(endLine);
    return withDirection(mkRange(start, end), direction(r));
  });
};

// ---------------------------------------------------------------------------
// Copy selection to next/prev line (C / Alt-C)
// ---------------------------------------------------------------------------

function copySelectionOnLine(cx: CommandContext, dir: Direction): void {
  const doc = cx.doc;
  const text = doc.text;
  const tw = tabWidth(cx.vs);
  const sel = cx.selection;
  const ranges: Range[] = [];
  let primaryIndex = 0;
  sel.ranges.forEach((r, ri) => {
    const isPrimary = ri === sel.primaryIndex;
    const [head, anchor] = r.anchor < r.head ? [r.head - 1, r.anchor] : [r.head, Math.max(0, r.anchor - 1)];
    const headLine = doc.lineOf(head);
    const anchorLine = doc.lineOf(anchor);
    const headCol = visualColumn(doc, head, tw);
    const anchorCol = visualColumn(doc, anchor, tw);
    const height = Math.max(headLine, anchorLine) - Math.min(headLine, anchorLine) + 1;
    if (isPrimary) primaryIndex = ranges.length;
    ranges.push(r);
    let sels = 0;
    let i = 0;
    while (sels < cx.count) {
      const offset = (i + 1) * height;
      const anchorRow = dir === Direction.Forward ? anchorLine + offset : anchorLine - offset;
      const headRow = dir === Direction.Forward ? headLine + offset : headLine - offset;
      if (anchorRow < 0 || headRow < 0 || anchorRow >= doc.lineCount || headRow >= doc.lineCount) break;
      const a = offsetAtVisualColumn(doc, anchorRow, anchorCol, tw);
      const h = offsetAtVisualColumn(doc, headRow, headCol, tw);
      if (visualColumn(doc, a, tw) === anchorCol && visualColumn(doc, h, tw) === headCol) {
        if (isPrimary) primaryIndex = ranges.length;
        ranges.push(putCursor(text, point(a), h, true));
        sels++;
      }
      if (anchorRow === 0 && headRow === 0) break;
      i++;
    }
  });
  cx.editor.setSelection(mkSelection(ranges, primaryIndex));
}

export const copySelectionOnNextLine: CommandFn = (cx) => copySelectionOnLine(cx, Direction.Forward);
export const copySelectionOnPrevLine: CommandFn = (cx) => copySelectionOnLine(cx, Direction.Backward);

// ---------------------------------------------------------------------------
// Align (&)
// ---------------------------------------------------------------------------

export const alignSelections: CommandFn = async (cx) => {
  const doc = cx.doc;
  const tw = tabWidth(cx.vs);
  const sel = cx.selection;
  const columnWidths: number[] = [];
  const coords: { row: number; col: number }[] = [];
  let previousLine = -1;
  let colIdx = 0;
  let runningOffset = 0;
  for (const r of sel.ranges) {
    const headRow = doc.lineOf(r.head);
    const anchorRow = doc.lineOf(r.anchor);
    if (headRow !== anchorRow) {
      cx.setError('align cannot work with multi line selections');
      return;
    }
    const col = visualColumn(doc, r.head, tw);
    if (headRow !== previousLine) {
      colIdx = 0;
      runningOffset = 0;
      previousLine = headRow;
    }
    const width = col - runningOffset;
    if (columnWidths[colIdx] === undefined) columnWidths.push(width);
    else columnWidths[colIdx] = Math.max(columnWidths[colIdx], width);
    coords.push({ row: headRow, col });
    runningOffset += width;
    colIdx++;
  }
  const columnPositions: number[] = [];
  let sum = 0;
  for (const w of columnWidths) {
    sum += w;
    columnPositions.push(sum);
  }
  previousLine = -1;
  const changes: { from: number; to: number; text: string }[] = [];
  coords.forEach((c, i) => {
    const r = sel.ranges[i];
    if (c.row !== previousLine) {
      colIdx = 0;
      runningOffset = 0;
      previousLine = c.row;
    }
    const inserts = columnPositions[colIdx] - c.col - runningOffset;
    const insertPos = from(r);
    colIdx++;
    runningOffset += inserts;
    if (inserts > 0) changes.push({ from: insertPos, to: insertPos, text: ' '.repeat(inserts) });
  });
  await cx.editor.apply(changes);
  exitSelectMode(cx);
};

export { lineEndWithEol, transform, Selection };
