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
npm run fetch-grammars # download every grammar in grammars.json (including the optional ones)
npm run gen-icon       # regenerate media/icon.png and media/helicode.svg
npm run package        # typecheck + tests + production bundle + helicode-<version>.vsix
code --install-extension helicode-0.1.0.vsix
```

`npm run build` produces two bundles: `dist/extension.js` for the Node
extension host (desktop, SSH, Dev Containers, WSL) and `dist/extension-web.js`
for the web extension host (vscode.dev, github.dev). Only `src/platform.ts`
and the lazily imported `node:child_process` in `src/engine/commands/shell.ts`
may touch Node APIs; everything else goes through `vscode.workspace.fs` and
`src/core/paths.ts` so both bundles work.

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
- `grammars.json` lists the prebuilt grammar WASM files that are not in
  `@vscode/tree-sitter-wasm`, with a sha256 for each. Add one with
  `node scripts/fetch-grammars.mjs --update` (it records the checksum) and a
  `bundled` flag: `true` ships it in the `.vsix`, `false` makes it installable
  with `:tree-sitter-install`.
- `src/treesitter/languages.json` maps VS Code language ids to a grammar and a
  query directory; it is shared by the extension and `scripts/check-queries.mjs`.
- Strings shown in the VS Code UI live in `package.nls.json` (English) and
  `package.nls.ja.json`; `package.json` refers to them with `%keys%`.
- `docs/keymap.md` and `docs/commands.md` are the coverage matrices; update
  them together with new commands. `docs/tutor.txt` has a Japanese counterpart
  in `docs/tutor.ja.txt` (`:tutor ja`).

## Integration tests

`test/integration/index.ts` drives a real VS Code window through the same
entry points the keyboard uses (`type` and `helicode.key`) and asserts text
and selections. `@vscode/test-electron` downloads a VS Code build into
`.vscode-test/` on first run.

## Releasing

1. Update `CHANGELOG.md` and bump `version` in `package.json`.
2. `npm run package` to check the `.vsix` locally
   (`dist/`, `wasm/`, `queries/`, `docs/`, `media/icon.png` and the license
   files only; see `.vscodeignore`).
3. Tag and push: `git tag v0.2.0 && git push --tags`.

`.github/workflows/publish.yml` then builds, verifies that the tag matches
`package.json`, publishes to the VS Code Marketplace (`VSCE_PAT` secret) and,
when `OVSX_PAT` is set, to Open VSX, and attaches the `.vsix` to the GitHub
release. `workflow_dispatch` with `dry_run` builds the `.vsix` without
publishing. `npm run publish` does the same from a workstation.

## Updating Helix references

The keymap (`src/engine/defaults.ts`) is a transcription of
`helix-term/src/keymap/default.rs`; typed commands live in
`src/vscode/cmdline.ts`. When Helix adds bindings, add the command
implementation, the keymap entry, the keybinding (if it is a special key) and
the docs row.
