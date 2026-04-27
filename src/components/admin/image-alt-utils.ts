import type { Editor } from "@tiptap/core";

/**
 * Pede texto alternativo até o utilizador preencher ou cancelar (null = cancelar).
 * Obrigatório para acessibilidade (WCAG) e SEO.
 */
export function promptAltRequired(
  message = "Texto alternativo (acessibilidade e SEO) — obrigatório para esta imagem:",
): string | null {
  if (typeof window === "undefined") return null;
  for (;;) {
    const v = window.prompt(message);
    if (v === null) return null;
    const t = v.trim();
    if (t) return t;
  }
}

/**
 * Se existir uma imagem sem `alt` no documento, trata a primeira: pede o texto
 * ou remove a imagem se o utilizador cancelar. Pode chamar-se várias vezes
 * (ex. após colar HTML com vários &lt;img&gt;).
 */
export function fixNextImageWithoutAlt(editor: Editor | null): void {
  if (!editor || editor.isDestroyed) return;

  let posFound = -1;
  let nodeSize = 0;
  const { doc } = editor.state;
  doc.descendants((node, pos) => {
    if (node.type.name === "image" && !String(node.attrs.alt ?? "").trim()) {
      posFound = pos;
      nodeSize = node.nodeSize;
      return false;
    }
  });

  if (posFound < 0) return;

  const alt = promptAltRequired();
  if (alt === null) {
    editor.chain().focus().deleteRange({ from: posFound, to: posFound + nodeSize }).run();
    return;
  }

  const node = editor.state.doc.nodeAt(posFound);
  if (!node || node.type.name !== "image") return;

  editor
    .chain()
    .focus()
    .command(({ tr }) => {
      tr.setNodeMarkup(posFound, undefined, { ...node.attrs, alt });
      return true;
    })
    .run();
}
