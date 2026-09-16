/**
 * Prompts: Helix-style incremental regex prompt (search / select / split /
 * keep / remove) and a plain input prompt, built on VS Code's InputBox.
 */
import * as vscode from 'vscode';
import { buildRegex } from '../core/search';
import { CommandContext } from '../engine/types';

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
 * change, Enter validates, Escape restores. Up/Down cycle history via the
 * quick pick history list (VS Code has no up/down hook for InputBox, so the
 * history is offered as completions with a QuickPick when the prompt is empty).
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
    let accepted = false;
    let lastValue = qp.value;

    const compile = (v: string): RegExp | undefined => {
      if (!v) return undefined;
      try {
        return buildRegex(v, smartCase);
      } catch {
        return undefined;
      }
    };

    qp.onDidChangeValue((v) => {
      lastValue = v;
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
    void lastValue;
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
    let accepted = false;
    qp.onDidChangeValue((v) => {
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
