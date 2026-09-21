/**
 * Import a real Helix `config.toml`: `[keys.normal]`, `[keys.select]` and
 * `[keys.insert]` become keymap overrides, and the `[editor]` options Helicode
 * understands are applied on top of the VS Code settings.
 *
 * The file is read through the VS Code file system API (so it also works over
 * a remote/SSH connection) and merged *under* `helicode.keys`, which keeps the
 * user's VS Code settings authoritative.
 */
import * as vscode from 'vscode';
import { parse as parseToml } from 'smol-toml';
import { homeDir, env, isWeb } from '../platform';
import { joinPath } from '../core/paths';

export interface HelixConfig {
  keys: Record<string, Record<string, unknown>>;
  editor: Record<string, unknown>;
  /** The file the config was read from. */
  uri: vscode.Uri;
}

/** Default Helix config locations, most specific first. */
export function defaultConfigUris(): vscode.Uri[] {
  const out: vscode.Uri[] = [];
  const add = (p: string | undefined) => {
    if (p) out.push(vscode.Uri.file(p));
  };
  const xdg = env('XDG_CONFIG_HOME');
  const home = homeDir();
  const appdata = env('APPDATA');
  if (xdg) add(joinPath(xdg, 'helix/config.toml'));
  if (home && !xdg) add(joinPath(home, '.config/helix/config.toml'));
  if (appdata) add(joinPath(appdata, 'helix/config.toml'));
  return out;
}

async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    return new TextDecoder().decode(await vscode.workspace.fs.readFile(uri));
  } catch {
    return undefined;
  }
}

/**
 * Read and parse a Helix config. `pathOrUri` may be a path, a uri, or
 * undefined for the default locations. Returns undefined when no file exists.
 */
export async function readHelixConfig(pathOrUri?: string): Promise<HelixConfig | undefined> {
  const candidates: vscode.Uri[] = [];
  if (pathOrUri) {
    candidates.push(/^[a-z][a-z0-9+.-]*:\/\//i.test(pathOrUri) ? vscode.Uri.parse(pathOrUri) : vscode.Uri.file(pathOrUri));
  } else {
    // A config checked into the workspace wins over the user's global one.
    for (const folder of vscode.workspace.workspaceFolders ?? []) {
      candidates.push(vscode.Uri.joinPath(folder.uri, '.helix', 'config.toml'));
    }
    if (!isWeb) candidates.push(...defaultConfigUris());
  }
  for (const uri of candidates) {
    const text = await readText(uri);
    if (text === undefined) continue;
    const parsed = parseToml(text) as Record<string, unknown>;
    const keys = (parsed.keys ?? {}) as Record<string, Record<string, unknown>>;
    const editor = (parsed.editor ?? {}) as Record<string, unknown>;
    return { keys, editor, uri };
  }
  return undefined;
}

/** Helix `[editor]` option -> Helicode / VS Code setting, with a value mapper. */
const EDITOR_OPTIONS: Record<string, { section: string; key: string; map?: (v: unknown) => unknown }> = {
  scrolloff: { section: 'helicode', key: 'scrolloff' },
  'text-width': { section: 'helicode', key: 'textWidth' },
  'default-yank-register': { section: 'helicode', key: 'defaultYankRegister' },
  'jump-label-alphabet': { section: 'helicode', key: 'jumpLabelAlphabet' },
  'auto-info': { section: 'helicode', key: 'autoInfo' },
  'auto-save': { section: 'files', key: 'autoSave', map: (v) => (v ? 'afterDelay' : 'off') },
  'auto-format': { section: 'editor', key: 'formatOnSave' },
  'auto-pairs': { section: 'editor', key: 'autoClosingBrackets', map: (v) => (typeof v === 'boolean' ? (v ? 'languageDefined' : 'never') : v) },
  'line-number': { section: 'editor', key: 'lineNumbers', map: (v) => (v === 'relative' ? 'relative' : 'on') },
  cursorline: { section: 'editor', key: 'renderLineHighlight', map: (v) => (v ? 'line' : 'none') },
  rulers: { section: 'editor', key: 'rulers' },
  shell: { section: 'helicode', key: 'shell' },
  'idle-timeout': { section: 'editor', key: 'quickSuggestionsDelay' },
  'insert-final-newline': { section: 'files', key: 'insertFinalNewline' },
  'trim-trailing-whitespace': { section: 'files', key: 'trimTrailingWhitespace' },
  'trim-final-newlines': { section: 'files', key: 'trimFinalNewlines' },
};

/** Nested `[editor.x]` tables flattened to Helix's dotted option names. */
function flattenEditor(editor: Record<string, unknown>, prefix = ''): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(editor)) {
    const name = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(out, flattenEditor(v as Record<string, unknown>, name));
    else out[name] = v;
  }
  return out;
}

export interface ImportResult {
  uri: vscode.Uri;
  keyModes: string[];
  keyCount: number;
  options: string[];
  skipped: string[];
}

function countBindings(node: unknown): number {
  if (typeof node !== 'object' || node === null) return 0;
  let n = 0;
  for (const v of Object.values(node as Record<string, unknown>)) {
    n += typeof v === 'object' && v !== null && !Array.isArray(v) ? countBindings(v) : 1;
  }
  return n;
}

/**
 * Apply a Helix config to the VS Code settings: `[keys.*]` to `helicode.keys`
 * and the supported `[editor]` options to their VS Code equivalents.
 */
export async function importHelixConfig(config: HelixConfig, target: vscode.ConfigurationTarget, opts: { keysOnly?: boolean } = {}): Promise<ImportResult> {
  const result: ImportResult = { uri: config.uri, keyModes: [], keyCount: 0, options: [], skipped: [] };
  const modes = ['normal', 'select', 'insert'] as const;
  const keys: Record<string, unknown> = {};
  for (const mode of modes) {
    const table = config.keys[mode];
    if (!table) continue;
    keys[mode] = table;
    result.keyModes.push(mode);
    result.keyCount += countBindings(table);
  }
  if (result.keyModes.length) {
    const cfg = vscode.workspace.getConfiguration('helicode');
    const existing = cfg.get<Record<string, unknown>>('keys', {});
    // The user's own `helicode.keys` entries win over the imported ones.
    const merged: Record<string, unknown> = { ...keys };
    for (const [mode, table] of Object.entries(existing)) {
      merged[mode] = { ...((keys[mode] as Record<string, unknown>) ?? {}), ...(table as Record<string, unknown>) };
    }
    await cfg.update('keys', merged, target);
  }
  if (!opts.keysOnly) {
    const flat = flattenEditor(config.editor);
    for (const [name, value] of Object.entries(flat)) {
      const opt = EDITOR_OPTIONS[name];
      if (!opt) {
        result.skipped.push(name);
        continue;
      }
      await vscode.workspace.getConfiguration(opt.section).update(opt.key, opt.map ? opt.map(value) : value, target);
      result.options.push(name);
    }
  }
  return result;
}
