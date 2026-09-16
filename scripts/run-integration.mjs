// Bundles the integration tests and runs them inside a downloaded VS Code.
import * as esbuild from 'esbuild';
import { mkdirSync, existsSync, symlinkSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { runTests, downloadAndUnzipVSCode } from '@vscode/test-electron';

mkdirSync('out/integration', { recursive: true });
await esbuild.build({
  entryPoints: ['test/integration/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  outfile: 'out/integration/index.js',
  external: ['vscode'],
  logLevel: 'warning',
});

const root = process.cwd();
// Newer macOS builds ship `Contents/MacOS/Code`; older test runners look for `Electron`.
const exe = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || 'stable');
if (process.platform === 'darwin' && !existsSync(exe)) {
  const dir = path.dirname(exe);
  const alt = readdirSync(dir).find((f) => f !== 'Electron');
  if (alt) symlinkSync(path.join(dir, alt), exe);
}
try {
  await runTests({
    extensionDevelopmentPath: root,
    extensionTestsPath: path.join(root, 'out/integration/index.js'),
    launchArgs: ['--disable-extensions', '--disable-workspace-trust', '--user-data-dir', path.join(root, '.vscode-test/user-data')],
    version: process.env.VSCODE_VERSION || 'stable',
    extensionTestsEnv: { HELICODE_TRACE: '1' },
  });
} catch (e) {
  console.error('integration tests failed:', e);
  process.exit(1);
}
