(element
  (STag)
  (content) @xml-element.inside
  (ETag)) @xml-element.around

(element) @xml-element.around

(Comment) @comment.around

(Attribute) @entry.around
(Attribute
  (AttValue) @entry.inside)
