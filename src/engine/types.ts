import type * as vscode from 'vscode';
import type { Key } from '../core/keys';
import type { Selection } from '../core/range';
import type { VsDoc } from '../vscode/document';
import type { EditorState } from './editor-state';
import type { Engine } from './engine';

export type Mode = 'normal' | 'insert' | 'select';

export interface CommandContext {
  readonly engine: Engine;
  readonly editor: EditorState;
  readonly vs: vscode.TextEditor;
  readonly doc: VsDoc;
  /** Count prefix, defaulting to 1. */
  readonly count: number;
  /** True when the user typed an explicit count. */
  readonly hasCount: boolean;
  readonly register: string | undefined;
  readonly mode: Mode;
  /** True in select mode: motions extend instead of move. */
  readonly extend: boolean;
  readonly selection: Selection;
  /** Register a callback for the next raw key press (Helix's cx.on_next_key). */
  onNextKey(cb: (key: Key) => void | Promise<void>): void;
  setStatus(message: string): void;
  setError(message: string): void;
  /** Cancels the pending keys / minor mode (used by pickers that take over input). */
  readonly keys: readonly Key[];
}

export type CommandFn = (cx: CommandContext) => void | Promise<void>;

export interface CommandInfo {
  name: string;
  doc: string;
  fn: CommandFn;
}
