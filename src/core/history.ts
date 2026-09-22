// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Helix-style edit history (helix-core/src/history.rs, linear variant).
 *
 * Every revision stores the forward change, its inverse, the selection
 * before and after, and a timestamp. `undo`/`redo` step one revision;
 * `earlier`/`later` accept a step count or a time span ("10s", "1m30s").
 *
 * The document text is only compared at revision boundaries, so one insert
 * session (i -> typing -> Esc) or one command produce exactly one revision,
 * regardless of how the host editor grouped the individual edits.
 */
import { Change, diffChange, mapSelection } from './changes';
import { Selection } from './range';

export interface Revision {
  /** Change from the previous state to this one. */
  readonly change: Change;
  /** Change from this state back to the previous one. */
  readonly inverse: Change;
  readonly selBefore: Selection;
  readonly selAfter: Selection;
  /** Milliseconds (Date.now()). */
  readonly time: number;
}

export type UndoKind = { steps: number } | { ms: number };

export class History {
  /** revisions[0] is the root (no change); revisions[i] leads from state i-1 to state i. */
  private readonly revisions: Revision[];
  /** Index of the current state. */
  current = 0;

  constructor(time = Date.now(), rootSelection: Selection = { ranges: [{ anchor: 0, head: 0 }], primaryIndex: 0 }) {
    const noop: Change = { from: 0, to: 0, text: '' };
    this.revisions = [{ change: noop, inverse: noop, selBefore: rootSelection, selAfter: rootSelection, time }];
  }

  get length(): number {
    return this.revisions.length;
  }

  get atRoot(): boolean {
    return this.current === 0;
  }

  get atHead(): boolean {
    return this.current === this.revisions.length - 1;
  }

  /**
   * Record `before -> after` as a new revision (dropping any redo branch).
   * Returns false when the texts are identical.
   */
  commit(before: string, after: string, selBefore: Selection, selAfter: Selection | undefined, time = Date.now()): boolean {
    const change = diffChange(before, after);
    if (!change) return false;
    const inverse: Change = { from: change.from, to: change.from + change.text.length, text: before.slice(change.from, change.to) };
    this.revisions.length = this.current + 1;
    this.revisions.push({ change, inverse, selBefore, selAfter: selAfter ?? mapSelection(selBefore, [change]), time });
    this.current = this.revisions.length - 1;
    return true;
  }

  /** Revision that `undo` would revert (undefined at the root). */
  peekUndo(): Revision | undefined {
    return this.current > 0 ? this.revisions[this.current] : undefined;
  }

  /** Revision that `redo` would re-apply (undefined at the head). */
  peekRedo(): Revision | undefined {
    return this.current < this.revisions.length - 1 ? this.revisions[this.current + 1] : undefined;
  }

  markUndone(): void {
    if (this.current > 0) this.current--;
  }

  markRedone(): void {
    if (this.current < this.revisions.length - 1) this.current++;
  }

  /**
   * Number of undo steps for `earlier`. With a time span, Helix moves to the
   * last revision whose timestamp is at most `current.time - span`.
   */
  stepsEarlier(kind: UndoKind): number {
    if ('steps' in kind) return Math.min(kind.steps, this.current);
    const target = this.revisions[this.current].time - kind.ms;
    let idx = this.current;
    while (idx > 0 && this.revisions[idx].time > target) idx--;
    return this.current - idx;
  }

  stepsLater(kind: UndoKind): number {
    const last = this.revisions.length - 1;
    if ('steps' in kind) return Math.min(kind.steps, last - this.current);
    const target = this.revisions[this.current].time + kind.ms;
    let idx = this.current;
    while (idx < last && this.revisions[idx + 1].time <= target) idx++;
    return idx - this.current;
  }

  /** Verify that `text` is the state this history believes it is in (cheap check on the last change). */
  matches(text: string): boolean {
    if (this.current === 0) return true;
    const rev = this.revisions[this.current];
    return text.slice(rev.change.from, rev.change.from + rev.change.text.length) === rev.change.text;
  }
}

const UNIT_MS: Record<string, number> = {
  s: 1000,
  sec: 1000,
  secs: 1000,
  second: 1000,
  seconds: 1000,
  m: 60_000,
  min: 60_000,
  mins: 60_000,
  minute: 60_000,
  minutes: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hrs: 3_600_000,
  hour: 3_600_000,
  hours: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
  days: 86_400_000,
};

/**
 * Parse Helix's `:earlier`/`:later` argument: a bare number is a step count,
 * anything like "10s", "1m 30s", "2 hours" is a duration. Returns undefined
 * for invalid input.
 */
export function parseUndoKind(arg: string | undefined): UndoKind | undefined {
  if (arg === undefined || arg.trim() === '') return { steps: 1 };
  const s = arg.trim();
  if (/^\d+$/.test(s)) return { steps: Math.max(1, parseInt(s, 10)) };
  let rest = s.replace(/\s+/g, '');
  let ms = 0;
  while (rest) {
    const m = /^(\d+)([a-zA-Z]+)/.exec(rest);
    if (!m) return undefined;
    const unit = UNIT_MS[m[2].toLowerCase()];
    if (unit === undefined) return undefined;
    ms += parseInt(m[1], 10) * unit;
    rest = rest.slice(m[0].length);
  }
  return ms > 0 ? { ms } : undefined;
}
