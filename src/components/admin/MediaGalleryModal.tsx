import type { Editor } from "@tiptap/core";
import { Images, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { isImageFileName } from "../../lib/media-filename";

type Item = { name: string; path: string; url: string };

type Props = {
  open: boolean;
  onClose: () => void;
  editor: Editor;
};

/**
 * Galeria: lista o bucket Supabase Storage (Central de Mídia) e insere a imagem com alt (SEO).
 */
export function MediaGalleryModal({ open, onClose, editor }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);
  const [altText, setAltText] = useState("");

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const res = await fetch("/api/admin/media/list", { credentials: "same-origin" });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: Item[];
      };
      if (!j.ok) {
        setErr(j.error || "Não foi possível listar a mídia no Supabase.");
        setItems([]);
        return;
      }
      const out: Item[] = [];
      for (const it of j.items || []) {
        if (!it.name || !isImageFileName(it.name)) {
          continue;
        }
        out.push({
          name: it.name,
          path: it.path,
          url: it.url,
        });
      }
      setItems(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao listar ficheiros.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      setSelected(null);
      setAltText("");
      void load();
    }
  }, [open, load]);

  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [open, onClose]);

  useEffect(() => {
    if (!selected) {
      setAltText("");
      return;
    }
    const base = selected.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
    setAltText(base.slice(0, 120) || "Imagem");
  }, [selected]);

  function insert() {
    if (!selected) return;
    const alt = altText.trim() || "Imagem";
    editor.chain().focus().setImage({ src: selected.url, alt }).run();
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="media-gallery-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Fechar galeria"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="media-gallery-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Images className="h-4 w-4" aria-hidden />
            Galeria (Supabase)
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {err && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950" role="alert">
              {err}
            </p>
          )}
          {loading ? (
            <p className="text-sm text-slate-500" role="status">
              Carregando imagens…
            </p>
          ) : items.length === 0 && !err ? (
            <p className="text-sm text-slate-500">
              Nenhuma imagem no Storage. Envie ficheiros em <span className="font-medium">/admin/media/</span>.
            </p>
          ) : (
            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {items.map((it) => {
                const on = selected?.path === it.path;
                return (
                  <li key={it.path}>
                    <button
                      type="button"
                      onClick={() => setSelected(it)}
                      className={
                        "w-full overflow-hidden rounded-lg border-2 text-left transition " +
                        (on ? "border-slate-900 ring-1 ring-slate-900" : "border-slate-200 hover:border-slate-300")
                      }
                    >
                      <img
                        src={it.url}
                        alt=""
                        className="h-24 w-full object-cover"
                        loading="lazy"
                        decoding="async"
                      />
                      <span className="block truncate px-1 py-0.5 text-[10px] text-slate-500">{it.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected && (
          <div className="border-t border-slate-200 bg-slate-50/90 px-4 py-3">
            <label htmlFor="media-modal-alt" className="text-xs font-medium text-slate-700">
              Texto alternativo (alt) — SEO e acessibilidade
            </label>
            <input
              id="media-modal-alt"
              value={altText}
              onChange={(e) => setAltText(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900"
              placeholder="Descreva a imagem em poucas palavras"
              autoComplete="off"
            />
            <p className="mt-1 text-[11px] text-slate-500">
              O artigo grava a URL pública do Storage (imagem otimizada em WebP no upload).
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={insert}
                className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800"
              >
                Inserir no artigo
              </button>
              <button
                type="button"
                onClick={() => {
                  setSelected(null);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
              >
                Outra imagem
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
