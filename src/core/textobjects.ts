// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Word / paragraph / pair textobjects (helix-core/src/textobject.rs).
 * Tree-sitter textobjects are in treesitter/objects.ts.
 */
import { Range, range, cursor, cursorLine } from './range';
import { TextDoc, CharCategory, categorize, charAt, charBefore, isWhitespace, lineEndWithEol, lineIsEmpty, nextGraphemeBoundary, prevGraphemeBoundary } from './text';
import { SyntaxMatcher, findNthClosestPairsPos, findNthPairsPos } from './surround';

export const enum TextObject {
  Around,
  Inside,
}

function findWordBoundary(text: string, pos: number, forward: boolean, long: boolean): number {
  let prevCategory: CharCategory;
  if (forward) prevCategory = pos === 0 ? CharCategory.Whitespace : categorize(charBefore(text, pos));
  else prevCategory = pos === text.length ? CharCategory.Whitespace : categorize(charAt(text, pos));

  for (;;) {
    const ch = forward ? charAt(text, pos) : charBefore(text, pos);
    if (!ch) return pos;
    const category = categorize(ch);
    if (category === CharCategory.Eol || category === CharCategory.Whitespace) return pos;
    if (!long && category !== prevCategory && pos !== 0 && pos !== text.length) return pos;
    pos = forward ? pos + ch.length : Math.max(0, pos - ch.length);
    prevCategory = category;
  }
}

export function textobjectWord(text: string, r: Range, obj: TextObject, long: boolean): Range {
  const pos = cursor(text, r);
  const wordStart = findWordBoundary(text, pos, false, long);
  const c = charAt(text, pos);
  const cat = c ? categorize(c) : undefined;
  const wordEnd = cat === undefined || cat === CharCategory.Whitespace || cat === CharCategory.Eol ? pos : findWordBoundary(text, pos + c.length, true, long);

  if (wordStart === wordEnd) return range(wordStart, wordEnd);
  if (obj === TextObject.Inside) return range(wordStart, wordEnd);

  let wsRight = 0;
  for (let i = wordEnd; i < text.length; ) {
    const ch = charAt(text, i);
    if (!isWhitespace(ch)) break;
    wsRight += ch.length;
    i += ch.length;
  }
  if (wsRight > 0) return range(wordStart, wordEnd + wsRight);
  let wsLeft = 0;
  for (let i = wordStart; i > 0; ) {
    const ch = charBefore(text, i);
    if (!isWhitespace(ch)) break;
    wsLeft += ch.length;
    i -= ch.length;
  }
  return range(wordStart - wsLeft, wordEnd);
}

export function textobjectParagraph(doc: TextDoc, r: Range, obj: TextObject, count: number): Range {
  const text = doc.text;
  const empty = (l: number) => lineIsEmpty(doc, l);
  let line = cursorLine(doc, r);
  const prevLineEmpty = empty(Math.max(0, line - 1));
  const currLineEmpty = empty(line);
  const nextLineEmpty = line + 1 >= doc.lineCount || empty(line + 1);
  const lastChar = prevGraphemeBoundary(text, lineEndWithEol(doc, line)) === cursor(text, r);
  const prevEmptyToLine = prevLineEmpty && !currLineEmpty;
  const currEmptyToLine = currLineEmpty && !nextLineEmpty;

  let lineBack = line;
  if (prevEmptyToLine || currEmptyToLine) lineBack += 1;
  if (!(currEmptyToLine && lastChar)) {
    // lines_at(line_back) reversed: iterate lines line_back-1, line_back-2, ...
    let l = lineBack;
    while (l > 0 && empty(l - 1)) {
      l--;
    }
    while (l > 0 && !empty(l - 1)) {
      l--;
    }
    lineBack = l;
  }

  if (currEmptyToLine && lastChar) line += 1;
  let countDone = 0;
  let l = line;
  for (let i = 0; i < count; i++) {
    let done = false;
    while (l < doc.lineCount && !empty(l)) {
      l++;
      done = true;
    }
    while (l < doc.lineCount && empty(l)) l++;
    countDone += done ? 1 : 0;
  }
  line = l;

  const lastParagraph = countDone !== count && line >= doc.lineCount;
  if (lastParagraph) {
    let b = lineBack;
    while (b > 0 && empty(b - 1)) b--;
    while (b > 0 && !empty(b - 1)) b--;
    lineBack = b;
  }

  if (obj === TextObject.Inside) {
    while (line > 0 && empty(line - 1)) line--;
  }

  const anchor = doc.lineStart(lineBack);
  const head = doc.lineStart(line);
  return range(anchor, head);
}

export function textobjectPairSurround(syntax: SyntaxMatcher | undefined, text: string, r: Range, obj: TextObject, ch: string | undefined, count: number): Range {
  let pair: [number, number];
  try {
    pair = ch === undefined ? findNthClosestPairsPos(syntax, text, r, count) : findNthPairsPos(syntax, text, ch, r, count);
  } catch {
    return r;
  }
  const [anchor, head] = pair;
  if (obj === TextObject.Inside) {
    return anchor < head ? range(nextGraphemeBoundary(text, anchor), head) : range(anchor, nextGraphemeBoundary(text, head));
  }
  return anchor < head ? range(anchor, nextGraphemeBoundary(text, head)) : range(nextGraphemeBoundary(text, anchor), head);
}
