// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Surround pair discovery (helix-core/src/surround.rs).
 *
 * `SyntaxMatcher` is an optional hook implemented by the tree-sitter layer:
 * when present, the tree-sitter aware algorithms are used, otherwise the
 * plaintext ones.
 */
import { Range, Selection, Direction, direction, from, to, cursor } from './range';
import { charAt, charBefore, nextGraphemeBoundary } from './text';
import { getPair, isCloseBracket, isOpenBracket } from './brackets';
import { findMatchingBracketPlaintext } from './brackets';

export interface SyntaxMatcher {
  /** find_matching_bracket: cursor must be on a bracket char. */
  findMatchingBracket(pos: number): number | undefined;
  /** find_matching_bracket_fuzzy: walks up the tree to find an enclosing pair. */
  findMatchingBracketFuzzy(pos: number): number | undefined;
}

export class SurroundError extends Error {}

export function findNthClosestPairsPos(syntax: SyntaxMatcher | undefined, text: string, r: Range, skip: number): [number, number] {
  return syntax ? findNthClosestPairsTs(syntax, text, r, skip) : findNthClosestPairsPlain(text, r, skip);
}

function findNthClosestPairsTs(syntax: SyntaxMatcher, text: string, r: Range, skip: number): [number, number] {
  let opening = from(r);
  let closing = to(r);
  while (skip > 0) {
    const c = syntax.findMatchingBracketFuzzy(closing);
    if (c === undefined) throw new SurroundError('Surround pair not found around all cursors');
    closing = c;
    const o = syntax.findMatchingBracket(closing);
    if (o === undefined) throw new SurroundError('Surround pair not found around all cursors');
    opening = o;
    if (closing < opening) [opening, closing] = [closing, opening];
    if (from(r) < opening || closing < to(r) - 1) {
      closing = nextGraphemeBoundary(text, closing);
    } else {
      skip -= 1;
      if (skip !== 0) closing = nextGraphemeBoundary(text, closing);
    }
  }
  return direction(r) === Direction.Forward ? [opening, closing] : [closing, opening];
}

function findNthClosestPairsPlain(text: string, r: Range, skip: number): [number, number] {
  const stack: string[] = [];
  const pos = from(r);
  let i = pos;
  while (i < text.length) {
    const ch = charAt(text, i);
    const closePos = i;
    i += ch.length;
    if (isOpenBracket(ch)) {
      stack.push(ch);
      continue;
    }
    if (!isCloseBracket(ch)) continue;
    const [open, close] = getPair(ch);
    if (stack.length && stack[stack.length - 1] === open) {
      stack.pop();
      continue;
    }
    const openPos = findNthOpenPair(text, open, close, closePos, 1);
    if (openPos !== undefined && openPos <= pos + 1 && closePos >= to(r) - 1) {
      if (skip > 1) {
        skip -= 1;
        continue;
      }
      return direction(r) === Direction.Forward ? [openPos, closePos] : [closePos, openPos];
    }
  }
  throw new SurroundError('Surround pair not found around all cursors');
}

export function findNthPairsPos(syntax: SyntaxMatcher | undefined, text: string, ch: string, r: Range, n: number): [number, number] {
  if (text.length < 2) throw new SurroundError('Surround pair not found around all cursors');
  if (to(r) >= text.length + 1) throw new SurroundError('Cursor range exceeds text length');
  const [open, close] = getPair(ch);
  const pos = cursor(text, r);
  let openPos: number | undefined;
  let closePos: number | undefined;
  if (open === close) {
    if (charAt(text, pos) === open) {
      const m = syntax ? syntax.findMatchingBracketFuzzy(pos) : findMatchingBracketPlaintext(text, pos);
      if (m === undefined) throw new SurroundError('Cursor on ambiguous surround pair');
      if (m > pos) {
        openPos = pos;
        closePos = m;
      } else {
        openPos = m;
        closePos = pos;
      }
    } else {
      openPos = findNthChar(text, open, pos, n, false);
      closePos = findNthChar(text, close, pos, n, true);
    }
  } else {
    openPos = findNthOpenPair(text, open, close, pos, n);
    closePos = findNthClosePair(text, open, close, pos, n);
  }
  if (openPos === undefined || closePos === undefined) throw new SurroundError('Surround pair not found around all cursors');
  return direction(r) === Direction.Forward ? [openPos, closePos] : [closePos, openPos];
}

/** search::find_nth_char: nth occurrence of `ch` strictly after/before `pos`. */
export function findNthChar(text: string, ch: string, pos: number, n: number, forward: boolean): number | undefined {
  if (forward) {
    let i = pos;
    let found = 0;
    while (i < text.length) {
      const c = charAt(text, i);
      if (c === ch) {
        found++;
        if (found === n) return i;
      }
      i += c.length;
    }
    return undefined;
  }
  let i = pos;
  let found = 0;
  while (i > 0) {
    const c = charBefore(text, i);
    i -= c.length;
    if (c === ch) {
      found++;
      if (found === n) return i;
    }
  }
  return undefined;
}

function findNthOpenPair(text: string, open: string, close: string, pos: number, n: number): number | undefined {
  if (pos >= text.length) return undefined;
  if (charAt(text, pos) === open) return pos;
  let i = pos;
  for (let k = 0; k < n; k++) {
    let stepOver = 0;
    for (;;) {
      if (i <= 0) return undefined;
      const c = charBefore(text, i);
      i -= c.length;
      if (c === close) stepOver++;
      else if (c === open) {
        if (stepOver === 0) break;
        stepOver--;
      }
    }
  }
  return i;
}

function findNthClosePair(text: string, open: string, close: string, pos: number, n: number): number | undefined {
  if (pos >= text.length) return undefined;
  if (charAt(text, pos) === close) return pos;
  let i = pos + charAt(text, pos).length;
  let found: number | undefined;
  for (let k = 0; k < n; k++) {
    let stepOver = 0;
    for (;;) {
      if (i >= text.length) return undefined;
      const c = charAt(text, i);
      const at = i;
      i += c.length;
      if (c === open) stepOver++;
      else if (c === close) {
        if (stepOver === 0) {
          found = at;
          break;
        }
        stepOver--;
      }
    }
  }
  return found;
}

/** get_surround_pos: flat list [open0, close0, open1, close1, ...] */
export function getSurroundPos(syntax: SyntaxMatcher | undefined, text: string, sel: Selection, ch: string | undefined, skip: number): number[] {
  const out: number[] = [];
  for (const r of sel.ranges) {
    const raw = ch === undefined ? findNthClosestPairsPos(syntax, text, r, skip) : findNthPairsPos(syntax, text, ch, r, skip);
    const o = Math.min(raw[0], raw[1]);
    const c = Math.max(raw[0], raw[1]);
    if (out.includes(o) || out.includes(c)) throw new SurroundError('Cursors overlap for a single surround pair range');
    out.push(o, c);
  }
  return out;
}
