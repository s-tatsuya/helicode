/**
 * Text model shared by the pure editing core and the VS Code adapter.
 *
 * All offsets are JS string offsets (UTF-16 code units). Helix works on
 * chars, but VS Code, tree-sitter (web) and JS strings all agree on UTF-16
 * units, so that is the common currency here. Grapheme awareness is layered on
 * top with Intl.Segmenter so multi-unit characters (emoji, combining marks,
 * CRLF) are treated as one cursor position, like Helix does.
 */

export interface TextDoc {
  /** Full document text. Must be cheap to call repeatedly (cache it). */
  readonly text: string;
  readonly length: number;
  readonly lineCount: number;
  /** Line ending used by the document. */
  readonly eol: '\n' | '\r\n';
  /** Offset of the first character of `line`. `line == lineCount` returns `length`. */
  lineStart(line: number): number;
  /** Line index containing `offset`. `offset == length` returns the last line. */
  lineOf(offset: number): number;
}

/** Simple string-backed TextDoc, used for tests and scratch computations. */
export class StringDoc implements TextDoc {
  private readonly starts: number[];
  readonly eol: '\n' | '\r\n';
  constructor(readonly text: string, eol?: '\n' | '\r\n') {
    this.eol = eol ?? (text.includes('\r\n') ? '\r\n' : '\n');
    this.starts = [0];
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.starts.push(i + 1);
    }
  }
  get length(): number {
    return this.text.length;
  }
  get lineCount(): number {
    return this.starts.length;
  }
  lineStart(line: number): number {
    if (line >= this.starts.length) return this.text.length;
    if (line < 0) return 0;
    return this.starts[line];
  }
  lineOf(offset: number): number {
    let lo = 0;
    let hi = this.starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.starts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}

// ---------------------------------------------------------------------------
// Line helpers
// ---------------------------------------------------------------------------

/** Offset just past the last non-EOL character of `line` (where the EOL starts). */
export function lineEnd(doc: TextDoc, line: number): number {
  if (line >= doc.lineCount - 1) return doc.length;
  const next = doc.lineStart(line + 1);
  const t = doc.text;
  let end = next - 1; // skip LF
  if (end > doc.lineStart(line) && t.charCodeAt(end - 1) === 13) end--; // CR
  return Math.max(end, doc.lineStart(line));
}

/** Offset just past the EOL of `line` (== start of the next line, or length). */
export function lineEndWithEol(doc: TextDoc, line: number): number {
  return line >= doc.lineCount - 1 ? doc.length : doc.lineStart(line + 1);
}

export function lineText(doc: TextDoc, line: number): string {
  return doc.text.slice(doc.lineStart(line), lineEnd(doc, line));
}

/** True when a line consists only of its line ending (empty line). */
export function lineIsEmpty(doc: TextDoc, line: number): boolean {
  return lineEnd(doc, line) === doc.lineStart(line);
}

export function lineIsBlank(doc: TextDoc, line: number): boolean {
  return /^\s*$/.test(lineText(doc, line));
}

/** Column of the first non-whitespace char of a line, or undefined when blank. */
export function firstNonWhitespace(doc: TextDoc, line: number): number | undefined {
  const t = lineText(doc, line);
  const m = /\S/.exec(t);
  return m ? m.index : undefined;
}

// ---------------------------------------------------------------------------
// Character categories (mirrors helix-core/src/chars.rs)
// ---------------------------------------------------------------------------

export const enum CharCategory {
  Whitespace,
  Eol,
  Word,
  Punctuation,
  Unknown,
}

const PUNCT_RE = /[\p{Po}\p{Ps}\p{Pe}\p{Pi}\p{Pf}\p{Pc}\p{Pd}\p{Sm}\p{Sc}\p{Sk}]/u;
const WORD_RE = /[\p{L}\p{N}\p{M}_]/u;

export function isLineEnding(ch: string): boolean {
  const c = ch.charCodeAt(0);
  return c === 10 || c === 13 || c === 0x0b || c === 0x0c || c === 0x85 || c === 0x2028 || c === 0x2029;
}

export function isWhitespace(ch: string): boolean {
  const c = ch.charCodeAt(0);
  if (c === 9 || c === 32 || c === 0xa0 || c === 0x180e || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0xfeff) return true;
  return c >= 0x2000 && c <= 0x200b;
}

/** Whitespace including line endings (Rust's char::is_whitespace). */
export function isAnyWhitespace(ch: string): boolean {
  return isWhitespace(ch) || isLineEnding(ch) || ch === ' ';
}

export function isWordChar(ch: string): boolean {
  return ch === '_' || WORD_RE.test(ch);
}

export function isPunctuation(ch: string): boolean {
  return PUNCT_RE.test(ch);
}

export function categorize(ch: string): CharCategory {
  if (isLineEnding(ch)) return CharCategory.Eol;
  if (isWhitespace(ch)) return CharCategory.Whitespace;
  if (isWordChar(ch)) return CharCategory.Word;
  if (isPunctuation(ch)) return CharCategory.Punctuation;
  return CharCategory.Unknown;
}

/** The full code point (as a string) starting at `offset`, handling surrogates. */
export function charAt(text: string, offset: number): string {
  const cp = text.codePointAt(offset);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/** The full code point ending right before `offset`. */
export function charBefore(text: string, offset: number): string {
  if (offset <= 0) return '';
  const lo = text.charCodeAt(offset - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && offset >= 2) {
    const hi = text.charCodeAt(offset - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return text.slice(offset - 2, offset);
  }
  return text[offset - 1];
}

// ---------------------------------------------------------------------------
// Graphemes
// ---------------------------------------------------------------------------

const segmenter: Intl.Segmenter | undefined =
  typeof Intl !== 'undefined' && 'Segmenter' in Intl ? new Intl.Segmenter(undefined, { granularity: 'grapheme' }) : undefined;

const WINDOW = 64;

/**
 * Next grapheme boundary strictly after `offset` (or `length` at the end).
 * Fast path for plain ASCII; falls back to Intl.Segmenter on a small window.
 */
export function nextGraphemeBoundary(text: string, offset: number): number {
  const len = text.length;
  if (offset >= len) return len;
  const c = text.charCodeAt(offset);
  if (c === 13 && offset + 1 < len && text.charCodeAt(offset + 1) === 10) return offset + 2;
  if (c < 0x300 && !(c >= 0xd800 && c <= 0xdfff)) {
    const n = offset + 1;
    if (n >= len) return len;
    const nc = text.charCodeAt(n);
    if (nc < 0x300) return n;
  }
  if (!segmenter) return Math.min(len, offset + (c >= 0xd800 && c <= 0xdbff ? 2 : 1));
  const end = Math.min(len, offset + WINDOW);
  const it = segmenter.segment(text.slice(offset, end))[Symbol.iterator]();
  const first = it.next();
  if (first.done) return offset + 1;
  return offset + first.value.segment.length;
}

/** Previous grapheme boundary strictly before `offset` (or 0). */
export function prevGraphemeBoundary(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset > text.length) offset = text.length;
  const c = text.charCodeAt(offset - 1);
  if (c === 10 && offset >= 2 && text.charCodeAt(offset - 2) === 13) return offset - 2;
  if (c < 0x300 && !(c >= 0xd800 && c <= 0xdfff)) return offset - 1;
  if (!segmenter) return Math.max(0, offset - (c >= 0xdc00 && c <= 0xdfff ? 2 : 1));
  const start = Math.max(0, offset - WINDOW);
  let last = start;
  for (const seg of segmenter.segment(text.slice(start, offset))) {
    last = start + seg.index;
  }
  return last;
}

export function nthNextGraphemeBoundary(text: string, offset: number, n: number): number {
  for (let i = 0; i < n; i++) offset = nextGraphemeBoundary(text, offset);
  return offset;
}

export function nthPrevGraphemeBoundary(text: string, offset: number, n: number): number {
  for (let i = 0; i < n; i++) offset = prevGraphemeBoundary(text, offset);
  return offset;
}

/** Snap `offset` to the nearest boundary at or before it. */
export function ensureGraphemeBoundaryPrev(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  const p = prevGraphemeBoundary(text, offset);
  const n = nextGraphemeBoundary(text, p);
  return n === offset ? offset : p;
}

/** Snap `offset` to the nearest boundary at or after it. */
export function ensureGraphemeBoundaryNext(text: string, offset: number): number {
  if (offset <= 0) return 0;
  if (offset >= text.length) return text.length;
  const p = prevGraphemeBoundary(text, offset);
  const n = nextGraphemeBoundary(text, p);
  return n === offset ? offset : n;
}

/** Split `text` into graphemes (used for replace / counting). */
export function graphemes(text: string): string[] {
  if (!segmenter) return Array.from(text);
  const out: string[] = [];
  for (const s of segmenter.segment(text)) out.push(s.segment);
  return out;
}

// ---------------------------------------------------------------------------
// Visual columns (tabs expanded)
// ---------------------------------------------------------------------------

/** Visual column of `offset` in its line, expanding tabs. */
export function visualColumn(doc: TextDoc, offset: number, tabWidth: number): number {
  const line = doc.lineOf(offset);
  const start = doc.lineStart(line);
  let col = 0;
  const t = doc.text;
  for (let i = start; i < offset; ) {
    const n = nextGraphemeBoundary(t, i);
    if (t.charCodeAt(i) === 9) col = (Math.floor(col / tabWidth) + 1) * tabWidth;
    else col += graphemeWidth(t.slice(i, n));
    i = n;
  }
  return col;
}

/** Offset in `line` at visual column `col` (clamped to line end, excludes EOL). */
export function offsetAtVisualColumn(doc: TextDoc, line: number, col: number, tabWidth: number): number {
  const start = doc.lineStart(line);
  const end = lineEnd(doc, line);
  const t = doc.text;
  let c = 0;
  let i = start;
  while (i < end) {
    const n = nextGraphemeBoundary(t, i);
    const w = t.charCodeAt(i) === 9 ? (Math.floor(c / tabWidth) + 1) * tabWidth - c : graphemeWidth(t.slice(i, n));
    if (c + w > col) return i;
    c += w;
    i = n;
  }
  return end;
}

export function graphemeWidth(g: string): number {
  const cp = g.codePointAt(0) ?? 0;
  // East Asian wide / fullwidth ranges (rough but sufficient for column alignment).
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x1f300 && cp <= 0x1faff) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}
