/**
 * Editing commands: insert modes, delete/change, yank/paste, replace, case,
 * indent, join, increment, newlines, undo/redo, macros.
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { Range, Selection, range as mkRange, point, from, to, direction, Direction, withDirection, lineRange, selection as mkSelection, transform, fragment, cursor as rangeCursor, cursorLine, primary } from '../../core/range';
import { graphemes, lineEnd, lineEndWithEol, lineText, firstNonWhitespace, nextGraphemeBoundary, prevGraphemeBoundary, lineIsBlank } from '../../core/text';
import { Change, changeBySelection } from '../../core/changes';
import { increment as incrementValue } from '../../core/increment';
import { exitSelectMode, selectedLines, selectionIsLinewise, indentUnit, tabWidth, nextChar, nextKey, transformSelection, vsCommandAndSync } from './util';
import { keyChar } from '../../core/keys';

// ---------------------------------------------------------------------------
// Entering insert mode
// ---------------------------------------------------------------------------

export const insertMode: CommandFn = (cx) => {
  const sel = transform(cx.selection, (r) => mkRange(to(r), from(r)));
  cx.engine.enterInsertMode(cx.editor, sel, false);
};

export const appendMode: CommandFn = (cx) => {
  const text = cx.doc.text;
  const sel = transform(cx.selection, (r) => mkRange(from(r), nextGraphemeBoundary(text, to(r))));
  cx.engine.enterInsertMode(cx.editor, sel, true);
};

function insertWithIndent(cx: CommandContext, atEnd: boolean): void {
  const doc = cx.doc;
  const sel = transform(cx.selection, (r) => {
    const line = cursorLine(doc, r);
    let pos: number;
    if (atEnd) pos = lineEnd(doc, line);
    else {
      const col = firstNonWhitespace(doc, line);
      pos = doc.lineStart(line) + (col ?? lineText(doc, line).length);
    }
    return point(pos);
  });
  cx.engine.enterInsertMode(cx.editor, sel, false);
}

export const insertAtLineStart: CommandFn = (cx) => insertWithIndent(cx, false);
export const insertAtLineEnd: CommandFn = (cx) => insertWithIndent(cx, true);

/** open_below / open_above: new line with the indentation of the current line. */
async function open(cx: CommandContext, above: boolean): Promise<void> {
  const doc = cx.doc;
  const text = doc.text;
  const eol = doc.eol;
  const sel = cx.selection;
  const changes: Change[] = [];
  const ranges: Range[] = [];
  let offs = 0;
  const order = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => from(a.r) - from(b.r));
  const newByIndex: Range[] = new Array(sel.ranges.length);
  for (const { r, i } of order) {
    const currLine = doc.lineOf(above ? from(r) : prevGraphemeBoundary(text, to(r)));
    const nextNewLine = above ? currLine : currLine + 1;
    const aboveNext = Math.max(0, nextNewLine - 1);
    const indent = leadingWhitespace(lineText(doc, currLine));
    const insertAt = nextNewLine === 0 ? 0 : lineEnd(doc, aboveNext);
    let insText: string;
    const count = cx.count;
    if (above && nextNewLine === 0) insText = (indent + eol).repeat(count);
    else insText = (eol + indent).repeat(count);
    for (let k = 0; k < count; k++) {
      const base = offs + insertAt + (above && nextNewLine === 0 ? 0 : eol.length);
      const pos = base + k * (eol.length + indent.length) + indent.length;
      if (k === count - 1) newByIndex[i] = point(pos);
      else ranges.push(point(pos));
    }
    changes.push({ from: insertAt, to: insertAt, text: insText });
    offs += insText.length;
  }
  const finalRanges = [...ranges, ...newByIndex].sort((a, b) => a.anchor - b.anchor);
  const primaryPos = newByIndex[sel.primaryIndex].anchor;
  const primaryIndex = Math.max(0, finalRanges.findIndex((r) => r.anchor === primaryPos));
  cx.engine.setMode('insert');
  await cx.editor.apply(changes, { undoStopAfter: false });
  cx.engine.enterInsertMode(cx.editor, mkSelection(finalRanges, primaryIndex), false);
  // Let VS Code re-indent with language rules if configured (like Helix's indent heuristic).
  if (vscode.workspace.getConfiguration('helicode').get<boolean>('openLineUsesEditorIndent', true) && cx.selection.ranges.length === 1) {
    await vscode.commands.executeCommand('editor.action.reindentselectedlines').then(undefined, () => undefined);
  }
}

function leadingWhitespace(s: string): string {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0] : '';
}

export const openBelow: CommandFn = (cx) => open(cx, false);
export const openAbove: CommandFn = (cx) => open(cx, true);

// ---------------------------------------------------------------------------
// Delete / change / yank / paste
// ---------------------------------------------------------------------------

async function yankTo(cx: CommandContext, register: string, values: string[]): Promise<void> {
  await cx.engine.registers.write(register, values);
}

function defaultRegister(cx: CommandContext): string {
  return cx.register ?? cx.engine.config.defaultYankRegister;
}

async function deleteSelectionImpl(cx: CommandContext, change: boolean, yank: boolean): Promise<void> {
  const doc = cx.doc;
  const text = doc.text;
  const sel = cx.selection;
  const onlyWholeLines = selectionIsLinewise(doc, sel);
  if (yank && cx.register !== '_') {
    await yankTo(cx, defaultRegister(cx), sel.ranges.map((r) => fragment(text, r)));
  }
  const { changes, ranges } = changeBySelection(sel, (r) => ({ from: from(r), to: to(r), text: '' }));
  const newSel = mkSelection(ranges.map((r) => point(from(r))), sel.primaryIndex);
  if (change) {
    if (onlyWholeLines) {
      await cx.editor.apply(changes, { selection: newSel, undoStopAfter: false });
      await open(cx, true);
    } else {
      cx.engine.setMode('insert');
      await cx.editor.apply(changes, { selection: newSel, undoStopAfter: false });
      cx.engine.enterInsertMode(cx.editor, newSel, false);
    }
  } else {
    await cx.editor.apply(changes, { selection: newSel });
    exitSelectMode(cx);
  }
}

export const deleteSelection: CommandFn = (cx) => deleteSelectionImpl(cx, false, true);
export const deleteSelectionNoyank: CommandFn = (cx) => deleteSelectionImpl(cx, false, false);
export const changeSelection: CommandFn = (cx) => deleteSelectionImpl(cx, true, true);
export const changeSelectionNoyank: CommandFn = (cx) => deleteSelectionImpl(cx, true, false);

export const yank: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const values = cx.selection.ranges.map((r) => fragment(text, r));
  const reg = defaultRegister(cx);
  await yankTo(cx, reg, values);
  cx.setStatus(`yanked ${values.length} selection${values.length === 1 ? '' : 's'} to register ${reg}`);
  exitSelectMode(cx);
};

export const yankJoined: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const values = cx.selection.ranges.map((r) => fragment(text, r));
  await yankTo(cx, defaultRegister(cx), [values.join(cx.doc.eol)]);
  cx.setStatus(`joined and yanked ${values.length} selection(s)`);
  exitSelectMode(cx);
};

export const yankToClipboard: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const values = cx.selection.ranges.map((r) => fragment(text, r));
  await cx.engine.registers.write('+', values);
  cx.setStatus(`yanked ${values.length} selection(s) to system clipboard`);
  exitSelectMode(cx);
};

export const yankMainSelectionToClipboard: CommandFn = async (cx) => {
  await cx.engine.registers.write('+', [fragment(cx.doc.text, primary(cx.selection))]);
  cx.setStatus('yanked main selection to system clipboard');
  exitSelectMode(cx);
};

export const yankJoinedToClipboard: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const values = cx.selection.ranges.map((r) => fragment(text, r));
  await cx.engine.registers.write('+', [values.join(cx.doc.eol)]);
  cx.setStatus(`joined and yanked ${values.length} selection(s) to system clipboard`);
  exitSelectMode(cx);
};

const enum Paste {
  Before,
  After,
  Cursor,
}

export async function pasteImpl(cx: CommandContext, values: string[], action: Paste, count: number): Promise<void> {
  if (values.length === 0) return;
  const doc = cx.doc;
  const text = doc.text;
  const eol = doc.eol;
  const linewise = values.some((v) => /\r\n|\n/.test(v) && (v.endsWith('\n')));
  const map = (v: string) => v.replace(/\r\n|\n/g, eol).repeat(count);
  const mapped = values.map(map);
  const sel = cx.selection;
  const ranges: Range[] = new Array(sel.ranges.length);
  const changes: Change[] = [];
  let offset = 0;
  const order = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => from(a.r) - from(b.r));
  let vi = 0;
  for (const { r, i } of order) {
    let pos: number;
    if (action === Paste.Cursor) pos = rangeCursor(text, r);
    else if (linewise) {
      if (action === Paste.Before) pos = doc.lineStart(doc.lineOf(from(r)));
      else {
        const [, endLine] = lineRange(doc, r);
        pos = doc.lineStart(Math.min(endLine + 1, doc.lineCount));
      }
    } else pos = action === Paste.Before ? from(r) : to(r);
    const value = mapped[Math.min(vi, mapped.length - 1)];
    vi++;
    const anchor = offset + pos;
    ranges[i] = withDirection(mkRange(anchor, anchor + value.length), direction(r));
    offset += value.length;
    changes.push({ from: pos, to: pos, text: value });
  }
  const newSel = cx.mode === 'insert' ? undefined : mkSelection(ranges, sel.primaryIndex);
  await cx.editor.apply(changes, { selection: newSel });
}

async function readRegister(cx: CommandContext, name: string): Promise<string[] | undefined> {
  const values = await cx.engine.registers.read(name);
  if (!values || values.length === 0) {
    cx.setError(`Register ${name} is empty`);
    return undefined;
  }
  return values;
}

export const pasteAfter: CommandFn = async (cx) => {
  const v = await readRegister(cx, defaultRegister(cx));
  if (v) await pasteImpl(cx, v, Paste.After, cx.count);
  exitSelectMode(cx);
};
export const pasteBefore: CommandFn = async (cx) => {
  const v = await readRegister(cx, defaultRegister(cx));
  if (v) await pasteImpl(cx, v, Paste.Before, cx.count);
  exitSelectMode(cx);
};
export const pasteClipboardAfter: CommandFn = async (cx) => {
  const v = await readRegister(cx, '+');
  if (v) await pasteImpl(cx, v, Paste.After, cx.count);
  exitSelectMode(cx);
};
export const pasteClipboardBefore: CommandFn = async (cx) => {
  const v = await readRegister(cx, '+');
  if (v) await pasteImpl(cx, v, Paste.Before, cx.count);
  exitSelectMode(cx);
};

async function replaceWith(cx: CommandContext, values: string[]): Promise<void> {
  const eol = cx.doc.eol;
  const mapped = values.map((v) => v.replace(/\r\n|\n/g, eol).repeat(cx.count));
  const sel = cx.selection;
  let vi = 0;
  const { changes, ranges } = changeBySelection(sel, (r) => {
    const v = mapped[Math.min(vi, mapped.length - 1)];
    vi++;
    return { from: from(r), to: to(r), text: v };
  });
  await cx.editor.apply(changes, { selection: mkSelection(ranges, sel.primaryIndex) });
  exitSelectMode(cx);
}

export const replaceWithYanked: CommandFn = async (cx) => {
  const v = await readRegister(cx, defaultRegister(cx));
  if (v) await replaceWith(cx, v);
};

export const replaceSelectionsWithClipboard: CommandFn = async (cx) => {
  const v = await readRegister(cx, '+');
  if (v) await replaceWith(cx, v);
};

/** paste at cursor in insert mode (used by C-r). */
export const insertRegister: CommandFn = async (cx) => {
  const ch = await nextChar(cx, '"');
  if (!ch) return;
  const v = await readRegister(cx, ch);
  if (!v) return;
  await pasteImpl(cx, v, Paste.Cursor, 1);
};

// ---------------------------------------------------------------------------
// Replace char (r) / case
// ---------------------------------------------------------------------------

export const replace: CommandFn = async (cx) => {
  const k = await nextKey(cx, 'r');
  if (!k) return;
  let ch: string | undefined;
  if (k.code === 'ret' && !k.ctrl && !k.alt) ch = cx.doc.eol;
  else ch = keyChar(k);
  if (ch === undefined) return;
  const text = cx.doc.text;
  const sel = cx.selection;
  const { changes, ranges } = changeBySelection(sel, (r) => {
    if (from(r) === to(r)) return undefined;
    const n = graphemes(text.slice(from(r), to(r))).length;
    return { from: from(r), to: to(r), text: ch!.repeat(n) };
  });
  await cx.editor.apply(changes, { selection: mkSelection(ranges, sel.primaryIndex) });
  exitSelectMode(cx);
};

async function switchCaseImpl(cx: CommandContext, f: (s: string) => string): Promise<void> {
  const text = cx.doc.text;
  const sel = cx.selection;
  const { changes, ranges } = changeBySelection(sel, (r) => ({ from: from(r), to: to(r), text: f(text.slice(from(r), to(r))) }));
  await cx.editor.apply(changes, { selection: mkSelection(ranges, sel.primaryIndex) });
  exitSelectMode(cx);
}

export const switchCase: CommandFn = (cx) =>
  switchCaseImpl(cx, (s) =>
    [...s]
      .map((c) => {
        const u = c.toUpperCase();
        const l = c.toLowerCase();
        if (c === u && c !== l) return l;
        if (c === l && c !== u) return u;
        return c;
      })
      .join(''),
  );
export const switchToLowercase: CommandFn = (cx) => switchCaseImpl(cx, (s) => s.toLowerCase());
export const switchToUppercase: CommandFn = (cx) => switchCaseImpl(cx, (s) => s.toUpperCase());

// ---------------------------------------------------------------------------
// Indent
// ---------------------------------------------------------------------------

export const indent: CommandFn = async (cx) => {
  const doc = cx.doc;
  const unit = indentUnit(cx.vs);
  const lines = selectedLines(doc, cx.selection);
  const changes: Change[] = [];
  for (const line of lines) {
    if (lineIsBlank(doc, line)) continue;
    const pos = doc.lineStart(line);
    let ins = unit.repeat(cx.count);
    if (unit !== '\t') {
      const fnw = firstNonWhitespace(doc, line) ?? 0;
      const offset = fnw % unit.length;
      ins = ins.slice(offset);
    }
    changes.push({ from: pos, to: pos, text: ins });
  }
  const sel = cx.selection;
  await cx.editor.apply(changes);
  // Keep the same lines selected (VS Code adjusted the selections for us).
  void sel;
  exitSelectMode(cx);
};

export const unindent: CommandFn = async (cx) => {
  const doc = cx.doc;
  const unit = indentUnit(cx.vs);
  const tw = tabWidth(cx.vs);
  const indentWidth = cx.count * (unit === '\t' ? tw : unit.length);
  const changes: Change[] = [];
  for (const line of selectedLines(doc, cx.selection)) {
    const t = lineText(doc, line);
    let width = 0;
    let pos = 0;
    for (const ch of t) {
      if (ch === ' ') width += 1;
      else if (ch === '\t') width = (Math.floor(width / tw) + 1) * tw;
      else break;
      pos++;
      if (width >= indentWidth) break;
    }
    if (pos > 0) {
      const start = doc.lineStart(line);
      changes.push({ from: start, to: start + pos, text: '' });
    }
  }
  await cx.editor.apply(changes);
  exitSelectMode(cx);
};

export const formatSelections: CommandFn = async (cx) => {
  // Use the LSP formatter through VS Code.
  const all = cx.selection.ranges.length === 1 && from(cx.selection.ranges[0]) === 0 && to(cx.selection.ranges[0]) >= cx.doc.length;
  await vsCommandAndSync(cx, all ? 'editor.action.formatDocument' : 'editor.action.formatSelection');
  exitSelectMode(cx);
};

// ---------------------------------------------------------------------------
// Join
// ---------------------------------------------------------------------------

async function joinSelectionsImpl(cx: CommandContext, selectSpace: boolean): Promise<void> {
  const doc = cx.doc;
  const text = doc.text;
  const changes: { from: number; to: number; text: string | undefined }[] = [];
  const commentTokens = commentTokensFor(cx.vs.document.languageId);
  for (const r of cx.selection.ranges) {
    let [start, end] = lineRange(doc, r);
    if (start === end) end = Math.min(end + 1, doc.lineCount - 1);
    const firstLineStart = doc.lineStart(start);
    const firstNonWs = /[^ \t]/.exec(text.slice(firstLineStart, lineEnd(doc, start)));
    const firstLine = text.slice(firstLineStart + (firstNonWs ? firstNonWs.index : 0));
    let currentToken = commentTokens.find((t) => firstLine.startsWith(t));
    for (let line = start; line < end; line++) {
      const s = lineEnd(doc, line);
      let e = doc.lineStart(line + 1);
      while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
      const rest = text.slice(e);
      const token = commentTokens.find((t) => rest.startsWith(t));
      if (token) {
        if (token === currentToken) {
          e += token.length;
          while (e < text.length && (text[e] === ' ' || text[e] === '\t')) e++;
        } else currentToken = token;
      }
      const separator = e === lineEnd(doc, line + 1) ? undefined : ' ';
      changes.push({ from: s, to: e, text: separator });
    }
  }
  if (changes.length === 0) return;
  changes.sort((a, b) => a.from - b.from);
  const dedup = changes.filter((c, i) => i === 0 || c.from !== changes[i - 1].from);
  const edits: Change[] = dedup.map((c) => ({ from: c.from, to: c.to, text: c.text ?? '' }));
  if (selectSpace) {
    let offset = 0;
    const ranges: Range[] = [];
    for (const c of dedup) {
      if (c.text !== undefined) {
        const p = c.from - offset;
        ranges.push(mkRange(p, p + 1));
        offset += c.to - c.from - 1;
      } else offset += c.to - c.from;
    }
    await cx.editor.apply(edits, { selection: ranges.length ? mkSelection(ranges, 0) : undefined });
  } else {
    const sel = cx.selection;
    await cx.editor.apply(edits);
    void sel;
  }
}

function commentTokensFor(languageId: string): string[] {
  const map: Record<string, string[]> = {
    rust: ['//', '///', '//!'],
    c: ['//'],
    cpp: ['//', '///'],
    javascript: ['//'],
    typescript: ['//', '///'],
    javascriptreact: ['//'],
    typescriptreact: ['//'],
    go: ['//'],
    java: ['//'],
    csharp: ['//', '///'],
    swift: ['//', '///'],
    kotlin: ['//'],
    python: ['#'],
    ruby: ['#'],
    shellscript: ['#'],
    yaml: ['#'],
    toml: ['#'],
    perl: ['#'],
    nix: ['#'],
    lua: ['--'],
    haskell: ['--'],
    sql: ['--'],
    elixir: ['#'],
  };
  const tokens = map[languageId] ?? [];
  return tokens.slice().sort((a, b) => b.length - a.length);
}

export const joinSelections: CommandFn = (cx) => joinSelectionsImpl(cx, false);
export const joinSelectionsSpace: CommandFn = (cx) => joinSelectionsImpl(cx, true);

// ---------------------------------------------------------------------------
// Increment / decrement
// ---------------------------------------------------------------------------

async function incrementImpl(cx: CommandContext, sign: 1 | -1): Promise<void> {
  const text = cx.doc.text;
  let amount = sign * cx.count;
  const increaseBy = cx.register === '#' ? sign : 0;
  const sel = cx.selection;
  const changes: Change[] = [];
  const newRanges: Range[] = [];
  let cumulative = 0;
  // Helix increments the number under the cursor when the selection is a single char.
  const ranges = sel.ranges.map((r) => expandToNumber(text, r));
  for (const r of ranges) {
    const selected = text.slice(from(r), to(r));
    const newFrom = from(r) + cumulative;
    const inc = incrementValue(selected, amount);
    amount += increaseBy;
    if (inc === undefined) {
      newRanges.push(mkRange(newFrom, to(r) + cumulative));
    } else {
      newRanges.push(mkRange(newFrom, newFrom + inc.length));
      cumulative += inc.length - selected.length;
      changes.push({ from: from(r), to: to(r), text: inc });
    }
  }
  if (changes.length) {
    await cx.editor.apply(changes, { selection: mkSelection(newRanges, sel.primaryIndex) });
    exitSelectMode(cx);
  }
}

/** For 1-wide selections, expand to the surrounding number (like Helix's cursor semantics). */
function expandToNumber(text: string, r: Range): Range {
  const width = to(r) - from(r);
  if (width > 1) return r;
  const c = rangeCursor(text, r);
  const isNum = (i: number) => /[0-9a-fA-FxXoObB_]/.test(text[i] ?? '');
  if (!/[0-9]/.test(text[c] ?? '') && !isNum(c)) return r;
  let s = c;
  let e = c;
  while (s > 0 && isNum(s - 1)) s--;
  while (e < text.length && isNum(e)) e++;
  if (s > 0 && text[s - 1] === '-') s--;
  const frag = text.slice(s, e);
  if (!/[0-9]/.test(frag)) return r;
  return withDirection(mkRange(s, e), direction(r));
}

export const incrementCmd: CommandFn = (cx) => incrementImpl(cx, 1);
export const decrementCmd: CommandFn = (cx) => incrementImpl(cx, -1);

// ---------------------------------------------------------------------------
// Add newline above / below
// ---------------------------------------------------------------------------

async function addNewlineImpl(cx: CommandContext, above: boolean): Promise<void> {
  const doc = cx.doc;
  const changes: Change[] = [];
  const seen = new Set<number>();
  for (const r of cx.selection.ranges) {
    const [start, end] = lineRange(doc, r);
    const line = above ? start : end + 1;
    const pos = doc.lineStart(line);
    if (seen.has(pos)) continue;
    seen.add(pos);
    changes.push({ from: pos, to: pos, text: doc.eol.repeat(cx.count) });
  }
  const sel = cx.selection;
  await cx.editor.apply(changes);
  void sel;
}

export const addNewlineAbove: CommandFn = (cx) => addNewlineImpl(cx, true);
export const addNewlineBelow: CommandFn = (cx) => addNewlineImpl(cx, false);

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

export const undo: CommandFn = async (cx) => {
  for (let i = 0; i < cx.count; i++) await vscode.commands.executeCommand('undo');
  await new Promise((r) => setTimeout(r, 0));
  cx.editor.syncFromVscode();
  cx.editor.decorate();
};

export const redo: CommandFn = async (cx) => {
  for (let i = 0; i < cx.count; i++) await vscode.commands.executeCommand('redo');
  await new Promise((r) => setTimeout(r, 0));
  cx.editor.syncFromVscode();
  cx.editor.decorate();
};

export const commitUndoCheckpoint: CommandFn = async (cx) => {
  // Insert an undo stop by making an empty edit with stops around it.
  await cx.vs.edit(() => {}, { undoStopBefore: true, undoStopAfter: true });
};

// ---------------------------------------------------------------------------
// Macros
// ---------------------------------------------------------------------------

export const recordMacro: CommandFn = async (cx) => {
  const engine = cx.engine;
  if (engine.macroRecording) {
    const { register, keys } = engine.macroRecording;
    // The last key is the `Q` that stopped the recording.
    keys.pop();
    engine.macroRecording = undefined;
    const serialized = keys.map((k) => (keyChar(k) !== undefined && keyChar(k) !== ' ' ? keyChar(k)! : `<${formatKeyForMacro(k)}>`)).join('');
    await engine.registers.write(register, [serialized]);
    cx.setStatus(`Recorded to register [${register}]`);
  } else {
    const register = cx.register ?? '@';
    engine.macroRecording = { register, keys: [] };
    cx.setStatus(`Recording to register [${register}]`);
  }
};

function formatKeyForMacro(k: { code: string; ctrl: boolean; alt: boolean; shift: boolean }): string {
  let s = '';
  if (k.ctrl) s += 'C-';
  if (k.alt) s += 'A-';
  if (k.shift) s += 'S-';
  return s + (k.code === ' ' ? 'space' : k.code);
}

export const replayMacro: CommandFn = async (cx) => {
  const engine = cx.engine;
  const register = cx.register ?? '@';
  const values = await engine.registers.read(register);
  if (!values || !values.length) {
    cx.setError(`Register [${register}] empty`);
    return;
  }
  const keys = engine.parseKeys(values[0]);
  for (let i = 0; i < cx.count; i++) await engine.replayKeys(keys);
};

// ---------------------------------------------------------------------------
// Register selection
// ---------------------------------------------------------------------------

export const selectRegister: CommandFn = async (cx) => {
  const ch = await nextChar(cx, '"');
  if (ch) {
    cx.engine.selectedRegister = ch;
    cx.setStatus(`register selected: ${ch}`);
  }
};

export { lineEndWithEol, Selection, transformSelection, Direction };
