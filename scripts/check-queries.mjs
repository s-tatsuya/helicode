// Compiles every bundled textobjects query against its grammar so broken
// queries are caught at build time rather than at runtime.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Parser, Language, Query } = require('web-tree-sitter');

const LANGUAGE_MAP = {
  typescript: ['typescript', 'typescript'],
  typescriptreact: ['tsx', 'tsx'],
  javascript: ['javascript', 'javascript'],
  javascriptreact: ['javascript', 'jsx'],
  python: ['python', 'python'],
  rust: ['rust', 'rust'],
  go: ['go', 'go'],
  java: ['java', 'java'],
  c: ['cpp', 'c'],
  cpp: ['cpp', 'cpp'],
  csharp: ['c-sharp', 'c-sharp'],
  css: ['css', 'css'],
  php: ['php', 'php'],
  ruby: ['ruby', 'ruby'],
  shellscript: ['bash', 'bash'],
};

const INHERITS_RE = /^;+\s*inherits\s*:?\s*([a-z_,()-]+)\s*$/im;
function readQuery(root, lang, seen = new Set()) {
  if (seen.has(lang)) return '';
  seen.add(lang);
  const file = path.join(root, lang, 'textobjects.scm');
  if (!existsSync(file)) return undefined;
  const src = readFileSync(file, 'utf8');
  const m = INHERITS_RE.exec(src);
  if (!m) return src;
  let out = src.replace(INHERITS_RE, '');
  for (const p of m[1].split(',').map((s) => s.trim().replace(/[()]/g, ''))) {
    const parent = readQuery(root, p, seen);
    if (parent) out = parent + '\n' + out;
  }
  return out;
}

await Parser.init({ locateFile: (f) => path.join('wasm', f) });
let failed = 0;
for (const [id, [grammar, qlang]] of Object.entries(LANGUAGE_MAP)) {
  const wasm = path.join('wasm', `tree-sitter-${grammar}.wasm`);
  if (!existsSync(wasm)) {
    console.log(`SKIP ${id}: no grammar ${wasm}`);
    continue;
  }
  const lang = await Language.load(wasm);
  const src = readQuery('queries', qlang);
  if (src === undefined) {
    console.log(`SKIP ${id}: no query for ${qlang}`);
    continue;
  }
  try {
    const q = new Query(lang, src);
    console.log(`OK   ${id}: ${q.captureNames.length} captures`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${id} (${qlang}): ${String(e).split('\n')[0]}`);
  }
}
void readdirSync;
process.exit(failed ? 1 : 0);
