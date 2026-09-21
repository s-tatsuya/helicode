; `resource "a" "b" { ... }` and friends are the functions of an HCL file.
(block
  (body) @function.inside) @function.around

(block) @function.around

(attribute
  (expression) @entry.inside) @entry.around

(comment) @comment.around

(function_call
  (function_arguments) @parameter.inside) @parameter.around

(object_elem) @entry.around
