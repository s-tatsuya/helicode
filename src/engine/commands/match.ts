/**
 * Match mode: mm / ms / mr / md / mi / ma, plus tree-sitter node selection
 * (Alt-o / Alt-i / Alt-n / Alt-p / Alt-I / Alt-a / Alt-e / Alt-b).
 */
import { CommandContext, CommandFn } from '../types';
import { Range, Selection, range as mkRange, point, from, to, direction, Direction, withDirection, putCursor, cursor as rangeCursor, selection as mkSelection, transformMany, fromSpan } from '../../core/range';
import { TextObject, textobjectWord, textobjectParagraph, textobjectPairSurround } from '../../core/textobjects';
import { getSurroundPos, SurroundError } from '../../core/surround';
import { findMatchingBracketPlaintext, getPair } from '../../core/brackets';
import { Change } from '../../core/changes';
import { getSyntax } from '../../treesitter';
import { nextChar, nextKey, exitSelectMode, transformSelection } from './util';
import { keyChar } from '../../core/keys';

export const matchBrackets: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const syntax = await getSyntax(cx.vs.document);
  transformSelection(cx, (r) => {
    const pos = rangeCursor(text, r);
    const matched = syntax ? syntax.findMatchingBracketFuzzy(pos) : findMatchingBracketPlaintext(text, pos);
    if (matched === undefined) return r;
    return putCursor(text, r, matched, cx.extend);
  });
};

const SURROUND_HELP = 'ms: ( [ { < \' " ` | or any char; Enter = newline';

export const surroundAdd: CommandFn = async (cx) => {
  const k = await nextKey(cx, SURROUND_HELP);
  if (!k) return;
  let open: string;
  let close: string;
  if (k.code === 'ret' && !k.ctrl && !k.alt) open = close = cx.doc.eol;
  else {
    const ch = keyChar(k);
    if (ch === undefined) return;
    [open, close] = getPair(ch);
  }
  const sel = cx.selection;
  const changes: Change[] = [];
  const ranges: Range[] = new Array(sel.ranges.length);
  let offs = 0;
  const surroundLen = open.length + close.length;
  const order = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => from(a.r) - from(b.r));
  for (const { r, i } of order) {
    changes.push({ from: from(r), to: from(r), text: open });
    changes.push({ from: to(r), to: to(r), text: close });
    ranges[i] = withDirection(mkRange(offs + from(r), offs + to(r) + surroundLen), direction(r));
    offs += surroundLen;
  }
  await cx.editor.apply(changes, { selection: mkSelection(ranges, sel.primaryIndex) });
  exitSelectMode(cx);
};

export const surroundReplace: CommandFn = async (cx) => {
  const count = cx.count;
  const ch = await nextChar(cx, 'mr: pair to replace (m = closest)');
  if (ch === undefined) return;
  const surroundCh = ch === 'm' ? undefined : ch;
  const text = cx.doc.text;
  const sel = cx.selection;
  const syntax = await getSyntax(cx.vs.document);
  let changePos: number[];
  try {
    changePos = getSurroundPos(syntax, text, sel, surroundCh, count);
  } catch (e) {
    cx.setError(e instanceof SurroundError ? e.message : String(e));
    return;
  }
  // Show the pair positions while waiting for the replacement char.
  cx.editor.setSelection(mkSelection(changePos.map((p) => point(p)), sel.primaryIndex * 2), { reveal: false });
  const toCh = await nextChar(cx, 'mr: replacement pair');
  cx.editor.setSelection(sel, { reveal: false });
  if (toCh === undefined) return;
  const [open, close] = getPair(toCh);
  const changes: Change[] = [];
  for (let i = 0; i < changePos.length; i += 2) {
    changes.push({ from: changePos[i], to: changePos[i] + 1, text: open });
    changes.push({ from: changePos[i + 1], to: changePos[i + 1] + 1, text: close });
  }
  await cx.editor.apply(changes, { selection: sel });
  exitSelectMode(cx);
};

export const surroundDelete: CommandFn = async (cx) => {
  const count = cx.count;
  const ch = await nextChar(cx, 'md: pair to delete (m = closest)');
  if (ch === undefined) return;
  const surroundCh = ch === 'm' ? undefined : ch;
  const text = cx.doc.text;
  const sel = cx.selection;
  const syntax = await getSyntax(cx.vs.document);
  let changePos: number[];
  try {
    changePos = getSurroundPos(syntax, text, sel, surroundCh, count);
  } catch (e) {
    cx.setError(e instanceof SurroundError ? e.message : String(e));
    return;
  }
  changePos.sort((a, b) => a - b);
  const changes: Change[] = changePos.map((p) => ({ from: p, to: p + 1, text: '' }));
  await cx.editor.apply(changes);
  exitSelectMode(cx);
};

const TEXTOBJECT_HELP = 'w=word W=WORD p=paragraph f=function t=type a=arg c=comment T=test e=entry x=xml m=closest pair g=change, or a pair char';

function selectTextobject(kind: TextObject): CommandFn {
  return async (cx) => {
    const count = cx.count;
    const ch = await nextChar(cx, (kind === TextObject.Inside ? 'mi: ' : 'ma: ') + TEXTOBJECT_HELP);
    if (ch === undefined) return;
    const motion = async (c: CommandContext) => {
      const doc = c.doc;
      const text = doc.text;
      const syntax = await getSyntax(c.vs.document);
      const tsKind = kind === TextObject.Inside ? 'inside' : 'around';
      const ts = (name: string, r: Range): Range => {
        if (!syntax) {
          c.setError('tree-sitter is not available for this document');
          return r;
        }
        const span = syntax.textobject(rangeCursor(text, r), name, tsKind);
        return span ? mkRange(span[0], span[1]) : r;
      };
      transformSelection(c, (r) => {
        switch (ch) {
          case 'w':
            return textobjectWord(text, r, kind, false);
          case 'W':
            return textobjectWord(text, r, kind, true);
          case 't':
            return ts('class', r);
          case 'f':
            return ts('function', r);
          case 'a':
            return ts('parameter', r);
          case 'c':
            return ts('comment', r);
          case 'T':
            return ts('test', r);
          case 'e':
            return ts('entry', r);
          case 'x':
            return ts('xml-element', r);
          case 'p':
            return textobjectParagraph(doc, r, kind, count);
          case 'm':
            return textobjectPairSurround(syntax, text, r, kind, undefined, count);
          case 'g':
            return r; // VCS change objects are not available in VS Code
          default:
            if (!/^[\p{L}\p{N}]$/u.test(ch)) return textobjectPairSurround(syntax, text, r, kind, ch, count);
            return r;
        }
      });
      if (ch === 'g') c.setError('textobject `g` (VCS change) is not supported in VS Code');
    };
    cx.engine.lastMotion = motion;
    await motion(cx);
  };
}

export const selectTextobjectAround = selectTextobject(TextObject.Around);
export const selectTextobjectInner = selectTextobject(TextObject.Inside);

// ---------------------------------------------------------------------------
// Tree-sitter node selection
// ---------------------------------------------------------------------------

/** History of selections for shrink_selection (Helix keeps a per-view stack). */
const expandHistory = new WeakMap<object, Selection[]>();

async function withSyntax(cx: CommandContext): Promise<import('../../treesitter').Syntax | undefined> {
  const s = await getSyntax(cx.vs.document);
  if (!s) cx.setError('tree-sitter is not available for this document');
  return s;
}

export const expandSelection: CommandFn = async (cx) => {
  const syntax = await withSyntax(cx);
  if (!syntax) return;
  const current = cx.selection;
  const next = transformOrKeep(current, (r) => {
    const span = syntax.expand(from(r), to(r));
    return span ? fromSpan(span[0], span[1], direction(r)) : r;
  });
  if (sameSelection(next, current)) return;
  const hist = expandHistory.get(cx.editor) ?? [];
  hist.push(current);
  expandHistory.set(cx.editor, hist);
  cx.editor.setSelection(next);
};

export const shrinkSelection: CommandFn = async (cx) => {
  const hist = expandHistory.get(cx.editor);
  const current = cx.selection;
  if (hist && hist.length) {
    const prev = hist.pop()!;
    // Only use history when the current selection is the result of expanding it.
    if (prev.ranges.every((r) => current.ranges.some((c) => from(c) <= from(r) && to(c) >= to(r)))) {
      cx.editor.setSelection(prev);
      return;
    }
    hist.length = 0;
  }
  const syntax = await withSyntax(cx);
  if (!syntax) return;
  cx.editor.setSelection(
    transformOrKeep(current, (r) => {
      const span = syntax.shrink(from(r), to(r));
      return span ? fromSpan(span[0], span[1], direction(r)) : r;
    }),
  );
};

export const selectNextSibling: CommandFn = async (cx) => {
  const syntax = await withSyntax(cx);
  if (!syntax) return;
  expandHistory.delete(cx.editor);
  cx.editor.setSelection(
    transformOrKeep(cx.selection, (r) => {
      const span = syntax.nextSibling(from(r), to(r));
      return span ? fromSpan(span[0], span[1], Direction.Forward) : r;
    }),
  );
};

export const selectPrevSibling: CommandFn = async (cx) => {
  const syntax = await withSyntax(cx);
  if (!syntax) return;
  expandHistory.delete(cx.editor);
  cx.editor.setSelection(
    transformOrKeep(cx.selection, (r) => {
      const span = syntax.prevSibling(from(r), to(r));
      return span ? fromSpan(span[0], span[1], Direction.Backward) : r;
    }),
  );
};

export const selectAllChildren: CommandFn = async (cx) => {
  const syntax = await withSyntax(cx);
  if (!syntax) return;
  expandHistory.delete(cx.editor);
  cx.editor.setSelection(
    transformMany(cx.selection, (r) => {
      const kids = syntax.allChildren(from(r), to(r));
      return kids ? kids.map((k) => fromSpan(k[0], k[1], direction(r))) : [r];
    }),
  );
};

export const selectAllSiblings: CommandFn = async (cx) => {
  const syntax = await withSyntax(cx);
  if (!syntax) return;
  expandHistory.delete(cx.editor);
  cx.editor.setSelection(
    transformMany(cx.selection, (r) => {
      const sibs = syntax.allSiblings(from(r), to(r));
      return sibs ? sibs.map((k) => fromSpan(k[0], k[1], direction(r))) : [r];
    }),
  );
};

function moveParentNode(dir: Direction, extend: boolean): CommandFn {
  return async (cx) => {
    const syntax = await withSyntax(cx);
    if (!syntax) return;
    const text = cx.doc.text;
    transformSelection(cx, (r) => {
      const cur = rangeCursor(text, r);
      let endHead = syntax.parentEdge(from(r), to(r), cur, dir);
      if (endHead === undefined) return r;
      if (!extend) {
        return direction(r) === Direction.Forward ? mkRange(endHead, endHead + 1) : mkRange(endHead + 1, endHead);
      }
      if (endHead >= r.anchor) endHead += 1;
      return mkRange(r.anchor, endHead);
    });
  };
}

export const moveParentNodeEnd = moveParentNode(Direction.Forward, false);
export const moveParentNodeStart = moveParentNode(Direction.Backward, false);
export const extendParentNodeEnd = moveParentNode(Direction.Forward, true);
export const extendParentNodeStart = moveParentNode(Direction.Backward, true);

function transformOrKeep(sel: Selection, f: (r: Range) => Range): Selection {
  return mkSelection(
    sel.ranges.map((r) => f(r)),
    sel.primaryIndex,
  );
}

function sameSelection(a: Selection, b: Selection): boolean {
  return a.ranges.length === b.ranges.length && a.ranges.every((r, i) => r.anchor === b.ranges[i].anchor && r.head === b.ranges[i].head);
}
