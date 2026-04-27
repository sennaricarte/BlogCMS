import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { htmlToMarkdown } from "../../lib/html-to-markdown";
import { slugifyTitle } from "../../lib/slugify";
import { Editor } from "./Editor";

const K_INTEGR = "blogcms-admin-integration";
const K_CMS = "blogcms-cms-target";
const DRAFT_KEY = "blogcms-draft-novo-post";

type TaxItem = { slug: string; name: string };
type Taxonomies = { categories: TaxItem[]; tags: TaxItem[] };

function readLs<T>(key: string): T | null {
  try {
    const r = localStorage.getItem(key);
    if (!r) return null;
    return JSON.parse(r) as T;
  } catch {
    return null;
  }
}

function fileToBase64Payload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("leitura"));
    r.readAsDataURL(file);
  });
}

export function NewPostForm({ taxonomies }: { taxonomies: Taxonomies }) {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [description, setDescription] = useState("");
  const [author, setAuthor] = useState("Equipa BlogCMS");
  const [heroImage, setHeroImage] = useState("../../assets/blog/hero-primeiro.svg");
  const [category, setCategory] = useState("");
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagsExtra, setTagsExtra] = useState("");
  const [draft, setDraft] = useState(true);
  const [pubDate, setPubDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [contentMd, setContentMd] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  const [message, setMessage] = useState<{ text: string; err: boolean } | null>(null);
  const [saving, setSaving] = useState(false);
  const [heroUploading, setHeroUploading] = useState(false);
  const [heroPickedName, setHeroPickedName] = useState<string | null>(null);
  const saveDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const catList = useMemo(
    () => (Array.isArray(taxonomies.categories) ? taxonomies.categories : []),
    [taxonomies],
  );
  const tagList = useMemo(
    () => (Array.isArray(taxonomies.tags) ? taxonomies.tags : []),
    [taxonomies],
  );

  const todayIso = new Date().toISOString().slice(0, 10);
  const scheduleFuture = pubDate > todayIso;

  useEffect(() => {
    if (!slugTouched) {
      setSlug(slugifyTitle(title, "artigo"));
    }
  }, [title, slugTouched]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      const d = JSON.parse(raw) as {
        title?: string;
        slug?: string;
        description?: string;
        contentMd?: string;
        /** @deprecated Legado: HTML do editor — convertido para Markdown ao reabrir. */
        html?: string;
        category?: string;
        tags?: string[];
        author?: string;
        heroImage?: string;
        draft?: boolean;
        pubDate?: string;
      };
      if (d.title) setTitle(d.title);
      if (d.slug) {
        setSlug(d.slug);
        setSlugTouched(true);
      }
      if (d.description != null) setDescription(d.description);
      if (d.contentMd !== undefined) {
        setContentMd(d.contentMd);
      } else if (d.html) {
        setContentMd(htmlToMarkdown(d.html));
      }
      if (d.category) setCategory(d.category);
      if (d.tags) setSelectedTags(d.tags);
      if (d.author) setAuthor(d.author);
      if (d.heroImage) setHeroImage(d.heroImage);
      if (typeof d.draft === "boolean") setDraft(d.draft);
      if (d.pubDate && /^\d{4}-\d{2}-\d{2}/.test(d.pubDate)) setPubDate(d.pubDate.slice(0, 10));
      setEditorKey((k) => k + 1);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (saveDebounce.current) clearTimeout(saveDebounce.current);
    saveDebounce.current = setTimeout(() => {
      try {
        const payload = {
          title,
          slug,
          description,
          contentMd,
          category,
          tags: selectedTags,
          author,
          heroImage,
          draft,
          pubDate,
        };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(payload));
      } catch {
        /* ignore */
      }
    }, 1500);
    return () => {
      if (saveDebounce.current) clearTimeout(saveDebounce.current);
    };
  }, [title, slug, description, contentMd, category, selectedTags, author, heroImage, draft, pubDate]);

  const onContentChange = useCallback((next: string) => {
    setContentMd(next);
  }, []);

  async function onHeroFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setHeroPickedName(file.name);
    setMessage(null);
    const integ = readLs<Record<string, string>>(K_INTEGR);
    const target = readLs<Record<string, string>>(K_CMS);
    if (!integ?.GITHUB_PERSONAL_TOKEN) {
      setHeroPickedName(null);
      setMessage({ text: "Configure o token do GitHub em /admin/settings/.", err: true });
      return;
    }
    if (!target?.githubRepoFullName) {
      setHeroPickedName(null);
      setMessage({ text: "Informe o repositório alvo (githubRepoFullName) em Configurações.", err: true });
      return;
    }
    let contentBase64: string;
    try {
      contentBase64 = await fileToBase64Payload(file);
    } catch {
      setHeroPickedName(null);
      setMessage({ text: "Não foi possível ler o arquivo de imagem.", err: true });
      return;
    }
    setHeroUploading(true);
    try {
      const res = await fetch("/api/admin/cms/upload-blog-hero", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
          githubRepoFullName: target.githubRepoFullName,
          branch: target.branch || "main",
          contentBase64,
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; heroImage?: string };
      if (!res.ok || !j.ok || !j.heroImage) {
        setMessage({ text: j.error || "Falha no envio da imagem para o GitHub.", err: true });
        return;
      }
      setHeroImage(j.heroImage);
      setMessage({
        text: "Imagem enviada. O caminho no front matter foi atualizado; salve o artigo para registrar o commit, se ainda não salvou.",
        err: false,
      });
    } catch {
      setMessage({ text: "Falha de rede ao enviar a imagem.", err: true });
    } finally {
      setHeroUploading(false);
      setHeroPickedName(null);
    }
  }

  const descLen = description.length;
  const descOver = descLen > 160;
  const allTagSlugs = useMemo(() => {
    const extra = tagsExtra
      .split(",")
      .map((s) => s.trim().toLowerCase().replace(/[^a-z0-9-]+/g, ""))
      .filter(Boolean);
    const seen: Record<string, true> = Object.create(null);
    const o: string[] = [];
    for (const t of selectedTags) {
      if (t && !seen[t]) {
        seen[t] = true;
        o.push(t);
      }
    }
    for (const t of extra) {
      if (t && !seen[t]) {
        seen[t] = true;
        o.push(t);
      }
    }
    return o;
  }, [selectedTags, tagsExtra]);

  async function onSave() {
    setMessage(null);
    const integ = readLs<Record<string, string>>(K_INTEGR);
    const target = readLs<Record<string, string>>(K_CMS);
    if (!integ?.GITHUB_PERSONAL_TOKEN) {
      setMessage({ text: "Configure o token do GitHub em /admin/settings/.", err: true });
      return;
    }
    if (!target?.githubRepoFullName) {
      setMessage({ text: "Informe o repositório alvo (githubRepoFullName) em Configurações.", err: true });
      return;
    }
    const t = title.trim();
    if (!t) {
      setMessage({ text: "O título é obrigatório.", err: true });
      return;
    }
    const finalSlug = slugifyTitle(slug.trim() || title, "artigo");
    const path = `src/content/blog/${finalSlug}.md`;
    const bodyMd = contentMd.trim();
    if (!bodyMd) {
      setMessage({ text: "Escreva o corpo do artigo no editor visual; o arquivo é salvo em Markdown.", err: true });
      return;
    }
    const desc = description.slice(0, 160);
    const todayIso = new Date().toISOString().slice(0, 10);
    const futurePub = pubDate > todayIso;
    const finalDraft = futurePub ? true : draft;
    const blogData: Record<string, unknown> = {
      title: t,
      description: desc,
      pubDate,
      author: author.trim() || "Equipa BlogCMS",
      heroImage: heroImage.trim() || "../../assets/blog/hero-primeiro.svg",
      tags: allTagSlugs,
      draft: finalDraft,
      category: category.trim() || undefined,
    };
    if (futurePub) {
      blogData.scheduled = true;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/posts/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
          githubRepoFullName: target.githubRepoFullName,
          branch: target.branch || "main",
          path,
          message: `content(blog): ${t}`,
          blog: {
            data: blogData,
            body: bodyMd,
          },
        }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !j.ok) {
        setMessage({ text: j.error || "Erro ao salvar.", err: true });
        return;
      }
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      window.location.href = `/admin/posts/edit/${finalSlug}/`;
    } catch {
      setMessage({ text: "Falha de rede ao enviar o pedido.", err: true });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {message && (
        <p
          className={
            "rounded-lg border px-3 py-2 text-sm " +
            (message.err
              ? "border-red-200 bg-red-50 text-red-900"
              : "border-emerald-200 bg-emerald-50 text-emerald-900")
          }
          role="status"
        >
          {message.text}
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-10">
        <div className="space-y-4 lg:col-span-7">
          <div>
            <label className="block text-sm font-medium text-zinc-800" htmlFor="np-title">
              Título
            </label>
            <input
              id="np-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none focus:ring-2 focus:ring-zinc-900/10"
              placeholder="Título do artigo"
            />
          </div>
          <div>
            <p className="text-sm font-medium text-zinc-800">Conteúdo</p>
            <p className="text-xs text-zinc-500">
              Editor rico (TipTap / ProseMirror): cola a partir do Google Docs ou Word; a formatação é limpa (HTML
              semântico) e o conteúdo exporta em Markdown (Turndown) para o .md. Licença MIT — adequado a produto
              comercial.
            </p>
            <div className="mt-2 w-full">
              <Editor key={editorKey} initialMarkdown={contentMd} onChange={onContentChange} />
            </div>
          </div>
        </div>

        <aside className="space-y-5 lg:col-span-3">
          <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Publicação</h2>
            <div className="mt-3 space-y-3">
              <div>
                <label className="text-sm font-medium text-zinc-800" htmlFor="np-pub">
                  Data de publicação
                </label>
                <input
                  id="np-pub"
                  type="date"
                  value={pubDate}
                  onChange={(e) => setPubDate(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                  aria-describedby="np-pub-hint"
                />
                <p id="np-pub-hint" className="mt-1 text-xs text-zinc-500">
                  Se escolheres uma <strong>data futura</strong>, o artigo fica agendado (rascunho até essa data).
                </p>
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-800" htmlFor="np-cat">
                  Categoria
                </label>
                <select
                  id="np-cat"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">— nenhuma —</option>
                  {catList.map((c) => (
                    <option key={c.slug} value={c.slug}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <span className="text-sm font-medium text-zinc-800">Etiquetas</span>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tagList.map((t) => {
                    const on = selectedTags.includes(t.slug);
                    return (
                      <button
                        key={t.slug}
                        type="button"
                        onClick={() => {
                          setSelectedTags((prev) =>
                            prev.includes(t.slug) ? prev.filter((x) => x !== t.slug) : [...prev, t.slug],
                          );
                        }}
                        className={
                          "rounded-md border px-2 py-0.5 text-xs font-medium " +
                          (on
                            ? "border-zinc-900 bg-zinc-900 text-white"
                            : "border-zinc-200 bg-zinc-50 text-zinc-800 hover:border-zinc-300")
                        }
                      >
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                <label className="mt-2 block text-xs text-zinc-500" htmlFor="np-tags-extra">
                  Outras (vírgula)
                </label>
                <input
                  id="np-tags-extra"
                  value={tagsExtra}
                  onChange={(e) => setTagsExtra(e.target.value)}
                  className="mt-1 w-full rounded-md border border-zinc-200 px-2 py-1 text-sm"
                />
              </div>
              <div>
                <span className="text-sm font-medium text-zinc-800">Estado</span>
                {scheduleFuture && (
                  <p className="mt-1 text-xs text-amber-800" role="status">
                    Data futura: o artigo será guardado como rascunho agendado.
                  </p>
                )}
                <div className="mt-1.5 flex flex-col gap-2">
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="status"
                      checked={scheduleFuture || draft}
                      disabled={scheduleFuture}
                      onChange={() => setDraft(true)}
                    />
                    Rascunho
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="status"
                      checked={!scheduleFuture && !draft}
                      disabled={scheduleFuture}
                      onChange={() => setDraft(false)}
                    />
                    Publicado
                  </label>
                </div>
              </div>
              <div>
                <span className="text-sm font-medium text-zinc-800">Imagem de destaque</span>
                <p className="mt-0.5 text-xs text-zinc-500">
                  O arquivo vai para{" "}
                  <code className="rounded bg-zinc-100 px-0.5 font-mono text-[0.7rem]">src/assets/blog/</code> no GitHub;
                  o caminho no front matter é definido automaticamente ao enviar (relativo ao artigo em{" "}
                  <code className="font-mono text-[0.7rem]">src/content/blog/</code>).
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-2">
                  <input
                    id="np-hero-file"
                    type="file"
                    accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
                    onChange={(e) => void onHeroFileChange(e)}
                    disabled={heroUploading}
                    className="sr-only"
                    aria-describedby="np-hero-file-hint"
                  />
                  <label
                    htmlFor="np-hero-file"
                    className={
                      "inline-flex cursor-pointer items-center rounded-md border border-zinc-200 bg-zinc-100 px-2.5 py-1.5 text-sm font-medium text-zinc-800 shadow-sm transition hover:bg-zinc-200 " +
                      (heroUploading ? "pointer-events-none opacity-50" : "")
                    }
                  >
                    Escolher arquivo
                  </label>
                  <span
                    id="np-hero-file-hint"
                    className="min-w-0 max-w-[14rem] truncate text-xs text-zinc-500"
                    title={heroPickedName || undefined}
                    aria-live="polite"
                  >
                    {heroPickedName || "Nenhum arquivo selecionado"}
                  </span>
                  {heroUploading && (
                    <span className="text-xs text-zinc-500" role="status" aria-live="polite">
                      Enviando…
                    </span>
                  )}
                </div>
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-800" htmlFor="np-author">
                  Autor
                </label>
                <input
                  id="np-author"
                  value={author}
                  onChange={(e) => setAuthor(e.target.value)}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 px-3 py-2 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200/90 bg-white p-4 shadow-sm">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-zinc-500">SEO</h2>
            <div className="mt-3 space-y-3">
              <div>
                <div className="flex items-end justify-between gap-2">
                  <label className="text-sm font-medium text-zinc-800" htmlFor="np-desc">
                    Meta description
                  </label>
                  <span
                    className={"text-xs tabular-nums " + (descOver ? "font-semibold text-red-600" : "text-zinc-500")}
                    aria-live="polite"
                  >
                    {descLen}/160
                  </span>
                </div>
                <textarea
                  id="np-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className={
                    "mt-1.5 w-full rounded-lg border bg-white px-3 py-2 text-sm " +
                    (descOver ? "border-red-300 focus:border-red-400 focus:ring-red-200" : "border-zinc-200")
                  }
                  placeholder="Resumo para resultados de pesquisa e partilha social"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-zinc-800" htmlFor="np-slug">
                  Slug
                </label>
                <input
                  id="np-slug"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(
                      e.target.value
                        .toLowerCase()
                        .replace(/[^a-z0-9-]+/g, "-")
                        .replace(/^-+|-+$/g, ""),
                    );
                  }}
                  className="mt-1.5 w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 font-mono text-sm"
                  pattern="[a-z0-9][a-z0-9-]*"
                />
                <p className="mt-1 text-xs text-zinc-500">Preenche automaticamente a partir do título; podes ajustar.</p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void onSave()}
              disabled={saving}
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-900/10 bg-zinc-900 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "Salvando…" : "Salvar"}
            </button>
            <a
              href="/admin/posts/"
              className="inline-flex min-h-10 items-center justify-center rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
            >
              Cancelar
            </a>
          </div>
        </aside>
      </div>
    </div>
  );
}
