import { ImagePlus, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPagination } from "./AdminPagination";
import { uploadCmsMediaFile, listCmsMediaFiles } from "../../lib/cms-media-upload";
import { isImageFileName } from "../../lib/media-filename";

type ListItem = { name: string; path: string; url: string };

type DoneUpload = { name: string; url: string; relativeMd: string };

const MEDIA_PAGE_SIZE = 12;

export function MediaCenter() {
  const [list, setList] = useState<ListItem[]>([]);
  const [mediaPage, setMediaPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [upMsg, setUpMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [lastUpload, setLastUpload] = useState<DoneUpload | null>(null);
  const [postAlt, setPostAlt] = useState("");

  const refresh = useCallback(async () => {
    setErr(null);
    setLoading(true);
    try {
      const r = await listCmsMediaFiles();
      if (!r.ok) {
        setErr(r.error);
        setList([]);
        return;
      }
      const out: ListItem[] = [];
      for (const it of r.items || []) {
        if (!it.name || !isImageFileName(it.name)) {
          continue;
        }
        out.push({
          name: it.name,
          path: it.path,
          url: it.url,
        });
      }
      setList(out);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Erro ao listar.");
      setList([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const mediaPageCount = Math.max(1, Math.ceil(list.length / MEDIA_PAGE_SIZE) || 1);
  const safeMediaPage = Math.min(mediaPage, mediaPageCount - 1);
  const pagedMedia = useMemo(() => {
    const start = safeMediaPage * MEDIA_PAGE_SIZE;
    return list.slice(start, start + MEDIA_PAGE_SIZE);
  }, [list, safeMediaPage]);

  useEffect(() => {
    setMediaPage((p) => Math.min(p, Math.max(0, mediaPageCount - 1)));
  }, [list.length, mediaPageCount]);

  async function doUploadFiles(files: FileList | File[]) {
    setUpMsg(null);
    setErr(null);
    const arr = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (arr.length === 0) {
      setErr("Só se aceitam ficheiros de imagem.");
      return;
    }
    setLoading(true);
    try {
      const file = arr[0];
      const up = await uploadCmsMediaFile(file);
      if (!up.ok) {
        setErr(up.error);
        return;
      }
      const { data } = up;
      setLastUpload({ name: data.fileName, url: data.previewUrl, relativeMd: data.relativeMarkdown });
      const base = data.fileName.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ");
      setPostAlt(base.slice(0, 120) || "Imagem");
      setUpMsg("Imagem enviada. Preenche o texto alternativo (recomendado para acessibilidade e SEO) abaixo.");
      await refresh();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Falha no upload.");
    } finally {
      setLoading(false);
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    if (e.dataTransfer.files?.length) void doUploadFiles(e.dataTransfer.files);
  }

  const mdForCopy =
    lastUpload && postAlt.trim() ? `![${postAlt.trim()}](${lastUpload.relativeMd})` : lastUpload
      ? `![…](${lastUpload.relativeMd})`
      : "";

  return (
    <div className="space-y-6">
      {err && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
          {err}
        </p>
      )}
      <p className="text-sm text-zinc-600">
        As imagens são optimizadas (tamanho WebP até 1920px; SVG mantém-se) e gravadas em{" "}
        <code className="rounded bg-zinc-100 px-1 font-mono text-xs">public/assets/cms/</code> no repositório GitHub
        configurado em Definições — o mesmo sítio que o deploy serve em{" "}
        <code className="rounded bg-zinc-100 px-1 font-mono text-xs">/assets/cms/…</code>.
      </p>

      <div
        className={
          "rounded-xl border-2 border-dashed p-6 text-center transition " +
          (dragOver ? "border-zinc-900 bg-zinc-50" : "border-zinc-200 bg-zinc-50/50")
        }
        onDragOver={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        role="region"
        aria-label="Zona de soltar ficheiros de imagem"
      >
        <Upload className="mx-auto h-8 w-8 text-zinc-400" aria-hidden />
        <p className="mt-2 text-sm font-medium text-zinc-800">Arraste imagens para aqui</p>
        <p className="text-xs text-zinc-500">ou</p>
        <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800">
          <input
            type="file"
            accept="image/*"
            className="sr-only"
            onChange={(e) => {
              if (e.target.files?.length) void doUploadFiles(e.target.files);
              e.target.value = "";
            }}
            disabled={loading}
          />
          Escolher ficheiro
        </label>
        <p className="mt-2 text-xs text-zinc-500">
          JPG/PNG/GIF são normalmente convertidos para WebP. O ficheiro fica no GitHub do cliente após guardares também
          o restante conteúdo que precises de publicar.
        </p>
      </div>

      {upMsg && <p className="text-sm text-emerald-800">{upMsg}</p>}

      {lastUpload && (
        <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Último envio</h3>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <img
              src={lastUpload.url}
              alt=""
              className="h-32 w-full max-w-xs rounded-md border object-cover sm:h-24 sm:w-40"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor="post-upload-alt" className="text-sm font-medium text-zinc-800">
                Texto alternativo (alt)
              </label>
              <input
                id="post-upload-alt"
                value={postAlt}
                onChange={(e) => setPostAlt(e.target.value)}
                className="mt-1.5 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                placeholder="Obrigatório para boa SEO e acessibilidade"
              />
              <p className="mt-1 break-all font-mono text-xs text-zinc-600">{mdForCopy}</p>
              <button
                type="button"
                onClick={async () => {
                  if (!lastUpload) return;
                  const t = `![${postAlt.trim() || "Imagem"}](${lastUpload.relativeMd})`;
                  await navigator.clipboard.writeText(t);
                }}
                className="mt-2 rounded-md border border-zinc-200 bg-zinc-50 px-2 py-1 text-xs font-medium text-zinc-800"
              >
                Copiar Markdown
              </button>
            </div>
          </div>
        </div>
      )}

      <div>
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-800">
          <ImagePlus className="h-4 w-4" aria-hidden />
          Imagens no repositório
        </h2>
        {loading && <p className="mt-2 text-sm text-zinc-500">Carregando…</p>}
        {!loading && list.length === 0 && !err && (
          <p className="mt-2 text-sm text-zinc-500">
            Ainda não há imagens em <span className="font-mono text-xs">public/assets/cms/</span> ou a pasta ainda não
            existe — envia uma imagem acima.
          </p>
        )}
        <ul className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {pagedMedia.map((it) => (
            <li key={it.path} className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
              <img
                src={it.url}
                alt=""
                className="h-32 w-full object-cover"
                loading="lazy"
                decoding="async"
              />
              <p className="truncate p-1 text-xs text-zinc-500" title={it.name}>
                {it.name}
              </p>
            </li>
          ))}
        </ul>
        {list.length > 0 && (
          <AdminPagination
            page={safeMediaPage}
            pageCount={mediaPageCount}
            total={list.length}
            pageSize={MEDIA_PAGE_SIZE}
            onPageChange={setMediaPage}
            nounSingular="imagem"
            nounPlural="imagens"
          />
        )}
      </div>
    </div>
  );
}
