import { useCallback, useMemo, useState } from "react";

const K_INTEGR = "blogcms-admin-integration";
const K_CMS = "blogcms-cms-target";

type IntegrationLs = { GITHUB_PERSONAL_TOKEN?: string };
type CmsTargetLs = { githubRepoFullName?: string; branch?: string };

function readLs<T>(key: string): T | null {
  try {
    const r = localStorage.getItem(key);
    if (!r) return null;
    return JSON.parse(r) as T;
  } catch {
    return null;
  }
}

type WpApiPost = {
  sourceId: number;
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  markdown: string;
  featuredImageUrl?: string;
};

export type PreviewRow = {
  id: string;
  selected: boolean;
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  markdown: string;
  featuredImageUrl?: string;
  sourceLabel: "WordPress" | "URL";
};

type TabId = "wordpress" | "url";

export function ContentImportPanel() {
  const URL_BATCH_SIZE = 20;
  const [tab, setTab] = useState<TabId>("wordpress");
  const [wpSiteUrl, setWpSiteUrl] = useState("");
  const [articleUrl, setArticleUrl] = useState("");
  const [urlOnlyArticles, setUrlOnlyArticles] = useState(true);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [urlBatchOffset, setUrlBatchOffset] = useState(0);
  const [urlTotalDiscovered, setUrlTotalDiscovered] = useState(0);
  const [urlHasMore, setUrlHasMore] = useState(false);
  const [discoveredLinks, setDiscoveredLinks] = useState<string[]>([]);
  const [loadingAllBatches, setLoadingAllBatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; err: boolean } | null>(null);

  const [credsTick, setCredsTick] = useState(0);
  const credsOk = useMemo(() => {
    void credsTick;
    const integ = readLs<IntegrationLs>(K_INTEGR);
    const target = readLs<CmsTargetLs>(K_CMS);
    return Boolean(integ?.GITHUB_PERSONAL_TOKEN?.trim() && target?.githubRepoFullName?.trim());
  }, [credsTick]);

  const setRowSelected = useCallback((id: string, selected: boolean) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, selected } : r)));
  }, []);

  const selectAll = useCallback((selected: boolean) => {
    setRows((prev) => prev.map((r) => ({ ...r, selected })));
  }, []);

  const clearRows = useCallback(() => {
    setRows([]);
    setDiscoveredLinks([]);
    setUrlBatchOffset(0);
    setUrlTotalDiscovered(0);
    setUrlHasMore(false);
    setMessage(null);
  }, []);

  const fetchWordPress = async () => {
    setMessage(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/import/wordpress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ wpSiteUrl: wpSiteUrl.trim() }),
      });
      const j = (await res.json()) as { ok?: boolean; error?: string; posts?: WpApiPost[] };
      if (!res.ok || !j.ok || !Array.isArray(j.posts)) {
        setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
        return;
      }
      const next: PreviewRow[] = j.posts.map((p) => ({
        id: `wp-${p.sourceId}`,
        selected: false,
        slug: p.slug,
        title: p.title,
        description: p.description,
        pubDate: p.pubDate,
        markdown: p.markdown,
        featuredImageUrl: p.featuredImageUrl,
        sourceLabel: "WordPress" as const,
      }));
      setRows(next);
      setMessage({ text: `${next.length} artigo(s) carregado(s). Marca os que queres gravar no repositório.`, err: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const scrapeUrl = async (resetBatch = true, overrideUrl?: string) => {
    setMessage(null);
    setBusy(true);
    try {
      const targetUrl = (overrideUrl ?? articleUrl).trim();
      const offset = resetBatch ? 0 : urlBatchOffset;
      const res = await fetch("/api/admin/import/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          articleUrl: targetUrl,
          onlyArticles: urlOnlyArticles,
          offset,
          limit: URL_BATCH_SIZE,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        totalDiscovered?: number;
        hasMore?: boolean;
        nextOffset?: number;
        discoveredLinks?: string[];
        post?: {
          slug: string;
          title: string;
          description: string;
          pubDate: string;
          markdown: string;
          featuredImageUrl?: string;
        };
        posts?: Array<{
          slug: string;
          title: string;
          description: string;
          pubDate: string;
          markdown: string;
          featuredImageUrl?: string;
        }>;
      };
      if (!res.ok || !j.ok) {
        setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
        return;
      }
      if (Array.isArray(j.discoveredLinks)) {
        setDiscoveredLinks((prev) => {
          if (resetBatch) return j.discoveredLinks ?? [];
          const s = new Set([...prev, ...j.discoveredLinks!]);
          return Array.from(s);
        });
        setUrlTotalDiscovered(typeof j.totalDiscovered === "number" ? j.totalDiscovered : j.discoveredLinks.length);
        setUrlHasMore(Boolean(j.hasMore));
        setUrlBatchOffset(typeof j.nextOffset === "number" ? j.nextOffset : offset + j.discoveredLinks.length);
        setMessage({
          text:
            j.message ||
            `${j.discoveredLinks.length} link(s) encontrado(s). Clique em «Importar» para extrair cada artigo.`,
          err: false,
        });
        return;
      }
      if (Array.isArray(j.posts)) {
        setDiscoveredLinks([]);
        const next: PreviewRow[] = j.posts.map((p) => ({
          id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          selected: true,
          slug: p.slug,
          title: p.title,
          description: p.description,
          pubDate: p.pubDate,
          markdown: p.markdown,
          featuredImageUrl: p.featuredImageUrl,
          sourceLabel: "URL",
        }));
        setRows((prev) => {
          const existing = new Set(prev.map((r) => r.slug));
          const deduped = next.filter((r) => !existing.has(r.slug));
          return resetBatch ? deduped : [...prev, ...deduped];
        });
        setUrlTotalDiscovered(typeof j.totalDiscovered === "number" ? j.totalDiscovered : 0);
        setUrlHasMore(Boolean(j.hasMore));
        setUrlBatchOffset(typeof j.nextOffset === "number" ? j.nextOffset : offset + j.posts.length);
        setMessage({
          text:
            j.message ||
            `${j.posts.length} artigo(s) carregado(s) neste lote. ${Boolean(j.hasMore) ? "Pode carregar o próximo lote." : "Todos os lotes disponíveis foram carregados."}`,
          err: false,
        });
        return;
      }

      if (!j.post) {
        setMessage({ text: "Resposta inesperada: nenhum artigo foi extraído.", err: true });
        return;
      }

      const p = j.post;
      const id = `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      setDiscoveredLinks([]);
      setRows((prev) => {
        const row: PreviewRow = {
          id,
          selected: true,
          slug: p.slug,
          title: p.title,
          description: p.description,
          pubDate: p.pubDate,
          markdown: p.markdown,
          featuredImageUrl: p.featuredImageUrl,
          sourceLabel: "URL",
        };
        if (resetBatch) return [row];
        if (prev.some((r) => r.slug === p.slug)) return prev;
        return [...prev, row];
      });
      setUrlTotalDiscovered(1);
      setUrlHasMore(false);
      setUrlBatchOffset(1);
      setMessage({ text: j.message || "Página analisada e adicionada à lista em baixo.", err: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const scrapeAllUrlBatches = async () => {
    setMessage(null);
    setBusy(true);
    setLoadingAllBatches(true);
    try {
      let offset = 0;
      let hasMore = true;
      let safety = 0;
      const allRows: PreviewRow[] = [];
      const slugs = new Set<string>();
      let totalDiscovered = 0;

      while (hasMore && safety < 80) {
        safety += 1;
        const res = await fetch("/api/admin/import/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            articleUrl: articleUrl.trim(),
            onlyArticles: urlOnlyArticles,
            offset,
            limit: URL_BATCH_SIZE,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          error?: string;
          message?: string;
          totalDiscovered?: number;
          hasMore?: boolean;
          nextOffset?: number;
          discoveredLinks?: string[];
          post?: {
            slug: string;
            title: string;
            description: string;
            pubDate: string;
            markdown: string;
            featuredImageUrl?: string;
          };
          posts?: Array<{
            slug: string;
            title: string;
            description: string;
            pubDate: string;
            markdown: string;
            featuredImageUrl?: string;
          }>;
        };
        if (!res.ok || !j.ok) {
          setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
          return;
        }

        if (typeof j.totalDiscovered === "number") {
          totalDiscovered = j.totalDiscovered;
        }
        if (Array.isArray(j.discoveredLinks)) {
          setDiscoveredLinks((prev) => {
            const s = new Set([...prev, ...j.discoveredLinks!]);
            return Array.from(s);
          });
          const nextOffset = typeof j.nextOffset === "number" ? j.nextOffset : offset + j.discoveredLinks.length;
          hasMore = Boolean(j.hasMore) && nextOffset > offset;
          offset = nextOffset;
          continue;
        }

        if (Array.isArray(j.posts)) {
          for (const p of j.posts) {
            if (slugs.has(p.slug)) continue;
            slugs.add(p.slug);
            allRows.push({
              id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              selected: true,
              slug: p.slug,
              title: p.title,
              description: p.description,
              pubDate: p.pubDate,
              markdown: p.markdown,
              featuredImageUrl: p.featuredImageUrl,
              sourceLabel: "URL",
            });
          }
          const nextOffset = typeof j.nextOffset === "number" ? j.nextOffset : offset + j.posts.length;
          hasMore = Boolean(j.hasMore) && nextOffset > offset;
          offset = nextOffset;
          continue;
        }

        if (j.post) {
          if (!slugs.has(j.post.slug)) {
            slugs.add(j.post.slug);
            allRows.push({
              id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
              selected: true,
              slug: j.post.slug,
              title: j.post.title,
              description: j.post.description,
              pubDate: j.post.pubDate,
              markdown: j.post.markdown,
              featuredImageUrl: j.post.featuredImageUrl,
              sourceLabel: "URL",
            });
          }
          hasMore = false;
          offset = 1;
          continue;
        }

        hasMore = false;
      }

      setRows(allRows);
      setUrlTotalDiscovered(totalDiscovered || allRows.length);
      setUrlHasMore(false);
      setUrlBatchOffset(offset);
      setMessage({
        text: `${allRows.length} artigo(s) carregado(s) no total.${totalDiscovered > allRows.length ? ` Descobertos ${totalDiscovered} URLs válidos.` : ""}`,
        err: false,
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede.", err: true });
    } finally {
      setBusy(false);
      setLoadingAllBatches(false);
    }
  };

  const commitSelected = async () => {
    setMessage(null);
    const integ = readLs<IntegrationLs>(K_INTEGR);
    const target = readLs<CmsTargetLs>(K_CMS);
    const token = integ?.GITHUB_PERSONAL_TOKEN?.trim();
    const githubRepoFullName = target?.githubRepoFullName?.trim();
    if (!token || !githubRepoFullName) {
      setMessage({
        text: "Configura o token GitHub e o repositório em /admin/settings/ (integração e alvo do CMS).",
        err: true,
      });
      return;
    }
    const picked = rows.filter((r) => r.selected);
    if (picked.length === 0) {
      setMessage({ text: "Seleciona pelo menos um artigo.", err: true });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/admin/import/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          GITHUB_PERSONAL_TOKEN: token,
          githubRepoFullName,
          branch: (target.branch || "main").trim() || "main",
          allowDuplicates: false,
          posts: picked.map((r) => ({
            slug: r.slug,
            title: r.title,
            description: r.description,
            pubDate: r.pubDate,
            markdownBody: r.markdown,
            featuredImageUrl: r.featuredImageUrl,
            draft: true,
          })),
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        created?: string[];
        skipped?: Array<{ slug: string; reason: string }>;
        errors?: Array<{ slug: string; error: string }>;
        message?: string;
      };
      const parts: string[] = [];
      if (j.message) parts.push(j.message);
      if (Array.isArray(j.created) && j.created.length) parts.push(`Slugs: ${j.created.join(", ")}.`);
      if (Array.isArray(j.errors) && j.errors.length) {
        parts.push(
          j.errors.map((e) => `${e.slug}: ${e.error}`).join(" | "),
        );
      }
      if (Array.isArray(j.skipped) && j.skipped.length) {
        parts.push(`Ignorados: ${j.skipped.map((s) => `${s.slug} (${s.reason})`).join(", ")}.`);
      }
      setMessage({
        text: parts.join(" ") || j.error || "Resposta inesperada.",
        err: !j.ok && (!j.created || j.created.length === 0),
      });
      if ((Array.isArray(j.created) && j.created.length > 0) || (Array.isArray(j.skipped) && j.skipped.length > 0)) {
        const createdSet = new Set(j.created);
        const skippedSet = new Set((j.skipped || []).map((s) => s.slug));
        setRows((prev) => prev.filter((r) => !r.selected || (!createdSet.has(r.slug) && !skippedSet.has(r.slug))));
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div className="space-y-8">
      {!credsOk && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          Para gravar no GitHub, define o token e o repositório em{" "}
          <a className="font-medium underline underline-offset-2" href="/admin/settings/">
            Configurações
          </a>{" "}
          (integração e alvo do CMS neste dispositivo).{" "}
          <button
            type="button"
            className="font-medium text-amber-950 underline underline-offset-2"
            onClick={() => setCredsTick((n) => n + 1)}
          >
            Voltar a verificar
          </button>
        </p>
      )}

      <div role="tablist" aria-label="Origem da importação" className="flex flex-wrap gap-2 border-b border-zinc-200 pb-1">
        <button
          type="button"
          role="tab"
          aria-selected={tab === "wordpress"}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            tab === "wordpress" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
          }`}
          onClick={() => setTab("wordpress")}
        >
          WordPress
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "url"}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            tab === "url" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
          }`}
          onClick={() => setTab("url")}
        >
          URL direta (Lovable / HTML)
        </button>
      </div>

      {tab === "wordpress" && (
        <section aria-labelledby="imp-wp-heading" className="space-y-4">
          <h2 id="imp-wp-heading" className="text-base font-semibold text-zinc-900">
            API REST do WordPress
          </h2>
          <p className="text-sm text-zinc-600">
            Indica a URL pública do site (com ou sem <code className="rounded bg-zinc-100 px-1">/wp-json</code>). O
            servidor pede até 100 posts a{" "}
            <code className="rounded bg-zinc-100 px-1 text-xs">/wp-json/wp/v2/posts?per_page=100</code>.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="wp-site-url" className="block text-sm font-medium text-zinc-700">
                URL do site WordPress
              </label>
              <input
                id="wp-site-url"
                type="url"
                autoComplete="url"
                placeholder="https://exemplo.com"
                value={wpSiteUrl}
                onChange={(e) => setWpSiteUrl(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-900/10"
              />
            </div>
            <button
              type="button"
              disabled={busy || !wpSiteUrl.trim()}
              onClick={() => void fetchWordPress()}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "A carregar…" : "Buscar posts"}
            </button>
          </div>
        </section>
      )}

      {tab === "url" && (
        <section aria-labelledby="imp-url-heading" className="space-y-4">
          <h2 id="imp-url-heading" className="text-base font-semibold text-zinc-900">
            Artigo por URL
          </h2>
          <p className="text-sm text-zinc-600">
            O servidor obtém o HTML, extrai <code className="rounded bg-zinc-100 px-1">&lt;article&gt;</code> ou{" "}
            <code className="rounded bg-zinc-100 px-1">&lt;main&gt;</code> (com fallback por densidade de texto), remove
            ruído (menu/rodapé/sidebar/script), converte para Markdown e pode usar{" "}
            <code className="rounded bg-zinc-100 px-1">og:image</code> como imagem de destaque.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="article-url" className="block text-sm font-medium text-zinc-700">
                URL do artigo
              </label>
              <input
                id="article-url"
                type="url"
                autoComplete="url"
                placeholder="https://…"
                value={articleUrl}
                onChange={(e) => setArticleUrl(e.target.value)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-900/10"
              />
            </div>
            <button
              type="button"
              disabled={busy || !articleUrl.trim()}
              onClick={() => void scrapeUrl(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "A analisar…" : "Analisar página"}
            </button>
            <button
              type="button"
              disabled={busy || !articleUrl.trim() || !urlHasMore}
              onClick={() => void scrapeUrl(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Carregar próximo lote de artigos descobertos"
            >
              {busy ? "A carregar…" : `Próximo lote (${URL_BATCH_SIZE})`}
            </button>
            <button
              type="button"
              disabled={busy || !articleUrl.trim()}
              onClick={() => void scrapeAllUrlBatches()}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Carregar todos os lotes de artigos desta URL"
            >
              {loadingAllBatches ? "A carregar todos…" : "Carregar todos"}
            </button>
          </div>
          <label className="inline-flex items-center gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={urlOnlyArticles}
              onChange={(e) => setUrlOnlyArticles(e.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
            />
            Importar somente artigos (ignorar páginas institucionais/listagem)
          </label>
          {urlTotalDiscovered > 0 && (
            <p className="text-xs text-zinc-600" role="status">
              Descobertos {urlTotalDiscovered} link(s)/artigo(s). Carregados na lista: {rows.length}.{" "}
              {urlHasMore ? "Há mais lotes disponíveis." : "Todos os lotes foram carregados."}
            </p>
          )}
          {discoveredLinks.length > 0 && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3">
              <p className="mb-2 text-sm font-medium text-zinc-800">Links encontrados (importação individual)</p>
              <ul className="space-y-2">
                {discoveredLinks.slice(0, 80).map((link) => (
                  <li key={link} className="flex flex-col gap-2 rounded border border-zinc-100 p-2 sm:flex-row sm:items-center sm:justify-between">
                    <span className="truncate text-xs text-zinc-700" title={link}>
                      {link}
                    </span>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void scrapeUrl(true, link)}
                      className="inline-flex min-h-9 items-center justify-center rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                    >
                      Importar
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {message && (
        <p
          className={`rounded-lg px-4 py-3 text-sm ${message.err ? "border border-red-200 bg-red-50 text-red-900" : "border border-emerald-200 bg-emerald-50 text-emerald-900"}`}
          role="status"
        >
          {message.text}
        </p>
      )}

      {rows.length > 0 && (
        <section aria-labelledby="imp-list-heading" className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 id="imp-list-heading" className="text-base font-semibold text-zinc-900">
              Artigos para importar ({rows.length})
            </h2>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => selectAll(true)}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Selecionar todos
              </button>
              <button
                type="button"
                onClick={() => selectAll(false)}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Limpar seleção
              </button>
              <button
                type="button"
                onClick={clearRows}
                className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50"
              >
                Limpar lista
              </button>
              <button
                type="button"
                disabled={busy || selectedCount === 0 || !credsOk}
                onClick={() => void commitSelected()}
                title={
                  !credsOk
                    ? "Configure token GitHub e repositório em /admin/settings para habilitar a importação."
                    : selectedCount === 0
                      ? "Selecione pelo menos um artigo para importar."
                      : undefined
                }
                aria-disabled={busy || selectedCount === 0 || !credsOk}
                className="rounded-md bg-emerald-700 px-3 py-1.5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? "A gravar…" : `Importar selecionados (${selectedCount})`}
              </button>
            </div>
          </div>
          {!credsOk && (
            <p className="text-xs text-amber-700" role="status">
              Para habilitar este botão, configure o token GitHub e o repositório em{" "}
              <a className="font-medium underline underline-offset-2" href="/admin/settings/">
                /admin/settings
              </a>
              .
            </p>
          )}

          <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm" data-cms-table-wrap>
            <table className="min-w-full text-left text-sm" data-cms-table>
              <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                <tr>
                  <th scope="col" className="w-10 px-3 py-3">
                    <span className="sr-only">Incluir</span>
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Título
                  </th>
                  <th scope="col" className="hidden px-3 py-3 sm:table-cell">
                    Slug
                  </th>
                  <th scope="col" className="px-3 py-3">
                    Data
                  </th>
                  <th scope="col" className="hidden px-3 py-3 md:table-cell">
                    Origem
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-100 last:border-0" data-search={`${r.title} ${r.slug}`}>
                    <td className="px-3 py-2 align-top">
                      <input
                        type="checkbox"
                        checked={r.selected}
                        onChange={(e) => setRowSelected(r.id, e.target.checked)}
                        aria-label={`Incluir «${r.title}» na importação`}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
                      />
                    </td>
                    <td className="px-3 py-2 align-top font-medium text-zinc-900">{r.title}</td>
                    <td className="hidden max-w-[10rem] truncate px-3 py-2 align-top font-mono text-xs text-zinc-600 sm:table-cell">
                      {r.slug}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 align-top text-zinc-600">{r.pubDate}</td>
                    <td className="hidden px-3 py-2 align-top text-zinc-600 md:table-cell">{r.sourceLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-zinc-500">
            Os ficheiros são criados como rascunho no GitHub; imagens de destaque remotas são enviadas para o armazenamento
            Supabase quando configurado no servidor.
          </p>
        </section>
      )}
    </div>
  );
}
