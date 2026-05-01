import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { articleHtmlToMarkdown } from "../../../../lib/import-convert";
import { normalizeImportedMarkdownBody } from "../../../../lib/normalize-import-markdown";
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

function extractImageUrlsFromMarkdown(md: string, sourceUrl?: string): string[] {
  const out = new Set<string>();
  for (const m of (md || "").matchAll(/!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const u = toStr(m[1]);
    const abs = toAbsoluteImageUrlCandidate(u, sourceUrl);
    if (abs) out.add(abs);
    else if (isHttpUrl(u)) out.add(u);
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

/**
 * Evita passar Markdown pelo Turndown (o resultado aparece no site como texto com `**` e `##` literais).
 */
function looksLikeHtml(s: string): boolean {
  const t = s.trim();
  if (t.length < 2) return false;
  if (/^```/.test(t)) return false;
  if (
    /<\s*(p|div|article|section|main|span|ul|ol|li|h[1-6]|table|thead|tbody|tr|td|th|blockquote|pre|a|img|br|hr|strong|em|b|i)\b[\s>/]/i.test(
      t,
    )
  ) {
    return true;
  }
  if (/<\s*(img|br|hr|input|meta|link)\b[^>]*>/i.test(t)) return true;
  if (
    /<[a-zA-Z][a-zA-Z0-9:-]*(?:\s[^>]*)?>[\s\S]*<\s*\/\s*[a-zA-Z][a-zA-Z0-9:-]*\s*>/i.test(t)
  ) {
    return true;
  }
  return false;
}

function toAbsoluteImageUrlCandidate(raw: string, sourceUrl?: string): string | null {
  const t = (raw || "").trim();
  if (!t) return null;
  if (t.startsWith("//")) {
    try {
      return new URL(`https:${t}`).toString();
    } catch {
      return null;
    }
  }
  try {
    const u = new URL(t);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    /* relativo */
  }
  const base = (sourceUrl || "").trim();
  if (!base) return null;
  try {
    const u = new URL(t, base);
    if (u.protocol === "http:" || u.protocol === "https:") return u.toString();
  } catch {
    return null;
  }
  return null;
}

function stringField(it: Record<string, unknown>, key: string): string {
  const v = it[key];
  if (typeof v === "string") return toStr(v);
  if (v && typeof v === "object" && "url" in v) {
    return toStr((v as { url?: unknown }).url);
  }
  return "";
}

/**
 * Corpo do artigo: campos explícitos de Markdown vs HTML; nunca assumir que `content` é HTML.
 */
function resolveMarkdownAndArticleHtml(it: Record<string, unknown>): { markdown: string; articleHtml: string } {
  const mdExplicit =
    stringField(it, "markdown") ||
    stringField(it, "markdownBody") ||
    stringField(it, "contentMarkdown") ||
    stringField(it, "body") ||
    stringField(it, "text");
  const htmlExplicit =
    stringField(it, "html") || stringField(it, "contentHtml") || stringField(it, "richText") || stringField(it, "rich_text");
  const generic = stringField(it, "content");

  if (mdExplicit) {
    let articleHtml = "";
    if (htmlExplicit && looksLikeHtml(htmlExplicit)) {
      articleHtml = htmlExplicit;
    } else if (generic && looksLikeHtml(generic) && generic !== mdExplicit) {
      articleHtml = generic;
    }
    return { markdown: mdExplicit, articleHtml };
  }

  if (htmlExplicit) {
    if (looksLikeHtml(htmlExplicit)) {
      return { markdown: articleHtmlToMarkdown(htmlExplicit), articleHtml: htmlExplicit };
    }
    return { markdown: htmlExplicit, articleHtml: "" };
  }

  if (generic) {
    if (looksLikeHtml(generic)) {
      return { markdown: articleHtmlToMarkdown(generic), articleHtml: generic };
    }
    return { markdown: generic, articleHtml: "" };
  }

  return { markdown: "", articleHtml: "" };
}

function collectStructuredImageUrls(it: Record<string, unknown>, sourceUrl?: string): string[] {
  const out: string[] = [];
  const add = (raw: unknown) => {
    const s = typeof raw === "string" ? raw.trim() : "";
    if (!s) return;
    const abs = toAbsoluteImageUrlCandidate(s, sourceUrl);
    if (abs) out.push(abs);
  };
  const walk = (arr: unknown) => {
    if (!Array.isArray(arr)) return;
    for (const el of arr) {
      if (typeof el === "string") add(el);
      else if (el && typeof el === "object") {
        const o = el as Record<string, unknown>;
        add(o.url);
        add(o.src);
        add(o.href);
        const nestedImage = stringField(o, "image");
        if (nestedImage) add(nestedImage);
        if (typeof o.imageUrl === "string") add(o.imageUrl);
      }
    }
  };
  walk(it.images);
  walk(it.imageUrls);
  walk(it.photos);
  walk(it.gallery);
  walk(it.media);
  walk(it.attachments);
  add(it.image);
  add(it.thumbnail);
  add(it.thumbnailUrl);
  if (typeof it.imageUrl === "string") add(it.imageUrl);
  return [...new Set(out)];
}

function coalesceFeaturedImageUrl(it: Record<string, unknown>): string | undefined {
  const keys = [
    "featuredImage",
    "featuredImageUrl",
    "coverImage",
    "cover",
    "heroImage",
    "hero",
    "thumbnail",
    "thumbnailUrl",
    "banner",
    "image",
  ];
  for (const k of keys) {
    const s = stringField(it, k);
    if (s) return s;
  }
  return undefined;
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

    const sourceUrl = toStr(it.sourceUrl) || toStr(it.url) || undefined;
    const { markdown: markdownCombinedRaw, articleHtml } = resolveMarkdownAndArticleHtml(it);
    const markdown = normalizeImportedMarkdownBody(markdownCombinedRaw);

    const featuredRaw = coalesceFeaturedImageUrl(it);
    const featuredImageUrl = featuredRaw
      ? toAbsoluteImageUrlCandidate(featuredRaw, sourceUrl) || featuredRaw
      : undefined;

    const description = toStr(it.description) || title.slice(0, 160);
    const category = toStr(it.category) || undefined;
    const tags = arr(it.tags).map((v) => String(v).trim()).filter(Boolean);
    const internalFromArr = arr(it.internalImages)
      .map((v) => String(v).trim())
      .map((u) => toAbsoluteImageUrlCandidate(u, sourceUrl) || (isHttpUrl(u) ? u : null))
      .filter((u): u is string => u != null);
    const structuredImages = collectStructuredImageUrls(it, sourceUrl);
    const internalImages = [...new Set([...internalFromArr, ...structuredImages])];
    const markdownImages = extractImageUrlsFromMarkdown(markdown, sourceUrl);

    const allAttachmentUrls = Array.from(
      new Set(
        [
          ...(featuredImageUrl ? [toAbsoluteImageUrlCandidate(featuredImageUrl, sourceUrl) || featuredImageUrl] : []),
          ...internalImages,
          ...markdownImages,
        ].filter((u): u is string => typeof u === "string" && u.length > 0),
      ),
    );
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
