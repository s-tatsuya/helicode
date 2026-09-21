# Tree-sitter support

Helicode ships `web-tree-sitter` (the WASM build of the tree-sitter runtime)
and grammar binaries from two sources: `@vscode/tree-sitter-wasm` (the package
VS Code itself uses) and the upstream grammar releases listed in
`grammars.json`. Parsing happens in the extension host; trees are updated
incrementally, so even large files re-parse in a few milliseconds after the
initial parse. Files larger than `helicode.treeSitter.maxFileSizeKB` are
skipped.

Grammars are loaded through the VS Code file system API, so tree-sitter also
works over a remote connection and in the web extension host.

## What uses tree-sitter

| Feature | Keys |
| --- | --- |
| Textobjects | `mi`/`ma` + `f` `t` `a` `c` `T` `e` `x`; `mi m`/`ma m` (closest pair, syntax aware) |
| Object navigation | `]f` `[f` `]t` `[t` `]a` `[a` `]c` `[c` `]T` `[T` `]e` `[e` `]x` `[x` |
| Syntax node selection | `Alt-o` `Alt-i` `Alt-n` `Alt-p` `Alt-I` `Alt-a` `Alt-e` `Alt-b` |
| Bracket matching | `mm`, `ms`/`mr`/`md` with `m` (fuzzy, string-literal aware) |
| Debugging | `:tree-sitter-scopes`, `:tree-sitter-subtree` |

Without a grammar these fall back to plaintext behaviour (`mm`, surround
pairs) or report "tree-sitter is not available for this document".

## Bundled grammars

| VS Code language id | Grammar | Helix query |
| --- | --- | --- |
| `typescript` | tree-sitter-typescript | `typescript` (inherits `_typescript`, `ecma`) |
| `typescriptreact` | tree-sitter-tsx | `tsx` |
| `javascript` | tree-sitter-javascript | `javascript` |
| `javascriptreact` | tree-sitter-javascript | `jsx` |
| `python` | tree-sitter-python | `python` |
| `rust` | tree-sitter-rust | `rust` |
| `go` | tree-sitter-go | `go` |
| `java` | tree-sitter-java | `java` |
| `c` | tree-sitter-cpp | `c` |
| `cpp` | tree-sitter-cpp | `cpp` |
| `csharp` | tree-sitter-c-sharp | `c-sharp` |
| `css`, `scss` | tree-sitter-css | `css` |
| `php` | tree-sitter-php | `php` |
| `ruby` | tree-sitter-ruby | `ruby` |
| `shellscript` | tree-sitter-bash | `bash` |
| `html` | tree-sitter-html | `html` |
| `xml` | tree-sitter-xml | `xml` |
| `json`, `jsonc`, `jsonl` | tree-sitter-json | `json` |
| `yaml`, `dockercompose`, `github-actions-workflow` | tree-sitter-yaml | `yaml` |
| `toml` | tree-sitter-toml | `toml` |
| `lua` | tree-sitter-lua | `lua` |
| `markdown` | tree-sitter-markdown | `markdown` |
| `zig` | tree-sitter-zig | `zig` |
| `elixir` | tree-sitter-elixir | `elixir` |
| `makefile` | tree-sitter-make | `make` |
| `terraform`, `hcl` | tree-sitter-hcl | `hcl` |
| `ini`, `powershell`, `regex` | bundled | no textobject query (node selection and `mm` only) |

## Grammars installed on demand

Large grammars are not bundled; `:tree-sitter-install <name>` downloads one
(checksum verified against `grammars.json`) into the extension's global
storage, and `:tree-sitter-uninstall` removes it. `:tree-sitter-grammars`
lists everything that is bundled, installed or available.

| Language | Grammar | Size |
| --- | --- | --- |
| `kotlin` | fwcd/tree-sitter-kotlin | 4.1 MB |
| `swift` | alex-pinkus/tree-sitter-swift | 3.8 MB |
| `scala` | tree-sitter/tree-sitter-scala | 4.0 MB |
| `ocaml` | tree-sitter/tree-sitter-ocaml | 4.8 MB |
| `haskell` | tree-sitter/tree-sitter-haskell | 3.8 MB |

`npm run check-queries` compiles every query against its grammar (`-- --all`
also checks the optional ones in `wasm-optional/`); all bundled pairs compile
cleanly. Queries that fail to compile at runtime (for example a
user supplied grammar of a different version) are salvaged pattern by pattern
and the dropped patterns are logged (`:log-open`).

## Adding a grammar

1. Build or download a `tree-sitter-<lang>.wasm` compiled with a tree-sitter
   ABI between 13 and 15 (tree-sitter 0.22+; `tree-sitter build --wasm` in the
   grammar repo, the CLI is available in the Nix dev shell).
2. Put a Helix style query directory next to it if you want textobjects
   (`<queries>/<lang>/textobjects.scm`, `; inherits:` is honoured). Queries for
   many languages that have no bundled grammar are already included under
   `queries/` in the extension (lua, json, yaml, toml, html, kotlin, swift,
   dart, scala, elixir, zig, ocaml, nix, haskell).
3. Configure:

```jsonc
"helicode.treeSitter.extraGrammars": {
  "lua": { "wasm": "/home/me/grammars/tree-sitter-lua.wasm" },
  "nix": { "wasm": "/home/me/grammars/tree-sitter-nix.wasm", "queries": "/home/me/queries", "language": "nix" }
}
```

`queries` defaults to the extension's `queries/` directory and `language` to
the VS Code language id.

## Differences from Helix

- Language injections (for example JS inside HTML) are not handled; the whole
  document is parsed with one grammar.
- `mi g` / `ma g` (VCS change hunks) are unavailable because VS Code exposes no
  diff hunk API to extensions.
