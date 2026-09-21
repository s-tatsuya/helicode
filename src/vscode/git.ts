/**
 * Diff base provider (helix-vcs): the content of the current file at HEAD,
 * obtained through VS Code's built-in git extension API, plus the hunks
 * between that base and the live document.
 */
import * as vscode from 'vscode';
import { Hunk, lineHunks } from '../core/diff';

interface GitRepositoryState {
  HEAD?: { commit?: string; name?: string };
  onDidChange: vscode.Event<void>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  show(ref: string, path: string): Promise<string>;
}

interface GitAPI {
  repositories: GitRepository[];
  getRepository(uri: vscode.Uri): GitRepository | null;
}

interface GitExtension {
  enabled: boolean;
  getAPI(version: 1): GitAPI;
}

interface BaseCacheEntry {
  commit: string | undefined;
  text: string | undefined;
  time: number;
}

const BASE_TTL_MS = 5000;
const baseCache = new Map<string, BaseCacheEntry>();

async function gitApi(): Promise<GitAPI | undefined> {
  const ext = vscode.extensions.getExtension<GitExtension>('vscode.git');
  if (!ext) return undefined;
  try {
    const exports = ext.isActive ? ext.exports : await ext.activate();
    if (!exports || !exports.enabled) return undefined;
    return exports.getAPI(1);
  } catch {
    return undefined;
  }
}

/** Text of `document` at HEAD, or undefined when it is not tracked by git. */
export async function diffBase(document: vscode.TextDocument): Promise<string | undefined> {
  if (document.uri.scheme !== 'file') return undefined;
  const api = await gitApi();
  const repo = api?.getRepository(document.uri);
  if (!repo) return undefined;
  const key = document.uri.toString();
  const commit = repo.state.HEAD?.commit;
  const cached = baseCache.get(key);
  if (cached && cached.commit === commit && Date.now() - cached.time < BASE_TTL_MS) return cached.text;
  let text: string | undefined;
  try {
    text = await repo.show('HEAD', document.uri.fsPath);
  } catch {
    text = undefined;
  }
  baseCache.set(key, { commit, text, time: Date.now() });
  return text;
}

/** Hunks between HEAD and the live document (undefined when no diff base exists). */
export async function documentHunks(document: vscode.TextDocument): Promise<Hunk[] | undefined> {
  const base = await diffBase(document);
  if (base === undefined) return undefined;
  return lineHunks(base.replace(/\r\n/g, '\n'), document.getText().replace(/\r\n/g, '\n'));
}

export function clearDiffCache(uri?: vscode.Uri): void {
  if (uri) baseCache.delete(uri.toString());
  else baseCache.clear();
}
