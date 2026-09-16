/**
 * Per-editor state: the Helix selection model and its synchronisation with
 * the VS Code editor, insert-mode anchor tracking, and cursor decorations.
 */
import * as vscode from 'vscode';
import { Range, Selection, ensureInvariants, from, to, primary, selection as mkSelection, cursor as rangeCursor, len, range as mkRange } from '../core/range';
import { nextGraphemeBoundary, prevGraphemeBoundary } from '../core/text';
import { Change, normalizeChanges, mapOffset, mapSelection, Assoc } from '../core/changes';
import { VsDoc, docFor } from '../vscode/document';
import type { Mode } from './types';

let primaryCursorDeco: vscode.TextEditorDecorationType | undefined;
let secondaryCursorDeco: vscode.TextEditorDecorationType | undefined;
let secondarySelectionDeco: vscode.TextEditorDecorationType | undefined;

export function ensureDecorationTypes(): void {
  if (primaryCursorDeco) return;
  primaryCursorDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editorCursor.foreground'),
    color: new vscode.ThemeColor('editorCursor.background'),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  secondaryCursorDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.wordHighlightStrongBackground'),
    border: '1px solid',
    borderColor: new vscode.ThemeColor('editorCursor.foreground'),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
  secondarySelectionDeco = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor('editor.inactiveSelectionBackground'),
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  });
}

export function disposeDecorationTypes(): void {
  primaryCursorDeco?.dispose();
  secondaryCursorDeco?.dispose();
  secondarySelectionDeco?.dispose();
  primaryCursorDeco = secondaryCursorDeco = secondarySelectionDeco = undefined;
}

export interface ApplyOptions {
  /** Selection to set after the edit (in post-edit offsets). */
  selection?: Selection;
  /** Whether to create an undo stop after the edit (default true). */
  undoStopAfter?: boolean;
  undoStopBefore?: boolean;
}

export class EditorState {
  selection: Selection;
  /** Anchors tracked through edits while in insert mode (index-aligned with vscode selections). */
  private insertAnchors: number[] | undefined;
  /** Set by append_mode: move the cursor back by one when leaving insert mode. */
  restoreCursor = false;
  private lastSet: readonly vscode.Selection[] = [];
  /** Last selection before the most recent edit (for `g.`). */
  lastModification: number | undefined;

  constructor(
    public vs: vscode.TextEditor,
    private readonly getMode: () => Mode,
  ) {
    this.selection = this.fromVscode(vs.selections);
    this.lastSet = vs.selections;
  }

  get doc(): VsDoc {
    return docFor(this.vs.document);
  }

  get text(): string {
    return this.doc.text;
  }

  // ---------------------------------------------------------------------
  // Conversions
  // ---------------------------------------------------------------------

  /** VS Code selections -> Helix selection. selections[0] is VS Code's primary. */
  fromVscode(sels: readonly vscode.Selection[]): Selection {
    const doc = this.doc;
    const text = doc.text;
    const ranges: Range[] = [];
    for (const s of sels) {
      const anchor = doc.offset(s.anchor);
      const active = doc.offset(s.active);
      if (anchor === active) ranges.push(mkRange(anchor, nextGraphemeBoundary(text, anchor)));
      else ranges.push(mkRange(anchor, active));
    }
    if (ranges.length === 0) return mkSelection([mkRange(0, nextGraphemeBoundary(text, 0))]);
    // Preserve existing sticky columns when the ranges did not change.
    const prevRanges = this.selection?.ranges;
    const withSticky = ranges.map((r) => {
      const old = prevRanges?.find((p) => p.anchor === r.anchor && p.head === r.head);
      return old?.stickyCol !== undefined ? { ...r, stickyCol: old.stickyCol } : r;
    });
    const sel = ensureInvariants(text, mkSelection(withSticky, 0));
    // ensureInvariants sorts; recover the primary as the range that came from selections[0]
    const p = withSticky[0];
    const idx = sel.ranges.findIndex((r) => from(r) <= from(p) && to(r) >= to(p));
    return mkSelection(sel.ranges, idx < 0 ? 0 : idx);
  }

  /** Helix selection -> VS Code selections (primary first). */
  toVscode(sel: Selection, mode: Mode): vscode.Selection[] {
    const doc = this.doc;
    const text = doc.text;
    const out: vscode.Selection[] = [];
    const order = [sel.primaryIndex, ...sel.ranges.map((_, i) => i).filter((i) => i !== sel.primaryIndex)];
    for (const i of order) {
      const r = sel.ranges[i];
      if (mode === 'insert') {
        const c = rangeCursor(text, r);
        out.push(new vscode.Selection(doc.position(c), doc.position(c)));
      } else if (len(r) === 0 || to(r) === nextGraphemeBoundary(text, from(r))) {
        const c = from(r);
        out.push(new vscode.Selection(doc.position(c), doc.position(c)));
      } else {
        out.push(new vscode.Selection(doc.position(r.anchor), doc.position(r.head)));
      }
    }
    return out;
  }

  // ---------------------------------------------------------------------
  // Selection management
  // ---------------------------------------------------------------------

  /** Set the Helix selection and push it to VS Code. */
  setSelection(sel: Selection, opts: { reveal?: boolean; normalize?: boolean } = {}): void {
    const text = this.text;
    const normalized = opts.normalize === false ? sel : ensureInvariants(text, sel);
    this.selection = normalized;
    const mode = this.getMode();
    const vsSels = this.toVscode(normalized, mode);
    if (!selectionsEqual(vsSels, this.vs.selections)) {
      this.vs.selections = vsSels;
    }
    this.lastSet = this.vs.selections;
    if (mode === 'insert') this.insertAnchors = this.orderedRanges(normalized).map((r) => r.anchor);
    if (opts.reveal !== false) this.revealCursor();
    this.decorate();
  }

  /** Ranges in the order they are pushed to VS Code (primary first). */
  private orderedRanges(sel: Selection): Range[] {
    const order = [sel.primaryIndex, ...sel.ranges.map((_, i) => i).filter((i) => i !== sel.primaryIndex)];
    return order.map((i) => sel.ranges[i]);
  }

  /** Called when VS Code reports a selection change we did not make (mouse, other commands). */
  syncFromVscode(): boolean {
    if (selectionsEqual(this.vs.selections, this.lastSet)) return false;
    const mode = this.getMode();
    if (mode === 'insert') {
      // Keep tracked anchors if the cursor count is unchanged; otherwise reset them.
      if (!this.insertAnchors || this.insertAnchors.length !== this.vs.selections.length) {
        this.insertAnchors = this.vs.selections.map((s) => this.doc.offset(s.active));
      }
      this.lastSet = this.vs.selections;
      return true;
    }
    this.selection = this.fromVscode(this.vs.selections);
    this.lastSet = this.vs.selections;
    this.decorate();
    return true;
  }

  /** Re-push the current selection (e.g. after a mode change alters rendering). */
  refresh(): void {
    this.setSelection(this.selection, { reveal: false });
  }

  revealCursor(): void {
    const p = primary(this.selection);
    const c = this.getMode() === 'insert' ? rangeCursor(this.text, p) : rangeCursor(this.text, p);
    const pos = this.doc.position(c);
    this.vs.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.Default);
  }

  // ---------------------------------------------------------------------
  // Insert mode
  // ---------------------------------------------------------------------

  /** Enter insert mode with the given (already transformed) selection. */
  beginInsert(sel: Selection, restoreCursor: boolean): void {
    this.restoreCursor = restoreCursor;
    this.selection = sel;
    const vsSels = this.toVscode(sel, 'insert');
    this.vs.selections = vsSels;
    this.lastSet = this.vs.selections;
    this.insertAnchors = this.orderedRanges(sel).map((r) => r.anchor);
    this.decorate();
    this.revealCursor();
  }

  /** Track anchors through a document edit that happened in insert mode. */
  applyInsertEdits(changes: readonly vscode.TextDocumentContentChangeEvent[]): void {
    if (!this.insertAnchors) return;
    const list: Change[] = changes.map((c) => ({ from: c.rangeOffset, to: c.rangeOffset + c.rangeLength, text: c.text }));
    let sorted: Change[];
    try {
      sorted = normalizeChanges(list);
    } catch {
      return;
    }
    this.insertAnchors = this.insertAnchors.map((a) => mapOffset(a, sorted, Assoc.After));
    this.lastModification = sorted.length ? mapOffset(sorted[sorted.length - 1].from, sorted, Assoc.After) : this.lastModification;
  }

  /** Leave insert mode: rebuild Helix ranges from tracked anchors + VS Code cursors. */
  endInsert(): Selection {
    const text = this.text;
    const sels = this.vs.selections;
    const anchors = this.insertAnchors && this.insertAnchors.length === sels.length ? this.insertAnchors : sels.map((s) => this.doc.offset(s.active));
    const ranges: Range[] = [];
    sels.forEach((s, i) => {
      const c = this.doc.offset(s.active);
      const anchor = Math.min(anchors[i], text.length);
      let r: Range;
      if (anchor > c) r = mkRange(anchor, c);
      else r = mkRange(anchor, c >= text.length ? c : nextGraphemeBoundary(text, c));
      if (this.restoreCursor) {
        let head = to(r);
        if (r.head > r.anchor) head = prevGraphemeBoundary(text, head);
        r = mkRange(from(r), head);
      }
      ranges.push(r);
    });
    this.insertAnchors = undefined;
    this.restoreCursor = false;
    // selections[0] is the primary
    const sel = ensureInvariants(text, mkSelection(ranges, 0));
    const p = ranges[0];
    const idx = sel.ranges.findIndex((r) => from(r) <= from(p) && to(r) >= to(p));
    this.selection = mkSelection(sel.ranges, idx < 0 ? 0 : idx);
    return this.selection;
  }

  // ---------------------------------------------------------------------
  // Editing
  // ---------------------------------------------------------------------

  /** Apply a set of changes atomically, then set the selection. */
  async apply(changes: readonly Change[], opts: ApplyOptions = {}): Promise<boolean> {
    const sorted = normalizeChanges(changes);
    if (sorted.length === 0) {
      if (opts.selection) this.setSelection(opts.selection);
      return true;
    }
    const doc = this.doc;
    const edits = sorted.map((c) => ({ range: new vscode.Range(doc.position(c.from), doc.position(c.to)), text: c.text }));
    const ok = await this.vs.edit(
      (eb) => {
        for (const e of edits) eb.replace(e.range, e.text);
      },
      { undoStopBefore: opts.undoStopBefore ?? true, undoStopAfter: opts.undoStopAfter ?? true },
    );
    this.lastModification = mapOffset(sorted[0].from, sorted, Assoc.After);
    if (opts.selection) this.setSelection(opts.selection);
    else if (this.getMode() !== 'insert') this.setSelection(mapSelection(this.selection, sorted));
    return ok;
  }

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------

  decorate(): void {
    ensureDecorationTypes();
    const mode = this.getMode();
    const doc = this.doc;
    const text = doc.text;
    const primaryCursors: vscode.Range[] = [];
    const secondaryCursors: vscode.Range[] = [];
    const secondarySelections: vscode.Range[] = [];
    let allNarrow = true;
    if (mode !== 'insert') {
      this.selection.ranges.forEach((r, i) => {
        const narrow = len(r) === 0 || to(r) === nextGraphemeBoundary(text, from(r));
        if (!narrow) {
          allNarrow = false;
          const c = rangeCursor(text, r);
          const vr = new vscode.Range(doc.position(c), doc.position(nextGraphemeBoundary(text, c)));
          (i === this.selection.primaryIndex ? primaryCursors : secondaryCursors).push(vr);
        }
        if (i !== this.selection.primaryIndex && this.selection.ranges.length > 1 && !narrow) {
          secondarySelections.push(new vscode.Range(doc.position(from(r)), doc.position(to(r))));
        }
      });
    }
    this.vs.setDecorations(primaryCursorDeco!, primaryCursors);
    this.vs.setDecorations(secondaryCursorDeco!, secondaryCursors);
    this.vs.setDecorations(secondarySelectionDeco!, secondarySelections);
    const style = mode === 'insert' ? vscode.TextEditorCursorStyle.Line : allNarrow ? vscode.TextEditorCursorStyle.Block : vscode.TextEditorCursorStyle.LineThin;
    if (this.vs.options.cursorStyle !== style) this.vs.options = { cursorStyle: style };
  }

  clearDecorations(): void {
    if (!primaryCursorDeco) return;
    this.vs.setDecorations(primaryCursorDeco, []);
    this.vs.setDecorations(secondaryCursorDeco!, []);
    this.vs.setDecorations(secondarySelectionDeco!, []);
  }
}

function selectionsEqual(a: readonly vscode.Selection[], b: readonly vscode.Selection[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!a[i].anchor.isEqual(b[i].anchor) || !a[i].active.isEqual(b[i].active)) return false;
  }
  return true;
}
