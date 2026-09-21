; Sections behave like "types" (a heading and everything under it) and fenced
; code blocks like "functions", which is what `mi f` / `]f` mean in prose.
(section
  (atx_heading) @class.inside) @class.around

(section) @class.around

(fenced_code_block
  (code_fence_content) @function.inside) @function.around

(list_item) @entry.around
(list_item
  (paragraph) @entry.inside)

(block_quote) @comment.around
(block_quote
  (paragraph) @comment.inside)
