# Vendored tree-sitter queries

The `*/textobjects.scm` files in this directory are copied verbatim from the
[Helix editor](https://github.com/helix-editor/helix) `runtime/queries/`
directory and are licensed under the Mozilla Public License 2.0 (see
`LICENSE` in this directory). They define the `function`, `class`,
`parameter`, `comment`, `test`, `entry` and `xml-element` textobjects used by
`mi`/`ma` and `]f`/`[f` etc.

Grammars that have no bundled WASM file (lua, json, yaml, ...) keep their
queries here so that user supplied grammars (`helicode.treeSitter.extraGrammars`)
work out of the box.
