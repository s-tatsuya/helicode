/**
 * Register picker (Helix shows the register list in the infobox when `"` is
 * pressed and in `:registers`): a QuickPick listing every register with a
 * preview of its content. Selecting one makes it the pending register, so
 * `"` `<pick>` `p` works like typing the name.
 */
import * as vscode from 'vscode';
import { Engine } from '../engine/engine';
import { CommandContext } from '../engine/types';

/** Registers with a fixed meaning, in the order Helix documents them. */
const SPECIAL: [string, string][] = [
  ['"', 'default yank register'],
  ['_', 'black hole (discards)'],
  ['+', 'system clipboard'],
  ['*', 'primary clipboard'],
  ['/', 'search history'],
  [':', 'command history'],
  ['@', 'default macro register'],
  ['.', 'selection contents'],
  ['%', 'current file name'],
  ['#', 'selection indices'],
];

export function registerPreview(values: string[] | undefined): string {
  if (!values || values.length === 0) return '(empty)';
  const first = values[0].replace(/\n/g, '\\n');
  const head = first.length > 80 ? first.slice(0, 80) + '...' : first;
  return values.length > 1 ? `${head}   (+${values.length - 1} more)` : head;
}

export interface RegisterEntry {
  name: string;
  description: string;
  values: string[] | undefined;
}

/** Every register with content, plus the special ones. */
export async function registerEntries(engine: Engine): Promise<RegisterEntry[]> {
  const out: RegisterEntry[] = [];
  const seen = new Set<string>();
  for (const [name, description] of SPECIAL) {
    seen.add(name);
    out.push({ name, description, values: await engine.registers.read(name).catch(() => undefined) });
  }
  for (const name of engine.registers.names().sort()) {
    if (seen.has(name)) continue;
    out.push({ name, description: '', values: engine.registers.readSync(name) });
  }
  return out;
}

/** `"` with no key yet: show the picker and resolve with the chosen name. */
export async function pickRegister(engine: Engine, title = 'Select register'): Promise<string | undefined> {
  const entries = await registerEntries(engine);
  const items = entries.map((e) => ({
    label: e.name,
    description: e.description,
    detail: registerPreview(e.values),
  }));
  const picked = await vscode.window.showQuickPick(items, { title, placeHolder: 'register name' });
  return picked?.label;
}

/** `:registers` - open the full list in a scratch buffer. */
export async function showRegisters(cx: CommandContext): Promise<void> {
  const entries = await registerEntries(cx.engine);
  const lines = ['# Registers', ''];
  for (const e of entries) {
    const values = e.values ?? [];
    lines.push(`## "${e.name}${e.description ? ` - ${e.description}` : ''}`);
    lines.push('');
    if (values.length === 0) lines.push('(empty)');
    else values.forEach((v, i) => lines.push('```', values.length > 1 ? `[${i + 1}] ${v}` : v, '```'));
    lines.push('');
  }
  const doc = await vscode.workspace.openTextDocument({ content: lines.join('\n'), language: 'markdown' });
  await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside, preserveFocus: true });
}
