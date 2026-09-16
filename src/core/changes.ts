/**
 * Minimal transaction model: a sorted list of non-overlapping replacements
 * applied atomically, plus offset mapping so selections can be recomputed
 * after the edit (Helix's Transaction / ChangeSet).
 */
import { Range, Selection, selection } from './range';

export interface Change {
  /** Start offset in the *original* text. */
  readonly from: number;
  /** End offset (exclusive) in the original text. */
  readonly to: number;
  /** Replacement text (empty string deletes). */
  readonly text: string;
}

export const enum Assoc {
  Before,
  After,
}

/** Sort and validate changes; throws if any overlap. */
export function normalizeChanges(changes: readonly Change[]): Change[] {
  const sorted = changes.filter((c) => c.from !== c.to || c.text.length > 0).slice().sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].from < sorted[i - 1].to) throw new Error(`overlapping changes at ${sorted[i].from}`);
  }
  // Drop exact duplicates (e.g. two cursors producing the same insertion).
  const out: Change[] = [];
  for (const c of sorted) {
    const last = out[out.length - 1];
    if (last && last.from === c.from && last.to === c.to && last.text === c.text) continue;
    out.push(c);
  }
  return out;
}

/** Apply changes to a string (used by tests and shell/pipe helpers). */
export function applyChanges(text: string, changes: readonly Change[]): string {
  const sorted = normalizeChanges(changes);
  let out = '';
  let pos = 0;
  for (const c of sorted) {
    out += text.slice(pos, c.from) + c.text;
    pos = c.to;
  }
  return out + text.slice(pos);
}

/**
 * Map an offset from the original text through `changes` (which must be
 * normalized). `assoc` decides which side a position exactly at an insertion
 * point sticks to.
 */
export function mapOffset(offset: number, changes: readonly Change[], assoc: Assoc): number {
  let delta = 0;
  for (const c of changes) {
    if (c.from > offset) break;
    const growth = c.text.length - (c.to - c.from);
    if (c.to <= offset) {
      if (c.to === offset && c.from === offset && assoc === Assoc.Before) {
        // pure insertion exactly at offset: Before keeps offset in front of it
        return offset + delta;
      }
      delta += growth;
      continue;
    }
    // offset is inside the replaced span (from <= offset < to)
    if (assoc === Assoc.Before) return c.from + delta;
    return c.from + delta + c.text.length;
  }
  return offset + delta;
}

/** Map a whole selection through changes, keeping directions. */
export function mapSelection(sel: Selection, changes: readonly Change[]): Selection {
  return selection(
    sel.ranges.map((r) => mapRange(r, changes)),
    sel.primaryIndex,
  );
}

export function mapRange(r: Range, changes: readonly Change[]): Range {
  if (r.anchor === r.head) {
    const p = mapOffset(r.anchor, changes, Assoc.After);
    return { anchor: p, head: p };
  }
  if (r.anchor < r.head) {
    return { anchor: mapOffset(r.anchor, changes, Assoc.After), head: mapOffset(r.head, changes, Assoc.Before) };
  }
  return { anchor: mapOffset(r.anchor, changes, Assoc.Before), head: mapOffset(r.head, changes, Assoc.After) };
}

/**
 * Helper for the very common "replace each range with something" pattern.
 * `f` receives the range and returns the replacement (or undefined to skip).
 * Returns the changes and the *new* ranges (positioned over the inserted
 * text), computed with running offsets exactly like Helix's
 * `Transaction::change_by_selection`.
 */
export function changeBySelection(
  sel: Selection,
  f: (r: Range, index: number) => { from: number; to: number; text: string } | undefined,
): { changes: Change[]; ranges: Range[] } {
  const changes: Change[] = [];
  const ranges: Range[] = [];
  let offset = 0;
  const order = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => Math.min(a.r.anchor, a.r.head) - Math.min(b.r.anchor, b.r.head));
  const newByIndex: Range[] = new Array(sel.ranges.length);
  for (const { r, i } of order) {
    const c = f(r, i);
    if (!c) {
      newByIndex[i] = mapRangeWithDelta(r, offset);
      continue;
    }
    changes.push(c);
    const start = c.from + offset;
    const end = start + c.text.length;
    newByIndex[i] = r.head < r.anchor ? { anchor: end, head: start } : { anchor: start, head: end };
    offset += c.text.length - (c.to - c.from);
  }
  for (const r of newByIndex) ranges.push(r);
  return { changes, ranges };
}

function mapRangeWithDelta(r: Range, delta: number): Range {
  return { anchor: r.anchor + delta, head: r.head + delta };
}

/** Compute the edit describing `oldText` -> `newText` (single diff hunk). */
export function diffChange(oldText: string, newText: string): Change | undefined {
  if (oldText === newText) return undefined;
  let start = 0;
  const minLen = Math.min(oldText.length, newText.length);
  while (start < minLen && oldText.charCodeAt(start) === newText.charCodeAt(start)) start++;
  let endOld = oldText.length;
  let endNew = newText.length;
  while (endOld > start && endNew > start && oldText.charCodeAt(endOld - 1) === newText.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, text: newText.slice(start, endNew) };
}
