/**
 * Key trie (helix-term/src/keymap.rs).
 */
import { Key, formatKey, parseKey } from '../core/keys';

export interface KeyTrieSpec {
  /** Human readable name shown in the pending-key hint. */
  __name?: string;
  /** Sticky minor modes stay active after a command runs (until Esc). */
  __sticky?: boolean;
  [keys: string]: string | KeyTrieSpec | boolean | undefined;
}

export class KeyTrieNode {
  readonly children = new Map<string, KeyTrieNode | string>();
  constructor(
    public name: string,
    public sticky = false,
  ) {}

  get(k: Key): KeyTrieNode | string | undefined {
    return this.children.get(formatKey(k));
  }

  set(k: Key, value: KeyTrieNode | string): void {
    this.children.set(formatKey(k), value);
  }

  clone(): KeyTrieNode {
    const n = new KeyTrieNode(this.name, this.sticky);
    for (const [k, v] of this.children) n.children.set(k, typeof v === 'string' ? v : v.clone());
    return n;
  }

  /** Merge `other` into this node (other wins on conflicts), recursively. */
  merge(other: KeyTrieNode): void {
    for (const [k, v] of other.children) {
      const mine = this.children.get(k);
      if (mine instanceof KeyTrieNode && v instanceof KeyTrieNode) mine.merge(v);
      else this.children.set(k, typeof v === 'string' ? v : v.clone());
    }
  }

  /** Flat listing for docs / which-key style hints. */
  entries(): { key: string; value: string | KeyTrieNode }[] {
    return [...this.children.entries()].map(([key, value]) => ({ key, value }));
  }
}

export function buildTrie(spec: KeyTrieSpec, name = ''): KeyTrieNode {
  const node = new KeyTrieNode(spec.__name ?? name, !!spec.__sticky);
  for (const [keys, value] of Object.entries(spec)) {
    if (keys.startsWith('__')) continue;
    if (value === undefined || typeof value === 'boolean') continue;
    for (const spec1 of keys.split(' | ')) {
      const k = parseKey(spec1);
      node.set(k, typeof value === 'string' ? value : buildTrie(value, spec1));
    }
  }
  return node;
}

/**
 * Apply user overrides written in Helix config.toml style, e.g.
 *   { "normal": { "C-s": ":w", "g": { "a": "code_action" } }, "insert": { "j": { "k": "normal_mode" } } }
 */
export function applyOverrides(root: KeyTrieNode, overrides: Record<string, unknown>): void {
  for (const [keys, value] of Object.entries(overrides)) {
    if (keys.startsWith('__')) continue;
    for (const spec1 of keys.split(' | ')) {
      const k = parseKey(spec1);
      if (typeof value === 'string') {
        root.set(k, value);
      } else if (Array.isArray(value)) {
        // A sequence of commands: encoded as "seq:cmd1;cmd2" and expanded by the dispatcher.
        root.set(k, 'seq:' + value.map(String).join(';'));
      } else if (value && typeof value === 'object') {
        const existing = root.get(k);
        const child = existing instanceof KeyTrieNode ? existing : new KeyTrieNode(spec1);
        applyOverrides(child, value as Record<string, unknown>);
        root.set(k, child);
      } else if (value === null) {
        root.children.delete(formatKey(k));
      }
    }
  }
}
