import { FolderPlus, Pencil, Plus, RefreshCw, Save, Search, Tag as TagIcon, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminPagination } from "./AdminPagination";
import { readCmsGithubContext } from "../../lib/cms-github-context";
import { CMS_PATHS } from "../../lib/cms-paths";
import { slugifyText } from "../../lib/slugify";
import type { TaxonomiesData, TaxonomyItem } from "../../lib/taxonomies";

const PATH = CMS_PATHS.taxonomiesJson;
const TAXONOMY_PAGE_SIZE = 10;

export type TaxonomyField = "categories" | "tags";

type Props = {
  initialData: TaxonomiesData;
  field: TaxonomyField;
};

const COPY: Record<
  TaxonomyField,
  {
    singular: string;
    plural: string;
    pluralCap: string;
    urlCode: string;
    previewPath: string;
    otherPlural: string;
    commitMsg: string;
    slugifyFallback: string;
    removeDetail: string;
    emptyCta: string;
    searchAria: string;
    formIdPrefix: string;
  }
> = {
  categories: {
    singular: "categoria",
    plural: "categorias",
    pluralCap: "Categorias",
    urlCode: "/category/slug",
    previewPath: "/categorias/",
    otherPlural: "etiquetas",
    commitMsg: "chore(taxonomia): categorias (CMS)",
    slugifyFallback: "categoria",
    removeDetail:
      "Os artigos que a usam no front matter (campo categoria) deixam de corresponder a este nome até atualizares cada post.",
    emptyCta: "«Nova categoria»",
    searchAria: "Pesquisar categorias",
    formIdPrefix: "cat",
  },
  tags: {
    singular: "etiqueta",
    plural: "etiquetas",
    pluralCap: "Etiquetas",
    urlCode: "/tag/slug",
    previewPath: "/etiquetas/",
    otherPlural: "categorias",
    commitMsg: "chore(taxonomia): etiquetas (CMS)",
    slugifyFallback: "etiqueta",
    removeDetail:
      "Os artigos que listam esta etiqueta no front matter (tags) deixam de corresponder até atualizares cada post.",
    emptyCta: "«Nova etiqueta»",
    searchAria: "Pesquisar etiquetas",
    formIdPrefix: "tag",
  },
};

function normItem(item: unknown): TaxonomyItem | null {
  if (!item || typeof item !== "object") return null;
  const o = item as { slug?: unknown; name?: unknown; description?: unknown };
  if (typeof o.slug !== "string" || typeof o.name !== "string") return null;
  const d =
    o.description === undefined || o.description === null
      ? ""
      : String(o.description);
  return { slug: o.slug.trim(), name: o.name.trim(), description: d };
}

function parseTaxonomiesText(text: string): { data: TaxonomiesData } | { error: string } {
  try {
    const raw = JSON.parse(text) as { categories?: unknown; tags?: unknown };
    const categories: TaxonomyItem[] = [];
    const tags: TaxonomyItem[] = [];
    if (Array.isArray(raw.categories)) {
      for (const x of raw.categories) {
        const n = normItem(x);
        if (n) categories.push(n);
      }
    }
    if (Array.isArray(raw.tags)) {
      for (const x of raw.tags) {
        const n = normItem(x);
        if (n) tags.push(n);
      }
    }
    return { data: { categories, tags } };
  } catch {
    return { error: "Conteúdo do ficheiro no repositório não é JSON válido." };
  }
}

function isValidSlug(s: string): boolean {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s) && s.length <= 80;
}

function sortByName(a: TaxonomyItem, b: TaxonomyItem): number {
  return a.name.localeCompare(b.name, "pt");
}

/**
 * CRUD para `categories` ou `tags` em `src/data/taxonomies.json`; a outra lista mantém-se ao guardar.
 */
export function TaxonomyItemsManager({ initialData, field }: Props) {
  const t = COPY[field];
  const [tags, setTags] = useState<TaxonomyItem[]>(() => [...initialData.tags]);
  const [categories, setCategories] = useState<TaxonomyItem[]>(() => [...initialData.categories]);
  const [fileSha, setFileSha] = useState("");

  const primaryItems = field === "categories" ? categories : tags;
  const setPrimary = field === "categories" ? setCategories : setTags;

  const [filter, setFilter] = useState("");
  const [listPage, setListPage] = useState(0);
  const [loadStatus, setLoadStatus] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [loadMsg, setLoadMsg] = useState("");

  const [saveStatus, setSaveStatus] = useState<"idle" | "saving">("idle");
  const [saveMsg, setSaveMsg] = useState<{ text: string; err: boolean } | null>(null);

  const [editing, setEditing] = useState<number | "new" | null>(null);
  const [formName, setFormName] = useState("");
  const [formSlug, setFormSlug] = useState("");
  const [formDesc, setFormDesc] = useState("");

  const openNew = useCallback(() => {
    setEditing("new");
    setFormName("");
    setFormSlug("");
    setFormDesc("");
  }, []);

  const openEdit = useCallback(
    (index: number) => {
      const list = field === "categories" ? categories : tags;
      const c = list[index];
      if (!c) return;
      setEditing(index);
      setFormName(c.name);
      setFormSlug(c.slug);
      setFormDesc(c.description || "");
    },
    [field, categories, tags],
  );

  const cancelForm = useCallback(() => {
    setEditing(null);
  }, []);

  const loadFromRepo = useCallback(async () => {
    setLoadMsg("");
    setLoadStatus("loading");
    const ctx = readCmsGithubContext();
    if (!ctx) {
      setLoadStatus("err");
      setLoadMsg("Configura o token GitHub e o repositório alvo em Configurações do CMS.");
      return;
    }
    try {
      const res = await fetch("/api/admin/cms/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get",
          GITHUB_PERSONAL_TOKEN: ctx.token,
          githubRepoFullName: ctx.githubRepoFullName,
          branch: ctx.branch,
          path: PATH,
        }),
      });
      const j = (await res.json()) as { ok: boolean; text?: string; sha?: string; error?: string };
      if (!j.ok) {
        setLoadStatus("err");
        setLoadMsg(j.error || "Não foi possível ler o ficheiro no repositório.");
        return;
      }
      if (!j.text) {
        setLoadStatus("err");
        setLoadMsg("Resposta vazia do repositório.");
        return;
      }
      const parsed = parseTaxonomiesText(j.text);
      if ("error" in parsed) {
        setLoadStatus("err");
        setLoadMsg(parsed.error);
        return;
      }
      setCategories([...parsed.data.categories]);
      setTags([...parsed.data.tags]);
      setFileSha(j.sha || "");
      setLoadStatus("ok");
      setLoadMsg("Dados atuais carregados do repositório.");
    } catch {
      setLoadStatus("err");
      setLoadMsg("Falha de rede ao carregar.");
    }
  }, []);

  useEffect(() => {
    void loadFromRepo();
  }, [loadFromRepo]);

  const visibleRows = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const list = [...primaryItems].map((c, i) => ({ c, i }));
    if (!q) {
      return list.sort((a, b) => sortByName(a.c, b.c));
    }
    return list
      .filter(
        (x) =>
          x.c.name.toLowerCase().includes(q) ||
          x.c.slug.toLowerCase().includes(q) ||
          (x.c.description || "").toLowerCase().includes(q),
      )
      .sort((a, b) => sortByName(a.c, b.c));
  }, [primaryItems, filter]);

  const taxonomyPageCount = Math.max(1, Math.ceil(visibleRows.length / TAXONOMY_PAGE_SIZE) || 1);
  const safeListPage = Math.min(listPage, taxonomyPageCount - 1);

  const pagedRows = useMemo(() => {
    const start = safeListPage * TAXONOMY_PAGE_SIZE;
    return visibleRows.slice(start, start + TAXONOMY_PAGE_SIZE);
  }, [visibleRows, safeListPage]);

  useEffect(() => {
    setListPage(0);
  }, [filter, field]);

  useEffect(() => {
    setListPage((p) => Math.min(p, Math.max(0, taxonomyPageCount - 1)));
  }, [visibleRows.length, taxonomyPageCount]);

  function slugFromName(): void {
    if (!formName.trim()) return;
    setFormSlug(slugifyText(formName, t.slugifyFallback));
  }

  function applyForm(): void {
    const name = formName.trim();
    const slug = formSlug.trim().toLowerCase();
    const description = formDesc.trim();
    const list = field === "categories" ? categories : tags;
    const err = (() => {
      if (!name) return "Indica o nome.";
      if (!slug) return "Indica o slug.";
      if (!isValidSlug(slug)) return "Slug inválido.";
      if (editing === "new") {
        if (list.some((c) => c.slug.toLowerCase() === slug)) return "Slug em uso.";
        return null;
      }
      if (typeof editing === "number") {
        if (list.some((c, i) => i !== editing && c.slug.toLowerCase() === slug)) return "Slug em uso.";
        return null;
      }
      return "Estado de edição inválido.";
    })();
    if (err) {
      setSaveMsg({ text: err, err: true });
      return;
    }
    if (editing === "new") {
      setPrimary((prev) => [...prev, { name, slug, description }].sort(sortByName));
    } else if (typeof editing === "number") {
      setPrimary((prev) => {
        const next = [...prev];
        next[editing] = { name, slug, description };
        return next;
      });
    }
    setSaveMsg(null);
    setEditing(null);
  }

  function removeAt(originalIndex: number) {
    const list = field === "categories" ? categories : tags;
    const c = list[originalIndex];
    if (!c) return;
    const ok = window.confirm(
      `Remover a ${t.singular} «${c.name}»? ${t.removeDetail}`,
    );
    if (!ok) return;
    setPrimary((prev) => prev.filter((_, i) => i !== originalIndex));
    if (editing === originalIndex) {
      setEditing(null);
    } else if (typeof editing === "number" && editing > originalIndex) {
      setEditing(editing - 1);
    }
    setSaveMsg({
      text: "Removido da lista local. Guarda no repositório para aplicar.",
      err: false,
    });
  }

  const saveToRepo = useCallback(async () => {
    const copy = COPY[field];
    setSaveMsg(null);
    const ctx = readCmsGithubContext();
    if (!ctx) {
      setSaveMsg({ text: "Configura o token e o repositório em Configurações.", err: true });
      return;
    }
    const primary = field === "categories" ? categories : tags;
    for (const c of primary) {
      if (!isValidSlug(c.slug) || !c.name.trim()) {
        setSaveMsg({ text: `Cada ${copy.singular} precisa de nome e slug válidos.`, err: true });
        return;
      }
    }
    const slugs = new Set<string>();
    for (const c of primary) {
      const s = c.slug.toLowerCase();
      if (slugs.has(s)) {
        setSaveMsg({ text: `Há slugs em duplicado na lista de ${copy.plural}.`, err: true });
        return;
      }
      slugs.add(s);
    }
    setSaveStatus("saving");
    const pretty = `${JSON.stringify({ categories, tags }, null, 2)}\n`;
    try {
      const res = await fetch("/api/admin/cms/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "put",
          GITHUB_PERSONAL_TOKEN: ctx.token,
          githubRepoFullName: ctx.githubRepoFullName,
          branch: ctx.branch,
          path: PATH,
          sha: fileSha || undefined,
          message: copy.commitMsg,
          content: pretty,
        }),
      });
      const j = (await res.json()) as { ok: boolean; sha?: string; error?: string };
      if (!j.ok) {
        setSaveMsg({ text: j.error || "Falha ao guardar.", err: true });
        return;
      }
      if (j.sha) setFileSha(j.sha);
      setSaveMsg({
        text: "Guardado no repositório. Faz deploy ou deixa a build atualizar o site se aplicável.",
        err: false,
      });
    } catch {
      setSaveMsg({ text: "Falha de rede.", err: true });
    } finally {
      setSaveStatus("idle");
    }
  }, [categories, tags, fileSha, field]);

  const fp = t.formIdPrefix;

  return (
    <div className="space-y-6">
      <p className="max-w-2xl text-sm text-slate-600">
        Cada {t.singular} tem um <span className="font-medium">nome</span> (visível) e um{" "}
        <span className="font-medium">identificador (slug)</span> usado na URL
        <code className="mx-1 rounded bg-slate-100 px-1 text-xs">{t.urlCode}</code> e nos artigos. As{" "}
        <span className="font-medium">{t.otherPlural}</span> no ficheiro{" "}
        <span className="font-medium">não são alteradas</span> neste ecrã.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <a
          href={t.previewPath}
          className="text-sm font-medium text-[var(--client-color-primary)] hover:underline"
          target="_blank"
          rel="noreferrer"
        >
          Pré-visualizar no site
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void loadFromRepo()}
          disabled={loadStatus === "loading"}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-800 disabled:opacity-50"
        >
          <RefreshCw className={`h-4 w-4 ${loadStatus === "loading" ? "animate-spin" : ""}`} aria-hidden />
          Recarregar do repositório
        </button>
        {loadMsg && (
          <p
            className={
              loadStatus === "err" ? "text-sm text-red-800" : "text-sm text-slate-600"
            }
            role="status"
            aria-live="polite"
          >
            {loadMsg}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden
          />
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Pesquisar por nome, slug…"
            className="w-full rounded-lg border border-slate-200 py-1.5 pl-9 pr-3 text-sm"
            aria-label={t.searchAria}
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={openNew}
            className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800"
          >
            {field === "tags" ? (
              <TagIcon className="h-4 w-4" aria-hidden />
            ) : (
              <Plus className="h-4 w-4" aria-hidden />
            )}
            Nova {t.singular}
          </button>
          <button
            type="button"
            onClick={() => void saveToRepo()}
            disabled={saveStatus === "saving" || loadStatus === "loading"}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            <Save className="h-4 w-4" aria-hidden />
            {saveStatus === "saving" ? "A guardar…" : "Guardar no repositório"}
          </button>
        </div>
      </div>

      {saveMsg && (
        <p
          className={saveMsg.err ? "text-sm text-red-800" : "text-sm text-emerald-800"}
          role="alert"
        >
          {saveMsg.text}
        </p>
      )}

      {(editing === "new" || typeof editing === "number") && (
        <div
          className="rounded-xl border border-slate-200 bg-slate-50/80 p-4"
          role="region"
          aria-label={editing === "new" ? `Nova ${t.singular}` : `Editar ${t.singular}`}
        >
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-900">
            {editing === "new" ? (
              <>
                {field === "tags" ? (
                  <TagIcon className="h-4 w-4" aria-hidden />
                ) : (
                  <FolderPlus className="h-4 w-4" aria-hidden />
                )}
                Nova {t.singular}
              </>
            ) : (
              <>
                <Pencil className="h-4 w-4" aria-hidden />
                Editar {t.singular}
              </>
            )}
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label htmlFor={`${fp}-name`} className="text-xs font-medium text-slate-700">
                Nome
              </label>
              <input
                id={`${fp}-name`}
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                onBlur={() => {
                  if (editing === "new" && !formSlug.trim() && formName.trim()) slugFromName();
                }}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                autoComplete="off"
              />
            </div>
            <div>
              <label htmlFor={`${fp}-slug`} className="text-xs font-medium text-slate-700">
                Slug (URL)
              </label>
              <div className="mt-1 flex gap-1">
                <input
                  id={`${fp}-slug`}
                  value={formSlug}
                  onChange={(e) => setFormSlug(e.target.value.toLowerCase())}
                  className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-sm"
                  autoComplete="off"
                />
                {editing === "new" && (
                  <button
                    type="button"
                    onClick={slugFromName}
                    className="shrink-0 rounded border border-slate-200 bg-white px-2 text-xs text-slate-700"
                  >
                    Gerar a partir do nome
                  </button>
                )}
              </div>
            </div>
            <div className="sm:col-span-2">
              <label htmlFor={`${fp}-desc`} className="text-xs font-medium text-slate-700">
                Descrição (SEO) — opcional
              </label>
              <textarea
                id={`${fp}-desc`}
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                placeholder="Texto curto para listagens e resultados de pesquisa"
              />
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={applyForm}
              className="rounded-lg bg-slate-900 px-3 py-1.5 text-sm font-medium text-white"
            >
              {editing === "new" ? "Adicionar à lista" : "Aplicar alterações"}
            </button>
            <button
              type="button"
              onClick={cancelForm}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-800"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200">
        <div className="overflow-x-auto">
        <table className="w-full min-w-[20rem] text-left text-sm">
          <caption className="border-b border-slate-200 bg-slate-50/90 px-3 py-2 text-left text-xs font-medium text-slate-600">
            {t.pluralCap} — {primaryItems.length} no total
          </caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/50 text-xs text-slate-500">
              <th scope="col" className="px-3 py-2 font-medium">
                Nome
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Slug
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                Descrição
              </th>
              <th scope="col" className="w-28 px-2 py-2 text-right font-medium">
                Ações
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-slate-500">
                  {primaryItems.length === 0
                    ? `Ainda não há ${t.plural}. Cria a primeira com ${t.emptyCta}.`
                    : "Nenhum resultado com este filtro."}
                </td>
              </tr>
            ) : (
              pagedRows.map(({ c, i: originalIndex }) => (
                <tr key={`${c.slug}-${originalIndex}`} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-900">{c.name}</td>
                  <td className="px-3 py-2 font-mono text-xs text-slate-600">{c.slug}</td>
                  <td className="max-w-md px-3 py-2 text-slate-600 line-clamp-2">{c.description || "—"}</td>
                  <td className="px-2 py-2 text-right">
                    <div className="inline-flex flex-wrap justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => openEdit(originalIndex)}
                        className="rounded p-1.5 text-slate-600 hover:bg-slate-100"
                        title="Editar"
                        aria-label={`Editar ${c.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => removeAt(originalIndex)}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50"
                        title="Excluir"
                        aria-label={`Excluir ${c.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
        {visibleRows.length > 0 && (
          <AdminPagination
            page={safeListPage}
            pageCount={taxonomyPageCount}
            total={visibleRows.length}
            pageSize={TAXONOMY_PAGE_SIZE}
            onPageChange={setListPage}
            nounSingular={t.singular}
            nounPlural={t.plural}
          />
        )}
      </div>
    </div>
  );
}

/** @deprecated use TaxonomyItemsManager com field="categories" */
export function CategoriesManager({ initialData }: { initialData: TaxonomiesData }) {
  return <TaxonomyItemsManager initialData={initialData} field="categories" />;
}

export function TagsManager({ initialData }: { initialData: TaxonomiesData }) {
  return <TaxonomyItemsManager initialData={initialData} field="tags" />;
}
