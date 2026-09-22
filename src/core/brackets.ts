// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Bracket pairs and plaintext bracket matching (helix-core/src/match_brackets.rs).
 * Tree-sitter aware matching lives in treesitter/nodes.ts and falls back here.
 */
import { charAt, charBefore } from './text';

export const BRACKETS: readonly [string, string][] = [
  ['(', ')'],
  ['{', '}'],
  ['[', ']'],
  ['<', '>'],
  ['‘', '’'],
  ['“', '”'],
  ['«', '»'],
  ['「', '」'],
  ['（', '）'],
];

export const PAIRS: readonly [string, string][] = [...BRACKETS, ['"', '"'], ["'", "'"], ['`', '`'], ['|', '|']];

const MAX_PLAINTEXT_SCAN = 10000;

export function getPair(ch: string): [string, string] {
  for (const p of PAIRS) if (p[0] === ch || p[1] === ch) return p;
  return [ch, ch];
}

export function isOpenBracket(ch: string): boolean {
  return BRACKETS.some((p) => p[0] === ch);
}
export function isCloseBracket(ch: string): boolean {
  return BRACKETS.some((p) => p[1] === ch);
}
export function isValidBracket(ch: string): boolean {
  return BRACKETS.some((p) => p[0] === ch || p[1] === ch);
}
export function isValidPair(ch: string): boolean {
  return PAIRS.some((p) => p[0] === ch || p[1] === ch);
}

/** find_matching_bracket_plaintext: cursor must be on a bracket. */
export function findMatchingBracketPlaintext(text: string, cursorPos: number, limit = MAX_PLAINTEXT_SCAN): number | undefined {
  const bracket = charAt(text, cursorPos);
  if (!bracket || !isValidBracket(bracket)) return undefined;
  const pair = getPair(bracket);
  const matching = pair[0] === bracket ? pair[1] : pair[0];
  const isFwd = isOpenBracket(bracket);
  let openCnt = 1;
  if (isFwd) {
    let i = cursorPos + bracket.length;
    let n = 0;
    while (i < text.length && n < limit) {
      const c = charAt(text, i);
      if (c === bracket) openCnt++;
      else if (c === matching) {
        if (openCnt === 1) return i;
        openCnt--;
      }
      i += c.length;
      n++;
    }
  } else {
    let i = cursorPos;
    let n = 0;
    while (i > 0 && n < limit) {
      const c = charBefore(text, i);
      i -= c.length;
      if (c === bracket) openCnt++;
      else if (c === matching) {
        if (openCnt === 1) return i;
        openCnt--;
      }
      n++;
    }
  }
  return undefined;
}
