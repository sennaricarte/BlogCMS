import { Images, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { listCmsMediaFiles } from "../../lib/cms-media-upload";
import { isImageFileName } from "../../lib/media-filename";

type Item = { name: string; path: string; url: string };

type Props = {
  open: boolean;
  onClose: () => void;
  /** Invocado com a URL pública da imagem na biblioteca. */
  onSelect: (publicUrl: string) => void;
  title: string;
};

/**
 * Escolhe uma imagem já existente em `public/assets/cms/` no repositório GitHub do cliente.
 */
export function StorageImagePickerModal({ open, onClose, onSelect, title }: Props) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [selected, setSelected] = useState<Item | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await listCmsMediaFiles();
      if (!r.ok) {
        setErr(r.error);
        setItems([]);
        return;
      }
      const out: Item[] = [];
      for (const it of r.items || []) {
        if (!it.name || !isImageFileName(it.name)) continue;
        out.push({ name: it.name, path: it.path, url: it.url });
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

  function confirm() {
    if (!selected) return;
    onSelect(selected.url);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="storage-picker-title"
    >
      <button
        type="button"
        className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm"
        aria-label="Fechar"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 id="storage-picker-title" className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Images className="h-4 w-4" aria-hidden />
            {title}
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
              A carregar imagens…
            </p>
          ) : items.length === 0 && !err ? (
            <p className="text-sm text-slate-500">
              Ainda não há imagens. Envia ficheiros em{" "}
              <a className="font-medium text-slate-800 underline" href="/admin/media/">
                Central de mídia
              </a>{" "}
              e volta aqui.
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

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 bg-slate-50/90 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            disabled={!selected}
            onClick={confirm}
            className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Usar esta imagem
          </button>
        </div>
      </div>
    </div>
  );
}
