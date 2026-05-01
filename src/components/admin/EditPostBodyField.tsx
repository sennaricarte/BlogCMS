import { useCallback, useEffect, useRef, useState } from "react";
import { Editor } from "./Editor";

const SYNC_EVENT = "blogcms-post-body";

function setHiddenBody(markdown: string) {
  const h = document.getElementById("f-body") as HTMLInputElement | null;
  if (!h) return;
  h.value = markdown;
  h.dispatchEvent(new Event("input", { bubbles: true }));
}

type Props = {
  initialMarkdown: string;
};

/**
 * Conteúdo do artigo: TipTap + campo oculto #f-body para o script `post-editor.ts` (SEO e gravação).
 */
export function EditPostBodyField({ initialMarkdown }: Props) {
  const [md, setMd] = useState(initialMarkdown);
  const [editorKey, setEditorKey] = useState(0);
  const lastRemoteMarkdownRef = useRef<string | null>(null);

  const onChange = useCallback((next: string) => {
    setMd(next);
    setHiddenBody(next);
  }, []);

  useEffect(() => {
    const onExternal = (e: Event) => {
      const ce = e as CustomEvent<{ markdown?: string }>;
      const next = ce.detail?.markdown;
      if (typeof next !== "string") return;
      if (lastRemoteMarkdownRef.current === next) return;
      lastRemoteMarkdownRef.current = next;
      setMd(next);
      setEditorKey((k) => k + 1);
      setHiddenBody(next);
    };
    window.addEventListener(SYNC_EVENT, onExternal as EventListener);
    return () => window.removeEventListener(SYNC_EVENT, onExternal as EventListener);
  }, []);

  /**
   * O `post-editor.ts` preenche `#f-body` ao acabar o GET ao GitHub (import / sync) e dispara
   * `blogcms-post-body`. Se isso acontecer antes do listener React estar activo ou antes do TipTap
   * hidratar, o evento perde-se — o editor fica vazio até refrescar. Reconciliamos com o DOM em
   * alguns instantes após o mount.
   */
  useEffect(() => {
    const h = document.getElementById("f-body") as HTMLInputElement | null;
    if (!h) return;

    const adoptFromHiddenIfNeeded = () => {
      const domVal = h.value;
      setMd((prev) => {
        if (domVal === prev) return prev;
        lastRemoteMarkdownRef.current = domVal;
        queueMicrotask(() => setEditorKey((k) => k + 1));
        return domVal;
      });
    };

    adoptFromHiddenIfNeeded();
    const timeouts = [30, 120, 350, 800, 2000].map((ms) => window.setTimeout(adoptFromHiddenIfNeeded, ms));
    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <div className="w-full min-w-0" data-editor="tiptap">
      <Editor key={editorKey} initialMarkdown={md} onChange={onChange} markdownDebounceMs={0} />
    </div>
  );
}
