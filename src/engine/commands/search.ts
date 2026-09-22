// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Search commands: / ? n N * Alt-* and the regex based selection commands s S K Alt-K.
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { Direction, Selection, primary, cursor as rangeCursor } from '../../core/range';
import { buildRegex, searchNext, selectOnMatches, splitOnMatches, keepOrRemoveMatches, selectionToRegex } from '../../core/search';
import { regexPrompt } from '../../vscode/prompt';

let searchHighlight: vscode.TextEditorDecorationType | undefined;

function highlightType(): vscode.TextEditorDecorationType {
  if (!searchHighlight) {
    searchHighlight = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
    });
  }
  return searchHighlight;
}

export function disposeSearchDecorations(): void {
  searchHighlight?.dispose();
  searchHighlight = undefined;
}

function searchImpl(cx: CommandContext, re: RegExp, dir: Direction, extend: boolean, showWarnings: boolean): boolean {
  const text = cx.doc.text;
  const res = searchNext(text, cx.selection, re, dir, extend, cx.engine.config.wrapAround);
  if (!res) {
    if (showWarnings) cx.setError('No more matches');
    return false;
  }
  if (res.wrapped && showWarnings) cx.setStatus('Wrapped around document');
  cx.editor.setSelection(res.selection);
  cx.vs.revealRange(cx.vs.selection, vscode.TextEditorRevealType.InCenterIfOutsideViewport);
  return true;
}

function search(dir: Direction, extend: boolean): CommandFn {
  return async (cx) => {
    const reg = cx.register ?? '/';
    const original = cx.selection;
    const deco = highlightType();
    const doc = cx.doc;
    await regexPrompt(cx, {
      prompt: dir === Direction.Forward ? 'search:' : 'reverse search:',
      register: reg,
      onUpdate: (re) => {
        cx.editor.setSelection(original, { reveal: false });
        if (!re) {
          cx.vs.setDecorations(deco, []);
          return;
        }
        searchImpl(cx, re, dir, extend, false);
        // highlight all matches in the visible area
        const t = doc.text;
        const ranges: vscode.Range[] = [];
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        let n = 0;
        while ((m = re.exec(t)) !== null && n < 2000) {
          if (m[0].length === 0) {
            re.lastIndex++;
            continue;
          }
          ranges.push(new vscode.Range(doc.position(m.index), doc.position(m.index + m[0].length)));
          n++;
        }
        cx.vs.setDecorations(deco, ranges);
      },
      onValidate: (re) => {
        cx.vs.setDecorations(deco, []);
        cx.editor.setSelection(original, { reveal: false });
        cx.engine.registers.lastSearchRegister = reg;
        cx.engine.pushJump(cx.editor);
        searchImpl(cx, re, dir, extend, true);
      },
      onCancel: () => {
        cx.vs.setDecorations(deco, []);
        cx.editor.setSelection(original);
      },
    });
  };
}

export const searchCmd = search(Direction.Forward, false);
export const rsearch = search(Direction.Backward, false);

function searchNextOrPrev(dir: Direction, extend: boolean): CommandFn {
  return async (cx) => {
    const reg = cx.register ?? cx.engine.registers.lastSearchRegister;
    const query = await cx.engine.registers.first(reg);
    if (!query) {
      cx.setError('No search pattern');
      return;
    }
    let re: RegExp;
    try {
      re = buildRegex(query, cx.engine.config.smartCase);
    } catch {
      cx.setError(`Invalid regex: ${query}`);
      return;
    }
    for (let i = 0; i < cx.count; i++) searchImpl(cx, re, dir, extend, true);
  };
}

export const searchNextCmd = searchNextOrPrev(Direction.Forward, false);
export const searchPrev = searchNextOrPrev(Direction.Backward, false);
export const extendSearchNext = searchNextOrPrev(Direction.Forward, true);
export const extendSearchPrev = searchNextOrPrev(Direction.Backward, true);

function searchSelectionImpl(detectWordBoundaries: boolean): CommandFn {
  return async (cx) => {
    const register = cx.register ?? '/';
    const regex = selectionToRegex(cx.doc.text, cx.selection, detectWordBoundaries);
    await cx.engine.registers.push(register, regex);
    cx.engine.registers.lastSearchRegister = register;
    cx.setStatus(`register '${register}' set to '${regex}'`);
  };
}

export const searchSelection = searchSelectionImpl(false);
export const searchSelectionDetectWordBoundaries = searchSelectionImpl(true);

// ---------------------------------------------------------------------------
// s / S / K / Alt-K
// ---------------------------------------------------------------------------

function regexSelectionCommand(prompt: string, apply: (text: string, sel: Selection, re: RegExp) => Selection | undefined, emptyError: string): CommandFn {
  return async (cx) => {
    const reg = cx.register ?? '/';
    const original = cx.selection;
    await regexPrompt(cx, {
      prompt,
      register: reg,
      onUpdate: (re) => {
        if (!re) {
          cx.editor.setSelection(original, { reveal: false });
          return;
        }
        const sel = apply(cx.doc.text, original, re);
        cx.editor.setSelection(sel ?? original, { reveal: false });
      },
      onValidate: (re) => {
        const sel = apply(cx.doc.text, original, re);
        if (sel) cx.editor.setSelection(sel);
        else {
          cx.editor.setSelection(original);
          cx.setError(emptyError);
        }
      },
      onCancel: () => cx.editor.setSelection(original),
    });
  };
}

export const selectRegex = regexSelectionCommand('select:', selectOnMatches, 'nothing selected');
export const splitSelection = regexSelectionCommand('split:', splitOnMatches, 'nothing selected');
export const keepSelections = regexSelectionCommand('keep:', (t, s, re) => keepOrRemoveMatches(t, s, re, false), 'no selections remaining');
export const removeSelections = regexSelectionCommand('remove:', (t, s, re) => keepOrRemoveMatches(t, s, re, true), 'no selections remaining');

/** Global search: hand off to VS Code's search view with the primary selection as the query. */
export const globalSearch: CommandFn = async (cx) => {
  const text = cx.doc.text;
  const p = primary(cx.selection);
  const query = text.slice(Math.min(p.anchor, p.head), Math.max(p.anchor, p.head));
  await vscode.commands.executeCommand('workbench.action.findInFiles', {
    query: query.length > 1 && !query.includes('\n') ? query : '',
    triggerSearch: false,
    isRegex: true,
  });
  void rangeCursor;
};
