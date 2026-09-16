/**
 * Key representation.
 *
 * Keys are normalized to Helix's textual notation so the default keymap can be
 * written exactly like helix-term/src/keymap/default.rs:
 *   "a", "A", "C-a", "A-a", "C-A-a", "S-tab", "esc", "ret", "space", "tab",
 *   "backspace", "del", "up", "down", "left", "right", "home", "end",
 *   "pageup", "pagedown", "minus" (== "-"), "ins".
 *
 * A Key is `{ code, ctrl, alt, shift }` where `code` is either a single
 * character (already shifted, e.g. "A" or "$") or a named special key.
 */

export interface Key {
  readonly code: string;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

export const SPECIAL_KEYS = new Set([
  'esc',
  'ret',
  'tab',
  'backspace',
  'del',
  'space',
  'up',
  'down',
  'left',
  'right',
  'home',
  'end',
  'pageup',
  'pagedown',
  'ins',
  'null',
]);

const ALIASES: Record<string, string> = {
  escape: 'esc',
  enter: 'ret',
  return: 'ret',
  delete: 'del',
  insert: 'ins',
  minus: '-',
  lt: '<',
  gt: '>',
  plus: '+',
  semicolon: ';',
  percent: '%',
  bar: '|',
  pipe: '|',
  backslash: '\\',
  quote: "'",
  dquote: '"',
  backtick: '`',
  hash: '#',
  comma: ',',
  period: '.',
  colon: ':',
  slash: '/',
  underscore: '_',
  tilde: '~',
  caret: '^',
  amp: '&',
  ampersand: '&',
  asterisk: '*',
  bang: '!',
  exclamation: '!',
  question: '?',
  at: '@',
  dollar: '$',
  equals: '=',
  equal: '=',
  lparen: '(',
  rparen: ')',
  lbracket: '[',
  rbracket: ']',
  lbrace: '{',
  rbrace: '}',
};

export function key(code: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}): Key {
  return { code, ctrl: !!mods.ctrl, alt: !!mods.alt, shift: !!mods.shift };
}

/** Parse Helix notation ("C-w", "A-S-down", "esc", "a", "minus"). */
export function parseKey(spec: string): Key {
  let s = spec.trim();
  let ctrl = false;
  let alt = false;
  let shift = false;
  // modifiers: prefixes "C-", "A-", "S-" (Helix also accepts "M-" for meta/alt)
  for (;;) {
    if (s.length > 2 && s[1] === '-') {
      const m = s[0];
      if (m === 'C') ctrl = true;
      else if (m === 'A' || m === 'M') alt = true;
      else if (m === 'S') shift = true;
      else break;
      s = s.slice(2);
      continue;
    }
    break;
  }
  const lower = s.toLowerCase();
  if (ALIASES[lower] !== undefined) s = ALIASES[lower];
  else if (SPECIAL_KEYS.has(lower)) s = lower;
  if (s.length !== 1 && !SPECIAL_KEYS.has(s)) {
    // Allow explicit unicode escapes like "U+00E9"? keep simple: treat as literal
    if (/^U\+[0-9a-fA-F]+$/.test(s)) s = String.fromCodePoint(parseInt(s.slice(2), 16));
  }
  // "S-a" means "A" for letters; for specials keep the shift flag.
  if (shift && s.length === 1 && s.toUpperCase() !== s) {
    s = s.toUpperCase();
    shift = false;
  }
  return { code: s, ctrl, alt, shift };
}

/** Format a key in Helix notation (inverse of parseKey). */
export function formatKey(k: Key): string {
  let out = '';
  if (k.ctrl) out += 'C-';
  if (k.alt) out += 'A-';
  if (k.shift) out += 'S-';
  if (k.code === ' ') return out + 'space';
  return out + k.code;
}

export function keyEquals(a: Key, b: Key): boolean {
  return a.code === b.code && a.ctrl === b.ctrl && a.alt === b.alt && a.shift === b.shift;
}

/** The printable character for a plain key press, or undefined. */
export function keyChar(k: Key): string | undefined {
  if (k.ctrl || k.alt) return undefined;
  if (k.code === 'space') return ' ';
  if (k.code === 'tab') return '\t';
  if (k.code.length === 1 || (k.code.length === 2 && /[\ud800-\udbff]/.test(k.code[0]))) return k.code;
  return undefined;
}

/** Keys coming from `type` are plain characters; one Key per code point. */
export function keysFromTyped(text: string): Key[] {
  const out: Key[] = [];
  for (const ch of text) {
    out.push(ch === ' ' ? key('space') : key(ch));
  }
  return out;
}

/** Turn a key into the string a user "typed" for macros/registers. */
export function keyToText(k: Key): string {
  return keyChar(k) ?? (k.code === 'ret' ? '\n' : '');
}
