import { Extension, textInputRule } from "@tiptap/core";

/**
 * The same two substitutions the caption box makes, inside the notebooks.
 *
 * NO CAPTURE GROUPS. The first version used `find: /(\w)--(\w)$/` with
 * `replace: "$1—$2"`, which reads like `String.replace` and is not: tiptap
 * inserts the replacement LITERALLY, so typing two hyphens produced the text
 * "--$1—$2" on screen. `replace` is a string, not a template.
 *
 * The fix is to need no groups at all, by letting the rules run into each
 * other: two hyphens become an em dash, and then an em dash followed by ">"
 * becomes the arrow. Typing "-->" therefore passes through "—" on its way to
 * "↠" without either rule having to know about the other's characters.
 *
 * Written as input rules rather than a rewrite pass over the document, so undo
 * works: press Ctrl+Z after an em dash appears and your two hyphens come back.
 */
export const TypingShortcuts = Extension.create({
  name: "typingShortcuts",

  addInputRules() {
    return [
      // The arrow first, so it wins when the text arrives whole — a paste, or
      // an import — rather than a character at a time.
      textInputRule({ find: /-->$/, replace: "↠" }),

      // And the same arrow reached the other way: the dash rule below has
      // already fired, and this is the ">" landing after it.
      textInputRule({ find: /—>$/, replace: "↠" }),

      // Two hyphens, the moment the second one is typed.
      textInputRule({ find: /--$/, replace: "—" }),
    ];
  },
});
