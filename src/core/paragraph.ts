// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Paragraph movement (helix-core/src/movement.rs: move_prev_paragraph / move_next_paragraph).
 */
import { Range, range, cursor, cursorLine, putCursor } from './range';
import { TextDoc, lineEndWithEol, lineIsEmpty, prevGraphemeBoundary } from './text';

export function movePrevParagraph(doc: TextDoc, r: Range, count: number, extend: boolean): Range {
  const text = doc.text;
  const empty = (l: number) => lineIsEmpty(doc, l);
  let line = cursorLine(doc, r);
  const firstChar = doc.lineStart(line) === cursor(text, r);
  const prevLineEmpty = empty(Math.max(0, line - 1));
  const currLineEmpty = empty(line);
  const prevEmptyToLine = prevLineEmpty && !currLineEmpty;

  if (prevEmptyToLine && !firstChar) line += 1;
  let lastLine = line;
  for (let i = 0; i < count; i++) {
    while (line > 0 && empty(line - 1)) line--;
    while (line > 0 && !empty(line - 1)) line--;
    if (line === lastLine) break;
    lastLine = line;
  }
  const head = doc.lineStart(line);
  let anchor: number;
  if (!extend) anchor = prevEmptyToLine && firstChar ? cursor(text, r) : r.head;
  else anchor = putCursor(text, r, head, true).anchor;
  return range(anchor, head);
}

export function moveNextParagraph(doc: TextDoc, r: Range, count: number, extend: boolean): Range {
  const text = doc.text;
  const empty = (l: number) => lineIsEmpty(doc, l);
  let line = cursorLine(doc, r);
  const lastChar = prevGraphemeBoundary(text, lineEndWithEol(doc, line)) === cursor(text, r);
  const currLineEmpty = empty(line);
  const nextLineEmpty = empty(Math.min(doc.lineCount - 1, line + 1));
  const currEmptyToLine = currLineEmpty && !nextLineEmpty;

  if (currEmptyToLine && lastChar) line += 1;
  let lastLine = line;
  for (let i = 0; i < count; i++) {
    while (line < doc.lineCount && !empty(line)) line++;
    while (line < doc.lineCount && empty(line)) line++;
    if (line === lastLine) break;
    lastLine = line;
  }
  const head = doc.lineStart(line);
  let anchor: number;
  if (!extend) anchor = currEmptyToLine && lastChar ? r.head : cursor(text, r);
  else anchor = putCursor(text, r, head, true).anchor;
  return range(anchor, head);
}
