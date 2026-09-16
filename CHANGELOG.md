# Changelog

## 0.1.0 (2026-09-17)

Initial release.

- Helix selection model (anchor/head ranges, multiple selections, primary selection) on top of VS Code.
- Normal, insert and select modes; goto, match, view, window, space and unimpaired minor modes.
- Counts, registers (`"`, `_`, `+`, `*`, `/`, `:`, `@`, `.`, `%`, `#`, `a-z`), macros, `.` repeat, `Alt-.` repeat motion, jumplist.
- Surround (`ms`/`mr`/`md`), textobjects (`mi`/`ma`), jump labels (`gw`).
- Tree-sitter (WASM) textobjects, object navigation, node selection and bracket matching with Helix's queries.
- `:` command line with completion, history and 80+ Helix typed commands.
- Notebook cell-list bindings, Markdown preview helpers.
- Nix based development environment, unit and integration tests.
