import { useCallback, useEffect, useRef, useState } from "react";
import { Columns2, PanelLeft } from "lucide-react";
import { PageBlocksEditor } from "./PageBlocksEditor";
import type { PageBlock } from "../../lib/page-blocks.zod";

const STORAGE_KEY = "blogcms-page-editor-split";

type Props = {
  hiddenInputId?: string;
};

function buildPageUrlFromForm(): string {
  if (typeof window === "undefined") return "";
  const origin = window.location.origin;
  const slugEl = document.getElementById("p-slug") as HTMLInputElement | null;
  const slug = (slugEl?.value || "preview").trim().replace(/^\/+|\/+$/g, "") || "preview";
  return `${origin}/p/${slug}/`;
}

export function PageEditorSplitView({ hiddenInputId = "p-page-blocks" }: Props) {
  const [split, setSplit] = useState(false);
  const [previewKey, setPreviewKey] = useState(0);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      if (v === "1") setSplit(true);
    } catch {
      /* ignore */
    }
  }, []);

  const setSplitPersist = useCallback((next: boolean) => {
    setSplit(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      /* ignore */
    }
  }, []);

  const refreshPreview = useCallback(
    async (blocks: PageBlock[]) => {
      setPreviewError(null);
      if (!split) return;
      setPreviewLoading(true);
      try {
        const pageUrl = buildPageUrlFromForm();
        const res = await fetch("/api/admin/preview/page-blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ blocks, pageUrl }),
        });
        const j = (await res.json()) as { ok?: boolean; sid?: string; error?: string };
        if (!res.ok || !j.ok || !j.sid) {
          setPreviewError(j.error || "Não foi possível gerar a pré-visualização.");
          return;
        }
        const url = `/admin/preview/page-blocks?sid=${encodeURIComponent(j.sid)}`;
        setPreviewKey((k) => k + 1);
        if (iframeRef.current) {
          iframeRef.current.src = url;
        }
      } catch {
        setPreviewError("Erro de rede ao pedir a pré-visualização.");
      } finally {
        setPreviewLoading(false);
      }
    },
    [split],
  );

  const onBlocksChange = useCallback(
    (blocks: PageBlock[]) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void refreshPreview(blocks);
      }, 350);
    },
    [refreshPreview],
  );

  useEffect(() => {
    if (!split) return;
    const el = document.getElementById(hiddenInputId) as HTMLInputElement | null;
    if (!el?.value || el.value === "[]") return;
    try {
      const raw = JSON.parse(el.value) as unknown;
      if (Array.isArray(raw) && raw.length > 0) {
        void refreshPreview(raw as PageBlock[]);
      }
    } catch {
      /* ignore */
    }
  }, [split, hiddenInputId, refreshPreview]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  return (
    <div className="min-w-0 space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-slate-800">Blocos da página</h2>
        <button
          type="button"
          onClick={() => setSplitPersist(!split)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
          aria-pressed={split}
        >
          {split ? (
            <>
              <PanelLeft className="h-4 w-4" aria-hidden />
              Só editor
            </>
          ) : (
            <>
              <Columns2 className="h-4 w-4" aria-hidden />
              Vista dividida
            </>
          )}
        </button>
      </div>

      {split && (
        <p className="text-xs text-slate-500">
          O painel direito mostra os mesmos componentes Astro que o site público. O QR Code usa o slug actual em
          <code className="mx-0.5 rounded bg-slate-100 px-1 font-mono">/p/…/</code> como URL de exemplo.
        </p>
      )}

      {previewError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800" role="alert">
          {previewError}
        </p>
      )}

      <div
        className={
          split
            ? "grid min-h-[32rem] grid-cols-1 gap-4 lg:grid-cols-2 lg:items-start"
            : "grid min-h-0 grid-cols-1"
        }
      >
        <div className="min-w-0 rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <PageBlocksEditor hiddenInputId={hiddenInputId} onBlocksChange={onBlocksChange} />
        </div>

        {split && (
          <div className="flex min-h-[28rem] min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-slate-100 shadow-inner">
            <div className="flex items-center justify-between border-b border-slate-200 bg-white px-3 py-2">
              <span className="text-xs font-medium text-slate-600">Pré-visualização</span>
              {previewLoading && <span className="text-xs text-slate-400">A actualizar…</span>}
            </div>
            <iframe
              key={previewKey}
              ref={iframeRef}
              title="Pré-visualização dos blocos Astro"
              className="min-h-[24rem] w-full flex-1 border-0 bg-white"
            />
          </div>
        )}
      </div>
    </div>
  );
}
