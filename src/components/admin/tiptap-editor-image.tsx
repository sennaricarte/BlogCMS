import { mergeAttributes } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import {
  getDisplayUrl,
  type EditorImagePreviewContext,
} from "../../lib/admin-editor-image-urls";
import { githubRawAssetToMarkdownRelative } from "../../lib/github-raw-url";

export type EditorImagePreviewRefs = {
  getPreviewContext: () => EditorImagePreviewContext | null;
  getGithubToken: () => string | null;
};

function shouldPersistDataSrc(src: string): boolean {
  const s = src.trim();
  return (
    s.startsWith("/assets/") ||
    /^\.\.\/\.\.\/assets\/blog\//i.test(s) ||
    /^\.\.\/assets\/blog\//i.test(s)
  );
}

/**
 * Imagem no editor: `src` canónico no estado (Markdown); `renderHTML` usa {@link getDisplayUrl}
 * e define `data-src` para o Turndown / normalização ao guardar.
 */
export function createEditorImagePreviewExtension(refs: EditorImagePreviewRefs) {
  return Image.extend({
    parseHTML() {
      return [
        {
          tag: "img[src]",
          priority: 60,
          getAttrs: (element) => {
            const el = element as HTMLImageElement;
            const dataSrc = el.getAttribute("data-src")?.trim();
            const srcAttr = el.getAttribute("src")?.trim() || "";
            let canon = "";
            if (dataSrc && shouldPersistDataSrc(dataSrc)) {
              canon = dataSrc;
            } else if (shouldPersistDataSrc(srcAttr)) {
              canon = srcAttr;
            } else {
              const fromGh = githubRawAssetToMarkdownRelative(srcAttr);
              canon = fromGh || srcAttr;
            }
            return {
              src: canon,
              alt: el.getAttribute("alt"),
              title: el.getAttribute("title"),
            };
          },
        },
        ...(this.parent?.() ?? []),
      ];
    },
    renderHTML({ HTMLAttributes }) {
      const { src: canonAttr, ...rest } = HTMLAttributes;
      const src = String(canonAttr ?? "").trim();
      const display = getDisplayUrl(src, refs.getPreviewContext(), refs.getGithubToken());
      const dataSrc = shouldPersistDataSrc(src) ? src : null;
      return [
        "img",
        mergeAttributes(this.options.HTMLAttributes, rest, {
          src: display,
          ...(dataSrc ? { "data-src": dataSrc } : {}),
        }),
      ];
    },
  }).configure({ inline: true, allowBase64: true });
}
