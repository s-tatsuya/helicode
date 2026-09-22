// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Shell commands: | Alt-| ! Alt-! $ and the :pipe/:insert-output/:sh family.
 */
import * as vscode from 'vscode';
import { CommandContext, CommandFn } from '../types';
import { isWeb, platform, env } from '../../platform';
import { Range, range as mkRange, from, to, direction, withDirection, selection as mkSelection, fragment } from '../../core/range';
import { Change } from '../../core/changes';
import { inputPrompt } from '../../vscode/prompt';
import { exitSelectMode } from './util';

export interface ShellResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export function shellCommandLine(cx: CommandContext): string[] {
  const configured = cx.engine.config.shell;
  if (configured && configured.length) return configured;
  if (platform === 'win32') return ['powershell', '-NoProfile', '-Command'];
  return [env('SHELL') || '/bin/sh', '-c'];
}

/** `node:child_process`, loaded lazily so the module also bundles for the web extension host. */
async function childProcess(): Promise<typeof import('node:child_process')> {
  if (isWeb) throw new Error('shell commands are not available in the web extension host');
  return import('node:child_process');
}

export async function runShell(cx: CommandContext, command: string, input: string | undefined): Promise<ShellResult> {
  const [prog, ...args] = shellCommandLine(cx);
  const cwd = vscode.workspace.getWorkspaceFolder(cx.vs.document.uri)?.uri.fsPath ?? vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? env('PWD') ?? undefined;
  const { spawn } = await childProcess();
  return new Promise((resolve, reject) => {
    const child = spawn(prog, [...args, command], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (d: string) => (stdout += d));
    child.stderr.on('data', (d: string) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code: number | null) => resolve({ stdout, stderr, code }));
    if (input !== undefined) child.stdin.end(input);
    else child.stdin.end();
  });
}

export const enum ShellBehavior {
  Replace,
  Ignore,
  Insert,
  Append,
}

export async function shellImpl(cx: CommandContext, command: string, behavior: ShellBehavior): Promise<void> {
  const text = cx.doc.text;
  const sel = cx.selection;
  const changes: Change[] = [];
  const ranges: Range[] = new Array(sel.ranges.length);
  let offs = 0;
  const order = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => from(a.r) - from(b.r));
  let shellOutput: string | undefined;
  for (const { r, i } of order) {
    const input = behavior === ShellBehavior.Replace || behavior === ShellBehavior.Ignore ? fragment(text, r) : undefined;
    let output: string;
    if (input === undefined && shellOutput !== undefined) output = shellOutput;
    else {
      const res = await runShell(cx, command, input);
      if (res.code !== 0 && res.code !== null) {
        cx.setError(`Command failed (${res.code}): ${res.stderr.trim().split('\n')[0] || command}`);
        return;
      }
      output = res.stdout;
      if (input === undefined) shellOutput = output;
    }
    if (behavior === ShellBehavior.Ignore) {
      ranges[i] = r;
      continue;
    }
    let f: number;
    let t: number;
    if (behavior === ShellBehavior.Replace) {
      f = from(r);
      t = to(r);
    } else if (behavior === ShellBehavior.Insert) {
      f = t = from(r);
    } else {
      f = t = to(r);
    }
    changes.push({ from: f, to: t, text: output });
    const start = f + offs;
    ranges[i] = withDirection(mkRange(start, start + output.length), direction(r));
    offs += output.length - (t - f);
  }
  if (behavior === ShellBehavior.Ignore) {
    cx.setStatus('Command executed');
    return;
  }
  await cx.editor.apply(changes, { selection: mkSelection(ranges, sel.primaryIndex) });
  exitSelectMode(cx);
}

/**
 * Put `output` at every selection: replace it, or insert before / append after
 * it. Used by `:popup` (output produced elsewhere, e.g. a Corral popup terminal).
 */
export async function insertOutputAtSelections(cx: CommandContext, output: string, behavior: ShellBehavior.Replace | ShellBehavior.Insert | ShellBehavior.Append): Promise<void> {
  const sel = cx.selection;
  const changes: Change[] = [];
  const ranges: Range[] = new Array(sel.ranges.length);
  let offs = 0;
  const order = sel.ranges.map((r, i) => ({ r, i })).sort((a, b) => from(a.r) - from(b.r));
  for (const { r, i } of order) {
    let f: number;
    let t: number;
    if (behavior === ShellBehavior.Replace) {
      f = from(r);
      t = to(r);
    } else if (behavior === ShellBehavior.Insert) {
      f = t = from(r);
    } else {
      f = t = to(r);
    }
    changes.push({ from: f, to: t, text: output });
    const start = f + offs;
    ranges[i] = withDirection(mkRange(start, start + output.length), direction(r));
    offs += output.length - (t - f);
  }
  await cx.editor.apply(changes, { selection: mkSelection(ranges, sel.primaryIndex) });
  exitSelectMode(cx);
}

function shellPrompt(prompt: string, behavior: ShellBehavior): CommandFn {
  return async (cx) => {
    const cmd = await inputPrompt(cx, { prompt, register: '|' });
    if (!cmd) return;
    await shellImpl(cx, cmd, behavior);
  };
}

export const shellPipe = shellPrompt('pipe:', ShellBehavior.Replace);
export const shellPipeTo = shellPrompt('pipe-to:', ShellBehavior.Ignore);
export const shellInsertOutput = shellPrompt('insert-output:', ShellBehavior.Insert);
export const shellAppendOutput = shellPrompt('append-output:', ShellBehavior.Append);

export const shellKeepPipe: CommandFn = async (cx) => {
  const cmd = await inputPrompt(cx, { prompt: 'keep-pipe:', register: '|' });
  if (!cmd) return;
  const text = cx.doc.text;
  const sel = cx.selection;
  const keep: Range[] = [];
  let primaryIndex = 0;
  for (let i = 0; i < sel.ranges.length; i++) {
    const r = sel.ranges[i];
    const res = await runShell(cx, cmd, fragment(text, r));
    if (res.code === 0) {
      if (i === sel.primaryIndex) primaryIndex = keep.length;
      keep.push(r);
    }
  }
  if (keep.length === 0) {
    cx.setError('No selections remaining');
    return;
  }
  cx.editor.setSelection(mkSelection(keep, Math.min(primaryIndex, keep.length - 1)));
};
