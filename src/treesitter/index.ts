/**
 * Tree-sitter integration via web-tree-sitter (WASM).
 *
 * - Grammars: bundled `wasm/tree-sitter-<name>.wasm` (from @vscode/tree-sitter-wasm)
 *   plus user supplied ones (`helicode.treeSitter.extraGrammars`).
 * - Queries: `queries/<lang>/textobjects.scm` vendored from Helix.
 * - Trees are parsed lazily per document and updated incrementally.
 */
import * as vscode from 'vscode';
import type { Parser as ParserT, Language as LanguageT, Tree, Node, Query, Edit } from 'web-tree-sitter';
import { readQueryFile } from './queries';
import { SyntaxMatcher } from '../core/surround';
import { PAIRS, findMatchingBracketPlaintext } from '../core/brackets';
import { Direction } from '../core/range';
import { basename } from '../core/paths';
import { trace } from '../platform';
import languagesJson from './languages.json';
import grammarsJson from '../../grammars.json';

type WTS = typeof import('web-tree-sitter');

let wts: WTS | undefined;
let initPromise: Promise<void> | undefined;
let extensionUri: vscode.Uri | undefined;
let storageUri: vscode.Uri | undefined;
const languages = new Map<string, Promise<LanguageT | undefined>>();
const queries = new Map<string, Promise<Query | undefined>>();
const output = vscode.window.createOutputChannel('Helicode');

export function log(msg: string): void {
  output.appendLine(`[${new Date().toISOString()}] ${msg}`);
  if (trace) console.log('[helicode:ts]', msg);
}

export function showLog(): void {
  output.show(true);
}

/** VS Code languageId -> [grammar file name, helix query language name]. */
const LANGUAGE_MAP: Record<string, [string, string]> = Object.fromEntries(Object.entries(languagesJson).filter(([k]) => !k.startsWith('$'))) as Record<string, [string, string]>;

export interface GrammarInfo {
  url: string;
  sha256: string;
  bundled: boolean;
  license: string;
  source: string;
}

/** Grammars known to the manifest (bundled or installable on demand). */
export const GRAMMARS: Record<string, GrammarInfo> = grammarsJson.grammars as Record<string, GrammarInfo>;

function extraGrammars(): Record<string, { wasm: string; queries?: string; language?: string }> {
  return vscode.workspace.getConfiguration('helicode').get('treeSitter.extraGrammars', {}) ?? {};
}

export function isEnabled(): boolean {
  return vscode.workspace.getConfiguration('helicode').get<boolean>('treeSitter.enabled', true);
}

async function exists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

export function init(extUri: vscode.Uri, globalStorage: vscode.Uri): Promise<void> {
  extensionUri = extUri;
  storageUri = globalStorage;
  if (!initPromise) {
    initPromise = (async () => {
      const mod = (await import('web-tree-sitter')) as unknown as WTS;
      const wasmBinary = await vscode.workspace.fs.readFile(vscode.Uri.joinPath(extUri, 'wasm', 'web-tree-sitter.wasm'));
      await mod.Parser.init({ wasmBinary });
      wts = mod;
      log('tree-sitter runtime initialised');
    })().catch((e) => {
      log(`tree-sitter init failed: ${e}`);
      wts = undefined;
    });
  }
  return initPromise;
}

/** Turn a user supplied path (settings) into a Uri. */
function uriFromSetting(p: string): vscode.Uri {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) return vscode.Uri.parse(p);
  return vscode.Uri.file(p);
}

function installedGrammarUri(name: string): vscode.Uri | undefined {
  return storageUri ? vscode.Uri.joinPath(storageUri, 'grammars', `tree-sitter-${name}.wasm`) : undefined;
}

interface GrammarSpec {
  /** Candidate locations, first existing one wins. */
  wasm: vscode.Uri[];
  queryLang: string;
  queryRoot: vscode.Uri;
  grammar: string;
}

function grammarSpec(languageId: string): GrammarSpec | undefined {
  if (!extensionUri) return undefined;
  const extra = extraGrammars()[languageId];
  const queriesRoot = vscode.Uri.joinPath(extensionUri, 'queries');
  if (extra) {
    return { wasm: [uriFromSetting(extra.wasm)], queryLang: extra.language ?? languageId, queryRoot: extra.queries ? uriFromSetting(extra.queries) : queriesRoot, grammar: languageId };
  }
  const m = LANGUAGE_MAP[languageId];
  if (!m) return undefined;
  const candidates = [vscode.Uri.joinPath(extensionUri, 'wasm', `tree-sitter-${m[0]}.wasm`)];
  const installed = installedGrammarUri(m[0]);
  if (installed) candidates.push(installed);
  return { wasm: candidates, queryLang: m[1], queryRoot: queriesRoot, grammar: m[0] };
}

export function supportsLanguage(languageId: string): boolean {
  return grammarSpec(languageId) !== undefined;
}

/** Grammar name (manifest key) for a language id, if it is installable on demand. */
export function installableGrammarFor(languageId: string): string | undefined {
  const m = LANGUAGE_MAP[languageId];
  if (!m) return undefined;
  const g = GRAMMARS[m[0]];
  return g && !g.bundled ? m[0] : undefined;
}

async function loadLanguage(languageId: string): Promise<LanguageT | undefined> {
  const spec = grammarSpec(languageId);
  if (!spec || !wts) return undefined;
  let p = languages.get(languageId);
  if (!p) {
    p = (async () => {
      let file: vscode.Uri | undefined;
      for (const c of spec.wasm) {
        if (await exists(c)) {
          file = c;
          break;
        }
      }
      if (!file) {
        log(`grammar not found for ${languageId}: ${spec.wasm.map((u) => u.fsPath).join(', ')}`);
        return undefined;
      }
      try {
        const bytes = await vscode.workspace.fs.readFile(file);
        const lang = await wts!.Language.load(bytes);
        log(`loaded grammar for ${languageId} (${basename(file.path)}, abi ${lang.abiVersion})`);
        return lang;
      } catch (e) {
        log(`failed to load grammar for ${languageId}: ${e}`);
        return undefined;
      }
    })();
    languages.set(languageId, p);
  }
  return p;
}

/** Forget a cached (missing) grammar so the next use retries, e.g. after :tree-sitter-install. */
export function resetLanguage(languageId?: string): void {
  if (languageId) {
    languages.delete(languageId);
    queries.delete(languageId);
    return;
  }
  languages.clear();
  queries.clear();
}

function textobjectQuery(languageId: string, lang: LanguageT): Promise<Query | undefined> {
  let cached = queries.get(languageId);
  if (cached) return cached;
  cached = (async () => {
    const spec = grammarSpec(languageId);
    if (!spec || !wts) return undefined;
    const src = await readQueryFile(spec.queryRoot, spec.queryLang, 'textobjects');
    if (!src) {
      log(`no textobjects query for ${languageId} (${spec.queryLang})`);
      return undefined;
    }
    try {
      return new wts.Query(lang, src);
    } catch (e) {
      // Try to salvage by dropping patterns that reference unknown node types.
      const salvaged = salvageQuery(lang, src, String(e));
      if (salvaged) {
        log(`textobjects query for ${languageId} loaded with some patterns dropped (${String(e).split('\n')[0]})`);
        return salvaged;
      }
      log(`textobjects query for ${languageId} failed to compile: ${e}`);
      return undefined;
    }
  })();
  queries.set(languageId, cached);
  return cached;
}

/** Compile each top-level pattern separately and keep the ones that work. */
function salvageQuery(lang: LanguageT, src: string, _err: string): Query | undefined {
  const patterns = splitPatterns(src);
  const good: string[] = [];
  for (const p of patterns) {
    try {
      new wts!.Query(lang, p);
      good.push(p);
    } catch {
      /* drop */
    }
  }
  if (good.length === 0) return undefined;
  try {
    return new wts!.Query(lang, good.join('\n'));
  } catch {
    return undefined;
  }
}

/** Split an .scm file into top-level S-expressions (comments stripped). */
function splitPatterns(src: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inStr) {
      cur += ch;
      if (ch === '\\') {
        cur += src[++i] ?? '';
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === ';') {
      while (i < src.length && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      cur += ch;
      continue;
    }
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    cur += ch;
    if (depth === 0 && (ch === ')' || ch === ']')) {
      // include trailing capture names like `@name` / predicates on the same expression
      let j = i + 1;
      while (j < src.length && src[j] !== '\n' && src[j] !== '(' && src[j] !== ';') {
        cur += src[j];
        j++;
      }
      i = j - 1;
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    }
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Per-document trees
// ---------------------------------------------------------------------------

interface DocTree {
  parser: ParserT;
  tree: Tree;
  version: number;
  pendingEdits: Edit[];
  languageId: string;
}

const trees = new Map<string, DocTree>();

export function maxFileSize(): number {
  return vscode.workspace.getConfiguration('helicode').get<number>('treeSitter.maxFileSizeKB', 2048) * 1024;
}

/** Record edits so the next parse can be incremental. */
export function onDocumentChanged(e: vscode.TextDocumentChangeEvent): void {
  const key = e.document.uri.toString();
  const dt = trees.get(key);
  if (!dt || !wts) return;
  if (e.contentChanges.length === 0) return;
  // Apply changes in reverse document order relative to the old text.
  const changes = [...e.contentChanges].sort((a, b) => b.rangeOffset - a.rangeOffset);
  for (const c of changes) {
    const startIndex = c.rangeOffset;
    const oldEndIndex = c.rangeOffset + c.rangeLength;
    const newEndIndex = c.rangeOffset + c.text.length;
    const startPosition = { row: c.range.start.line, column: c.range.start.character };
    const oldEndPosition = { row: c.range.end.line, column: c.range.end.character };
    const lines = c.text.split('\n');
    const newEndPosition =
      lines.length === 1
        ? { row: c.range.start.line, column: c.range.start.character + c.text.length }
        : { row: c.range.start.line + lines.length - 1, column: lines[lines.length - 1].length };
    const edit = new wts.Edit({ startIndex, oldEndIndex, newEndIndex, startPosition, oldEndPosition, newEndPosition });
    dt.tree.edit(edit);
  }
}

export function onDocumentClosed(doc: vscode.TextDocument): void {
  const key = doc.uri.toString();
  const dt = trees.get(key);
  if (dt) {
    dt.tree.delete();
    dt.parser.delete();
    trees.delete(key);
  }
}

interface Span {
  startIndex: number;
  endIndex: number;
}

export class Syntax implements SyntaxMatcher {
  constructor(
    readonly tree: Tree,
    readonly query: Query | undefined,
    readonly text: string,
    readonly languageId: string,
  ) {}

  get root(): Node {
    return this.tree.rootNode;
  }

  // ---- match_brackets.rs ----------------------------------------------

  findMatchingBracket(pos: number): number | undefined {
    if (pos >= this.text.length) return undefined;
    const ch = this.text[pos];
    if (!PAIRS.some((p) => p[0] === ch || p[1] === ch)) return undefined;
    return this.findPair(pos, false);
  }

  findMatchingBracketFuzzy(pos: number): number | undefined {
    return this.findPair(pos, true);
  }

  private findPair(pos: number, traverseParents: boolean): number | undefined {
    const root = this.root;
    let node: Node | null = root.descendantForIndex(pos, pos);
    if (!node) return undefined;
    const MATCH_LIMIT = 16;
    for (;;) {
      if (node.isNamed && node.childCount >= 2) {
        const open = node.child(0)!;
        const close = node.child(node.childCount - 1)!;
        const o = this.asChar(open);
        const c = this.asChar(close);
        if (o && c) {
          if (PAIRS.some((p) => p[0] === o[1] && p[1] === c[1]) && o[0] <= pos && pos <= c[0]) {
            if (c[0] === pos) return o[0];
            if (traverseParents || o[0] === pos) return c[0];
          }
        }
      }
      const closePair = this.asClosePair(node);
      if (closePair) {
        const start = this.findPairEnd(node.previousSibling, closePair[0], closePair[1], Direction.Backward);
        if (start !== undefined) return start;
      }
      const openPair = this.asOpenPair(node);
      if (openPair) {
        const end = this.findPairEnd(node.nextSibling, openPair[0], openPair[1], Direction.Forward);
        if (end !== undefined) return end;
      }
      if (traverseParents) {
        let sib = node.nextSibling;
        let n = 0;
        while (sib && n < MATCH_LIMIT) {
          const cp = this.asClosePair(sib);
          if (cp && this.findPairEnd(sib.previousSibling, cp[0], cp[1], Direction.Backward) !== undefined) return sib.startIndex;
          sib = sib.nextSibling;
          n++;
        }
      } else if (node.isNamed) break;
      const parent: Node | null = node.parent;
      if (!parent) break;
      node = parent;
    }
    const leaf = root.namedDescendantForIndex(pos, pos + 1);
    if (!leaf || leaf.childCount !== 0) return undefined;
    const nodeText = this.text.slice(leaf.startIndex, leaf.endIndex);
    const r = findMatchingBracketPlaintext(nodeText, pos - leaf.startIndex);
    return r === undefined ? undefined : r + leaf.startIndex;
  }

  /** If the node is a single pair character, returns [pos, char]. */
  private asChar(node: Node): [number, string] | undefined {
    if (node.endIndex - node.startIndex !== 1) return undefined;
    return [node.startIndex, this.text[node.startIndex]];
  }

  private asClosePair(node: Node): [string, string] | undefined {
    const c = this.asChar(node);
    if (!c) return undefined;
    const p = PAIRS.find((p) => p[1] === c[1]);
    return p ? [p[0], p[1]] : undefined;
  }

  private asOpenPair(node: Node): [string, string] | undefined {
    const c = this.asChar(node);
    if (!c) return undefined;
    const p = PAIRS.find((p) => p[0] === c[1]);
    return p ? [p[0], p[1]] : undefined;
  }

  private findPairEnd(start: Node | null, open: string, close: string, dir: Direction): number | undefined {
    let node = start;
    let depth = 0;
    let n = 0;
    while (node && n < 10000) {
      const c = this.asChar(node);
      if (c) {
        if (c[1] === open) {
          if (dir === Direction.Backward) {
            if (depth === 0) return c[0];
            depth--;
          } else depth++;
        } else if (c[1] === close) {
          if (dir === Direction.Forward) {
            if (depth === 0) return c[0];
            depth--;
          } else depth++;
        }
      }
      node = dir === Direction.Forward ? node.nextSibling : node.previousSibling;
      n++;
    }
    return undefined;
  }

  // ---- textobjects -----------------------------------------------------

  /**
   * Spans captured with the given capture names. Like Helix's
   * `CapturedNode::Grouped`, several nodes captured under the same name within
   * one match (e.g. a parameter and its trailing comma) form a single span.
   */
  captureSpans(names: string[]): Span[] {
    if (!this.query) return [];
    const out: Span[] = [];
    for (const m of this.query.matches(this.root)) {
      for (const name of names) {
        let start = Infinity;
        let end = -Infinity;
        for (const c of m.captures) {
          if (c.name !== name) continue;
          start = Math.min(start, c.node.startIndex);
          end = Math.max(end, c.node.endIndex);
        }
        if (start !== Infinity) out.push({ startIndex: start, endIndex: end });
      }
    }
    return out;
  }

  /** textobject_treesitter: smallest capture containing `pos`. */
  textobject(pos: number, objectName: string, kind: 'inside' | 'around'): [number, number] | undefined {
    const spans = this.captureSpans([`${objectName}.${kind}`]).filter((n) => n.startIndex <= pos && pos < n.endIndex);
    if (spans.length === 0) return undefined;
    let best = spans[0];
    for (const n of spans) if (n.endIndex - n.startIndex < best.endIndex - best.startIndex) best = n;
    return [best.startIndex, best.endIndex];
  }

  /** goto_treesitter_object: next/prev object relative to `pos`. */
  gotoObject(pos: number, objectName: string, dir: Direction): [number, number] | undefined {
    const spans = this.captureSpans([`${objectName}.movement`, `${objectName}.around`, `${objectName}.inside`]);
    let best: Span | undefined;
    if (dir === Direction.Forward) {
      for (const n of spans) {
        if (n.startIndex <= pos) continue;
        if (!best || n.startIndex < best.startIndex || (n.startIndex === best.startIndex && n.endIndex > best.endIndex)) best = n;
      }
    } else {
      for (const n of spans) {
        if (n.endIndex >= pos) continue;
        if (!best || n.endIndex > best.endIndex || (n.endIndex === best.endIndex && n.startIndex < best.startIndex)) best = n;
      }
    }
    return best ? [best.startIndex, best.endIndex] : undefined;
  }

  // ---- object.rs (expand / shrink / siblings) -------------------------

  private nodeForRange(from: number, to: number): Node | null {
    return this.root.descendantForIndex(from, Math.max(from, to - 1 < from ? from : to - 1));
  }

  private namedNodeForRange(from: number, to: number): Node | null {
    return this.root.namedDescendantForIndex(from, Math.max(from, to > from ? to - 1 : from));
  }

  expand(from: number, to: number): [number, number] | undefined {
    let node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    while (node && node.startIndex === from && node.endIndex === to) {
      node = node.parent;
    }
    if (!node) return undefined;
    return [node.startIndex, node.endIndex];
  }

  shrink(from: number, to: number): [number, number] | undefined {
    const node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    const child = node.namedChildren[0] ?? null;
    const n = child ?? node;
    return [n.startIndex, n.endIndex];
  }

  nextSibling(from: number, to: number): [number, number] | undefined {
    let node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    while (node) {
      const s: Node | null = node.nextNamedSibling;
      if (s) return [s.startIndex, s.endIndex];
      node = node.parent;
    }
    return undefined;
  }

  prevSibling(from: number, to: number): [number, number] | undefined {
    let node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    while (node) {
      const s: Node | null = node.previousNamedSibling;
      if (s) return [s.startIndex, s.endIndex];
      node = node.parent;
    }
    return undefined;
  }

  allChildren(from: number, to: number): [number, number][] | undefined {
    const node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    const kids = node.namedChildren.map((c): [number, number] => [c.startIndex, c.endIndex]);
    return kids.length ? kids : undefined;
  }

  allSiblings(from: number, to: number): [number, number][] | undefined {
    let node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    let parent = node.parent;
    while (parent && parent.namedChildCount <= 1) {
      node = parent;
      parent = parent.parent;
    }
    if (!parent) return undefined;
    return parent.namedChildren.map((c): [number, number] => [c.startIndex, c.endIndex]);
  }

  /** move_parent_node_end / start */
  parentEdge(from: number, to: number, cursor: number, dir: Direction): number | undefined {
    let node = this.namedNodeForRange(from, to);
    if (!node) return undefined;
    if (dir === Direction.Forward) return node.endIndex;
    let head = node.startIndex;
    if (head === cursor) {
      // already at the start: go up to the first parent that starts earlier
      const start = node.startIndex;
      let p: Node | null = node;
      while (p && (p.startIndex >= start || !p.isNamed)) p = p.parent;
      if (p) head = p.startIndex;
    }
    return head;
  }

  /** Node type chain for :tree-sitter-subtree style debugging. */
  describeAt(pos: number): string {
    const n = this.root.namedDescendantForIndex(pos, pos);
    if (!n) return '(none)';
    return n.toString();
  }

  scopesAt(pos: number): string[] {
    const out: string[] = [];
    let n: Node | null = this.root.descendantForIndex(pos, pos);
    while (n) {
      out.push(n.type);
      n = n.parent;
    }
    return out;
  }
}

/**
 * Parse (or incrementally re-parse) the document and return a Syntax handle.
 * Returns undefined when tree-sitter is disabled/unavailable for the language.
 */
export async function getSyntax(document: vscode.TextDocument): Promise<Syntax | undefined> {
  if (!isEnabled()) return undefined;
  await initPromise;
  if (!wts) return undefined;
  const lang = await loadLanguage(document.languageId);
  if (!lang) return undefined;
  const text = document.getText();
  if (text.length > maxFileSize()) return undefined;
  const key = document.uri.toString();
  let dt = trees.get(key);
  if (dt && dt.languageId !== document.languageId) {
    onDocumentClosed(document);
    dt = undefined;
  }
  if (!dt) {
    const parser = new wts.Parser();
    parser.setLanguage(lang);
    const t0 = Date.now();
    const tree = parser.parse(text);
    if (!tree) {
      parser.delete();
      return undefined;
    }
    dt = { parser, tree, version: document.version, pendingEdits: [], languageId: document.languageId };
    trees.set(key, dt);
    log(`parsed ${basename(document.fileName)} in ${Date.now() - t0}ms`);
  } else if (dt.version !== document.version) {
    const t0 = Date.now();
    const newTree = dt.parser.parse(text, dt.tree);
    if (newTree) {
      dt.tree.delete();
      dt.tree = newTree;
    }
    dt.version = document.version;
    const ms = Date.now() - t0;
    if (ms > 50) log(`re-parsed ${basename(document.fileName)} in ${ms}ms`);
  }
  return new Syntax(dt.tree, await textobjectQuery(document.languageId, lang), text, document.languageId);
}

export async function bundledGrammars(): Promise<string[]> {
  if (!extensionUri) return [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(extensionUri, 'wasm'));
    return entries
      .map(([f]) => f)
      .filter((f) => f.startsWith('tree-sitter-') && f.endsWith('.wasm'))
      .map((f) => f.slice('tree-sitter-'.length, -'.wasm'.length))
      .sort();
  } catch {
    return [];
  }
}

export async function installedGrammars(): Promise<string[]> {
  if (!storageUri) return [];
  try {
    const entries = await vscode.workspace.fs.readDirectory(vscode.Uri.joinPath(storageUri, 'grammars'));
    return entries
      .map(([f]) => f)
      .filter((f) => f.startsWith('tree-sitter-') && f.endsWith('.wasm'))
      .map((f) => f.slice('tree-sitter-'.length, -'.wasm'.length))
      .sort();
  } catch {
    return [];
  }
}

/** Grammars from the manifest that are not bundled (installable with :tree-sitter-install). */
export function optionalGrammars(): string[] {
  return Object.entries(GRAMMARS)
    .filter(([, g]) => !g.bundled)
    .map(([n]) => n)
    .sort();
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes.slice().buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Download a grammar from the manifest into the extension's global storage
 * (verifying its checksum) and make it available immediately.
 */
export async function installGrammar(name: string, progress?: (msg: string) => void): Promise<void> {
  const g = GRAMMARS[name];
  if (!g) throw new Error(`unknown grammar: ${name} (known: ${Object.keys(GRAMMARS).sort().join(', ')})`);
  const target = installedGrammarUri(name);
  if (!target) throw new Error('global storage is not available');
  progress?.(`downloading ${name} grammar...`);
  const res = await fetch(g.url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  const hash = await sha256Hex(bytes);
  if (g.sha256 && hash !== g.sha256) throw new Error(`checksum mismatch for ${name}: expected ${g.sha256}, got ${hash}`);
  await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(target, '..'));
  await vscode.workspace.fs.writeFile(target, bytes);
  for (const [id, [grammar]] of Object.entries(LANGUAGE_MAP)) if (grammar === name) resetLanguage(id);
  log(`installed grammar ${name} (${(bytes.length / 1024).toFixed(0)} KB) to ${target.fsPath}`);
}

export async function uninstallGrammar(name: string): Promise<void> {
  const target = installedGrammarUri(name);
  if (!target) return;
  await vscode.workspace.fs.delete(target);
  for (const [id, [grammar]] of Object.entries(LANGUAGE_MAP)) if (grammar === name) resetLanguage(id);
}

export function dispose(): void {
  for (const [, dt] of trees) {
    dt.tree.delete();
    dt.parser.delete();
  }
  trees.clear();
  for (const q of queries.values()) void q.then((x) => x?.delete());
  queries.clear();
  output.dispose();
}
