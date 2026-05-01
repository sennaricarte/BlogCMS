import { useCallback, useMemo, useState } from "react";

const K_INTEGR = "blogcms-admin-integration";
const K_CMS = "blogcms-cms-target";
const LS_REPLACE_EXISTING = "blogcms-import-replace-existing";
const IMPORTER_UI_VERSION = "importador-ui 2026-05-01 · migrar-imagens-remotas-github";

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      if (typeof result !== "string") {
        reject(new Error("Falha ao ler ficheiro XML."));
        return;
      }
      const i = result.indexOf("base64,");
      resolve(i >= 0 ? result.slice(i + 7) : btoa(result));
    };
    r.onerror = () => reject(r.error || new Error("Falha ao ler ficheiro XML."));
    r.readAsDataURL(file);
  });
}

type WpApiPost = {
  sourceId: number;
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  markdown: string;
  featuredImageUrl?: string;
  sourceUrl?: string;
  articleHtml?: string;
  category?: string;
  tags?: string[];
  xmlAttachmentUrls?: string[];
  xmlAttachmentFileNameByUrl?: Record<string, string>;
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
  sourceUrl?: string;
  articleHtml?: string;
  category?: string;
  tags?: string[];
  xmlAttachmentUrls?: string[];
  xmlAttachmentFileNameByUrl?: Record<string, string>;
  sourceLabel: "WordPress" | "URL" | "Lovable JSON";
};

type TabId = "wordpress" | "xml" | "json" | "url";

export function ContentImportPanel() {
  const URL_BATCH_SIZE = 20;
  const XML_BATCH_SIZE = 20;
  const JSON_BATCH_SIZE = 20;
  const [tab, setTab] = useState<TabId>("wordpress");
  const [wpSiteUrl, setWpSiteUrl] = useState("");
  const [wpXmlFileName, setWpXmlFileName] = useState("");
  const [wpXmlBase64, setWpXmlBase64] = useState("");
  const [wpXmlOffset, setWpXmlOffset] = useState(0);
  const [wpXmlHasMore, setWpXmlHasMore] = useState(false);
  const [wpXmlTotal, setWpXmlTotal] = useState(0);
  const [lovableJsonFileName, setLovableJsonFileName] = useState("");
  const [lovableJsonBase64, setLovableJsonBase64] = useState("");
  const [lovableJsonOffset, setLovableJsonOffset] = useState(0);
  const [lovableJsonHasMore, setLovableJsonHasMore] = useState(false);
  const [lovableJsonTotal, setLovableJsonTotal] = useState(0);
  const [articleUrl, setArticleUrl] = useState("");
  const [urlOnlyArticles, setUrlOnlyArticles] = useState(true);
  const [rows, setRows] = useState<PreviewRow[]>([]);
  const [urlBatchOffset, setUrlBatchOffset] = useState(0);
  const [urlTotalDiscovered, setUrlTotalDiscovered] = useState(0);
  const [urlHasMore, setUrlHasMore] = useState(false);
  const [discoveredLinks, setDiscoveredLinks] = useState<string[]>([]);
  const [selectedDiscoveredLinks, setSelectedDiscoveredLinks] = useState<string[]>([]);
  const [loadingAllBatches, setLoadingAllBatches] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; err: boolean } | null>(null);
  const [replaceExistingImports, setReplaceExistingImports] = useState(() => {
    try {
      return typeof localStorage !== "undefined" && localStorage.getItem(LS_REPLACE_EXISTING) === "1";
    } catch {
      return false;
    }
  });

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
    setSelectedDiscoveredLinks([]);
    setUrlBatchOffset(0);
    setUrlTotalDiscovered(0);
    setUrlHasMore(false);
    setMessage(null);
  }, []);

  const setDiscoveredSelected = useCallback((link: string, selected: boolean) => {
    setSelectedDiscoveredLinks((prev) => {
      const s = new Set(prev);
      if (selected) s.add(link);
      else s.delete(link);
      return Array.from(s);
    });
  }, []);

  const selectAllDiscovered = useCallback((selected: boolean) => {
    setSelectedDiscoveredLinks(selected ? [...discoveredLinks] : []);
  }, [discoveredLinks]);

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
        sourceUrl: p.sourceUrl,
        articleHtml: p.articleHtml,
        category: p.category,
        tags: p.tags,
        xmlAttachmentUrls: p.xmlAttachmentUrls,
        xmlAttachmentFileNameByUrl: p.xmlAttachmentFileNameByUrl,
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

  const onSelectWpXmlFile = async (file: File | null) => {
    if (!file) {
      setWpXmlFileName("");
      setWpXmlBase64("");
      setWpXmlOffset(0);
      setWpXmlHasMore(false);
      setWpXmlTotal(0);
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      setWpXmlFileName(file.name);
      setWpXmlBase64(b64);
      setWpXmlOffset(0);
      setWpXmlHasMore(false);
      setWpXmlTotal(0);
      setMessage({ text: `Arquivo XML carregado: ${file.name}`, err: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha ao ler XML.", err: true });
    }
  };

  const fetchWordPressXmlBatch = async (resetBatch = true) => {
    if (!wpXmlBase64) {
      setMessage({ text: "Selecione um arquivo .xml primeiro.", err: true });
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const offset = resetBatch ? 0 : wpXmlOffset;
      const res = await fetch("/api/admin/import/wordpress-xml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          xmlBase64: wpXmlBase64,
          offset,
          limit: XML_BATCH_SIZE,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        posts?: WpApiPost[];
        totalDiscovered?: number;
        hasMore?: boolean;
        nextOffset?: number;
      };
      if (!res.ok || !j.ok || !Array.isArray(j.posts)) {
        setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
        return;
      }
      const nextRows: PreviewRow[] = j.posts.map((p) => ({
        id: `wpxml-${p.sourceId}-${Math.random().toString(36).slice(2, 7)}`,
        selected: false,
        slug: p.slug,
        title: p.title,
        description: p.description,
        pubDate: p.pubDate,
        markdown: p.markdown,
        featuredImageUrl: p.featuredImageUrl,
        sourceUrl: p.sourceUrl,
        articleHtml: p.articleHtml,
        category: p.category,
        tags: p.tags,
        xmlAttachmentUrls: p.xmlAttachmentUrls,
        xmlAttachmentFileNameByUrl: p.xmlAttachmentFileNameByUrl,
        sourceLabel: "WordPress",
      }));
      setRows((prev) => {
        if (resetBatch) return nextRows;
        const dedupe = new Set(prev.map((r) => r.slug));
        const append = nextRows.filter((r) => !dedupe.has(r.slug));
        return [...prev, ...append];
      });
      setWpXmlTotal(typeof j.totalDiscovered === "number" ? j.totalDiscovered : nextRows.length);
      setWpXmlHasMore(Boolean(j.hasMore));
      setWpXmlOffset(typeof j.nextOffset === "number" ? j.nextOffset : offset + nextRows.length);
      setMessage({
        text:
          j.message ||
          `${nextRows.length} post(s) XML carregado(s). ${Boolean(j.hasMore) ? "Pode carregar o próximo lote." : "Todos os lotes foram carregados."}`,
        err: false,
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede no importador XML.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const fetchAllWordPressXmlBatches = async () => {
    if (!wpXmlBase64) {
      setMessage({ text: "Selecione um arquivo .xml primeiro.", err: true });
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      let offset = 0;
      let hasMore = true;
      const allRows: PreviewRow[] = [];
      const dedupe = new Set<string>();
      let total = 0;
      let safety = 0;
      while (hasMore && safety < 120) {
        safety += 1;
        const res = await fetch("/api/admin/import/wordpress-xml", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            xmlBase64: wpXmlBase64,
            offset,
            limit: XML_BATCH_SIZE,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          error?: string;
          posts?: WpApiPost[];
          totalDiscovered?: number;
          hasMore?: boolean;
          nextOffset?: number;
        };
        if (!res.ok || !j.ok || !Array.isArray(j.posts)) {
          setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
          return;
        }
        total = typeof j.totalDiscovered === "number" ? j.totalDiscovered : total;
        for (const p of j.posts) {
          if (dedupe.has(p.slug)) continue;
          dedupe.add(p.slug);
          allRows.push({
            id: `wpxml-${p.sourceId}-${Math.random().toString(36).slice(2, 7)}`,
            selected: false,
            slug: p.slug,
            title: p.title,
            description: p.description,
            pubDate: p.pubDate,
            markdown: p.markdown,
            featuredImageUrl: p.featuredImageUrl,
            sourceUrl: p.sourceUrl,
            articleHtml: p.articleHtml,
            category: p.category,
            tags: p.tags,
            sourceLabel: "WordPress",
          });
        }
        offset = typeof j.nextOffset === "number" ? j.nextOffset : offset + j.posts.length;
        hasMore = Boolean(j.hasMore) && j.posts.length > 0;
      }
      setRows(allRows);
      setWpXmlTotal(total || allRows.length);
      setWpXmlHasMore(false);
      setWpXmlOffset(offset);
      setMessage({ text: `${allRows.length} post(s) do XML carregado(s) no total.`, err: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede no processamento em lotes do XML.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const onSelectLovableJsonFile = async (file: File | null) => {
    if (!file) {
      setLovableJsonFileName("");
      setLovableJsonBase64("");
      setLovableJsonOffset(0);
      setLovableJsonHasMore(false);
      setLovableJsonTotal(0);
      return;
    }
    try {
      const b64 = await fileToBase64(file);
      setLovableJsonFileName(file.name);
      setLovableJsonBase64(b64);
      setLovableJsonOffset(0);
      setLovableJsonHasMore(false);
      setLovableJsonTotal(0);
      setMessage({ text: `Arquivo JSON carregado: ${file.name}`, err: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha ao ler JSON.", err: true });
    }
  };

  const fetchLovableJsonBatch = async (resetBatch = true) => {
    if (!lovableJsonBase64) {
      setMessage({ text: "Selecione um arquivo .json primeiro.", err: true });
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      const offset = resetBatch ? 0 : lovableJsonOffset;
      const res = await fetch("/api/admin/import/lovable-json", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          jsonBase64: lovableJsonBase64,
          offset,
          limit: JSON_BATCH_SIZE,
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        posts?: WpApiPost[];
        totalDiscovered?: number;
        hasMore?: boolean;
        nextOffset?: number;
      };
      if (!res.ok || !j.ok || !Array.isArray(j.posts)) {
        setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
        return;
      }
      const nextRows: PreviewRow[] = j.posts.map((p) => ({
        id: `lovable-${p.sourceId}-${Math.random().toString(36).slice(2, 7)}`,
        selected: false,
        slug: p.slug,
        title: p.title,
        description: p.description,
        pubDate: p.pubDate,
        markdown: p.markdown,
        featuredImageUrl: p.featuredImageUrl,
        sourceUrl: p.sourceUrl,
        articleHtml: p.articleHtml,
        category: p.category,
        tags: p.tags,
        xmlAttachmentUrls: p.xmlAttachmentUrls,
        xmlAttachmentFileNameByUrl: p.xmlAttachmentFileNameByUrl,
        sourceLabel: "Lovable JSON",
      }));
      setRows((prev) => {
        if (resetBatch) return nextRows;
        const dedupe = new Set(prev.map((r) => r.slug));
        const append = nextRows.filter((r) => !dedupe.has(r.slug));
        return [...prev, ...append];
      });
      setLovableJsonTotal(typeof j.totalDiscovered === "number" ? j.totalDiscovered : nextRows.length);
      setLovableJsonHasMore(Boolean(j.hasMore));
      setLovableJsonOffset(typeof j.nextOffset === "number" ? j.nextOffset : offset + nextRows.length);
      setMessage({
        text:
          j.message ||
          `${nextRows.length} artigo(s) JSON carregado(s). ${Boolean(j.hasMore) ? "Pode carregar o próximo lote." : "Todos os lotes foram carregados."}`,
        err: false,
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede no importador JSON.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const fetchAllLovableJsonBatches = async () => {
    if (!lovableJsonBase64) {
      setMessage({ text: "Selecione um arquivo .json primeiro.", err: true });
      return;
    }
    setMessage(null);
    setBusy(true);
    try {
      let offset = 0;
      let hasMore = true;
      const allRows: PreviewRow[] = [];
      const dedupe = new Set<string>();
      let total = 0;
      let safety = 0;
      while (hasMore && safety < 120) {
        safety += 1;
        const res = await fetch("/api/admin/import/lovable-json", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            jsonBase64: lovableJsonBase64,
            offset,
            limit: JSON_BATCH_SIZE,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          error?: string;
          posts?: WpApiPost[];
          totalDiscovered?: number;
          hasMore?: boolean;
          nextOffset?: number;
        };
        if (!res.ok || !j.ok || !Array.isArray(j.posts)) {
          setMessage({ text: j.error || `Erro HTTP ${res.status}`, err: true });
          return;
        }
        total = typeof j.totalDiscovered === "number" ? j.totalDiscovered : total;
        for (const p of j.posts) {
          if (dedupe.has(p.slug)) continue;
          dedupe.add(p.slug);
          allRows.push({
            id: `lovable-${p.sourceId}-${Math.random().toString(36).slice(2, 7)}`,
            selected: false,
            slug: p.slug,
            title: p.title,
            description: p.description,
            pubDate: p.pubDate,
            markdown: p.markdown,
            featuredImageUrl: p.featuredImageUrl,
            sourceUrl: p.sourceUrl,
            articleHtml: p.articleHtml,
            category: p.category,
            tags: p.tags,
            xmlAttachmentUrls: p.xmlAttachmentUrls,
            xmlAttachmentFileNameByUrl: p.xmlAttachmentFileNameByUrl,
            sourceLabel: "Lovable JSON",
          });
        }
        offset = typeof j.nextOffset === "number" ? j.nextOffset : offset + j.posts.length;
        hasMore = Boolean(j.hasMore) && j.posts.length > 0;
      }
      setRows(allRows);
      setLovableJsonTotal(total || allRows.length);
      setLovableJsonHasMore(false);
      setLovableJsonOffset(offset);
      setMessage({ text: `${allRows.length} artigo(s) do JSON Lovable carregado(s) no total.`, err: false });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede no processamento em lotes do JSON.", err: true });
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
          sourceUrl?: string;
          articleHtml?: string;
        };
        posts?: Array<{
          slug: string;
          title: string;
          description: string;
          pubDate: string;
          markdown: string;
          featuredImageUrl?: string;
          sourceUrl?: string;
          articleHtml?: string;
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
        setSelectedDiscoveredLinks((prev) => {
          if (resetBatch) return [];
          const keep = new Set(prev);
          for (const l of j.discoveredLinks) keep.add(l);
          return Array.from(keep);
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
        setSelectedDiscoveredLinks([]);
        const next: PreviewRow[] = j.posts.map((p) => ({
          id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          selected: true,
          slug: p.slug,
          title: p.title,
          description: p.description,
          pubDate: p.pubDate,
          markdown: p.markdown,
          featuredImageUrl: p.featuredImageUrl,
          sourceUrl: p.sourceUrl,
          articleHtml: p.articleHtml,
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
      setSelectedDiscoveredLinks([]);
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
          sourceUrl: p.sourceUrl,
          articleHtml: p.articleHtml,
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
            sourceUrl?: string;
            articleHtml?: string;
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
          setSelectedDiscoveredLinks((prev) => {
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
              sourceUrl: p.sourceUrl,
              articleHtml: p.articleHtml,
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

  const importSelectedDiscoveredLinks = async () => {
    const targets = selectedDiscoveredLinks.filter(Boolean);
    if (targets.length === 0) {
      setMessage({ text: "Selecione pelo menos um link da lista para importar.", err: true });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      let imported = 0;
      const failed: string[] = [];
      const dedupe = new Set(rows.map((r) => r.slug));
      for (const link of targets) {
        const res = await fetch("/api/admin/import/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            articleUrl: link,
            onlyArticles: true,
            offset: 0,
            limit: 1,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          post?: {
            slug: string;
            title: string;
            description: string;
            pubDate: string;
            markdown: string;
            featuredImageUrl?: string;
            sourceUrl?: string;
            articleHtml?: string;
          };
        };
        if (!res.ok || !j.ok || !j.post) {
          failed.push(link);
          continue;
        }
        if (dedupe.has(j.post.slug)) continue;
        dedupe.add(j.post.slug);
        imported += 1;
        setRows((prev) => [
          ...prev,
          {
            id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            selected: true,
            slug: j.post!.slug,
            title: j.post!.title,
            description: j.post!.description,
            pubDate: j.post!.pubDate,
            markdown: j.post!.markdown,
            featuredImageUrl: j.post!.featuredImageUrl,
            sourceUrl: j.post!.sourceUrl,
            articleHtml: j.post!.articleHtml,
            sourceLabel: "URL",
          },
        ]);
      }
      setSelectedDiscoveredLinks([]);
      if (imported > 0) {
        setMessage({
          text:
            failed.length > 0
              ? `Importados ${imported} link(s). ${failed.length} falharam e podem precisar de nova tentativa.`
              : `Importados ${imported} link(s) com sucesso.`,
          err: false,
        });
      } else {
        setMessage({
          text: "Não foi possível extrair conteúdo dos links selecionados.",
          err: true,
        });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede ao importar links.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const importAllDiscoveredLinks = async () => {
    if (discoveredLinks.length === 0) {
      setMessage({ text: "Nenhum link encontrado para importar.", err: true });
      return;
    }
    setSelectedDiscoveredLinks([...discoveredLinks]);
    setBusy(true);
    setMessage(null);
    try {
      let imported = 0;
      const failed: string[] = [];
      const dedupe = new Set(rows.map((r) => r.slug));
      for (const link of discoveredLinks) {
        const res = await fetch("/api/admin/import/scrape", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({
            articleUrl: link,
            onlyArticles: true,
            offset: 0,
            limit: 1,
          }),
        });
        const j = (await res.json()) as {
          ok?: boolean;
          post?: {
            slug: string;
            title: string;
            description: string;
            pubDate: string;
            markdown: string;
            featuredImageUrl?: string;
            sourceUrl?: string;
            articleHtml?: string;
          };
        };
        if (!res.ok || !j.ok || !j.post) {
          failed.push(link);
          continue;
        }
        if (dedupe.has(j.post.slug)) continue;
        dedupe.add(j.post.slug);
        imported += 1;
        setRows((prev) => [
          ...prev,
          {
            id: `url-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            selected: true,
            slug: j.post!.slug,
            title: j.post!.title,
            description: j.post!.description,
            pubDate: j.post!.pubDate,
            markdown: j.post!.markdown,
            featuredImageUrl: j.post!.featuredImageUrl,
            sourceUrl: j.post!.sourceUrl,
            articleHtml: j.post!.articleHtml,
            sourceLabel: "URL",
          },
        ]);
      }
      setSelectedDiscoveredLinks([]);
      if (imported > 0) {
        setMessage({
          text:
            failed.length > 0
              ? `Importados ${imported} link(s) de ${discoveredLinks.length}. ${failed.length} falharam e podem precisar de nova tentativa.`
              : `Importados todos os ${imported} link(s) encontrados com sucesso.`,
          err: false,
        });
      } else {
        setMessage({
          text: "Não foi possível extrair conteúdo dos links encontrados.",
          err: true,
        });
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede ao importar todos os links.", err: true });
    } finally {
      setBusy(false);
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
          replaceExisting: replaceExistingImports,
          posts: picked.map((r) => ({
            slug: r.slug,
            title: r.title,
            description: r.description,
            pubDate: r.pubDate,
            markdownBody: r.markdown,
            featuredImageUrl: r.featuredImageUrl,
            sourceUrl: r.sourceUrl,
            articleHtml: r.articleHtml,
            category: r.category,
            tags: r.tags,
            xmlAttachmentUrls: r.xmlAttachmentUrls,
            xmlAttachmentFileNameByUrl: r.xmlAttachmentFileNameByUrl,
            draft: true,
          })),
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        created?: string[];
        replaced?: string[];
        skipped?: Array<{ slug: string; reason: string }>;
        errors?: Array<{ slug: string; error: string }>;
        message?: string;
      };
      const parts: string[] = [];
      if (j.message) parts.push(j.message);
      const newSlugs = j.created ?? [];
      const repSlugs = j.replaced ?? [];
      if (newSlugs.length > 0) parts.push(`Novos: ${newSlugs.join(", ")}.`);
      if (repSlugs.length > 0) parts.push(`Substituídos: ${repSlugs.join(", ")}.`);
      if (Array.isArray(j.errors) && j.errors.length) {
        parts.push(
          j.errors.map((e) => `${e.slug}: ${e.error}`).join(" | "),
        );
      }
      if (Array.isArray(j.skipped) && j.skipped.length) {
        parts.push(`Ignorados: ${j.skipped.map((s) => `${s.slug} (${s.reason})`).join(", ")}.`);
      }
      const writtenCount = newSlugs.length + repSlugs.length;
      setMessage({
        text: parts.join(" ") || j.error || "Resposta inesperada.",
        err: !j.ok && writtenCount === 0,
      });
      if (writtenCount > 0 || (Array.isArray(j.skipped) && j.skipped.length > 0)) {
        const committedSet = new Set([...newSlugs, ...repSlugs]);
        const skippedSet = new Set((j.skipped || []).map((s) => s.slug));
        setRows((prev) =>
          prev.filter((r) => !r.selected || (!committedSet.has(r.slug) && !skippedSet.has(r.slug))),
        );
      }
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const migrateRemoteBlogImages = async () => {
    if (
      !window.confirm(
        "Isto vai analisar os artigos já existentes em src/content/blog no GitHub, descarregar imagens com URL externa (por exemplo Supabase), gravá-las em src/assets/blog (referências ../../assets/blog/ no .md) e atualizar os ficheiros com commits separados. Pode demorar vários minutos. Continuar?",
      )
    ) {
      return;
    }
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
    setBusy(true);
    try {
      const res = await fetch("/api/admin/cms/migrate-remote-blog-images", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          GITHUB_PERSONAL_TOKEN: token,
          githubRepoFullName,
          branch: (target.branch || "main").trim() || "main",
          maxPosts: 200,
        }),
      });
      let j: {
        ok?: boolean;
        message?: string;
        postsScanned?: number;
        postsUpdated?: number;
        imagesMigrated?: number;
        errors?: Array<{ path: string; error: string }>;
        error?: string;
      };
      try {
        j = (await res.json()) as typeof j;
      } catch {
        setMessage({ text: `Resposta inválida (HTTP ${res.status}).`, err: true });
        return;
      }
      const errLines =
        Array.isArray(j.errors) && j.errors.length > 0
          ? " Detalhes: " + j.errors.map((e) => `${e.path}: ${e.error}`).join(" | ")
          : "";
      const postsUpdated = j.postsUpdated ?? 0;
      setMessage({
        text: (j.message || j.error || (res.ok ? "Operação concluída." : `Erro HTTP ${res.status}.`)) + errLines,
        err: !res.ok || (!j.ok && postsUpdated === 0),
      });
    } catch (e) {
      setMessage({ text: e instanceof Error ? e.message : "Falha de rede.", err: true });
    } finally {
      setBusy(false);
    }
  };

  const selectedCount = rows.filter((r) => r.selected).length;

  return (
    <div className="space-y-8">
      <p className="text-xs text-zinc-500" role="status" aria-label="Versão da interface do importador">
        Versão do importador: <code className="rounded bg-zinc-100 px-1">{IMPORTER_UI_VERSION}</code>
      </p>

      <section
        aria-labelledby="migrate-remote-images-heading"
        className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/90 px-4 py-4"
      >
        <h2 id="migrate-remote-images-heading" className="text-sm font-semibold text-violet-950">
          Migrar imagens remotas (artigos já no GitHub)
        </h2>
        <p className="text-xs text-violet-900/95">
          Varre os <code className="rounded bg-violet-100/80 px-1">.md</code> em{" "}
          <code className="rounded bg-violet-100/80 px-1">src/content/blog</code> do repositório configurado. URLs de imagens
          externas (por exemplo <code className="rounded bg-violet-100/80 px-1">*.supabase.co</code>) são descarregadas e
          guardadas em <code className="rounded bg-violet-100/80 px-1">src/assets/blog</code>; o Markdown e o destaque
          passam a apontar para caminhos locais. Usa o mesmo token e repositório das{" "}
          <a className="font-medium underline underline-offset-2" href="/admin/settings/">
            Configurações
          </a>
          .
        </p>
        <button
          type="button"
          disabled={busy || !credsOk}
          onClick={() => void migrateRemoteBlogImages()}
          aria-disabled={busy || !credsOk}
          title={
            !credsOk
              ? "Configure o token GitHub e o repositório nas Configurações."
              : "Analisa até 200 ficheiros por execução."
          }
          className="inline-flex min-h-10 items-center justify-center rounded-md bg-violet-800 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-violet-900 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "A migrar imagens…" : "Varrer e migrar imagens no repositório"}
        </button>
      </section>

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
          aria-selected={tab === "xml"}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            tab === "xml" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
          }`}
          onClick={() => setTab("xml")}
        >
          WordPress XML (WXR)
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === "json"}
          className={`rounded-md px-4 py-2 text-sm font-medium transition ${
            tab === "json" ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100"
          }`}
          onClick={() => setTab("json")}
        >
          JSON Lovable
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

      {tab === "xml" && (
        <section aria-labelledby="imp-wpxml-heading" className="space-y-4">
          <h2 id="imp-wpxml-heading" className="text-base font-semibold text-zinc-900">
            Importar WordPress por XML (WXR)
          </h2>
          <p className="text-sm text-zinc-600">
            Envie um arquivo de exportação <code className="rounded bg-zinc-100 px-1">.xml</code> do WordPress. O servidor
            processa em lotes, converte conteúdo para Markdown e mantém os assets no GitHub do cliente.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="wp-xml-file" className="block text-sm font-medium text-zinc-700">
                Arquivo XML do WordPress
              </label>
              <input
                id="wp-xml-file"
                type="file"
                accept=".xml,text/xml,application/xml"
                onChange={(e) => void onSelectWpXmlFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-900/10"
              />
              {wpXmlFileName && <p className="mt-1 text-xs text-zinc-600">Selecionado: {wpXmlFileName}</p>}
            </div>
            <button
              type="button"
              disabled={busy || !wpXmlBase64}
              onClick={() => void fetchWordPressXmlBatch(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "A processar…" : "Analisar XML"}
            </button>
            <button
              type="button"
              disabled={busy || !wpXmlBase64 || !wpXmlHasMore}
              onClick={() => void fetchWordPressXmlBatch(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Carregar próximo lote de posts do XML"
            >
              {busy ? "A carregar…" : `Próximo lote (${XML_BATCH_SIZE})`}
            </button>
            <button
              type="button"
              disabled={busy || !wpXmlBase64}
              onClick={() => void fetchAllWordPressXmlBatches()}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Carregar todos os lotes do XML"
            >
              {busy ? "A carregar…" : "Carregar todos"}
            </button>
          </div>
          {wpXmlTotal > 0 && (
            <p className="text-xs text-zinc-600" role="status">
              Descobertos {wpXmlTotal} post(s) no XML. Carregados na lista: {rows.length}.{" "}
              {wpXmlHasMore ? "Há mais lotes disponíveis." : "Todos os lotes foram carregados."}
            </p>
          )}
        </section>
      )}

      {tab === "json" && (
        <section aria-labelledby="imp-json-heading" className="space-y-4">
          <h2 id="imp-json-heading" className="text-base font-semibold text-zinc-900">
            Importar JSON (Lovable / export)
          </h2>
          <p className="text-sm text-zinc-600">
            Envie um ficheiro <code className="rounded bg-zinc-100 px-1">.json</code> com um array de artigos ou chaves
            como <code className="rounded bg-zinc-100 px-1">posts</code>, <code className="rounded bg-zinc-100 px-1">articles</code> ou{" "}
            <code className="rounded bg-zinc-100 px-1">data.posts</code>. O servidor processa em lotes e prepara a
            pré-visualização para gravar no GitHub.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="min-w-0 flex-1">
              <label htmlFor="lovable-json-file" className="block text-sm font-medium text-zinc-700">
                Arquivo JSON
              </label>
              <input
                id="lovable-json-file"
                type="file"
                accept=".json,application/json"
                aria-describedby="imp-json-file-hint"
                onChange={(e) => void onSelectLovableJsonFile(e.target.files?.[0] || null)}
                className="mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm file:mr-3 file:rounded-md file:border-0 file:bg-zinc-900 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-white hover:file:bg-zinc-800 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-900/10"
              />
              <p id="imp-json-file-hint" className="sr-only">
                Escolha um ficheiro JSON exportado do Lovable ou com a mesma estrutura de lista de artigos.
              </p>
              {lovableJsonFileName && (
                <p className="mt-1 text-xs text-zinc-600" role="status">
                  Selecionado: {lovableJsonFileName}
                </p>
              )}
            </div>
            <button
              type="button"
              disabled={busy || !lovableJsonBase64}
              onClick={() => void fetchLovableJsonBatch(true)}
              className="inline-flex min-h-10 items-center justify-center rounded-md bg-zinc-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "A processar…" : "Carregar lote"}
            </button>
            <button
              type="button"
              disabled={busy || !lovableJsonBase64 || !lovableJsonHasMore}
              onClick={() => void fetchLovableJsonBatch(false)}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-zinc-300 bg-white px-4 py-2 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Carregar próximo lote de artigos do JSON"
            >
              {busy ? "A carregar…" : `Próximo lote (${JSON_BATCH_SIZE})`}
            </button>
            <button
              type="button"
              disabled={busy || !lovableJsonBase64}
              onClick={() => void fetchAllLovableJsonBatches()}
              className="inline-flex min-h-10 items-center justify-center rounded-md border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label="Carregar todos os lotes do JSON"
            >
              {busy ? "A carregar…" : "Carregar todos"}
            </button>
          </div>
          {lovableJsonTotal > 0 && (
            <p className="text-xs text-zinc-600" role="status">
              Descobertos {lovableJsonTotal} artigo(s) no JSON. Carregados na lista: {rows.length}.{" "}
              {lovableJsonHasMore ? "Há mais lotes disponíveis." : "Todos os lotes foram carregados."}
            </p>
          )}
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-zinc-800">Links encontrados (importação individual)</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || discoveredLinks.length === 0}
                    onClick={() => selectAllDiscovered(true)}
                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Selecionar todos
                  </button>
                  <button
                    type="button"
                    disabled={busy || selectedDiscoveredLinks.length === 0}
                    onClick={() => selectAllDiscovered(false)}
                    className="rounded-md border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50"
                  >
                    Limpar
                  </button>
                  <button
                    type="button"
                    disabled={busy || selectedDiscoveredLinks.length === 0}
                    onClick={() => void importSelectedDiscoveredLinks()}
                    className="rounded-md bg-zinc-900 px-2.5 py-1 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50"
                  >
                    Importar selecionados ({selectedDiscoveredLinks.length})
                  </button>
                  <button
                    type="button"
                    disabled={busy || discoveredLinks.length === 0}
                    onClick={() => void importAllDiscoveredLinks()}
                    className="rounded-md bg-emerald-700 px-2.5 py-1 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    Importar todos da lista ({discoveredLinks.length})
                  </button>
                </div>
              </div>
              <ul className="space-y-2">
                {discoveredLinks.slice(0, 80).map((link) => (
                  <li key={link} className="flex flex-col gap-2 rounded border border-zinc-100 p-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="flex min-w-0 flex-1 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selectedDiscoveredLinks.includes(link)}
                        onChange={(e) => setDiscoveredSelected(link, e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900"
                      />
                      <span className="truncate text-xs text-zinc-700" title={link}>
                        {link}
                      </span>
                    </label>
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
          <label className="flex max-w-2xl cursor-pointer items-start gap-2 text-sm text-zinc-700">
            <input
              type="checkbox"
              checked={replaceExistingImports}
              onChange={(e) => {
                const v = e.target.checked;
                setReplaceExistingImports(v);
                try {
                  localStorage.setItem(LS_REPLACE_EXISTING, v ? "1" : "0");
                } catch {
                  /* ignore */
                }
              }}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 text-zinc-900"
              aria-describedby="imp-replace-hint"
            />
            <span>
              <span className="font-medium text-zinc-900">Substituir artigos já importados</span>
              <span id="imp-replace-hint" className="mt-0.5 block text-xs text-zinc-600">
                Com esta opção ativa, se já existir um artigo com o mesmo slug no GitHub, o ficheiro é{" "}
                <strong>atualizado</strong> com o conteúdo desta importação (em vez de ser ignorado). A preferência fica
                guardada neste dispositivo.
              </span>
            </span>
          </label>
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
            Os ficheiros são criados como rascunho no GitHub; as imagens importadas (corpo e destaque) são guardadas em
            <code className="rounded bg-zinc-100 px-1">src/assets/blog</code> no repositório do cliente.
          </p>
        </section>
      )}
    </div>
  );
}
