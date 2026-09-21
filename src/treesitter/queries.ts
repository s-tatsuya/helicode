/**
 * Loads Helix textobject queries (queries/<lang>/textobjects.scm) honouring
 * the `; inherits: a,b` directive used by Helix's runtime queries. Uses the
 * VS Code file system API so it also works in the web extension host.
 */
import * as vscode from 'vscode';

const INHERITS_RE = /^;+\s*inherits\s*:?\s*([a-z_,()-]+)\s*$/im;

export async function readQueryFile(root: vscode.Uri, language: string, kind = 'textobjects', seen = new Set<string>()): Promise<string | undefined> {
  if (seen.has(language)) return '';
  seen.add(language);
  const file = vscode.Uri.joinPath(root, language, `${kind}.scm`);
  let src: string;
  try {
    src = new TextDecoder().decode(await vscode.workspace.fs.readFile(file));
  } catch {
    return undefined;
  }
  const m = INHERITS_RE.exec(src);
  if (!m) return src;
  const parents = m[1]
    .split(',')
    .map((s) => s.trim().replace(/[()]/g, ''))
    .filter(Boolean);
  let out = src.replace(INHERITS_RE, '');
  for (const p of parents) {
    const parent = await readQueryFile(root, p, kind, seen);
    if (parent) out = parent + '\n' + out;
  }
  return out;
}
