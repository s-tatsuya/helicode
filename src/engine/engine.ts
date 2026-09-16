/**
 * The engine: modes, key dispatch (counts, registers, minor modes, sticky
 * modes, on-next-key callbacks), macros, the jumplist and command registry.
 * Mirrors helix-term/src/ui/editor.rs + keymap.rs.
 */
import * as vscode from 'vscode';
import { Key, formatKey, keyChar, keysFromTyped, parseKey } from '../core/keys';
import { Registers } from '../core/registers';
import { Selection, primary, fragment } from '../core/range';
import { KeyTrieNode, applyOverrides } from './keymap';
import { defaultKeymaps } from './defaults';
import { EditorState } from './editor-state';
import { CommandContext, CommandFn, CommandInfo, Mode } from './types';
import { docFor } from '../vscode/document';

export interface Jump {
  uri: vscode.Uri;
  selection: Selection;
}

/** helix-view/src/view.rs JumpList */
export class JumpList {
  private jumps: Jump[] = [];
  private current = 0;
  private static readonly CAPACITY = 100;

  push(jump: Jump): void {
    this.jumps = this.jumps.filter((j) => !(j.uri.toString() === jump.uri.toString() && sameSelection(j.selection, jump.selection)));
    this.jumps.push(jump);
    if (this.jumps.length > JumpList.CAPACITY) this.jumps.shift();
    this.current = this.jumps.length;
  }

  backward(count: number, currentJump: Jump): Jump | undefined {
    const target = this.current - count;
    if (target < 0) return undefined;
    if (this.current === this.jumps.length) {
      this.push(currentJump);
    }
    this.current = target;
    return this.jumps[this.current];
  }

  forward(count: number): Jump | undefined {
    if (this.current + count < this.jumps.length) {
      this.current += count;
      return this.jumps[this.current];
    }
    return undefined;
  }

  remove(uri: vscode.Uri): void {
    this.jumps = this.jumps.filter((j) => j.uri.toString() !== uri.toString());
    this.current = Math.min(this.current, this.jumps.length);
  }

  all(): readonly Jump[] {
    return this.jumps;
  }
}

function sameSelection(a: Selection, b: Selection): boolean {
  if (a.ranges.length !== b.ranges.length) return false;
  return a.ranges.every((r, i) => r.anchor === b.ranges[i].anchor && r.head === b.ranges[i].head);
}

export interface EngineConfig {
  jumpLabelAlphabet: string;
  smartCase: boolean;
  wrapAround: boolean;
  scrolloff: number;
  keymapOverrides: Record<string, Record<string, unknown>>;
  shell: string[];
  notebookEscapeQuitsEdit: boolean;
  defaultYankRegister: string;
}

export type StatusRenderer = (engine: Engine) => void;

export class Engine {
  mode: Mode = 'normal';
  keymaps = defaultKeymaps();
  readonly registers: Registers;
  readonly commands = new Map<string, CommandInfo>();
  readonly jumplist = new JumpList();
  config: EngineConfig;

  // dispatcher state
  count: number | undefined;
  selectedRegister: string | undefined;
  pendingKeys: Key[] = [];
  private pendingNode: KeyTrieNode | undefined;
  private sticky: KeyTrieNode | undefined;
  private nextKeyCb: ((key: Key) => void | Promise<void>) | undefined;
  /** Resolves when the running command asks for another key, releasing the key queue. */
  private keyWaiter: (() => void) | undefined;
  /** The command currently in flight (it may be suspended waiting for a key). */
  private runningCommand: Promise<void> | undefined;
  /** Command name currently awaiting keys (for the status line hint). */
  private nextKeyHint: string | undefined;

  // macros
  macroRecording: { register: string; keys: Key[] } | undefined;
  private replayDepth = 0;

  // repeat-last-motion / repeat-last-insert
  lastMotion: ((cx: CommandContext) => void | Promise<void>) | undefined;
  private lastInsert: { command: string; count: number; register: string | undefined; keys: Key[] } | undefined;
  private currentInsert: { command: string; count: number; register: string | undefined; keys: Key[] } | undefined;

  // status
  statusMessage: { text: string; error: boolean } | undefined;
  render: StatusRenderer = () => {};
  /** Hook for the `:` command line, registered by vscode/cmdline.ts. */
  runTyped: ((line: string, cx: CommandContext) => Promise<void>) | undefined;
  /** Last modified document (for `gm`). */
  lastModifiedUri: vscode.Uri | undefined;
  /** Previously active document (for `ga`). */
  lastAccessedUri: vscode.Uri | undefined;
  /** Last picker id (for `space '`). */
  lastPicker: string | undefined;
  /** Whether the engine handles keys at all. */
  enabled = true;
  /** Serialises key handling so async commands do not interleave. */
  private queue: Promise<void> = Promise.resolve();

  private readonly states = new WeakMap<vscode.TextEditor, EditorState>();

  constructor(config: EngineConfig) {
    this.config = config;
    this.registers = new Registers({
      readClipboard: () => Promise.resolve(vscode.env.clipboard.readText()),
      writeClipboard: (t) => Promise.resolve(vscode.env.clipboard.writeText(t)),
      currentSelections: () => {
        const st = this.active();
        return st ? st.selection.ranges.map((r) => fragment(st.text, r)) : undefined;
      },
      currentFileName: () => {
        const ed = vscode.window.activeTextEditor;
        if (!ed) return undefined;
        return vscode.workspace.asRelativePath(ed.document.uri, false);
      },
    });
    this.applyKeymapOverrides();
  }

  applyKeymapOverrides(): void {
    this.keymaps = defaultKeymaps();
    const ov = this.config.keymapOverrides ?? {};
    if (ov.normal) applyOverrides(this.keymaps.normal, ov.normal);
    if (ov.select) applyOverrides(this.keymaps.select, ov.select);
    if (ov.insert) applyOverrides(this.keymaps.insert, ov.insert);
  }

  // -------------------------------------------------------------------
  // Editors
  // -------------------------------------------------------------------

  state(editor: vscode.TextEditor): EditorState {
    let st = this.states.get(editor);
    if (!st) {
      st = new EditorState(editor, () => this.mode);
      this.states.set(editor, st);
    }
    return st;
  }

  hasState(editor: vscode.TextEditor): boolean {
    return this.states.has(editor);
  }

  active(): EditorState | undefined {
    const ed = vscode.window.activeTextEditor;
    return ed ? this.state(ed) : undefined;
  }

  // -------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------

  register(name: string, doc: string, fn: CommandFn): void {
    this.commands.set(name, { name, doc, fn });
  }

  registerAll(defs: Record<string, [string, CommandFn]>): void {
    for (const [name, [doc, fn]] of Object.entries(defs)) this.register(name, doc, fn);
  }

  makeContext(editor: EditorState, opts: { count?: number; register?: string } = {}): CommandContext {
    const engine = this;
    const count = opts.count;
    return {
      engine,
      editor,
      vs: editor.vs,
      doc: editor.doc,
      count: count ?? 1,
      hasCount: count !== undefined,
      register: opts.register,
      mode: this.mode,
      extend: this.mode === 'select',
      get selection() {
        return editor.selection;
      },
      keys: this.pendingKeys,
      onNextKey: (cb) => {
        engine.nextKeyCb = cb;
        const w = engine.keyWaiter;
        engine.keyWaiter = undefined;
        w?.();
      },
      setStatus: (m) => this.setStatus(m),
      setError: (m) => this.setError(m),
    };
  }

  setStatus(text: string): void {
    this.statusMessage = { text, error: false };
    this.render(this);
  }

  setError(text: string): void {
    this.statusMessage = { text, error: true };
    this.render(this);
  }

  /** Execute a named command (Helix static command, `:typed`, or `seq:`). */
  async execute(name: string, opts: { count?: number; register?: string; editor?: EditorState } = {}): Promise<void> {
    const editor = opts.editor ?? this.active();
    if (!editor) return;
    const cx = this.makeContext(editor, opts);
    if (name.startsWith('seq:')) {
      for (const part of name.slice(4).split(';')) await this.execute(part.trim(), opts);
      return;
    }
    if (name.startsWith(':')) {
      if (this.runTyped) await this.runTyped(name.slice(1), cx);
      return;
    }
    if (process.env.HELICODE_TRACE) console.log(`[helicode] execute ${name} mode=${this.mode}`);
    const info = this.commands.get(name);
    if (!info) {
      this.setError(`unknown command: ${name}`);
      return;
    }
    // Commands that enter insert mode are remembered for `.`
    const before = this.mode;
    try {
      await info.fn(cx);
    } catch (e) {
      this.setError(`${name}: ${e instanceof Error ? e.message : String(e)}`);
      console.error('[helicode]', name, e);
    }
    if (process.env.HELICODE_TRACE) console.log(`[helicode] done ${name} mode=${this.mode}`);
    if (before !== 'insert' && this.mode === 'insert') {
      this.currentInsert = { command: name, count: cx.count, register: cx.register, keys: [] };
    }
  }

  // -------------------------------------------------------------------
  // Modes
  // -------------------------------------------------------------------

  setMode(mode: Mode): void {
    if (this.mode === mode) return;
    const prev = this.mode;
    const st = this.active();
    if (prev === 'insert' && st) {
      st.endInsert();
      if (this.currentInsert) {
        this.lastInsert = this.currentInsert;
        this.currentInsert = undefined;
      }
    }
    this.mode = mode;
    if (st) st.refresh();
    this.render(this);
  }

  enterInsertMode(editor: EditorState, sel: Selection, restoreCursor = false): void {
    this.mode = 'insert';
    editor.beginInsert(sel, restoreCursor);
    this.render(this);
  }

  enterNormalMode(): void {
    this.setMode('normal');
  }

  /**
   * Insert text at every cursor while in insert mode without going through
   * `default:type` (used for macro / `.` replay and by the test harness, where
   * the editor may not have keyboard focus).
   */
  async insertTextAtCursors(text: string): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const eol = ed.document.eol === vscode.EndOfLine.CRLF ? '\r\n' : '\n';
    const value = text.replace(/\r\n|\n/g, eol);
    const sels = ed.selections;
    await ed.edit(
      (eb) => {
        for (const s of sels) eb.replace(s, value);
      },
      { undoStopBefore: false, undoStopAfter: false },
    );
    // Compute the cursors ourselves; VS Code's copy of the selections may lag behind the edit.
    const doc = docFor(ed.document);
    const sorted = sels.map((s, i) => ({ s, i })).sort((a, b) => a.s.start.compareTo(b.s.start));
    let delta = 0;
    const next: vscode.Selection[] = new Array(sels.length);
    for (const { s, i } of sorted) {
      const start = doc.offset(s.start) + delta;
      const pos = doc.position(start + value.length);
      next[i] = new vscode.Selection(pos, pos);
      delta += value.length - (doc.offset(s.end) - doc.offset(s.start));
    }
    ed.selections = next;
  }

  /** Called by the `type` override while in insert mode (for `.` repeat and macros). */
  onInsertTyped(text: string): void {
    const keys = keysFromTyped(text);
    if (this.currentInsert) this.currentInsert.keys.push(...keys);
    if (this.macroRecording) this.macroRecording.keys.push(...keys);
  }

  // -------------------------------------------------------------------
  // Key dispatch
  // -------------------------------------------------------------------

  /** Entry point for every key press (serialised). */
  handleKey(key: Key): Promise<void> {
    const run = () => this.handleKeyInner(key);
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  handleTyped(text: string): Promise<void> {
    const keys = keysFromTyped(text);
    let p = Promise.resolve();
    for (const k of keys) p = this.handleKey(k);
    return p;
  }

  private async handleKeyInner(key: Key): Promise<void> {
    const editor = this.active();
    if (!editor) return;
    if (this.macroRecording && this.replayDepth === 0) this.macroRecording.keys.push(key);
    this.statusMessage = undefined;

    // A command is waiting for a raw key.
    if (this.nextKeyCb) {
      const cb = this.nextKeyCb;
      this.nextKeyCb = undefined;
      this.nextKeyHint = undefined;
      await this.untilDoneOrWaiting(async () => {
        try {
          await cb(key);
          // The callback usually just resumes the suspended command; wait for
          // that command to finish (or to ask for yet another key).
          if (this.runningCommand) await this.runningCommand;
        } catch (e) {
          this.setError(e instanceof Error ? e.message : String(e));
        }
      });
      this.afterKey(editor);
      return;
    }

    if (this.mode === 'insert') {
      await this.handleInsertKey(key, editor);
      this.afterKey(editor);
      return;
    }

    // Count handling (helix-term editor.rs: command_mode).
    const ch = keyChar(key);
    if (ch !== undefined && ch >= '0' && ch <= '9' && ch.length === 1) {
      const digit = ch.charCodeAt(0) - 48;
      if (this.count !== undefined) {
        this.count = Math.min(this.count * 10 + digit, 1_000_000);
        this.render(this);
        return;
      }
      if (digit !== 0 && !this.pendingNode && !this.rootTrie().get(key)) {
        this.count = digit;
        this.render(this);
        return;
      }
    }

    // `.` repeats the last insert.
    if (ch === '.' && !this.pendingNode && !this.sticky) {
      await this.repeatLastInsert(editor);
      this.afterKey(editor);
      return;
    }

    const register = this.selectedRegister;
    this.selectedRegister = undefined;
    const result = this.lookup(key);
    switch (result.kind) {
      case 'matched': {
        const count = this.count;
        this.count = undefined;
        await this.untilDoneOrWaiting(() => this.execute(result.command, { count, register, editor }), true);
        break;
      }
      case 'pending':
        // keep count and register for the completed sequence
        this.selectedRegister = register;
        break;
      case 'cancelled':
      case 'notfound':
        this.count = undefined;
        break;
    }
    this.afterKey(editor);
  }

  /**
   * Runs `work` but returns as soon as it either finishes or asks for the next
   * key (via onNextKey), so that the key queue is not blocked by commands such
   * as `f`, `r`, `mi` that wait for more input. The remaining work continues
   * when the next key invokes the registered callback.
   */
  private async untilDoneOrWaiting(work: () => Promise<void>, isCommand = false): Promise<void> {
    const waiting = new Promise<void>((resolve) => {
      this.keyWaiter = resolve;
    });
    const p = work().catch(() => undefined);
    if (isCommand) {
      this.runningCommand = p;
      void p.finally(() => {
        if (this.runningCommand === p) this.runningCommand = undefined;
      });
    }
    await Promise.race([p, waiting]);
    this.keyWaiter = undefined;
  }

  private rootTrie(): KeyTrieNode {
    return this.sticky ?? (this.mode === 'select' ? this.keymaps.select : this.keymaps.normal);
  }

  /** Keymaps::get */
  private lookup(key: Key): { kind: 'matched'; command: string } | { kind: 'pending' } | { kind: 'cancelled' } | { kind: 'notfound' } {
    if (key.code === 'esc' && !key.ctrl && !key.alt) {
      if (this.pendingNode) {
        this.pendingNode = undefined;
        this.pendingKeys = [];
        return { kind: 'cancelled' };
      }
      this.sticky = undefined;
    }
    const node = this.pendingNode ?? this.rootTrie();
    const hit = node.get(key);
    if (hit === undefined) {
      const wasPending = this.pendingNode !== undefined;
      this.pendingNode = undefined;
      this.pendingKeys = [];
      return wasPending ? { kind: 'cancelled' } : { kind: 'notfound' };
    }
    if (typeof hit === 'string') {
      this.pendingNode = undefined;
      this.pendingKeys = [];
      return { kind: 'matched', command: hit };
    }
    if (hit.sticky) {
      this.sticky = hit;
      this.pendingNode = undefined;
      this.pendingKeys = [];
      return { kind: 'pending' };
    }
    this.pendingNode = hit;
    this.pendingKeys = [...this.pendingKeys, key];
    return { kind: 'pending' };
  }

  private async handleInsertKey(key: Key, editor: EditorState): Promise<void> {
    const hit = this.keymaps.insert.get(key);
    if (typeof hit === 'string') {
      if (this.currentInsert) this.currentInsert.keys.push(key);
      await this.untilDoneOrWaiting(() => this.execute(hit, { editor }), true);
      return;
    }
    if (hit instanceof KeyTrieNode) {
      // Nested insert-mode bindings (user defined, e.g. "j k" -> normal_mode).
      const node = hit;
      const first = key;
      this.nextKeyCb = async (k2) => {
        const leaf = node.get(k2);
        if (typeof leaf === 'string') await this.execute(leaf, { editor });
        else {
          // Not a sequence: insert both keys literally.
          const t = (keyChar(first) ?? '') + (keyChar(k2) ?? '');
          if (t) await vscode.commands.executeCommand('default:type', { text: t });
        }
      };
      return;
    }
    // Unbound key in insert mode: type its character if it has one.
    const ch = keyChar(key);
    if (ch !== undefined) {
      this.onInsertTyped(ch);
      await vscode.commands.executeCommand('default:type', { text: ch });
    } else if (key.code === 'ret' && !key.ctrl && !key.alt) {
      await vscode.commands.executeCommand('type', { text: '\n' });
    }
  }

  private afterKey(editor: EditorState): void {
    if (this.mode !== 'insert') editor.decorate();
    this.render(this);
  }

  /** Human readable pending state for the status line. */
  pendingDescription(): string {
    const parts: string[] = [];
    if (this.selectedRegister) parts.push(`"${this.selectedRegister}`);
    if (this.count !== undefined) parts.push(String(this.count));
    if (this.sticky) parts.push(`[${this.sticky.name}]`);
    if (this.pendingNode) parts.push(this.pendingKeys.map(formatKey).join('') + ' ' + (this.pendingNode.name ? `(${this.pendingNode.name})` : ''));
    if (this.nextKeyHint) parts.push(this.nextKeyHint);
    return parts.join(' ');
  }

  setNextKeyHint(hint: string): void {
    this.nextKeyHint = hint;
    this.render(this);
  }

  /** Entries of the current minor mode (which-key style hint). */
  pendingEntries(): { key: string; value: string }[] | undefined {
    const node = this.pendingNode ?? this.sticky;
    if (!node) return undefined;
    return node.entries().map((e) => ({ key: e.key, value: typeof e.value === 'string' ? e.value : `+${e.value.name}` }));
  }

  cancelPending(): void {
    this.pendingNode = undefined;
    this.pendingKeys = [];
    this.nextKeyCb = undefined;
    this.nextKeyHint = undefined;
    this.count = undefined;
    this.selectedRegister = undefined;
    this.render(this);
  }

  get isPending(): boolean {
    return !!(this.pendingNode || this.nextKeyCb || this.sticky);
  }

  // -------------------------------------------------------------------
  // Macros & repeat
  // -------------------------------------------------------------------

  async replayKeys(keys: readonly Key[]): Promise<void> {
    this.replayDepth++;
    try {
      for (const k of keys) {
        if (this.mode === 'insert' && !this.nextKeyCb) {
          const ch = keyChar(k);
          const bound = this.keymaps.insert.get(k);
          if (ch !== undefined && bound === undefined) {
            await this.insertTextAtCursors(ch);
            continue;
          }
        }
        await this.handleKeyInner(k);
      }
    } finally {
      this.replayDepth--;
    }
  }

  private async repeatLastInsert(editor: EditorState): Promise<void> {
    const li = this.lastInsert;
    if (!li) return;
    const count = this.count;
    this.count = undefined;
    const times = count ?? 1;
    for (let i = 0; i < times; i++) {
      await this.execute(li.command, { count: li.count, register: li.register, editor });
      if (this.mode !== 'insert') return;
      await this.replayKeys(li.keys);
      if (this.mode === 'insert') this.enterNormalMode();
    }
    // Do not overwrite lastInsert with the replay.
    this.lastInsert = li;
  }

  parseKeys(spec: string): Key[] {
    // "abc<ret>" style: everything in <> is a named key
    const out: Key[] = [];
    const re = /<([^>]+)>|([\s\S])/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(spec)) !== null) {
      if (m[1] !== undefined) out.push(parseKey(m[1]));
      else out.push(...keysFromTyped(m[2]));
    }
    return out;
  }

  // -------------------------------------------------------------------
  // Jumplist helpers
  // -------------------------------------------------------------------

  pushJump(editor: EditorState): void {
    this.jumplist.push({ uri: editor.vs.document.uri, selection: editor.selection });
  }

  async gotoJump(jump: Jump): Promise<void> {
    const ed = vscode.window.activeTextEditor;
    let target = ed;
    if (!ed || ed.document.uri.toString() !== jump.uri.toString()) {
      try {
        const doc = await vscode.workspace.openTextDocument(jump.uri);
        target = await vscode.window.showTextDocument(doc, { preserveFocus: false });
      } catch {
        this.setError('jump target no longer available');
        return;
      }
    }
    if (!target) return;
    const st = this.state(target);
    const len = docFor(target.document).length;
    const clamped: Selection = {
      ranges: jump.selection.ranges.map((r) => ({ anchor: Math.min(r.anchor, len), head: Math.min(r.head, len) })),
      primaryIndex: jump.selection.primaryIndex,
    };
    st.setSelection(clamped);
  }

  /** Text of the primary selection (used by several pickers). */
  primaryText(editor: EditorState): string {
    return fragment(editor.text, primary(editor.selection));
  }
}
