// Downloads the prebuilt grammar WASM files listed in grammars.json into wasm/.
//
//   node scripts/fetch-grammars.mjs            # bundled grammars only (used by the build)
//   node scripts/fetch-grammars.mjs --all      # also the optional (large) ones
//   node scripts/fetch-grammars.mjs --update   # (re)compute sha256 values and rewrite grammars.json
//
// Bundled grammars go to wasm/ (shipped in the .vsix); optional ones to
// wasm-optional/ (used by `npm run check-queries -- --all`; at runtime they
// are installed into the extension's global storage by :tree-sitter-install).
// Files already present with a matching checksum are skipped, so an offline
// build keeps working once the files have been fetched once.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const manifestPath = new URL('../grammars.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const all = process.argv.includes('--all');
const update = process.argv.includes('--update');
const outDir = path.join(process.cwd(), 'wasm');
const optDir = path.join(process.cwd(), 'wasm-optional');
mkdirSync(outDir, { recursive: true });
mkdirSync(optDir, { recursive: true });

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');

export async function fetchGrammars({ includeOptional = all, rewriteManifest = update, quiet = false } = {}) {
  let failed = 0;
  let changed = false;
  for (const [name, g] of Object.entries(manifest.grammars)) {
    if (!g.bundled && !includeOptional) continue;
    const file = path.join(g.bundled ? outDir : optDir, `tree-sitter-${name}.wasm`);
    if (existsSync(file) && !rewriteManifest) {
      if (!g.sha256 || sha256(readFileSync(file)) === g.sha256) continue;
      if (!quiet) console.log(`checksum mismatch for ${name}, re-downloading`);
    }
    try {
      const res = await fetch(g.url, { redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      const hash = sha256(buf);
      if (g.sha256 && g.sha256 !== hash && !rewriteManifest) throw new Error(`sha256 mismatch: expected ${g.sha256}, got ${hash}`);
      if (g.sha256 !== hash) {
        g.sha256 = hash;
        changed = true;
      }
      writeFileSync(file, buf);
      if (!quiet) console.log(`fetched ${name} (${(buf.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      failed++;
      console.warn(`could not fetch grammar ${name}: ${e.message}`);
    }
  }
  if (changed && rewriteManifest) writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
  return failed;
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const failed = await fetchGrammars();
  process.exit(failed && process.env.HELICODE_REQUIRE_GRAMMARS ? 1 : 0);
}
