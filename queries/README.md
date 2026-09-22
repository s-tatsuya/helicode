# Vendored tree-sitter queries

The `*/textobjects.scm` files in this directory are copied verbatim from the
[Helix editor](https://github.com/helix-editor/helix) `runtime/queries/`
directory and are licensed under the Mozilla Public License 2.0 (full text in
[`../licenses/MPL-2.0.txt`](../licenses/MPL-2.0.txt); see also
[`../THIRD-PARTY-NOTICES.md`](../THIRD-PARTY-NOTICES.md)). They define the
`function`, `class`, `parameter`, `comment`, `test`, `entry` and `xml-element`
textobjects used by `mi`/`ma` and `]f`/`[f` etc.

Copyright (c) 2021 Blaž Hrastnik and the Helix contributors. The Source Code
Form of these files is available at the repository linked above; they are
unmodified, and any Helicode change to them would be a Modification under
MPL-2.0 § 1.10.

Grammars that have no bundled WASM file (lua, json, yaml, ...) keep their
queries here so that user supplied grammars (`helicode.treeSitter.extraGrammars`)
work out of the box.
