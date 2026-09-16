import { test } from 'node:test';
import assert from 'node:assert/strict';
import { StringDoc, nextGraphemeBoundary, prevGraphemeBoundary, categorize, CharCategory, lineEnd } from '../src/core/text';
import { range, point, cursor, putCursor, ensureInvariants, selection, normalize, lineRange, from, to } from '../src/core/range';
import { moveNextWordStart, moveNextWordEnd, movePrevWordStart, moveNextLongWordStart, moveNextSubWordStart } from '../src/core/words';
import { textobjectWord, textobjectParagraph, textobjectPairSurround, TextObject } from '../src/core/textobjects';
import { findNthPairsPos, getSurroundPos, findNthChar } from '../src/core/surround';
import { findMatchingBracketPlaintext } from '../src/core/brackets';
import { applyChanges, mapOffset, Assoc, changeBySelection } from '../src/core/changes';
import { buildRegex, selectOnMatches, splitOnMatches, searchNext, selectionToRegex } from '../src/core/search';
import { increment } from '../src/core/increment';
import { parseKey, formatKey } from '../src/core/keys';
import { moveNextParagraph, movePrevParagraph } from '../src/core/paragraph';
import { Direction } from '../src/core/range';
import { buildTrie } from '../src/engine/keymap';
import { defaultKeymaps } from '../src/engine/defaults';

test('graphemes: ascii, crlf, emoji, combining', () => {
  const t = 'a\r\nb👍🏽ćd';
  assert.equal(nextGraphemeBoundary(t, 0), 1);
  assert.equal(nextGraphemeBoundary(t, 1), 3); // CRLF is one grapheme
  assert.equal(nextGraphemeBoundary(t, 4), 8); // thumbs up + skin tone
  assert.equal(nextGraphemeBoundary(t, 8), 10); // c + combining acute
  assert.equal(prevGraphemeBoundary(t, 3), 1);
  assert.equal(prevGraphemeBoundary(t, 8), 4);
  assert.equal(prevGraphemeBoundary(t, 10), 8);
});

test('categorize', () => {
  assert.equal(categorize('a'), CharCategory.Word);
  assert.equal(categorize('_'), CharCategory.Word);
  assert.equal(categorize('漢'), CharCategory.Word);
  assert.equal(categorize('.'), CharCategory.Punctuation);
  assert.equal(categorize('$'), CharCategory.Punctuation);
  assert.equal(categorize(' '), CharCategory.Whitespace);
  assert.equal(categorize('\n'), CharCategory.Eol);
});

test('range cursor / putCursor / invariants', () => {
  const t = 'hello world';
  assert.equal(cursor(t, range(0, 1)), 0);
  assert.equal(cursor(t, range(3, 1)), 1);
  assert.deepEqual(putCursor(t, range(0, 1), 4, true), range(0, 5));
  // extending backwards past the anchor flips it around the anchor grapheme
  assert.deepEqual(putCursor(t, range(2, 3), 0, true), range(3, 0));
  const sel = ensureInvariants(t, selection([point(3), range(5, 5)]));
  assert.deepEqual(sel.ranges.map((r) => [r.anchor, r.head]), [
    [3, 4],
    [5, 6],
  ]);
  // overlapping ranges merge
  const merged = normalize(selection([range(0, 4), range(2, 6)], 1));
  assert.equal(merged.ranges.length, 1);
  assert.deepEqual([from(merged.ranges[0]), to(merged.ranges[0])], [0, 6]);
});

test('word motions match Helix semantics', () => {
  const t = 'Lorem ipsum_dolor sit.amet\n\nconsectetur';
  // w from start selects "Lorem " (word + trailing whitespace)
  let r = moveNextWordStart(t, range(0, 1), 1);
  assert.deepEqual([r.anchor, r.head], [0, 6]);
  // e selects to end of word
  r = moveNextWordEnd(t, range(0, 1), 1);
  assert.deepEqual([r.anchor, r.head], [0, 5]);
  // punctuation is its own word class
  r = moveNextWordStart(t, range(18, 19), 1); // on 's' of sit
  assert.deepEqual([r.anchor, r.head], [18, 21]);
  r = moveNextWordStart(t, range(21, 22), 1); // on '.': boundary is immediate, so the next word is selected
  assert.deepEqual([r.anchor, r.head], [22, 26]);
  r = moveNextWordStart(t, range(20, 21), 1); // on 't' of sit: selects the '.'
  assert.deepEqual([r.anchor, r.head], [21, 22]);
  // W treats sit.amet as one long word
  r = moveNextLongWordStart(t, range(18, 19), 1);
  assert.deepEqual([r.anchor, r.head], [18, 26]);
  // b goes back to word start
  r = movePrevWordStart(t, range(9, 10), 1);
  assert.deepEqual([r.anchor, r.head], [10, 6]);
  // counts
  r = moveNextWordStart(t, range(0, 1), 2);
  assert.deepEqual([r.anchor, r.head], [6, 18]);
  // sub words
  r = moveNextSubWordStart('fooBarBaz', range(0, 1), 1);
  assert.deepEqual([r.anchor, r.head], [0, 3]);
});

test('word motions skip newlines like Helix', () => {
  const t = 'a\n\nb';
  const r = moveNextWordStart(t, range(0, 1), 1);
  // newlines are skipped and the anchor moves past them, so only "b" is selected
  assert.deepEqual([r.anchor, r.head], [3, 4]);
});

test('textobject word', () => {
  const t = 'cursor at middle of word';
  assert.deepEqual(textobjectWord(t, point(13), TextObject.Inside, false), range(10, 16));
  assert.deepEqual(textobjectWord(t, point(13), TextObject.Around, false), range(10, 17));
  assert.deepEqual(textobjectWord(t, point(6), TextObject.Inside, false), range(6, 6));
});

test('textobject paragraph', () => {
  const doc = new StringDoc('p1 line1\np1 line2\n\n\np2 line1\n');
  const r = textobjectParagraph(doc, point(3), TextObject.Inside, 1);
  assert.deepEqual([r.anchor, r.head], [0, 18]);
  const a = textobjectParagraph(doc, point(3), TextObject.Around, 1);
  assert.deepEqual([a.anchor, a.head], [0, 20]);
});

test('paragraph movement', () => {
  const doc = new StringDoc('a\nb\n\nc\nd\n\ne\n');
  const n = moveNextParagraph(doc, range(0, 1), 1, false);
  assert.equal(n.head, 5);
  const p = movePrevParagraph(doc, range(6, 7), 1, false);
  assert.equal(p.head, 5); // start of the paragraph containing the cursor
  const p2 = movePrevParagraph(doc, range(5, 6), 1, false);
  assert.equal(p2.head, 0); // from a paragraph start, the previous paragraph
});

test('surround pairs', () => {
  const t = 'fn(a, (b), c)';
  assert.deepEqual(findNthPairsPos(undefined, t, '(', range(4, 5), 1), [2, 12]);
  assert.deepEqual(findNthPairsPos(undefined, t, '(', range(7, 8), 1), [6, 8]);
  assert.deepEqual(findNthPairsPos(undefined, t, '(', range(7, 8), 2), [2, 12]);
  assert.deepEqual(getSurroundPos(undefined, t, selection([range(7, 8)]), '(', 1), [6, 8]);
  // closest pair
  assert.deepEqual(textobjectPairSurround(undefined, '[x(y)z]', range(3, 4), TextObject.Inside, undefined, 1), range(3, 4));
  assert.deepEqual(textobjectPairSurround(undefined, '[x(y)z]', range(3, 4), TextObject.Around, undefined, 1), range(2, 5));
  // quotes
  assert.deepEqual(textobjectPairSurround(undefined, 'say "hi there" now', range(6, 7), TextObject.Inside, '"', 1), range(5, 13));
  assert.equal(findNthChar('a-b-c', '-', 0, 2, true), 3);
  assert.equal(findMatchingBracketPlaintext('(a(b)c)', 0), 6);
  assert.equal(findMatchingBracketPlaintext('(a(b)c)', 6), 0);
});

test('changes: apply and offset mapping', () => {
  const t = 'hello world';
  const changes = [
    { from: 0, to: 5, text: 'goodbye' },
    { from: 6, to: 6, text: 'cruel ' },
  ];
  assert.equal(applyChanges(t, changes), 'goodbye cruel world');
  assert.equal(mapOffset(6, changes, Assoc.Before), 8);
  assert.equal(mapOffset(6, changes, Assoc.After), 14);
  assert.equal(mapOffset(11, changes, Assoc.After), 19);
  const { changes: c2, ranges } = changeBySelection(selection([range(0, 2), range(4, 6)]), (r) => ({ from: from(r), to: to(r), text: 'XYZ' }));
  assert.equal(applyChanges('abcdefg', c2), 'XYZcdXYZg');
  assert.deepEqual(ranges.map((r) => [r.anchor, r.head]), [
    [0, 3],
    [5, 8],
  ]);
});

test('search helpers', () => {
  const t = 'foo bar foo baz';
  const re = buildRegex('foo', true);
  const sel = selectOnMatches(t, selection([range(0, t.length)]), re)!;
  assert.deepEqual(sel.ranges.map((r) => [r.anchor, r.head]), [
    [0, 3],
    [8, 11],
  ]);
  const split = splitOnMatches(t, selection([range(0, t.length)]), buildRegex(' ', true));
  assert.equal(split.ranges.length, 4);
  const next = searchNext(t, selection([range(0, 1)]), re, Direction.Forward, false, true)!;
  assert.deepEqual([next.selection.ranges[0].anchor, next.selection.ranges[0].head], [8, 11]);
  const wrapped = searchNext(t, selection([range(8, 11)]), re, Direction.Forward, false, true)!;
  assert.equal(wrapped.wrapped, true);
  assert.equal(selectionToRegex(t, selection([range(4, 7)]), true), '\\bbar\\b');
  // smart case
  assert.equal(buildRegex('Foo', true).flags.includes('i'), false);
  assert.equal(buildRegex('foo', true).flags.includes('i'), true);
});

test('increment', () => {
  assert.equal(increment('41', 1), '42');
  assert.equal(increment('-1', 1), '0');
  assert.equal(increment('007', 1), '008');
  assert.equal(increment('0x0f', 1), '0x10');
  assert.equal(increment('0b11', 1), '0b100');
  assert.equal(increment('1_000', 1), '1_001');
  assert.equal(increment('2024-02-28', 2), '2024-03-01');
  assert.equal(increment('abc', 1), undefined);
});

test('keys', () => {
  assert.deepEqual(parseKey('C-w'), { code: 'w', ctrl: true, alt: false, shift: false });
  assert.deepEqual(parseKey('A-minus'), { code: '-', ctrl: false, alt: true, shift: false });
  assert.deepEqual(parseKey('S-tab'), { code: 'tab', ctrl: false, alt: false, shift: true });
  assert.deepEqual(parseKey('esc'), { code: 'esc', ctrl: false, alt: false, shift: false });
  assert.equal(formatKey(parseKey('A-S-down')), 'A-S-down');
  assert.equal(formatKey(parseKey('space')), 'space');
});

test('keymap trie', () => {
  const { normal, select, insert } = defaultKeymaps();
  assert.equal(normal.get(parseKey('w')), 'move_next_word_start');
  assert.equal(select.get(parseKey('w')), 'extend_next_word_start');
  const g = normal.get(parseKey('g'));
  assert.ok(typeof g !== 'string' && g);
  assert.equal((g as Exclude<typeof g, string | undefined>).get(parseKey('d')), 'goto_definition');
  const sg = select.get(parseKey('g')) as Exclude<typeof g, string | undefined>;
  assert.equal(sg.get(parseKey('g')), 'extend_to_file_start');
  assert.equal(sg.get(parseKey('d')), 'goto_definition'); // merged, not replaced
  assert.equal(insert.get(parseKey('C-w')), 'delete_word_backward');
  const Z = normal.get(parseKey('Z')) as Exclude<typeof g, string | undefined>;
  assert.equal(Z.sticky, true);
  const custom = buildTrie({ 'C-s | C-S-s': ':w' });
  assert.equal(custom.get(parseKey('C-s')), ':w');
});

test('lineRange and lineEnd', () => {
  const doc = new StringDoc('ab\ncd\n');
  assert.equal(lineEnd(doc, 0), 2);
  assert.deepEqual(lineRange(doc, range(0, 3)), [0, 0]);
  assert.deepEqual(lineRange(doc, range(0, 4)), [0, 1]);
});
