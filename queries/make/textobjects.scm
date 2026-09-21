; A rule is the unit you jump between; its recipe is the "inside".
(rule
  (recipe) @function.inside) @function.around

(rule) @function.around

(variable_assignment
  value: (_) @entry.inside) @entry.around

(comment) @comment.around

(prerequisites
  (word) @parameter.inside) @parameter.around
