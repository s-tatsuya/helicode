import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// Copy tree-sitter runtime + grammars into wasm/ (shipped with the extension).
mkdirSync('wasm', { recursive: true });
const nm = path.join(process.cwd(), 'node_modules');
cpSync(path.join(nm, 'web-tree-sitter', 'web-tree-sitter.wasm'), 'wasm/web-tree-sitter.wasm');
const grammars = path.join(nm, '@vscode', 'tree-sitter-wasm', 'wasm');
for (const f of (await import('node:fs')).readdirSync(grammars)) {
  if (f.startsWith('tree-sitter-') && f.endsWith('.wasm')) cpSync(path.join(grammars, f), path.join('wasm', f));
}

const ctx = await esbuild.context({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  alias: { 'web-tree-sitter': path.join(nm, 'web-tree-sitter', 'web-tree-sitter.cjs') },
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
});
if (watch) {
  await ctx.watch();
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
