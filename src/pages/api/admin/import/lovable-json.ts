import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { articleHtmlToMarkdown } from "../../../../lib/import-convert";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";

export const prerender = false;

const JSON_BATCH_LIMIT_DEFAULT = 20;
const JSON_BATCH_LIMIT_MAX = 50;

function json(o: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers as object) },
  });
}

function arr<T>(v: T | T[] | undefined | null): T[] {
  if (Array.isArray(v)) return v;
  return v == null ? [] : [v];
}

function toStr(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function slugify(s: string): string {
  const t = (s || "").trim();
  if (!t) return `post-${Date.now()}`;
  return (
    t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 90) || `post-${Date.now()}`
  );
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

function extractImageUrlsFromMarkdown(md: string): string[] {
  const out = new Set<string>();
  for (const m of (md || "").matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const u = toStr(m[1]);
    if (isHttpUrl(u)) out.add(u);
  }
  return Array.from(out);
}

function fileNameFromUrl(url: string): string {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    return last || "imagem";
  } catch {
    return "imagem";
  }
}

function resolveInputItems(parsed: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(parsed)) return parsed.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  if (parsed && typeof parsed === "object") {
    const obj = parsed as Record<string, unknown>;
    const candidates = [
      obj.posts,
      obj.articles,
      obj.items,
      obj.data,
      (obj.data as Record<string, unknown> | undefined)?.posts,
      (obj.data as Record<string, unknown> | undefined)?.articles,
      (obj.result as Record<string, unknown> | undefined)?.posts,
    ];
    for (const c of candidates) {
      if (Array.isArray(c)) return c.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
    }
  }
  return [];
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);

  let body: { jsonBase64?: string; offset?: number; limit?: number };
  try {
    body = (await context.request.json()) as { jsonBase64?: string; offset?: number; limit?: number };
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const jsonBase64 = toStr(body.jsonBase64);
  if (!jsonBase64) return json({ ok: false, error: "Arquivo JSON em falta." }, 400, auth.responseHeaders);

  const offset = Math.max(0, Number.isFinite(body.offset) ? Number(body.offset) : 0);
  const limit = Math.min(
    JSON_BATCH_LIMIT_MAX,
    Math.max(1, Number.isFinite(body.limit) ? Number(body.limit) : JSON_BATCH_LIMIT_DEFAULT),
  );

  let rawJson = "";
  try {
    rawJson = Buffer.from(jsonBase64, "base64").toString("utf8");
  } catch {
    return json({ ok: false, error: "Não foi possível decodificar o JSON enviado." }, 400, auth.responseHeaders);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson) as unknown;
  } catch {
    return json({ ok: false, error: "Arquivo JSON inválido." }, 400, auth.responseHeaders);
  }

  const items = resolveInputItems(parsed);
  if (!items.length) {
    return json({ ok: false, error: "Nenhum artigo encontrado no JSON (array/posts/articles/items)." }, 422, auth.responseHeaders);
  }

  const selected = items.slice(offset, offset + limit);
  const hasMore = offset + selected.length < items.length;
  const nextOffset = offset + selected.length;

  const posts = selected.map((it, i) => {
    const title = toStr(it.title) || toStr(it.headline) || `artigo-${offset + i + 1}`;
    const slug = slugify(toStr(it.slug) || toStr(it.urlSlug) || title);
    const pubRaw = toStr(it.pubDate) || toStr(it.publishedAt) || toStr(it.date);
    const d = pubRaw ? new Date(pubRaw) : null;
    const pubDate = d && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

    const markdownRaw = toStr(it.markdown) || toStr(it.markdownBody) || toStr(it.contentMarkdown);
    const htmlRaw = toStr(it.html) || toStr(it.contentHtml) || toStr(it.content);
    const markdown = markdownRaw || articleHtmlToMarkdown(htmlRaw);
    const articleHtml = htmlRaw || "";

    const featuredImageUrl = toStr(it.featuredImage) || toStr(it.featuredImageUrl) || toStr(it.coverImage) || undefined;
    const sourceUrl = toStr(it.sourceUrl) || toStr(it.url) || undefined;
    const description = toStr(it.description) || title.slice(0, 160);
    const category = toStr(it.category) || undefined;
    const tags = arr(it.tags).map((v) => String(v).trim()).filter(Boolean);
    const internalImages = arr(it.internalImages).map((v) => String(v).trim()).filter((u) => isHttpUrl(u));
    const markdownImages = extractImageUrlsFromMarkdown(markdown);
    const allAttachmentUrls = Array.from(new Set([...(featuredImageUrl ? [featuredImageUrl] : []), ...internalImages, ...markdownImages]));
    const xmlAttachmentFileNameByUrl = Object.fromEntries(allAttachmentUrls.map((u) => [u, fileNameFromUrl(u)]));

    return {
      sourceId: offset + i + 1,
      slug,
      title,
      description: description.slice(0, 160),
      pubDate,
      markdown,
      featuredImageUrl,
      sourceUrl,
      articleHtml,
      category,
      tags,
      xmlAttachmentUrls: allAttachmentUrls,
      xmlAttachmentFileNameByUrl,
    };
  });

  return json(
    {
      ok: true,
      posts,
      totalDiscovered: items.length,
      hasMore,
      nextOffset,
      message: `Lote JSON carregado: ${posts.length} artigo(s).`,
    },
    200,
    auth.responseHeaders,
  );
};
