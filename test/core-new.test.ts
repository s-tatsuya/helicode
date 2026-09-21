/**
 * Unit tests for the modules added alongside the Helix history, the git diff
 * navigation and the web/host abstraction.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History, parseUndoKind } from '../src/core/history';
import { diffLines, lineHunks, splitLines, nextHunk, prevHunk, hunkAt } from '../src/core/diff';
import { isAbsolutePath, normalizePath, joinPath, dirname, basename, resolvePath, expandHome } from '../src/core/paths';
import { selection, range } from '../src/core/range';

const sel = (a: number, h: number) => selection([range(a, h)]);

test('history: commit, undo, redo', () => {
  const h = new History(1000, sel(0, 1));
  assert.equal(h.commit('hello', 'hello world', sel(0, 1), sel(11, 11), 1000), true);
  assert.equal(h.commit('hello world', 'hello world', sel(0, 1), undefined, 1001), false, 'no-op is not recorded');
  assert.equal(h.commit('hello world', 'HELLO world', sel(0, 5), sel(0, 5), 1002), true);
  assert.equal(h.length, 3);
  assert.equal(h.atHead, true);

  const rev = h.peekUndo()!;
  assert.equal(rev.change.text, 'HELLO');
  assert.equal(rev.inverse.text, 'hello');
  h.markUndone();
  assert.equal(h.peekRedo()!.change.text, 'HELLO');
  h.markUndone();
  assert.equal(h.atRoot, true);
  assert.equal(h.peekUndo(), undefined);
});

test('history: a new commit drops the redo branch', () => {
  const h = new History(0, sel(0, 1));
  h.commit('a', 'ab', sel(0, 1), sel(2, 2), 1);
  h.commit('ab', 'abc', sel(0, 1), sel(3, 3), 2);
  h.markUndone();
  assert.equal(h.peekRedo()!.change.text, 'c');
  h.commit('ab', 'abX', sel(0, 1), sel(3, 3), 3);
  assert.equal(h.peekRedo(), undefined);
  assert.equal(h.length, 3);
});

test('history: earlier/later by steps and by time', () => {
  const h = new History(0, sel(0, 1));
  h.commit('', 'a', sel(0, 0), sel(1, 1), 1_000);
  h.commit('a', 'ab', sel(1, 1), sel(2, 2), 2_000);
  h.commit('ab', 'abc', sel(2, 2), sel(3, 3), 12_000);
  h.commit('abc', 'abcd', sel(3, 3), sel(4, 4), 13_000);

  assert.equal(h.stepsEarlier({ steps: 2 }), 2);
  assert.equal(h.stepsEarlier({ steps: 99 }), 4, 'clamped to the root');
  // Current revision is at 13s; 2s back is 11s, so revisions at 12s and 13s go.
  assert.equal(h.stepsEarlier({ ms: 2_000 }), 2);
  assert.equal(h.stepsEarlier({ ms: 20_000 }), 4);

  for (let i = 0; i < 4; i++) h.markUndone();
  assert.equal(h.stepsLater({ steps: 1 }), 1);
  assert.equal(h.stepsLater({ steps: 10 }), 4);
});

test('parseUndoKind', () => {
  assert.deepEqual(parseUndoKind(undefined), { steps: 1 });
  assert.deepEqual(parseUndoKind(''), { steps: 1 });
  assert.deepEqual(parseUndoKind('3'), { steps: 3 });
  assert.deepEqual(parseUndoKind('10s'), { ms: 10_000 });
  assert.deepEqual(parseUndoKind('1m30s'), { ms: 90_000 });
  assert.deepEqual(parseUndoKind('1 m 30 s'), { ms: 90_000 });
  assert.deepEqual(parseUndoKind('2h'), { ms: 7_200_000 });
  assert.deepEqual(parseUndoKind('3 days'), { ms: 259_200_000 });
  assert.equal(parseUndoKind('10x'), undefined);
  assert.equal(parseUndoKind('10s garbage'), undefined);
});

test('diff: splitLines keeps the trailing newline out', () => {
  assert.deepEqual(splitLines(''), []);
  assert.deepEqual(splitLines('a\n'), ['a']);
  assert.deepEqual(splitLines('a\nb'), ['a', 'b']);
  assert.deepEqual(splitLines('a\n\n'), ['a', '']);
});

test('diff: insertion, removal and replacement hunks', () => {
  assert.deepEqual(lineHunks('a\nb\n', 'a\nb\n'), []);
  assert.deepEqual(lineHunks('a\nb\n', 'a\nX\nb\n'), [{ beforeStart: 1, beforeEnd: 1, afterStart: 1, afterEnd: 2 }]);
  assert.deepEqual(lineHunks('a\nX\nb\n', 'a\nb\n'), [{ beforeStart: 1, beforeEnd: 2, afterStart: 1, afterEnd: 1 }]);
  assert.deepEqual(lineHunks('a\nb\nc\n', 'a\nB\nc\n'), [{ beforeStart: 1, beforeEnd: 2, afterStart: 1, afterEnd: 2 }]);
});

test('diff: several hunks in one file', () => {
  const before = ['1', '2', '3', '4', '5', '6', '7', '8'].join('\n') + '\n';
  const after = ['1', 'two', '3', '4', '5', '6', '7', '8', '9'].join('\n') + '\n';
  const hunks = lineHunks(before, after);
  assert.deepEqual(hunks, [
    { beforeStart: 1, beforeEnd: 2, afterStart: 1, afterEnd: 2 },
    { beforeStart: 8, beforeEnd: 8, afterStart: 8, afterEnd: 9 },
  ]);
});

test('diff: myers finds the minimal edit for a move', () => {
  const hunks = diffLines(['a', 'b', 'c', 'd'], ['a', 'c', 'd', 'b']);
  // "b" is removed after "a" and added at the end (not a rewrite of the middle).
  assert.deepEqual(hunks, [
    { beforeStart: 1, beforeEnd: 2, afterStart: 1, afterEnd: 1 },
    { beforeStart: 4, beforeEnd: 4, afterStart: 3, afterEnd: 4 },
  ]);
});

test('diff: hunk navigation', () => {
  const hunks = lineHunks('1\n2\n3\n4\n5\n', '1\nX\n3\n4\nY\nZ\n');
  assert.equal(hunks.length, 2);
  assert.equal(nextHunk(hunks, 0), 0);
  assert.equal(nextHunk(hunks, 1), 1);
  assert.equal(nextHunk(hunks, 5), undefined);
  assert.equal(prevHunk(hunks, 5), 0);
  assert.equal(prevHunk(hunks, 0), undefined);
  assert.equal(hunkAt(hunks, 1, false), 0);
  assert.equal(hunkAt(hunks, 2, false), undefined);
  assert.equal(hunkAt(hunks, 4, false), 1);
});

test('diff: a pure removal is found at its line only when asked', () => {
  const hunks = lineHunks('a\nb\nc\n', 'a\nc\n');
  assert.deepEqual(hunks, [{ beforeStart: 1, beforeEnd: 2, afterStart: 1, afterEnd: 1 }]);
  assert.equal(hunkAt(hunks, 1, false), undefined);
  assert.equal(hunkAt(hunks, 1, true), 0);
});

test('paths: absolute detection on posix and windows', () => {
  assert.equal(isAbsolutePath('/a/b'), true);
  assert.equal(isAbsolutePath('C:\\a'), true);
  assert.equal(isAbsolutePath('c:/a'), true);
  assert.equal(isAbsolutePath('a/b'), false);
  assert.equal(isAbsolutePath('~/a'), false);
});

test('paths: normalize, join, dirname, basename', () => {
  assert.equal(normalizePath('/a/./b/../c'), '/a/c');
  assert.equal(normalizePath('a//b/'), 'a/b');
  assert.equal(normalizePath('../a'), '../a');
  assert.equal(normalizePath('C:\\a\\b'), 'C:/a/b');
  assert.equal(joinPath('/a', 'b', 'c.txt'), '/a/b/c.txt');
  assert.equal(joinPath('/a/b', '../c'), '/a/c');
  assert.equal(dirname('/a/b/c.txt'), '/a/b');
  assert.equal(dirname('/a'), '/');
  assert.equal(dirname('a'), '.');
  assert.equal(basename('/a/b/c.txt'), 'c.txt');
  assert.equal(basename('/a/b/'), 'b');
});

test('paths: resolve and ~ expansion', () => {
  assert.equal(resolvePath('/work', 'src/a.ts'), '/work/src/a.ts');
  assert.equal(resolvePath('/work', '/etc/hosts'), '/etc/hosts');
  assert.equal(expandHome('~/x', '/home/u'), '/home/u/x');
  assert.equal(expandHome('~', '/home/u'), '/home/u');
  assert.equal(expandHome('~x', '/home/u'), '~x');
  assert.equal(expandHome('~/x', undefined), '~/x');
});
