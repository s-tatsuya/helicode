// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Line diff (Myers) producing Helix-style hunks (helix-vcs/src/diff.rs):
 * `before` and `after` are half-open line ranges in the base and the
 * current text respectively. A pure insertion has an empty `before`, a pure
 * removal an empty `after`.
 */

export interface Hunk {
  readonly beforeStart: number;
  readonly beforeEnd: number;
  readonly afterStart: number;
  readonly afterEnd: number;
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Budget for the Myers search; beyond it the middle is reported as one hunk. */
const MAX_D = 4000;

export function lineHunks(before: string, after: string): Hunk[] {
  return diffLines(splitLines(before), splitLines(after));
}

export function diffLines(a: readonly string[], b: readonly string[]): Hunk[] {
  // Trim common prefix / suffix.
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) start++;
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 && m === 0) return [];
  if (n === 0 || m === 0) return [{ beforeStart: start, beforeEnd: endA, afterStart: start, afterEnd: endB }];

  const ops = myers(a.slice(start, endA), b.slice(start, endB));
  if (!ops) return [{ beforeStart: start, beforeEnd: endA, afterStart: start, afterEnd: endB }];

  // Walk the edit script and group consecutive insert/delete runs into hunks.
  const hunks: Hunk[] = [];
  let i = 0;
  let j = 0;
  let cur: { bs: number; be: number; as: number; ae: number } | undefined;
  const flush = () => {
    if (cur) hunks.push({ beforeStart: cur.bs, beforeEnd: cur.be, afterStart: cur.as, afterEnd: cur.ae });
    cur = undefined;
  };
  for (const op of ops) {
    if (op === 0) {
      flush();
      i++;
      j++;
    } else if (op === -1) {
      if (!cur) cur = { bs: start + i, be: start + i, as: start + j, ae: start + j };
      cur.be++;
      i++;
    } else {
      if (!cur) cur = { bs: start + i, be: start + i, as: start + j, ae: start + j };
      cur.ae++;
      j++;
    }
  }
  flush();
  return hunks;
}

/**
 * Myers O(ND) diff returning an edit script of 0 (equal), -1 (delete from a),
 * +1 (insert from b), or undefined when the budget is exceeded.
 */
function myers(a: readonly string[], b: readonly string[]): number[] | undefined {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max + 1;
  const size = 2 * max + 3;
  let v = new Int32Array(size).fill(0);
  const trace: Int32Array[] = [];
  for (let d = 0; d <= Math.min(max, MAX_D); d++) {
    trace.push(v);
    const next = new Int32Array(v);
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) x = v[offset + k + 1];
      else x = v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(next);
        return backtrack(trace, n, m, offset, d + 1);
      }
    }
    v = next;
  }
  return undefined;
}

function backtrack(trace: Int32Array[], n: number, m: number, offset: number, dEnd: number): number[] {
  const ops: number[] = [];
  let x = n;
  let y = m;
  for (let d = dEnd - 1; d > 0; d--) {
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) prevK = k + 1;
    else prevK = k - 1;
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      ops.push(0);
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) ops.push(1);
      else ops.push(-1);
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    ops.push(0);
    x--;
    y--;
  }
  while (x > 0) {
    ops.push(-1);
    x--;
  }
  while (y > 0) {
    ops.push(1);
    y--;
  }
  return ops.reverse();
}

// ---------------------------------------------------------------------------
// Navigation helpers (helix-vcs diff.rs: next_hunk / prev_hunk / hunk_at)
// ---------------------------------------------------------------------------

/** Index of the first hunk starting after `line` (in the current text). */
export function nextHunk(hunks: readonly Hunk[], line: number): number | undefined {
  for (let i = 0; i < hunks.length; i++) if (hunks[i].afterStart > line) return i;
  return undefined;
}

/** Index of the last hunk ending at or before `line`; a pure removal shown at `line` itself is skipped. */
export function prevHunk(hunks: readonly Hunk[], line: number): number | undefined {
  for (let i = hunks.length - 1; i >= 0; i--) {
    const h = hunks[i];
    if (h.afterEnd <= line && !(h.afterStart === h.afterEnd && h.afterStart === line)) return i;
  }
  return undefined;
}

/** Index of the hunk containing `line` (pure removals count when `includeRemoved`). */
export function hunkAt(hunks: readonly Hunk[], line: number, includeRemoved: boolean): number | undefined {
  for (let i = 0; i < hunks.length; i++) {
    const h = hunks[i];
    if (h.afterStart <= line && line < h.afterEnd) return i;
    if (includeRemoved && h.afterStart === h.afterEnd && h.afterStart === line) return i;
  }
  return undefined;
}
