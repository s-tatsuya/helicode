// Bundles test/*.test.ts into out/test/*.cjs so node --test can run them.
import * as esbuild from 'esbuild';
import { readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';

mkdirSync('out/test', { recursive: true });
const entries = readdirSync('test').filter((f) => f.endsWith('.test.ts')).map((f) => path.join('test', f));
await esbuild.build({
  entryPoints: entries,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outdir: 'out/test',
  outExtension: { '.js': '.cjs' },
  external: ['vscode'],
  logLevel: 'warning',
});
