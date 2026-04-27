import { useCallback, useEffect, useState } from "react";
import { Editor } from "./Editor";

const SYNC_EVENT = "blogcms-page-body";

function setHiddenBody(markdown: string) {
  const h = document.getElementById("p-body") as HTMLInputElement | null;
  if (!h) return;
  h.value = markdown;
  h.dispatchEvent(new Event("input", { bubbles: true }));
}

type Props = {
  initialMarkdown: string;
};

/**
 * Corpo da página: TipTap + campo oculto #p-body para o script `page-editor.ts` (pré‑visualização e gravação GitHub).
 * Mesmo formato do editor de artigos (EditPostBodyField + #f-body).
 */
export function EditPageBodyField({ initialMarkdown }: Props) {
  const [md, setMd] = useState(initialMarkdown);
  const [editorKey, setEditorKey] = useState(0);

  const onChange = useCallback((next: string) => {
    setMd(next);
  }, []);

  useEffect(() => {
    setHiddenBody(md);
  }, [md]);

  useEffect(() => {
    const onExternal = (e: Event) => {
      const ce = e as CustomEvent<{ markdown?: string }>;
      const next = ce.detail?.markdown;
      if (typeof next !== "string") return;
      setMd(next);
      setEditorKey((k) => k + 1);
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
