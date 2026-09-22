# Third-party notices

Helicode itself is MIT licensed (see [LICENSE](LICENSE)). It contains, and the
published `.vsix` ships, material from the projects below. Their licenses and
copyright notices are reproduced here; full license texts that are too long to
inline live in [`licenses/`](licenses).

## 1. Helix editor — MPL-2.0

- Source: <https://github.com/helix-editor/helix>
- License: Mozilla Public License 2.0, [`licenses/MPL-2.0.txt`](licenses/MPL-2.0.txt)
- Copyright (c) 2021 Blaž Hrastnik and the Helix contributors

Helicode is a re-implementation of the Helix editing model. The following parts
are covered by the MPL and stay under the MPL even though the rest of Helicode
is MIT (MPL-2.0 § 3.3, "Distribution of a Larger Work"). The corresponding
Source Code Form is this repository (<https://github.com/s-tatsuya/helicode>)
together with the upstream repository linked above.

| Part of Helicode | Relationship to Helix |
| --- | --- |
| `queries/*/textobjects.scm` | copied verbatim from `runtime/queries/` |
| `docs/tutor.txt` | copied verbatim from `runtime/tutor` |
| `docs/tutor.ja.txt` | Japanese translation of `runtime/tutor` (a Modification under MPL-2.0 § 1.10) |
| every source file carrying an `SPDX-License-Identifier: MPL-2.0` header (most of `src/core/` and `src/engine/`, plus `src/vscode/cmdline.ts`, `src/vscode/helix-config.ts`, `src/vscode/labels.ts` and `src/treesitter/`) | ported from `helix-core`, `helix-view`, `helix-vcs` and `helix-term`; command names, `:` command descriptions and the default keymap come from `helix-term/src/commands/typed.rs` and `helix-term/src/keymap/default.rs` |

Every file that is a port carries an `SPDX-License-Identifier: MPL-2.0` header.
Files without that header are original Helicode code under the MIT license.

Helicode is not affiliated with, endorsed by, or a product of the Helix
project. "Helix" is used only to describe what the extension is compatible
with.

## 2. tree-sitter / web-tree-sitter — MIT

- Source: <https://github.com/tree-sitter/tree-sitter>
- Shipped as: `wasm/web-tree-sitter.wasm` and the runtime bundled into `dist/`

```
The MIT License (MIT)

Copyright (c) 2018 Max Brunsfeld

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. @vscode/tree-sitter-wasm — MIT

- Source: <https://github.com/microsoft/vscode-tree-sitter-wasm>
- Shipped as: 16 of the `wasm/tree-sitter-*.wasm` grammar binaries (see § 5)

```
MIT License

Copyright (c) Microsoft Corporation.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 4. smol-toml — BSD-3-Clause

- Source: <https://github.com/squirrelchat/smol-toml>
- Shipped as: bundled into `dist/extension.js` and `dist/extension-web.js`
  (used by `:config-import` to read a Helix `config.toml`)

```
Copyright (c) Squirrel Chat et al., All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the
   documentation and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software without
   specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## 5. Bundled tree-sitter grammars (`wasm/`)

Grammar binaries shipped inside the extension. Those marked *(vscode)* are the
prebuilt binaries from `@vscode/tree-sitter-wasm` 0.3.1 (§ 3); the rest are the
upstream release artifacts pinned by SHA-256 in `grammars.json`.

### MIT

| Grammar | Source | Copyright |
| --- | --- | --- |
| bash *(vscode)* | tree-sitter/tree-sitter-bash | Copyright (c) 2017 Max Brunsfeld |
| c | tree-sitter/tree-sitter-c v0.24.2 | Copyright (c) 2014 Max Brunsfeld |
| c-sharp *(vscode)* | tree-sitter/tree-sitter-c-sharp | Copyright (c) 2014-2023 Max Brunsfeld, Damien Guard, Amaan Qureshi, and contributors |
| cpp *(vscode)* | tree-sitter/tree-sitter-cpp | Copyright (c) 2014 Max Brunsfeld |
| css *(vscode)* | tree-sitter/tree-sitter-css | Copyright (c) 2018 Max Brunsfeld |
| go *(vscode)* | tree-sitter/tree-sitter-go | Copyright (c) 2014 Max Brunsfeld |
| html | tree-sitter/tree-sitter-html v0.23.2 | Copyright (c) 2014 Max Brunsfeld |
| java *(vscode)* | tree-sitter/tree-sitter-java | Copyright (c) 2017 Ayman Nadeem |
| javascript *(vscode)* | tree-sitter/tree-sitter-javascript | Copyright (c) 2014 Max Brunsfeld |
| json | tree-sitter/tree-sitter-json v0.24.8 | Copyright (c) 2014 Max Brunsfeld |
| lua | tree-sitter-grammars/tree-sitter-lua v0.5.0 | Copyright (c) 2021 Munif Tanjim |
| make | tree-sitter-grammars/tree-sitter-make v1.1.1 | Copyright (c) 2021 Alexandre A. Muller |
| markdown | tree-sitter-grammars/tree-sitter-markdown v0.5.3 | Copyright (c) 2021 Matthias Deiml |
| php *(vscode)* | tree-sitter/tree-sitter-php | Copyright (c) 2017 Josh Vera, GitHub; Copyright (c) 2019 Max Brunsfeld, Amaan Qureshi, Christian Frøystad, Caleb White |
| powershell *(vscode)* | airbus-cert/tree-sitter-powershell | Copyright (c) 2023 Airbus CERT |
| python *(vscode)* | tree-sitter/tree-sitter-python | Copyright (c) 2016 Max Brunsfeld |
| regex *(vscode)* | tree-sitter/tree-sitter-regex | Copyright (c) 2014 Max Brunsfeld |
| ruby *(vscode)* | tree-sitter/tree-sitter-ruby | Copyright (c) 2016 Rob Rix |
| rust *(vscode)* | tree-sitter/tree-sitter-rust | Copyright (c) 2017 Maxim Sokolov |
| toml | tree-sitter-grammars/tree-sitter-toml v0.7.0 | Copyright (c) Ika <ikatyang@gmail.com> |
| tsx, typescript *(vscode)* | tree-sitter/tree-sitter-typescript | Copyright (c) 2017 Max Brunsfeld |
| xml | tree-sitter-grammars/tree-sitter-xml v0.7.0 | Copyright (c) 2023 ObserverOfTime |
| yaml | tree-sitter-grammars/tree-sitter-yaml v0.7.2 | Copyright (c) 2024 tree-sitter-grammars contributors; Copyright (c) 2019-2021 Ika |
| zig | tree-sitter-grammars/tree-sitter-zig v1.1.2 | Copyright (c) 2024 Amaan Qureshi <amaanq12@gmail.com> |

All of the above are distributed under the MIT license, whose terms are the
ones reproduced in § 2, with the copyright notice given in the table.

### Apache-2.0

| Grammar | Source | Copyright |
| --- | --- | --- |
| elixir | elixir-lang/tree-sitter-elixir v0.3.5 | Copyright 2021 The Elixir Team |
| hcl | tree-sitter-grammars/tree-sitter-hcl v1.2.0 | no copyright owner named upstream; (c) the tree-sitter-hcl contributors |
| ini *(vscode)* | justinmk/tree-sitter-ini | no copyright owner named upstream; (c) the tree-sitter-ini contributors |

Licensed under the Apache License, Version 2.0 — full text in
[`licenses/Apache-2.0.txt`](licenses/Apache-2.0.txt). You may not use these
files except in compliance with that license. Unless required by applicable law
or agreed to in writing, they are distributed on an "AS IS" BASIS, WITHOUT
WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.

`tree-sitter-elixir` ships a NOTICE file, reproduced verbatim as
[`licenses/tree-sitter-elixir-NOTICE.txt`](licenses/tree-sitter-elixir-NOTICE.txt)
as required by Apache-2.0 § 4(d).

## 6. Grammars downloaded on demand (not shipped)

`:tree-sitter-install <name>` downloads these from their upstream releases into
the extension's global storage on the user's machine. They are *not* part of
the `.vsix`; `grammars.json` records the URL, SHA-256 and license of each.

| Grammar | Source | License | Copyright |
| --- | --- | --- | --- |
| haskell | tree-sitter/tree-sitter-haskell v0.23.1 | MIT | Copyright (c) 2014 Max Brunsfeld |
| kotlin | fwcd/tree-sitter-kotlin 0.3.8 | MIT | Copyright (c) 2019 fwcd |
| ocaml | tree-sitter/tree-sitter-ocaml v0.26.0 | MIT | Copyright (c) 2020 Max Brunsfeld and Pieter Goetschalckx |
| scala | tree-sitter/tree-sitter-scala v0.26.2 | MIT | Copyright (c) 2018 Max Brunsfeld and GitHub |
| swift | alex-pinkus/tree-sitter-swift 0.7.3 | MIT | Copyright (c) 2021 alex-pinkus |
