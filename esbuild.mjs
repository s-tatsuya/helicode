import * as esbuild from 'esbuild';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fetchGrammars } from './scripts/fetch-grammars.mjs';

const watch = process.argv.includes('--watch');
const production = process.argv.includes('--production');

// A production build must not ship the source maps a previous dev build left.
if (production) rmSync('dist', { recursive: true, force: true });

// Copy tree-sitter runtime + grammars into wasm/ (shipped with the extension).
mkdirSync('wasm', { recursive: true });
const nm = path.join(process.cwd(), 'node_modules');
cpSync(path.join(nm, 'web-tree-sitter', 'web-tree-sitter.wasm'), 'wasm/web-tree-sitter.wasm');
const grammars = path.join(nm, '@vscode', 'tree-sitter-wasm', 'wasm');
for (const f of readdirSync(grammars)) {
  if (f.startsWith('tree-sitter-') && f.endsWith('.wasm')) cpSync(path.join(grammars, f), path.join('wasm', f));
}
// Grammars that are not in @vscode/tree-sitter-wasm come from grammars.json
// (downloaded once; an offline build reuses what is already in wasm/).
await fetchGrammars({ quiet: !production });

const shared = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const nodeCtx = await esbuild.context({
  ...shared,
  platform: 'node',
  target: 'node20',
  outfile: 'dist/extension.js',
  alias: { 'web-tree-sitter': path.join(nm, 'web-tree-sitter', 'web-tree-sitter.cjs') },
});

// Web extension host (vscode.dev, github.dev): no Node APIs, so `node:*`
// imports stay external. They are only reached behind `isWeb` guards.
const webCtx = await esbuild.context({
  ...shared,
  platform: 'browser',
  target: 'es2022',
  outfile: 'dist/extension-web.js',
  alias: { 'web-tree-sitter': path.join(nm, 'web-tree-sitter', 'web-tree-sitter.cjs') },
  external: ['vscode', 'node:child_process'],
  define: { global: 'globalThis' },
});

if (watch) {
  await nodeCtx.watch();
  await webCtx.watch();
} else {
  await nodeCtx.rebuild();
  await webCtx.rebuild();
  await nodeCtx.dispose();
  await webCtx.dispose();
}
