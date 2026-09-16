/**
 * Regex search helpers (Helix uses the Rust regex crate; we use JS RegExp with
 * the `u`, `m` and `s`-less flags, plus smart-case).
 */
import { Range, Selection, Direction, direction, from, to, primary, range as mkRange, replacePrimary, pushRange, selection, point } from './range';
import { ensureGraphemeBoundaryNext, ensureGraphemeBoundaryPrev, isWordChar, charAt, charBefore } from './text';

export interface SearchConfig {
  smartCase: boolean;
  wrapAround: boolean;
}

/** Build a global, multiline regex. Throws on invalid syntax. */
export function buildRegex(pattern: string, smartCase: boolean): RegExp {
  const caseInsensitive = smartCase ? !/\p{Lu}/u.test(pattern) : false;
  return new RegExp(translatePattern(pattern), 'gm' + (caseInsensitive ? 'i' : '') + 'u');
}

/**
 * Translate a few Rust-regex-isms into JS syntax so muscle memory from Helix
 * keeps working: `(?i)` inline flags are hoisted, `\h` etc. are left alone.
 */
function translatePattern(p: string): string {
  // JS has no inline (?i) at pattern start; strip it (we already handle case via flags).
  return p.replace(/^\(\?i\)/, '');
}

export function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\\/]/g, '\\$&');
}

export interface Match {
  start: number;
  end: number;
}

/** All matches of `re` inside text[start, end). Empty matches are skipped. */
export function findAll(text: string, re: RegExp, start = 0, end = text.length): Match[] {
  const out: Match[] = [];
  const slice = text.slice(start, end);
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(slice)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    out.push({ start: start + m.index, end: start + m.index + m[0].length });
  }
  return out;
}

export function findFirstFrom(text: string, re: RegExp, start: number): Match | undefined {
  re.lastIndex = start;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    return { start: m.index, end: m.index + m[0].length };
  }
  return undefined;
}

export function findLastBefore(text: string, re: RegExp, end: number): Match | undefined {
  const all = findAll(text, re, 0, end);
  return all.length ? all[all.length - 1] : undefined;
}

export interface SearchResult {
  selection: Selection;
  wrapped: boolean;
}

/** search_impl: moves/extends the primary selection to the next match. */
export function searchNext(text: string, sel: Selection, re: RegExp, dir: Direction, extend: boolean, wrapAround: boolean): SearchResult | undefined {
  const prim = primary(sel);
  let mat: Match | undefined;
  let wrapped = false;
  if (dir === Direction.Forward) {
    const start = ensureGraphemeBoundaryNext(text, to(prim));
    mat = findFirstFrom(text, re, start);
    if (!mat && wrapAround) {
      mat = findFirstFrom(text, re, 0);
      wrapped = true;
    }
  } else {
    const start = ensureGraphemeBoundaryPrev(text, from(prim));
    mat = findLastBefore(text, re, start);
    if (!mat && wrapAround) {
      mat = findLastBefore(text, re, text.length);
      wrapped = true;
    }
  }
  if (!mat || mat.end === 0) return undefined;
  const r = direction(prim) === Direction.Forward ? mkRange(mat.start, mat.end) : mkRange(mat.end, mat.start);
  return { selection: extend ? pushRange(sel, r) : replacePrimary(sel, r), wrapped };
}

/** selection::select_on_matches */
export function selectOnMatches(text: string, sel: Selection, re: RegExp): Selection | undefined {
  const ranges: Range[] = [];
  for (const r of sel.ranges) {
    for (const m of findAll(text, re, from(r), to(r))) {
      ranges.push(mkRange(m.start, m.end));
    }
  }
  if (ranges.length === 0) return undefined;
  return selection(ranges, ranges.length - 1);
}

/** selection::split_on_matches */
export function splitOnMatches(text: string, sel: Selection, re: RegExp): Selection {
  const ranges: Range[] = [];
  for (const r of sel.ranges) {
    if (from(r) === to(r)) {
      ranges.push(r);
      continue;
    }
    const s = from(r);
    const e = to(r);
    let start = s;
    for (const m of findAll(text, re, s, e)) {
      ranges.push(mkRange(start, m.start));
      start = m.end;
    }
    if (start < e) ranges.push(mkRange(start, e));
  }
  if (ranges.length === 0) return sel;
  return selection(ranges, ranges.length - 1);
}

/** selection::split_on_newline */
export function splitOnNewline(text: string, sel: Selection): Selection {
  const ranges: Range[] = [];
  for (const r of sel.ranges) {
    if (from(r) === to(r)) {
      ranges.push(r);
      continue;
    }
    const s = from(r);
    const e = to(r);
    let start = s;
    const re = /\r\n|\n/g;
    for (const m of findAll(text, re, s, e)) {
      ranges.push(mkRange(start, m.end));
      start = m.end;
    }
    if (start < e) ranges.push(mkRange(start, e));
  }
  if (ranges.length === 0) return sel;
  return selection(ranges, ranges.length - 1);
}

/** selection::keep_or_remove_matches */
export function keepOrRemoveMatches(text: string, sel: Selection, re: RegExp, remove: boolean): Selection | undefined {
  const ranges = sel.ranges.filter((r) => {
    re.lastIndex = 0;
    const matched = re.test(text.slice(from(r), to(r)));
    return matched !== remove;
  });
  if (ranges.length === 0) return undefined;
  return selection(ranges, 0);
}

/** search_selection_impl: builds the regex for `*` / `Alt-*`. */
export function selectionToRegex(text: string, sel: Selection, detectWordBoundaries: boolean): string {
  const atWordStart = (i: number) => {
    if (i >= text.length) return false;
    const ch = charAt(text, i);
    if (i === 0) return isWordChar(ch);
    return !isWordChar(charBefore(text, i)) && isWordChar(ch);
  };
  const atWordEnd = (i: number) => {
    if (i === 0 || i >= text.length) return false;
    return isWordChar(charBefore(text, i)) && !isWordChar(charAt(text, i));
  };
  const parts = new Set<string>();
  for (const r of sel.ranges) {
    const prefix = detectWordBoundaries && atWordStart(from(r)) ? '\\b' : '';
    const suffix = detectWordBoundaries && atWordEnd(to(r)) ? '\\b' : '';
    parts.add(prefix + escapeRegex(text.slice(from(r), to(r))) + suffix);
  }
  return [...parts].join('|');
}

export { point };
