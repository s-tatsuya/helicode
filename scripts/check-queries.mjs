// Compiles every bundled textobjects query against its grammar so broken
// queries are caught at build time rather than at runtime.
//
//   node scripts/check-queries.mjs           # bundled grammars
//   node scripts/check-queries.mjs --all     # also the optional ones in wasm-optional/
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Parser, Language, Query } = require('web-tree-sitter');

const languages = JSON.parse(readFileSync(new URL('../src/treesitter/languages.json', import.meta.url), 'utf8'));
const LANGUAGE_MAP = Object.fromEntries(Object.entries(languages).filter(([k]) => !k.startsWith('$')));
const includeOptional = process.argv.includes('--all');

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

function grammarPath(name) {
  const bundled = path.join('wasm', `tree-sitter-${name}.wasm`);
  if (existsSync(bundled)) return bundled;
  const optional = path.join('wasm-optional', `tree-sitter-${name}.wasm`);
  if (includeOptional && existsSync(optional)) return optional;
  return undefined;
}

await Parser.init({ locateFile: (f) => path.join('wasm', f) });
let failed = 0;
const seenGrammar = new Set();
for (const [id, [grammar, qlang]] of Object.entries(LANGUAGE_MAP)) {
  const key = `${grammar}:${qlang}`;
  if (seenGrammar.has(key)) continue;
  seenGrammar.add(key);
  const wasm = grammarPath(grammar);
  if (!wasm) {
    console.log(`SKIP ${id}: no grammar tree-sitter-${grammar}.wasm`);
    continue;
  }
  const lang = await Language.load(wasm);
  const src = readQuery('queries', qlang);
  if (src === undefined) {
    console.log(`SKIP ${id}: no query for ${qlang} (node selection and mm still work)`);
    continue;
  }
  try {
    const q = new Query(lang, src);
    console.log(`OK   ${id}: ${q.captureNames.length} captures (abi ${lang.abiVersion})`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${id} (${qlang}): ${String(e).split('\n')[0]}`);
  }
}
process.exit(failed ? 1 : 0);
