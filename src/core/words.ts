/**
 * Word motions (helix-core/src/movement.rs: word_move / range_to_target).
 */
import { Range, range } from './range';
import { CharCategory, categorize, charAt, charBefore, isAnyWhitespace, isLineEnding, nextGraphemeBoundary, prevGraphemeBoundary } from './text';

export const enum WordTarget {
  NextWordStart,
  NextWordEnd,
  PrevWordStart,
  PrevWordEnd,
  NextLongWordStart,
  NextLongWordEnd,
  PrevLongWordStart,
  PrevLongWordEnd,
  NextSubWordStart,
  NextSubWordEnd,
  PrevSubWordStart,
  PrevSubWordEnd,
}

function isPrevTarget(t: WordTarget): boolean {
  return (
    t === WordTarget.PrevWordStart ||
    t === WordTarget.PrevWordEnd ||
    t === WordTarget.PrevLongWordStart ||
    t === WordTarget.PrevLongWordEnd ||
    t === WordTarget.PrevSubWordStart ||
    t === WordTarget.PrevSubWordEnd
  );
}

function isWordBoundary(a: string, b: string): boolean {
  return categorize(a) !== categorize(b);
}

function isLongWordBoundary(a: string, b: string): boolean {
  const ca = categorize(a);
  const cb = categorize(b);
  if ((ca === CharCategory.Word && cb === CharCategory.Punctuation) || (ca === CharCategory.Punctuation && cb === CharCategory.Word)) return false;
  return ca !== cb;
}

function isLower(ch: string): boolean {
  return ch !== ch.toUpperCase() && ch === ch.toLowerCase();
}
function isUpper(ch: string): boolean {
  return ch !== ch.toLowerCase() && ch === ch.toUpperCase();
}

function isSubWordBoundary(a: string, b: string, forward: boolean): boolean {
  const ca = categorize(a);
  const cb = categorize(b);
  if (ca === CharCategory.Word && cb === CharCategory.Word) {
    if ((a === '_') !== (b === '_')) return true;
    return forward ? isLower(a) && isUpper(b) : isUpper(a) && isLower(b);
  }
  return ca !== cb;
}

function reachedTarget(target: WordTarget, prev: string, next: string): boolean {
  switch (target) {
    case WordTarget.NextWordStart:
    case WordTarget.PrevWordEnd:
      return isWordBoundary(prev, next) && (isLineEnding(next) || !isAnyWhitespace(next));
    case WordTarget.NextWordEnd:
    case WordTarget.PrevWordStart:
      return isWordBoundary(prev, next) && (!isAnyWhitespace(prev) || isLineEnding(next));
    case WordTarget.NextLongWordStart:
    case WordTarget.PrevLongWordEnd:
      return isLongWordBoundary(prev, next) && (isLineEnding(next) || !isAnyWhitespace(next));
    case WordTarget.NextLongWordEnd:
    case WordTarget.PrevLongWordStart:
      return isLongWordBoundary(prev, next) && (!isAnyWhitespace(prev) || isLineEnding(next));
    case WordTarget.NextSubWordStart:
      return isSubWordBoundary(prev, next, true) && (isLineEnding(next) || !(isAnyWhitespace(next) || next === '_'));
    case WordTarget.PrevSubWordEnd:
      return isSubWordBoundary(prev, next, false) && (isLineEnding(next) || !(isAnyWhitespace(next) || next === '_'));
    case WordTarget.NextSubWordEnd:
      return isSubWordBoundary(prev, next, true) && (!(isAnyWhitespace(prev) || prev === '_') || isLineEnding(next));
    case WordTarget.PrevSubWordStart:
      return isSubWordBoundary(prev, next, false) && (!(isAnyWhitespace(prev) || prev === '_') || isLineEnding(next));
  }
}

/**
 * Character iterator over code points that can move in either direction,
 * modelled after ropey's Chars iterator used by Helix (prev()/next() share a
 * cursor between them).
 */
class Chars {
  constructor(
    private readonly text: string,
    public pos: number,
    private reversed = false,
  ) {}
  reverse(): void {
    this.reversed = !this.reversed;
  }
  next(): string | undefined {
    return this.reversed ? this.rawPrev() : this.rawNext();
  }
  prev(): string | undefined {
    return this.reversed ? this.rawNext() : this.rawPrev();
  }
  private rawNext(): string | undefined {
    if (this.pos >= this.text.length) return undefined;
    const ch = charAt(this.text, this.pos);
    this.pos += ch.length;
    return ch;
  }
  private rawPrev(): string | undefined {
    if (this.pos <= 0) return undefined;
    const ch = charBefore(this.text, this.pos);
    this.pos -= ch.length;
    return ch;
  }
}

/** Chars::range_to_target */
function rangeToTarget(text: string, target: WordTarget, origin: Range): Range {
  const isPrev = isPrevTarget(target);
  const it = new Chars(text, origin.head);
  if (isPrev) it.reverse();
  const advance = (idx: number, ch: string): number => (isPrev ? Math.max(0, idx - ch.length) : idx + ch.length);

  let anchor = origin.anchor;
  let head = origin.head;
  let prevCh: string | undefined = (() => {
    const ch = it.prev();
    if (ch !== undefined) it.next();
    return ch;
  })();

  // Skip any initial newline characters.
  for (;;) {
    const ch = it.next();
    if (ch === undefined) break;
    if (isLineEnding(ch)) {
      prevCh = ch;
      head = advance(head, ch);
    } else {
      it.prev();
      break;
    }
  }
  if (prevCh !== undefined && isLineEnding(prevCh)) anchor = head;

  const headStart = head;
  for (;;) {
    const nextCh = it.next();
    if (nextCh === undefined) break;
    if (prevCh === undefined || reachedTarget(target, prevCh, nextCh)) {
      if (head === headStart) anchor = head;
      else break;
    }
    prevCh = nextCh;
    head = advance(head, nextCh);
  }
  return range(anchor, head);
}

/** word_move */
export function wordMove(text: string, r: Range, count: number, target: WordTarget): Range {
  const isPrev = isPrevTarget(target);
  if ((isPrev && r.head === 0) || (!isPrev && r.head === text.length)) return r;

  let start: Range;
  if (isPrev) {
    start = r.anchor < r.head ? range(r.head, prevGraphemeBoundary(text, r.head)) : range(nextGraphemeBoundary(text, r.head), r.head);
  } else {
    start = r.anchor < r.head ? range(prevGraphemeBoundary(text, r.head), r.head) : range(r.head, nextGraphemeBoundary(text, r.head));
  }
  let cur = start;
  for (let i = 0; i < count; i++) {
    const next = rangeToTarget(text, target, cur);
    if (next.anchor === cur.anchor && next.head === cur.head) break;
    cur = next;
  }
  return cur;
}

export const moveNextWordStart = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.NextWordStart);
export const moveNextWordEnd = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.NextWordEnd);
export const movePrevWordStart = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.PrevWordStart);
export const movePrevWordEnd = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.PrevWordEnd);
export const moveNextLongWordStart = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.NextLongWordStart);
export const moveNextLongWordEnd = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.NextLongWordEnd);
export const movePrevLongWordStart = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.PrevLongWordStart);
export const movePrevLongWordEnd = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.PrevLongWordEnd);
export const moveNextSubWordStart = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.NextSubWordStart);
export const moveNextSubWordEnd = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.NextSubWordEnd);
export const movePrevSubWordStart = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.PrevSubWordStart);
export const movePrevSubWordEnd = (t: string, r: Range, n: number) => wordMove(t, r, n, WordTarget.PrevSubWordEnd);

/** Returns first index >= pos whose char does not satisfy `pred`, or undefined. */
export function skipWhile(text: string, pos: number, pred: (ch: string) => boolean): number | undefined {
  let i = pos;
  while (i < text.length) {
    const ch = charAt(text, i);
    if (!pred(ch)) return i;
    i += ch.length;
  }
  return undefined;
}

/** Returns first index <= pos (scanning backwards from pos-1) whose char does not satisfy `pred`. */
export function backwardsSkipWhile(text: string, pos: number, pred: (ch: string) => boolean): number | undefined {
  let i = pos;
  while (i > 0) {
    const ch = charBefore(text, i);
    if (!pred(ch)) return i;
    i -= ch.length;
  }
  return undefined;
}
