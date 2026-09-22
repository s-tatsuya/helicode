// SPDX-License-Identifier: MPL-2.0
// Ported from the Helix editor (https://github.com/helix-editor/helix),
// Copyright (c) 2021 Blaž Hrastnik and the Helix contributors.
// See THIRD-PARTY-NOTICES.md; the rest of Helicode is MIT (see LICENSE).
/**
 * Registers (helix-view/src/register.rs).
 *
 * A register holds a list of values (one per selection). Special registers:
 *   "  default yank register
 *   _  black hole
 *   +  system clipboard (async, handled by the host)
 *   *  primary clipboard (mapped to the system clipboard here)
 *   /  search history (newest first)
 *   :  command history (newest first)
 *   @  macro register (also used as default macro register)
 *   .  selection contents (read-only)
 *   %  current file name (read-only)
 *   #  selection indices (read-only)
 */

export interface RegisterHost {
  readClipboard(): Promise<string>;
  writeClipboard(text: string): Promise<void>;
  currentSelections(): string[] | undefined;
  currentFileName(): string | undefined;
}

const HISTORY_REGISTERS = new Set(['/', ':', '|', '!', '$']);
const HISTORY_LIMIT = 100;

export class Registers {
  private readonly values = new Map<string, string[]>();
  lastSearchRegister = '/';

  constructor(private readonly host: RegisterHost) {}

  async read(name: string): Promise<string[] | undefined> {
    switch (name) {
      case '_':
        return undefined;
      case '+':
      case '*': {
        const text = await this.host.readClipboard();
        return text.length ? [text] : undefined;
      }
      case '.':
        return this.host.currentSelections();
      case '%': {
        const f = this.host.currentFileName();
        return f ? [f] : undefined;
      }
      case '#': {
        const sels = this.host.currentSelections();
        return sels ? sels.map((_, i) => String(i + 1)) : undefined;
      }
      default:
        return this.values.get(name);
    }
  }

  /** Synchronous read for non-clipboard registers (used by prompts/history). */
  readSync(name: string): string[] | undefined {
    if (name === '+' || name === '*' || name === '.' || name === '%' || name === '#' || name === '_') return undefined;
    return this.values.get(name);
  }

  /** Newest value of a register (history registers keep newest first). */
  async first(name: string): Promise<string | undefined> {
    const v = await this.read(name);
    return v?.[0];
  }

  async write(name: string, values: string[]): Promise<void> {
    switch (name) {
      case '_':
        return;
      case '+':
      case '*':
        await this.host.writeClipboard(values.join('\n'));
        return;
      case '.':
      case '%':
      case '#':
        throw new Error(`register ${name} is read-only`);
      default:
        this.values.set(name, values);
    }
  }

  /** Push a value onto a history register (newest first, deduplicated). */
  async push(name: string, value: string): Promise<void> {
    if (name === '+' || name === '*') {
      await this.host.writeClipboard(value);
      return;
    }
    if (name === '_') return;
    const cur = (this.values.get(name) ?? []).filter((v) => v !== value);
    cur.unshift(value);
    if (HISTORY_REGISTERS.has(name) && cur.length > HISTORY_LIMIT) cur.length = HISTORY_LIMIT;
    this.values.set(name, cur);
  }

  clear(name?: string): void {
    if (name === undefined) this.values.clear();
    else this.values.delete(name);
  }

  names(): string[] {
    return [...this.values.keys()];
  }
}
