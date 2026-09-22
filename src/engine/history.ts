// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Document history glue: records VS Code document changes into a Helix-style
 * `History` per document and applies undo/redo through the editor.
 *
 * Revision boundaries follow Helix: one per normal-mode command (including
 * every key it waits for), one per insert session (until Esc or Ctrl-s), and
 * one per change that arrives outside any command (formatters, other
 * extensions). Nested commands (macros, `.`) collapse into one revision.
 */
import * as vscode from 'vscode';
import { History, UndoKind } from '../core/history';
import { Selection } from '../core/range';
import { EditorState } from './editor-state';

const MAX_TRACKED_LENGTH = 8 * 1024 * 1024;

interface DocHistory {
  history: History;
  /** Text as of the last recorded state (or the end of the open transaction). */
  text: string;
  open: { startText: string; selBefore: Selection; time: number } | undefined;
  lastSelection: Selection | undefined;
}

export type UndoMode = 'helix' | 'vscode';

export class HistoryManager {
  private readonly docs = new Map<string, DocHistory>();
  /** > 0 while a command runs: changes are grouped until it finishes. */
  private holdDepth = 0;
  /** Documents that changed during the current hold. */
  private readonly dirty = new Set<string>();
  /** True while this manager applies an undo/redo edit itself. */
  private applying = false;
  /** Insert sessions keep the transaction open across commands. */
  insertOpen = false;
  mode: UndoMode = 'helix';

  track(document: vscode.TextDocument, selection?: Selection): void {
    const key = document.uri.toString();
    if (this.docs.has(key)) return;
    const text = document.getText();
    if (text.length > MAX_TRACKED_LENGTH) return;
    this.docs.set(key, { history: new History(Date.now(), selection), text, open: undefined, lastSelection: selection });
  }

  forget(document: vscode.TextDocument): void {
    this.docs.delete(document.uri.toString());
  }

  /** Remember the selection a command starts from (used as `selBefore`). */
  noteSelection(document: vscode.TextDocument, selection: Selection): void {
    const h = this.docs.get(document.uri.toString());
    if (h) h.lastSelection = selection;
  }

  hold(): void {
    this.holdDepth++;
  }

  /** End a hold; commits the pending transactions unless an insert session is open. */
  release(selAfter: (uri: string) => Selection | undefined): void {
    if (this.holdDepth > 0) this.holdDepth--;
    if (this.holdDepth === 0 && !this.insertOpen) this.commitAll(selAfter);
  }

  get holding(): boolean {
    return this.holdDepth > 0 || this.insertOpen;
  }

  onDidChange(e: vscode.TextDocumentChangeEvent, selection: Selection | undefined): void {
    if (e.contentChanges.length === 0) return;
    const key = e.document.uri.toString();
    const h = this.docs.get(key);
    if (!h) {
      // Untracked (opened before we saw it, or too large): start tracking from here.
      this.track(e.document, selection);
      return;
    }
    if (this.applying) {
      h.text = e.document.getText();
      return;
    }
    if (!h.open) h.open = { startText: h.text, selBefore: h.lastSelection ?? selection ?? rootSelection(), time: Date.now() };
    h.text = e.document.getText();
    if (h.text.length > MAX_TRACKED_LENGTH) {
      this.docs.delete(key);
      return;
    }
    if (this.holding) this.dirty.add(key);
    else this.commit(key, selection);
  }

  /** Close the open transaction of one document. */
  commit(key: string, selAfter: Selection | undefined): void {
    const h = this.docs.get(key);
    if (!h || !h.open) return;
    const { startText, selBefore, time } = h.open;
    h.open = undefined;
    this.dirty.delete(key);
    if (startText === h.text) return;
    h.history.commit(startText, h.text, selBefore, selAfter, time);
    if (selAfter) h.lastSelection = selAfter;
  }

  commitAll(selAfter: (uri: string) => Selection | undefined): void {
    for (const key of [...this.dirty]) this.commit(key, selAfter(key));
    this.dirty.clear();
  }

  commitDocument(document: vscode.TextDocument, selAfter: Selection | undefined): void {
    this.commit(document.uri.toString(), selAfter);
  }

  hasHistory(document: vscode.TextDocument): boolean {
    return this.docs.has(document.uri.toString());
  }

  /** Steps that `earlier` / `later` would take (0 when nothing to do). */
  steps(document: vscode.TextDocument, kind: UndoKind, direction: 'earlier' | 'later'): number {
    const h = this.docs.get(document.uri.toString());
    if (!h) return 0;
    return direction === 'earlier' ? h.history.stepsEarlier(kind) : h.history.stepsLater(kind);
  }

  /**
   * Undo (`count` < 0) or redo (`count` > 0) revisions on the editor's document.
   * Returns 'done', 'fallback' when this document has no usable history (the
   * caller should use the host's undo), or a status message.
   */
  async step(editor: EditorState, count: number): Promise<'done' | 'fallback' | string> {
    const doc = editor.vs.document;
    const key = doc.uri.toString();
    const h = this.docs.get(key);
    if (!h) return 'fallback';
    this.commit(key, editor.selection);
    if (h.text !== doc.getText() || !h.history.matches(h.text)) {
      // We lost track of the document (missed events): resync and give up on this step.
      this.docs.delete(key);
      this.track(doc, editor.selection);
      return 'fallback';
    }
    let done = 0;
    const n = Math.abs(count);
    for (let i = 0; i < n; i++) {
      const rev = count < 0 ? h.history.peekUndo() : h.history.peekRedo();
      if (!rev) break;
      const change = count < 0 ? rev.inverse : rev.change;
      const sel = count < 0 ? rev.selBefore : rev.selAfter;
      this.applying = true;
      let ok = false;
      try {
        const range = new vscode.Range(doc.positionAt(change.from), doc.positionAt(change.to));
        ok = await editor.vs.edit((eb) => eb.replace(range, change.text), { undoStopBefore: true, undoStopAfter: true });
      } finally {
        this.applying = false;
      }
      if (!ok) break;
      h.text = doc.getText();
      if (count < 0) h.history.markUndone();
      else h.history.markRedone();
      h.lastSelection = sel;
      editor.setSelection(clampSelection(sel, h.text.length));
      done++;
    }
    if (done === 0) return count < 0 ? 'Already at oldest change' : 'Already at newest change';
    return 'done';
  }
}

function rootSelection(): Selection {
  return { ranges: [{ anchor: 0, head: 0 }], primaryIndex: 0 };
}

function clampSelection(sel: Selection, len: number): Selection {
  const ranges = sel.ranges.map((r) => ({ anchor: Math.min(r.anchor, len), head: Math.min(r.head, len) }));
  return { ranges, primaryIndex: Math.min(sel.primaryIndex, ranges.length - 1) };
}
