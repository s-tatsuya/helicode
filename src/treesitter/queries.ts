/**
 * Loads Helix textobject queries (queries/<lang>/textobjects.scm) honouring
 * the `; inherits: a,b` directive used by Helix's runtime queries.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

const INHERITS_RE = /^;+\s*inherits\s*:?\s*([a-z_,()-]+)\s*$/im;

export interface QuerySource {
  language: string;
  source: string;
}

export function readQueryFile(root: string, language: string, kind = 'textobjects', seen = new Set<string>()): string | undefined {
  if (seen.has(language)) return '';
  seen.add(language);
  const file = path.join(root, language, `${kind}.scm`);
  let src: string;
  try {
    src = fs.readFileSync(file, 'utf8');
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
    const parent = readQueryFile(root, p, kind, seen);
    if (parent) out = parent + '\n' + out;
  }
  return out;
}
