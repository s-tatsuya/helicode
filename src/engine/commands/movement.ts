/**
 * Movement commands: chars, lines, words, find-char, goto family, paging.
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { Range, range as mkRange, point, putCursor, cursor as rangeCursor, cursorLine, transform, from, to, primary, Direction } from '../../core/range';
import { nthNextGraphemeBoundary, nthPrevGraphemeBoundary, nextGraphemeBoundary, lineEnd, lineIsEmpty, firstNonWhitespace, visualColumn, offsetAtVisualColumn, prevGraphemeBoundary, lineEndWithEol } from '../../core/text';
import * as words from '../../core/words';
import { findNthChar } from '../../core/surround';
import { movePrevParagraph, moveNextParagraph } from '../../core/paragraph';
import { transformSelection, tabWidth, visibleLineCount, firstVisibleLine, lastVisibleLine, nextKey, vsCommandAndSync, exitSelectMode } from './util';
import { keyChar } from '../../core/keys';

// ---------------------------------------------------------------------------
// Horizontal / vertical
// ---------------------------------------------------------------------------

function moveHorizontally(cx: CommandContext, dir: Direction, extend: boolean): void {
  const text = cx.doc.text;
  transformSelection(cx, (r) => {
    const pos = rangeCursor(text, r);
    const newPos = dir === Direction.Forward ? nthNextGraphemeBoundary(text, pos, cx.count) : nthPrevGraphemeBoundary(text, pos, cx.count);
    return putCursor(text, r, newPos, extend);
  });
}

/** move_vertically: keeps a sticky visual column like Helix. */
function moveVertically(cx: CommandContext, dir: Direction, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  const tw = tabWidth(cx.vs);
  transformSelection(cx, (r) => {
    const pos = rangeCursor(text, r);
    const line = doc.lineOf(pos);
    const col = r.stickyCol ?? visualColumn(doc, pos, tw);
    let newLine = dir === Direction.Forward ? line + cx.count : line - cx.count;
    newLine = Math.max(0, Math.min(newLine, doc.lineCount - 1));
    if (newLine === line && dir === Direction.Forward && line === doc.lineCount - 1) return r;
    const newPos = offsetAtVisualColumn(doc, newLine, col, tw);
    // Special-case: extending onto an empty line keeps the range.
    if (extend && lineIsEmpty(doc, newLine) && lineEnd(doc, newLine) === doc.lineStart(newLine) && newLine !== line && false) return r;
    const nr = putCursor(text, r, newPos, extend);
    return { ...nr, stickyCol: col };
  });
}

export const moveCharLeft: CommandFn = (cx) => moveHorizontally(cx, Direction.Backward, false);
export const moveCharRight: CommandFn = (cx) => moveHorizontally(cx, Direction.Forward, false);
export const extendCharLeft: CommandFn = (cx) => moveHorizontally(cx, Direction.Backward, true);
export const extendCharRight: CommandFn = (cx) => moveHorizontally(cx, Direction.Forward, true);
export const moveLineDown: CommandFn = (cx) => moveVertically(cx, Direction.Forward, false);
export const moveLineUp: CommandFn = (cx) => moveVertically(cx, Direction.Backward, false);
export const extendLineDown: CommandFn = (cx) => moveVertically(cx, Direction.Forward, true);
export const extendLineUp: CommandFn = (cx) => moveVertically(cx, Direction.Backward, true);

/**
 * Visual line movement. VS Code knows about soft-wrap; when word wrap is off
 * this is identical to logical movement. We use VS Code's own cursor movement
 * for wrapped lines to get correct visual behaviour, then resync.
 */
async function moveVisual(cx: CommandContext, dir: Direction, extend: boolean): Promise<void> {
  const wrap = vscode.workspace.getConfiguration('editor', cx.vs.document).get<string>('wordWrap', 'off');
  if (wrap === 'off' || cx.selection.ranges.length > 1) {
    moveVertically(cx, dir, extend);
    return;
  }
  // Single cursor with soft wrap: only VS Code knows where the rows break, so
  // it moves the cursor and we ask it where the row we landed on starts and
  // ends. The column is kept by Helicode (`stickyCol` holds the column inside
  // the wrapped row here; moveVertically stores a visual column in the logical
  // line - the two paths never run for the same editor), because every cursor
  // write resets the column VS Code itself would remember.
  const doc = cx.doc;
  const text = doc.text;
  const sel = cx.selection;
  const r = primary(sel);
  const c = rangeCursor(text, r);
  await cx.editor.withOwnCursorMoves(async () => {
    const at = (offset: number) => {
      const p = doc.position(offset);
      cx.editor.pushToVscode([new vscode.Selection(p, p)]);
    };
    const move = async (to: string, by?: string, value?: number): Promise<number> => {
      await vscode.commands.executeCommand('cursorMove', { to, by, value });
      return doc.offset(cx.vs.selection.active);
    };
    at(c);
    // The column is only measured when the last command was not a vertical
    // move; repeated j/k reuse the one the range carries.
    let col = r.stickyCol;
    if (col === undefined) {
      col = c - (await move('wrappedLineStart'));
      at(c);
    }
    await move(dir === Direction.Forward ? 'down' : 'up', 'wrappedLine', cx.count);
    const rowEnd = await move('wrappedLineEnd');
    const newRowStart = await move('wrappedLineStart');
    // The cursor VS Code moved for us is reported back asynchronously: ours.
    cx.editor.rememberOwnWrite(cx.vs.selections);
    if (c >= newRowStart && c <= rowEnd) {
      // Still the same row - the first or last one of the document. Helix
      // leaves the selection alone there.
      cx.editor.setSelection(transform(sel, (rr, i) => (i === sel.primaryIndex ? { ...rr, stickyCol: col } : rr)));
      return;
    }
    const np = Math.min(newRowStart + col, Math.max(rowEnd, newRowStart));
    cx.editor.setSelection(
      transform(sel, (rr, i) => (i === sel.primaryIndex ? { ...putCursor(text, rr, np, extend), stickyCol: col } : rr)),
    );
  });
}

export const moveVisualLineDown: CommandFn = (cx) => moveVisual(cx, Direction.Forward, false);
export const moveVisualLineUp: CommandFn = (cx) => moveVisual(cx, Direction.Backward, false);
export const extendVisualLineDown: CommandFn = (cx) => moveVisual(cx, Direction.Forward, true);
export const extendVisualLineUp: CommandFn = (cx) => moveVisual(cx, Direction.Backward, true);

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

function wordMotion(move: (t: string, r: Range, n: number) => Range, extend: boolean): CommandFn {
  return (cx) => {
    const text = cx.doc.text;
    transformSelection(cx, (r) => {
      const word = move(text, r, cx.count);
      if (!extend) return word;
      return putCursor(text, r, rangeCursor(text, word), true);
    });
  };
}

export const moveNextWordStart = wordMotion(words.moveNextWordStart, false);
export const moveNextWordEnd = wordMotion(words.moveNextWordEnd, false);
export const movePrevWordStart = wordMotion(words.movePrevWordStart, false);
export const movePrevWordEnd = wordMotion(words.movePrevWordEnd, false);
export const moveNextLongWordStart = wordMotion(words.moveNextLongWordStart, false);
export const moveNextLongWordEnd = wordMotion(words.moveNextLongWordEnd, false);
export const movePrevLongWordStart = wordMotion(words.movePrevLongWordStart, false);
export const movePrevLongWordEnd = wordMotion(words.movePrevLongWordEnd, false);
export const moveNextSubWordStart = wordMotion(words.moveNextSubWordStart, false);
export const moveNextSubWordEnd = wordMotion(words.moveNextSubWordEnd, false);
export const movePrevSubWordStart = wordMotion(words.movePrevSubWordStart, false);
export const movePrevSubWordEnd = wordMotion(words.movePrevSubWordEnd, false);
export const extendNextWordStart = wordMotion(words.moveNextWordStart, true);
export const extendNextWordEnd = wordMotion(words.moveNextWordEnd, true);
export const extendPrevWordStart = wordMotion(words.movePrevWordStart, true);
export const extendPrevWordEnd = wordMotion(words.movePrevWordEnd, true);
export const extendNextLongWordStart = wordMotion(words.moveNextLongWordStart, true);
export const extendNextLongWordEnd = wordMotion(words.moveNextLongWordEnd, true);
export const extendPrevLongWordStart = wordMotion(words.movePrevLongWordStart, true);
export const extendPrevLongWordEnd = wordMotion(words.movePrevLongWordEnd, true);
export const extendNextSubWordStart = wordMotion(words.moveNextSubWordStart, true);
export const extendNextSubWordEnd = wordMotion(words.moveNextSubWordEnd, true);
export const extendPrevSubWordStart = wordMotion(words.movePrevSubWordStart, true);
export const extendPrevSubWordEnd = wordMotion(words.movePrevSubWordEnd, true);

// ---------------------------------------------------------------------------
// find char (f / t / F / T)
// ---------------------------------------------------------------------------

function findCharImpl(cx: CommandContext, ch: string, count: number, dir: Direction, inclusive: boolean, extend: boolean): void {
  const text = cx.doc.text;
  transformSelection(cx, (r) => {
    const cursorAnchor = rangeCursor(text, r);
    const cursorHead = nextGraphemeBoundary(text, cursorAnchor);
    let searchStart: number;
    if (inclusive) searchStart = dir === Direction.Forward ? cursorHead : cursorAnchor;
    else searchStart = dir === Direction.Forward ? cursorHead + 1 : Math.max(0, cursorAnchor - 1);
    const found = findNthChar(text, ch, searchStart, count, dir === Direction.Forward);
    if (found === undefined) return r;
    let pos = found;
    if (!inclusive) pos = dir === Direction.Forward ? prevGraphemeBoundary(text, pos) : nextGraphemeBoundary(text, pos);
    return extend ? putCursor(text, r, pos, true) : putCursor(text, point(rangeCursor(text, r)), pos, true);
  });
}

function findCharLineEnding(cx: CommandContext, count: number, dir: Direction, inclusive: boolean, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  transformSelection(cx, (r) => {
    const cur = rangeCursor(text, r);
    let line = doc.lineOf(cur);
    let pos: number;
    if (dir === Direction.Forward) {
      // If already on a line end, start from the next line.
      const onEol = cur >= lineEnd(doc, line);
      line = line + count - (onEol ? 0 : 1);
      if (line >= doc.lineCount) return r;
      pos = lineEnd(doc, line);
      if (!inclusive) pos = Math.max(doc.lineStart(line), prevGraphemeBoundary(text, pos));
    } else {
      line = line - count;
      if (line < 0) return r;
      pos = lineEnd(doc, line);
      if (!inclusive) pos = nextGraphemeBoundary(text, pos);
    }
    return extend ? putCursor(text, r, pos, true) : putCursor(text, point(cur), pos, true);
  });
}

function findChar(dir: Direction, inclusive: boolean, extend: boolean): CommandFn {
  return async (cx) => {
    const count = cx.count;
    const k = await nextKey(cx, dir === Direction.Forward ? (inclusive ? 'f' : 't') : inclusive ? 'F' : 'T');
    if (!k) return;
    let motion: (c: CommandContext) => void;
    if (k.code === 'ret' && !k.ctrl && !k.alt) motion = (c) => findCharLineEnding(c, count, dir, inclusive, extend);
    else {
      const ch = keyChar(k);
      if (ch === undefined) return;
      motion = (c) => findCharImpl(c, ch, count, dir, inclusive, extend);
    }
    cx.engine.lastMotion = motion;
    motion(cx);
  };
}

export const findTillChar = findChar(Direction.Forward, false, false);
export const findNextChar = findChar(Direction.Forward, true, false);
export const tillPrevChar = findChar(Direction.Backward, false, false);
export const findPrevChar = findChar(Direction.Backward, true, false);
export const extendTillChar = findChar(Direction.Forward, false, true);
export const extendNextChar = findChar(Direction.Forward, true, true);
export const extendTillPrevChar = findChar(Direction.Backward, false, true);
export const extendPrevChar = findChar(Direction.Backward, true, true);

export const repeatLastMotion: CommandFn = async (cx) => {
  const m = cx.engine.lastMotion;
  if (!m) return;
  for (let i = 0; i < cx.count; i++) await m(cx);
};

// ---------------------------------------------------------------------------
// Line-relative
// ---------------------------------------------------------------------------

function gotoLineStartImpl(cx: CommandContext, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  transformSelection(cx, (r) => putCursor(text, r, doc.lineStart(cursorLine(doc, r)), extend));
}

function gotoLineEndImpl(cx: CommandContext, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  transformSelection(cx, (r) => {
    const line = cursorLine(doc, r);
    const start = doc.lineStart(line);
    const pos = Math.max(prevGraphemeBoundary(text, lineEnd(doc, line)), start);
    return putCursor(text, r, pos, extend);
  });
}

function gotoFirstNonWhitespaceImpl(cx: CommandContext, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  transformSelection(cx, (r) => {
    const line = cursorLine(doc, r);
    const col = firstNonWhitespace(doc, line);
    if (col === undefined) return r;
    return putCursor(text, r, doc.lineStart(line) + col, extend);
  });
}

export const gotoLineStart: CommandFn = (cx) => gotoLineStartImpl(cx, cx.extend);
export const gotoLineEnd: CommandFn = (cx) => gotoLineEndImpl(cx, cx.extend);
export const extendToLineStart: CommandFn = (cx) => gotoLineStartImpl(cx, true);
export const extendToLineEnd: CommandFn = (cx) => gotoLineEndImpl(cx, true);
export const gotoFirstNonwhitespace: CommandFn = (cx) => gotoFirstNonWhitespaceImpl(cx, cx.extend);
export const extendToFirstNonwhitespace: CommandFn = (cx) => gotoFirstNonWhitespaceImpl(cx, true);

/** goto_line_end_newline: insert-mode End key (cursor after the last char). */
export const gotoLineEndNewline: CommandFn = (cx) => {
  const doc = cx.doc;
  const text = doc.text;
  transformSelection(cx, (r) => putCursor(text, r, lineEnd(doc, cursorLine(doc, r)), cx.extend));
};

function gotoColumnImpl(cx: CommandContext, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  const tw = tabWidth(cx.vs);
  transformSelection(cx, (r) => {
    const line = cursorLine(doc, r);
    const pos = offsetAtVisualColumn(doc, line, cx.count - 1, tw);
    return putCursor(text, r, pos, extend);
  });
}

export const gotoColumn: CommandFn = (cx) => gotoColumnImpl(cx, cx.extend);
export const extendToColumn: CommandFn = (cx) => gotoColumnImpl(cx, true);

// ---------------------------------------------------------------------------
// Whole-file goto
// ---------------------------------------------------------------------------

function gotoLineImpl(cx: CommandContext, extend: boolean): void {
  if (!cx.hasCount) return;
  cx.engine.pushJump(cx.editor);
  gotoLineWithoutJumplist(cx, cx.count, extend);
}

export function gotoLineWithoutJumplist(cx: CommandContext, lineNumber: number, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  // Helix: the last line is the one before a trailing newline.
  const lastLine = lineIsEmpty(doc, doc.lineCount - 1) && doc.lineCount > 1 ? doc.lineCount - 2 : doc.lineCount - 1;
  const line = Math.min(Math.max(lineNumber, 1) - 1, lastLine);
  const pos = doc.lineStart(line);
  transformSelection(cx, (r) => putCursor(text, r, pos, extend));
}

export const gotoLine: CommandFn = (cx) => gotoLineImpl(cx, cx.extend);

function gotoFileStartImpl(cx: CommandContext, extend: boolean): void {
  if (cx.hasCount) {
    gotoLineImpl(cx, extend);
    return;
  }
  cx.engine.pushJump(cx.editor);
  const text = cx.doc.text;
  transformSelection(cx, (r) => putCursor(text, r, 0, extend));
}

export const gotoFileStart: CommandFn = (cx) => gotoFileStartImpl(cx, cx.extend);
export const extendToFileStart: CommandFn = (cx) => gotoFileStartImpl(cx, true);

function gotoLastLineImpl(cx: CommandContext, extend: boolean): void {
  const doc = cx.doc;
  const text = doc.text;
  const line = lineIsEmpty(doc, doc.lineCount - 1) && doc.lineCount > 1 ? doc.lineCount - 2 : doc.lineCount - 1;
  const pos = doc.lineStart(line);
  cx.engine.pushJump(cx.editor);
  transformSelection(cx, (r) => putCursor(text, r, pos, extend));
}

export const gotoLastLine: CommandFn = (cx) => gotoLastLineImpl(cx, cx.extend);
export const extendToLastLine: CommandFn = (cx) => gotoLastLineImpl(cx, true);

export const gotoFileEnd: CommandFn = (cx) => {
  const text = cx.doc.text;
  cx.engine.pushJump(cx.editor);
  transformSelection(cx, (r) => putCursor(text, r, text.length, cx.extend));
};

// ---------------------------------------------------------------------------
// Window-relative (gt / gc / gb)
// ---------------------------------------------------------------------------

function gotoWindow(cx: CommandContext, where: 'top' | 'center' | 'bottom'): void {
  const doc = cx.doc;
  const text = doc.text;
  const first = firstVisibleLine(cx.vs);
  const last = Math.min(lastVisibleLine(cx.vs), doc.lineCount - 1);
  const scrolloff = Math.min(cx.engine.config.scrolloff, Math.floor((last - first) / 2));
  let line: number;
  if (where === 'top') line = first + scrolloff + (cx.hasCount ? cx.count - 1 : 0);
  else if (where === 'bottom') line = last - scrolloff - (cx.hasCount ? cx.count - 1 : 0);
  else line = Math.floor((first + last) / 2);
  line = Math.max(first, Math.min(line, last));
  const pos = doc.lineStart(line);
  transformSelection(cx, (r) => putCursor(text, r, pos, cx.extend));
}

export const gotoWindowTop: CommandFn = (cx) => gotoWindow(cx, 'top');
export const gotoWindowCenter: CommandFn = (cx) => gotoWindow(cx, 'center');
export const gotoWindowBottom: CommandFn = (cx) => gotoWindow(cx, 'bottom');

// ---------------------------------------------------------------------------
// Paging
// ---------------------------------------------------------------------------

async function scrollBy(cx: CommandContext, lines: number, moveCursor: boolean): Promise<void> {
  const doc = cx.doc;
  const text = doc.text;
  const dir = lines >= 0 ? 'down' : 'up';
  await vscode.commands.executeCommand('editorScroll', { to: dir, by: 'line', value: Math.abs(lines), revealCursor: false });
  if (moveCursor) {
    const tw = tabWidth(cx.vs);
    transformSelection(cx, (r) => {
      const pos = rangeCursor(text, r);
      const line = doc.lineOf(pos);
      const col = r.stickyCol ?? visualColumn(doc, pos, tw);
      const newLine = Math.max(0, Math.min(line + lines, doc.lineCount - 1));
      const nr = putCursor(text, r, offsetAtVisualColumn(doc, newLine, col, tw), cx.extend);
      return { ...nr, stickyCol: col };
    });
  } else {
    // Keep the cursor inside the view like Helix (scrolloff).
    await keepCursorInView(cx);
  }
}

async function keepCursorInView(cx: CommandContext): Promise<void> {
  await new Promise((r) => setTimeout(r, 0));
  const doc = cx.doc;
  const text = doc.text;
  const first = firstVisibleLine(cx.vs);
  const last = lastVisibleLine(cx.vs);
  const off = Math.min(cx.engine.config.scrolloff, Math.floor((last - first) / 2));
  const tw = tabWidth(cx.vs);
  transformSelection(cx, (r) => {
    const pos = rangeCursor(text, r);
    const line = doc.lineOf(pos);
    const lo = Math.min(first + off, doc.lineCount - 1);
    const hi = Math.max(last - off, 0);
    if (line >= lo && line <= hi) return r;
    const col = r.stickyCol ?? visualColumn(doc, pos, tw);
    const newLine = line < lo ? lo : hi;
    const nr = putCursor(text, r, offsetAtVisualColumn(doc, newLine, col, tw), cx.extend);
    return { ...nr, stickyCol: col };
  });
  cx.editor.setSelection(cx.editor.selection, { reveal: false });
}

export const pageUp: CommandFn = (cx) => scrollBy(cx, -visibleLineCount(cx.vs) * cx.count, false);
export const pageDown: CommandFn = (cx) => scrollBy(cx, visibleLineCount(cx.vs) * cx.count, false);
export const pageCursorHalfUp: CommandFn = (cx) => scrollBy(cx, -Math.floor(visibleLineCount(cx.vs) / 2) * cx.count, true);
export const pageCursorHalfDown: CommandFn = (cx) => scrollBy(cx, Math.floor(visibleLineCount(cx.vs) / 2) * cx.count, true);
export const pageCursorUp: CommandFn = (cx) => scrollBy(cx, -visibleLineCount(cx.vs) * cx.count, true);
export const pageCursorDown: CommandFn = (cx) => scrollBy(cx, visibleLineCount(cx.vs) * cx.count, true);
export const scrollUp: CommandFn = (cx) => scrollBy(cx, -cx.count, false);
export const scrollDown: CommandFn = (cx) => scrollBy(cx, cx.count, false);

// ---------------------------------------------------------------------------
// Paragraphs
// ---------------------------------------------------------------------------

export const gotoPrevParagraph: CommandFn = (cx) => {
  const motion = (c: CommandContext) => {
    const doc = c.doc;
    transformSelection(c, (r) => movePrevParagraph(doc, r, c.count, c.extend));
  };
  cx.engine.lastMotion = motion;
  motion(cx);
};

export const gotoNextParagraph: CommandFn = (cx) => {
  const motion = (c: CommandContext) => {
    const doc = c.doc;
    transformSelection(c, (r) => moveNextParagraph(doc, r, c.count, c.extend));
  };
  cx.engine.lastMotion = motion;
  motion(cx);
};

// ---------------------------------------------------------------------------
// Jumplist
// ---------------------------------------------------------------------------

export const jumpForward: CommandFn = async (cx) => {
  const j = cx.engine.jumplist.forward(cx.count);
  if (j) await cx.engine.gotoJump(j);
};

export const jumpBackward: CommandFn = async (cx) => {
  const j = cx.engine.jumplist.backward(cx.count, { uri: cx.vs.document.uri, selection: cx.selection });
  if (j) await cx.engine.gotoJump(j);
};

export const saveSelection: CommandFn = (cx) => {
  cx.engine.pushJump(cx.editor);
  cx.setStatus('Selection saved to jumplist');
};

// ---------------------------------------------------------------------------
// Buffers / files
// ---------------------------------------------------------------------------

export const gotoNextBuffer: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.nextEditor');
export const gotoPreviousBuffer: CommandFn = (cx) => vsCommandAndSync(cx, 'workbench.action.previousEditor');

export const gotoLastAccessedFile: CommandFn = async (cx) => {
  const uri = cx.engine.lastAccessedUri;
  if (!uri) {
    cx.setError('no last accessed buffer');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
};

export const gotoLastModifiedFile: CommandFn = async (cx) => {
  const uri = cx.engine.lastModifiedUri;
  if (!uri) {
    cx.setError('no last modified buffer');
    return;
  }
  const doc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(doc);
};

export const gotoLastModification: CommandFn = (cx) => {
  const pos = cx.editor.lastModification;
  if (pos === undefined) return;
  const text = cx.doc.text;
  const p = Math.min(pos, text.length);
  transformSelection(cx, (r, i) => (i === cx.selection.primaryIndex ? putCursor(text, r, p, cx.extend) : r));
};

/** gf: open the path under the selection (or the word under the cursor). */
export const gotoFile: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const paths = new Set<string>();
  for (const r of cx.selection.ranges) {
    let frag = text.slice(from(r), to(r));
    if (frag.length <= 1 || !frag.trim()) {
      // expand to a WORD around the cursor
      const c = rangeCursor(text, r);
      let s = c;
      let e = c;
      while (s > 0 && !/\s/.test(text[s - 1])) s--;
      while (e < text.length && !/\s/.test(text[e])) e++;
      frag = text.slice(s, e);
    }
    frag = frag.trim().replace(/^["'<(\[]+|["'>)\],;:]+$/g, '');
    if (frag) paths.add(frag);
  }
  for (const p of paths) {
    const m = /^(.*?)(?::(\d+))?(?::(\d+))?$/.exec(p);
    const file = m ? m[1] : p;
    const line = m && m[2] ? Number(m[2]) : undefined;
    const uri = await resolvePath(file, cx.vs.document.uri);
    if (!uri) {
      cx.setError(`File not found: ${file}`);
      continue;
    }
    try {
      const doc = await vscode.workspace.openTextDocument(uri);
      const ed = await vscode.window.showTextDocument(doc);
      if (line !== undefined) {
        const pos = new vscode.Position(Math.max(0, line - 1), 0);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos));
      }
    } catch {
      cx.setError(`Could not open ${file}`);
    }
  }
};

async function resolvePath(p: string, relativeTo: vscode.Uri): Promise<vscode.Uri | undefined> {
  const candidates: vscode.Uri[] = [];
  if (p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)) candidates.push(vscode.Uri.file(p));
  else {
    if (relativeTo.scheme === 'file') candidates.push(vscode.Uri.joinPath(relativeTo, '..', p));
    for (const f of vscode.workspace.workspaceFolders ?? []) candidates.push(vscode.Uri.joinPath(f.uri, p));
  }
  for (const c of candidates) {
    try {
      const st = await vscode.workspace.fs.stat(c);
      if (st.type & vscode.FileType.File) return c;
    } catch {
      /* try next */
    }
  }
  return undefined;
}

export const suspend: CommandFn = (cx) => {
  cx.setStatus('suspend is not applicable in VS Code');
};

export const normalModeCmd: CommandFn = (cx) => {
  if (cx.engine.mode === 'insert') cx.engine.enterNormalMode();
  else if (cx.engine.mode === 'select') exitSelectMode(cx);
};

export const exitSelectModeCmd: CommandFn = (cx) => exitSelectMode(cx);

export const selectModeCmd: CommandFn = (cx) => {
  cx.engine.setMode('select');
};

export { mkRange, lineEndWithEol };
