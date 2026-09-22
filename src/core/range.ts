// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Helix selection model (helix-core/src/selection.rs).
 *
 * A Range is a pair of offsets: `anchor` (where the selection started) and
 * `head` (the moving end). Ranges are half-open [from, to). The *cursor* is
 * the grapheme immediately before `head` when the range is forward, or at
 * `head` when it is backward. Every range is at least one grapheme wide
 * except at the very end of the document (see ensureInvariants).
 */
import { TextDoc, nextGraphemeBoundary, prevGraphemeBoundary, ensureGraphemeBoundaryNext, ensureGraphemeBoundaryPrev } from './text';

export const enum Direction {
  Forward,
  Backward,
}

export interface Range {
  readonly anchor: number;
  readonly head: number;
  /** Remembered visual column for vertical movement (like Helix's old_visual_position). */
  readonly stickyCol?: number;
}

export function range(anchor: number, head: number, stickyCol?: number): Range {
  return stickyCol === undefined ? { anchor, head } : { anchor, head, stickyCol };
}

export function point(offset: number): Range {
  return { anchor: offset, head: offset };
}

export function from(r: Range): number {
  return Math.min(r.anchor, r.head);
}

export function to(r: Range): number {
  return Math.max(r.anchor, r.head);
}

export function len(r: Range): number {
  return to(r) - from(r);
}

export function isEmpty(r: Range): boolean {
  return r.anchor === r.head;
}

export function direction(r: Range): Direction {
  return r.head < r.anchor ? Direction.Backward : Direction.Forward;
}

export function flip(r: Range): Range {
  return { anchor: r.head, head: r.anchor };
}

export function withDirection(r: Range, dir: Direction): Range {
  return direction(r) === dir ? r : flip(r);
}

export function rangesEqual(a: Range, b: Range): boolean {
  return a.anchor === b.anchor && a.head === b.head;
}

/** Offset of the cursor grapheme (see module doc). */
export function cursor(text: string, r: Range): number {
  return r.head > r.anchor ? prevGraphemeBoundary(text, r.head) : r.head;
}

/** Line index of the cursor. */
export function cursorLine(doc: TextDoc, r: Range): number {
  return doc.lineOf(cursor(doc.text, r));
}

/**
 * Moves the cursor to `offset`. When `extend` is false the range collapses to a
 * point (callers usually re-run ensureInvariants / minWidth1 afterwards).
 * Mirrors Range::put_cursor.
 */
export function putCursor(text: string, r: Range, offset: number, extend: boolean): Range {
  if (!extend) return point(offset);
  let anchor = r.anchor;
  if (r.head >= r.anchor && offset < r.anchor) anchor = nextGraphemeBoundary(text, r.anchor);
  else if (r.head < r.anchor && offset >= r.anchor) anchor = prevGraphemeBoundary(text, r.anchor);
  if (anchor <= offset) return { anchor, head: nextGraphemeBoundary(text, offset) };
  return { anchor, head: offset };
}

/** Range::min_width_1 */
export function minWidth1(text: string, r: Range): Range {
  if (r.anchor === r.head) return { anchor: r.anchor, head: nextGraphemeBoundary(text, r.head), stickyCol: r.stickyCol };
  return r;
}

/** Range::grapheme_aligned */
export function graphemeAligned(text: string, r: Range): Range {
  let anchor: number;
  let head: number;
  if (r.anchor === r.head) {
    anchor = head = ensureGraphemeBoundaryPrev(text, r.anchor);
  } else if (r.anchor < r.head) {
    anchor = ensureGraphemeBoundaryPrev(text, r.anchor);
    head = ensureGraphemeBoundaryNext(text, r.head);
  } else {
    anchor = ensureGraphemeBoundaryNext(text, r.anchor);
    head = ensureGraphemeBoundaryPrev(text, r.head);
  }
  return { anchor, head, stickyCol: anchor === r.anchor ? r.stickyCol : undefined };
}

/** (start line, end line) covered by the range; the end excludes a trailing EOL. */
export function lineRange(doc: TextDoc, r: Range): [number, number] {
  const f = from(r);
  const t = isEmpty(r) ? to(r) : Math.max(prevGraphemeBoundary(doc.text, to(r)), f);
  return [doc.lineOf(f), doc.lineOf(t)];
}

export function overlaps(a: Range, b: Range): boolean {
  // Two empty ranges overlap only if equal; otherwise half-open intersection.
  return from(a) === from(b) || (to(a) > from(b) && to(b) > from(a));
}

export function contains(r: Range, offset: number): boolean {
  return offset >= from(r) && offset < to(r);
}

export function fragment(text: string, r: Range): string {
  return text.slice(from(r), to(r));
}

// ---------------------------------------------------------------------------
// Selection: ordered, non-overlapping ranges plus a primary index.
// ---------------------------------------------------------------------------

export interface Selection {
  readonly ranges: readonly Range[];
  readonly primaryIndex: number;
}

export function selection(ranges: readonly Range[], primaryIndex = 0): Selection {
  if (ranges.length === 0) throw new Error('selection must have at least one range');
  return { ranges, primaryIndex: Math.min(Math.max(primaryIndex, 0), ranges.length - 1) };
}

export function single(anchor: number, head: number): Selection {
  return { ranges: [{ anchor, head }], primaryIndex: 0 };
}

export function primary(sel: Selection): Range {
  return sel.ranges[sel.primaryIndex];
}

export function transform(sel: Selection, f: (r: Range, index: number) => Range): Selection {
  return { ranges: sel.ranges.map(f), primaryIndex: sel.primaryIndex };
}

export function transformMany(sel: Selection, f: (r: Range, index: number) => Range[]): Selection {
  const ranges: Range[] = [];
  let primaryIndex = 0;
  sel.ranges.forEach((r, i) => {
    const out = f(r, i);
    if (i === sel.primaryIndex) primaryIndex = ranges.length + Math.max(0, out.length - 1);
    ranges.push(...out);
  });
  if (ranges.length === 0) return sel;
  return selection(ranges, primaryIndex);
}

/** Sorts ranges by `from`, merging overlapping ones (Selection::normalize). */
export function normalize(sel: Selection): Selection {
  if (sel.ranges.length === 1) return sel;
  const indexed = sel.ranges.map((r, i) => ({ r, i }));
  indexed.sort((a, b) => from(a.r) - from(b.r) || a.i - b.i);
  const merged: { r: Range; i: number }[] = [];
  for (const cur of indexed) {
    const last = merged[merged.length - 1];
    if (last && overlaps(last.r, cur.r)) {
      const isPrimary = cur.i === sel.primaryIndex;
      const merged_ = mergeRanges(last.r, cur.r);
      merged[merged.length - 1] = { r: merged_, i: isPrimary ? cur.i : last.i };
    } else {
      merged.push(cur);
    }
  }
  let primaryIndex = merged.findIndex((x) => x.i === sel.primaryIndex);
  if (primaryIndex < 0) primaryIndex = merged.length - 1;
  return { ranges: merged.map((x) => x.r), primaryIndex };
}

function mergeRanges(a: Range, b: Range): Range {
  const f = Math.min(from(a), from(b));
  const t = Math.max(to(a), to(b));
  // Keep the direction of the range that spans further (like Helix's merge).
  return direction(len(a) >= len(b) ? a : b) === Direction.Forward ? { anchor: f, head: t } : { anchor: t, head: f };
}

/**
 * Selection::ensure_invariants: min width 1, grapheme aligned, normalized.
 */
export function ensureInvariants(text: string, sel: Selection): Selection {
  return normalize(transform(sel, (r) => graphemeAligned(text, minWidth1(text, r))));
}

/** Merge all ranges into one (merge_ranges). */
export function mergeAll(sel: Selection): Selection {
  let f = Infinity;
  let t = -Infinity;
  for (const r of sel.ranges) {
    f = Math.min(f, from(r));
    t = Math.max(t, to(r));
  }
  const dir = direction(primary(sel));
  return single(dir === Direction.Forward ? f : t, dir === Direction.Forward ? t : f);
}

/** Merge ranges that touch each other (merge_consecutive_ranges). */
export function mergeConsecutive(sel: Selection): Selection {
  const sorted = normalize(sel);
  const out: Range[] = [];
  let primaryIndex = 0;
  sorted.ranges.forEach((r, i) => {
    const last = out[out.length - 1];
    if (last && to(last) === from(r)) {
      out[out.length - 1] = withDirection({ anchor: from(last), head: to(r) }, direction(last));
      if (i === sorted.primaryIndex) primaryIndex = out.length - 1;
    } else {
      if (i === sorted.primaryIndex) primaryIndex = out.length;
      out.push(r);
    }
  });
  return selection(out, primaryIndex);
}

export function pushRange(sel: Selection, r: Range): Selection {
  return normalize({ ranges: [...sel.ranges, r], primaryIndex: sel.ranges.length });
}

export function replacePrimary(sel: Selection, r: Range): Selection {
  const ranges = sel.ranges.slice();
  ranges[sel.primaryIndex] = r;
  return normalize({ ranges, primaryIndex: sel.primaryIndex });
}

export function selectionsEqual(a: Selection, b: Selection): boolean {
  if (a.ranges.length !== b.ranges.length || a.primaryIndex !== b.primaryIndex) return false;
  for (let i = 0; i < a.ranges.length; i++) if (!rangesEqual(a.ranges[i], b.ranges[i])) return false;
  return true;
}

/** Create a range from tree-sitter-like [start,end) preserving a direction. */
export function fromSpan(start: number, end: number, dir: Direction): Range {
  return dir === Direction.Forward ? { anchor: start, head: end } : { anchor: end, head: start };
}
