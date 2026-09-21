/**
 * Prompts: Helix-style incremental regex prompt (search / select / split /
 * keep / remove) and a plain input prompt, built on VS Code's QuickPick.
 *
 * All prompts (including the `:` command line) support Helix's `Ctrl-r <reg>`
 * to insert a register: the keybinding sets `helicode.promptOpen`, the
 * `helicode.promptKey` command arms the next typed character as the register
 * name.
 */
import * as vscode from 'vscode';
import { buildRegex } from '../core/search';
import { CommandContext } from '../engine/types';
import { Engine } from '../engine/engine';

/** The prompt currently shown, if any (for `helicode.promptKey`). */
let activePrompt: { awaitRegister(): void } | undefined;

export function promptKey(key: string): void {
  if (key === 'C-r') activePrompt?.awaitRegister();
}

/**
 * Wire a QuickPick as a Helicode prompt: registers it as the active prompt,
 * sets the `helicode.promptOpen` context and implements `Ctrl-r <register>`.
 * Returns a function that must be called from `onDidChangeValue` first; it
 * returns true when the change was consumed (register name typed).
 */
export function attachPrompt(qp: vscode.QuickPick<vscode.QuickPickItem>, engine: Engine): (value: string) => boolean {
  let awaiting = false;
  let before = '';
  let placeholder: string | undefined;
  const me = {
    awaitRegister() {
      if (awaiting) return;
      awaiting = true;
      before = qp.value;
      placeholder = qp.placeholder;
      qp.placeholder = 'register? (" a-z + * / : @ . % #)';
    },
  };
  activePrompt = me;
  void vscode.commands.executeCommand('setContext', 'helicode.promptOpen', true);
  qp.onDidHide(() => {
    if (activePrompt === me) activePrompt = undefined;
    void vscode.commands.executeCommand('setContext', 'helicode.promptOpen', false);
  });
  return (value: string): boolean => {
    if (!awaiting) return false;
    awaiting = false;
    qp.placeholder = placeholder;
    // The typed register name is the character that was added to the old value.
    let name: string | undefined;
    if (value.length === before.length + 1) {
      let i = 0;
      while (i < before.length && before[i] === value[i]) i++;
      name = value[i];
    }
    if (!name) {
      qp.value = before;
      return true;
    }
    void engine.registers.read(name).then((values) => {
      const content = values?.[0] ?? '';
      qp.value = before + content;
    });
    return true;
  };
}

export interface RegexPromptOptions {
  prompt: string;
  /** History register to read completions from and push the result to. */
  register?: string;
  /** Called on every keystroke with the compiled regex (undefined when invalid/empty). */
  onUpdate?: (re: RegExp | undefined, value: string) => void;
  onValidate: (re: RegExp, value: string) => void | Promise<void>;
  onCancel?: () => void;
  initial?: string;
}

/**
 * Opens an input box that behaves like Helix's regex prompt: live preview on
 * change, Enter validates, Escape restores. Up/Down move through the history
 * offered as completions.
 */
export function regexPrompt(cx: CommandContext, opts: RegexPromptOptions): Promise<void> {
  const smartCase = cx.engine.config.smartCase;
  const history = opts.register ? (cx.engine.registers.readSync(opts.register) ?? []) : [];
  return new Promise<void>((resolve) => {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { value: string }>();
    qp.title = undefined;
    qp.placeholder = opts.prompt;
    qp.matchOnDescription = false;
    qp.ignoreFocusOut = false;
    qp.items = history.slice(0, 50).map((h) => ({ label: h, value: h, description: 'history' }));
    qp.value = opts.initial ?? '';
    const consumeRegister = attachPrompt(qp, cx.engine);
    let accepted = false;

    const compile = (v: string): RegExp | undefined => {
      if (!v) return undefined;
      try {
        return buildRegex(v, smartCase);
      } catch {
        return undefined;
      }
    };

    qp.onDidChangeValue((v) => {
      if (consumeRegister(v)) return;
      // Keep history visible but do not filter it into the way of typing.
      qp.items = history.filter((h) => h.includes(v)).slice(0, 50).map((h) => ({ label: h, value: h, description: 'history' }));
      opts.onUpdate?.(compile(v), v);
    });
    qp.onDidAccept(async () => {
      accepted = true;
      const active = qp.activeItems[0];
      const value = qp.value || (active ? active.value : '');
      qp.hide();
      if (!value) {
        opts.onCancel?.();
        resolve();
        return;
      }
      const re = compile(value);
      if (!re) {
        cx.setError(`Invalid regex: ${value}`);
        opts.onCancel?.();
        resolve();
        return;
      }
      if (opts.register) await cx.engine.registers.push(opts.register, value);
      try {
        await opts.onValidate(re, value);
      } catch (e) {
        cx.setError(e instanceof Error ? e.message : String(e));
      }
      resolve();
    });
    qp.onDidHide(() => {
      if (!accepted) {
        opts.onCancel?.();
        resolve();
      }
      qp.dispose();
    });
    if (opts.initial) opts.onUpdate?.(compile(opts.initial), opts.initial);
    qp.show();
  });
}

export interface InputPromptOptions {
  prompt: string;
  value?: string;
  register?: string;
  placeholder?: string;
  password?: boolean;
}

/** Plain text prompt with history (for shell commands, rename, etc.). */
export function inputPrompt(cx: CommandContext, opts: InputPromptOptions): Promise<string | undefined> {
  const history = opts.register ? (cx.engine.registers.readSync(opts.register) ?? []) : [];
  return new Promise<string | undefined>((resolve) => {
    const qp = vscode.window.createQuickPick<vscode.QuickPickItem & { value: string }>();
    qp.placeholder = opts.placeholder ?? opts.prompt;
    qp.value = opts.value ?? '';
    qp.items = history.slice(0, 50).map((h) => ({ label: h, value: h, description: 'history' }));
    const consumeRegister = attachPrompt(qp, cx.engine);
    let accepted = false;
    qp.onDidChangeValue((v) => {
      if (consumeRegister(v)) return;
      qp.items = history.filter((h) => h.includes(v)).slice(0, 50).map((h) => ({ label: h, value: h, description: 'history' }));
    });
    qp.onDidAccept(async () => {
      accepted = true;
      const active = qp.activeItems[0];
      const value = qp.value || (active ? active.value : '');
      qp.hide();
      if (value && opts.register) await cx.engine.registers.push(opts.register, value);
      resolve(value || undefined);
    });
    qp.onDidHide(() => {
      if (!accepted) resolve(undefined);
      qp.dispose();
    });
    qp.show();
  });
}
