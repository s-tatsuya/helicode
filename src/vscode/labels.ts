/**
 * Jump labels (`gw`): helix-term commands.rs jump_to_word / jump_to_label.
 */
import * as vscode from 'vscode';
import { CommandContext } from '../engine/types';
import { Range, range as mkRange, point, from, to, primary, cursor as rangeCursor, withDirection, Direction, selection as mkSelection } from '../core/range';
import { moveNextWordEnd, movePrevWordStart } from '../core/words';
import { isWordChar, nextGraphemeBoundary, charAt, charBefore, graphemes, isAnyWhitespace } from '../core/text';
import { keyChar } from '../core/keys';
import { firstVisibleLine, lastVisibleLine, nextKey } from '../engine/commands/util';

let labelDeco: vscode.TextEditorDecorationType | undefined;

function decoType(): vscode.TextEditorDecorationType {
  if (!labelDeco) {
    labelDeco = vscode.window.createTextEditorDecorationType({
      opacity: '0',
      rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
    });
  }
  return labelDeco;
}

export function disposeLabelDecorations(): void {
  labelDeco?.dispose();
  labelDeco = undefined;
}

/** Collect jump candidates in the visible area, alternating forward/backward from the cursor. */
export function jumpCandidates(cx: CommandContext): Range[] {
  const alphabet = [...cx.engine.config.jumpLabelAlphabet];
  if (alphabet.length === 0) return [];
  const limit = alphabet.length * alphabet.length;
  const doc = cx.doc;
  const text = doc.text;
  const start = doc.lineStart(firstVisibleLine(cx.vs));
  const end = doc.lineStart(Math.min(lastVisibleLine(cx.vs) + 1, doc.lineCount));
  const cursor = rangeCursor(text, primary(cx.selection));
  let cursorFwd = point(cursor);
  let cursorRev = point(cursor);
  const ch = charAt(text, cursor);
  if (ch && !isAnyWhitespace(ch)) {
    const wordEnd = moveNextWordEnd(text, cursorFwd, 1);
    if (wordEnd.anchor === cursor) cursorFwd = wordEnd;
    const wordStart = movePrevWordStart(text, cursorRev, 1);
    if (wordStart.anchor === nextGraphemeBoundary(text, cursor)) cursorRev = wordStart;
  }
  const words: Range[] = [];
  const twoWordGraphemesBefore = (pos: number) => {
    const gs = graphemes(text.slice(Math.max(0, pos - 8), pos));
    const last2 = gs.slice(-2);
    return last2.length === 2 && last2.every((g) => [...g].every(isWordChar));
  };
  const twoWordGraphemesAfter = (pos: number) => {
    const gs = graphemes(text.slice(pos, Math.min(text.length, pos + 8)));
    const first2 = gs.slice(0, 2);
    return first2.length === 2 && first2.every((g) => [...g].every(isWordChar));
  };
  outer: for (;;) {
    let changed = false;
    while (cursorFwd.head < end) {
      cursorFwd = moveNextWordEnd(text, cursorFwd, 1);
      if (!twoWordGraphemesBefore(cursorFwd.head)) continue;
      changed = true;
      let a = cursorFwd.anchor;
      while (a < text.length && !isWordChar(charAt(text, a))) a += charAt(text, a).length;
      words.push(mkRange(a, cursorFwd.head));
      if (words.length === limit) break outer;
      break;
    }
    while (cursorRev.head > start) {
      cursorRev = movePrevWordStart(text, cursorRev, 1);
      if (!twoWordGraphemesAfter(cursorRev.head)) continue;
      changed = true;
      let a = cursorRev.anchor;
      while (a > 0 && !isWordChar(charBefore(text, a))) a -= charBefore(text, a).length;
      words.push(mkRange(a, cursorRev.head));
      if (words.length === limit) break outer;
      break;
    }
    if (!changed) break;
  }
  return words;
}

/** Show two-character labels and jump to the chosen candidate. */
export async function jumpToLabel(cx: CommandContext, labels: Range[], extend: boolean): Promise<void> {
  const alphabet = [...cx.engine.config.jumpLabelAlphabet];
  if (labels.length === 0 || alphabet.length === 0) return;
  const doc = cx.doc;
  const text = doc.text;
  const n = alphabet.length;
  const decorations: vscode.DecorationOptions[] = labels.map((r, i) => {
    const label = alphabet[Math.floor(i / n)] + alphabet[i % n];
    const s = from(r);
    const e = nextGraphemeBoundary(text, nextGraphemeBoundary(text, s));
    return {
      range: new vscode.Range(doc.position(s), doc.position(e)),
      renderOptions: {
        before: {
          contentText: label,
          color: new vscode.ThemeColor('editor.background'),
          backgroundColor: new vscode.ThemeColor('editorInfo.foreground'),
          fontWeight: 'bold',
          margin: '0 -2ch 0 0',
          width: '2ch',
          textDecoration: 'none; position: relative; z-index: 10; display: inline-block; text-align: center;',
        },
      },
    };
  });
  const deco = decoType();
  cx.vs.setDecorations(deco, decorations);
  const clear = () => cx.vs.setDecorations(deco, []);
  const primaryRange = primary(cx.selection);
  try {
    const k1 = await nextKey(cx, 'jump');
    const c1 = k1 && !k1.ctrl && !k1.alt ? keyChar(k1) : undefined;
    const outer = c1 !== undefined ? alphabet.indexOf(c1) : -1;
    if (outer < 0 || outer * n > labels.length) return;
    const k2 = await nextKey(cx, 'jump');
    const c2 = k2 && !k2.ctrl && !k2.alt ? keyChar(k2) : undefined;
    const inner = c2 !== undefined ? alphabet.indexOf(c2) : -1;
    if (inner < 0) return;
    let target = labels[outer * n + inner];
    if (!target) return;
    if (extend) {
      let anchor: number;
      if (target.anchor < target.head) {
        const f = from(primaryRange);
        anchor = target.anchor < f ? target.anchor : f;
      } else {
        const t = to(primaryRange);
        anchor = target.anchor > t ? target.anchor : t;
      }
      target = mkRange(anchor, target.head);
    } else {
      target = withDirection(target, Direction.Forward);
    }
    cx.engine.pushJump(cx.editor);
    cx.editor.setSelection(mkSelection([target]));
  } finally {
    clear();
  }
}

export async function gotoWord(cx: CommandContext): Promise<void> {
  await jumpToLabel(cx, jumpCandidates(cx), false);
}

export async function extendToWord(cx: CommandContext): Promise<void> {
  await jumpToLabel(cx, jumpCandidates(cx), true);
}
