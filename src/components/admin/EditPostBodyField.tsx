import { useCallback, useEffect, useState } from "react";
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
 * Conteúdo do artigo: TipTap + campo oculto #f-body para o script `post-editor.ts` (pré‑visualização e gravação).
 */
export function EditPostBodyField({ initialMarkdown }: Props) {
  const [md, setMd] = useState(initialMarkdown);
  const [editorKey, setEditorKey] = useState(0);

  const onChange = useCallback((next: string) => {
    setMd(next);
    setHiddenBody(next);
  }, []);

  useEffect(() => {
    const onExternal = (e: Event) => {
      const ce = e as CustomEvent<{ markdown?: string }>;
      const next = ce.detail?.markdown;
      if (typeof next !== "string") return;
      setMd(next);
      setEditorKey((k) => k + 1);
      setHiddenBody(next);
    };
    window.addEventListener(SYNC_EVENT, onExternal as EventListener);
    return () => window.removeEventListener(SYNC_EVENT, onExternal as EventListener);
  }, []);

  return (
    <div className="w-full min-w-0" data-editor="tiptap">
      <Editor key={editorKey} initialMarkdown={md} onChange={onChange} markdownDebounceMs={0} />
    </div>
  );
}
