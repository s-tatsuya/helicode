# Development

Everything runs inside the Nix dev shell (`flake.nix`): Node 22, npm, git,
jq and the tree-sitter CLI. Nothing is installed globally; `node_modules/`
lives in the repository. Without Nix (Windows, or any machine with Node 22
installed) the same npm scripts work as-is; see "Windows" below.

```sh
nix develop            # or: direnv allow   (uses .envrc -> `use flake`)
npm ci                 # install pinned dependencies
npm run typecheck      # tsc --noEmit
npm test               # unit tests for src/core (node:test, bundled by esbuild)
npm run build          # regenerate keybindings + bundle dist/extension.js + copy wasm/
npm run check-queries  # compile every bundled textobjects.scm against its grammar
npm run test:integration   # downloads VS Code once, runs test/integration in a real instance
npm run package        # typecheck + tests + production bundle + helicode-<version>.vsix
code --install-extension helicode-0.1.0.vsix
```

`npm run watch` keeps `dist/extension.js` up to date; press F5 in VS Code
("Run Extension") to launch an Extension Development Host.

## Windows

```powershell
winget install OpenJS.NodeJS.LTS
npm ci
npm run typecheck; npm test; npm run build
npm run package
code --install-extension .\helicode-0.1.0.vsix
```

The scripts are plain Node (`scripts/*.mjs`, `esbuild.mjs`), so nothing here
needs a POSIX shell. `npm run check-queries` needs the `tree-sitter` CLI
(`npm i -g tree-sitter-cli`) and is optional. GitHub Actions
(`.github/workflows/ci.yml`) runs typecheck, tests and packaging on
`windows-latest`, `macos-latest` and `ubuntu-latest` and uploads the `.vsix`.

## Layout

- `src/core` is pure and unit tested (`test/core.test.ts`); keep VS Code out of it.
- `src/engine/commands/*` mirror Helix's `commands.rs` groups. A command is an
  async function taking a `CommandContext`. Register it in
  `src/engine/commands/index.ts` under its Helix name.
- Special keys must be listed in `scripts/gen-keybindings.mjs`; run
  `npm run gen-keybindings` (part of `npm run build`) after editing.
- `queries/` are vendored from Helix; `npm run check-queries` after updating.
- `docs/keymap.md` and `docs/commands.md` are the coverage matrices; update
  them together with new commands.

## Integration tests

`test/integration/index.ts` drives a real VS Code window through the same
entry points the keyboard uses (`type` and `helicode.key`) and asserts text
and selections. `@vscode/test-electron` downloads a VS Code build into
`.vscode-test/` on first run.

## Releasing

`npm run package` produces the `.vsix`. For the Marketplace, set `publisher`
in `package.json`, then `npx vsce publish` (needs a PAT). The `.vsix` contains
`dist/`, `wasm/`, `queries/`, `docs/` and the license files only (see
`.vscodeignore`).

## Updating Helix references

The keymap (`src/engine/defaults.ts`) is a transcription of
`helix-term/src/keymap/default.rs`; typed commands live in
`src/vscode/cmdline.ts`. When Helix adds bindings, add the command
implementation, the keymap entry, the keybinding (if it is a special key) and
the docs row.
