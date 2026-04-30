import type { APIRoute } from "astro";
import { XMLParser } from "fast-xml-parser";
import { Buffer } from "node:buffer";
import { articleHtmlToMarkdown } from "../../../../lib/import-convert";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";

export const prerender = false;

const XML_BATCH_LIMIT_DEFAULT = 20;
const XML_BATCH_LIMIT_MAX = 50;

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

function stripHtmlToText(html: string, maxLen: number): string {
  const t = (html || "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t.length <= maxLen ? t : `${t.slice(0, maxLen - 1)}…`;
}

type WxrItem = Record<string, unknown>;

function resolveFeaturedUrlFromItem(item: WxrItem, attachmentById: Map<string, string>): string | undefined {
  const directAttachment = typeof item["wp:attachment_url"] === "string" ? (item["wp:attachment_url"] as string).trim() : "";
  if (directAttachment) return directAttachment;

  const metas = arr(item["wp:postmeta"] as WxrItem | WxrItem[] | undefined);
  const thumbMeta = metas.find((m) => String(m["wp:meta_key"] || "") === "_thumbnail_id");
  const thumbId = String(thumbMeta?.["wp:meta_value"] || "").trim();
  if (thumbId && attachmentById.has(thumbId)) return attachmentById.get(thumbId);
  return undefined;
}

function resolveTerms(item: WxrItem): { category?: string; tags: string[] } {
  const cats = arr(item.category as Array<Record<string, unknown>> | Record<string, unknown> | string | undefined);
  const categoryNames: string[] = [];
  const tagNames: string[] = [];
  for (const c of cats) {
    if (typeof c === "string") continue;
    const domain = String(c?.["@_domain"] || "").trim();
    const raw = String(c?.["#text"] || c?.["__text"] || c?.["text"] || "").trim();
    if (!raw) continue;
    if (domain === "category") categoryNames.push(raw);
    if (domain === "post_tag") tagNames.push(raw);
  }
  return { category: categoryNames[0], tags: Array.from(new Set(tagNames)) };
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);

  let body: { xmlBase64?: string; offset?: number; limit?: number };
  try {
    body = (await context.request.json()) as { xmlBase64?: string; offset?: number; limit?: number };
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const xmlBase64 = (body.xmlBase64 || "").trim();
  if (!xmlBase64) return json({ ok: false, error: "Arquivo XML em falta." }, 400, auth.responseHeaders);

  const offset = Math.max(0, Number.isFinite(body.offset) ? Number(body.offset) : 0);
  const limit = Math.min(XML_BATCH_LIMIT_MAX, Math.max(1, Number.isFinite(body.limit) ? Number(body.limit) : XML_BATCH_LIMIT_DEFAULT));

  let xmlText = "";
  try {
    xmlText = Buffer.from(xmlBase64, "base64").toString("utf8");
  } catch {
    return json({ ok: false, error: "Não foi possível decodificar o XML enviado." }, 400, auth.responseHeaders);
  }

  try {
    const parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      trimValues: true,
      parseTagValue: false,
    });
    const parsed = parser.parse(xmlText) as Record<string, unknown>;
    const channel = (parsed?.rss as { channel?: { item?: WxrItem | WxrItem[] } } | undefined)?.channel;
    const items = arr(channel?.item);
    if (!items.length) {
      return json({ ok: false, error: "Nenhum <item> encontrado no XML WXR." }, 422, auth.responseHeaders);
    }

    const attachmentById = new Map<string, string>();
    for (const it of items) {
      const postType = String(it["wp:post_type"] || "").trim();
      if (postType !== "attachment") continue;
      const id = String(it["wp:post_id"] || "").trim();
      const url = String(it["wp:attachment_url"] || "").trim();
      if (id && url) attachmentById.set(id, url);
    }

    const postsOnly = items.filter((it) => String(it["wp:post_type"] || "").trim() === "post");
    const totalDiscovered = postsOnly.length;
    const selected = postsOnly.slice(offset, offset + limit);
    const hasMore = offset + selected.length < totalDiscovered;
    const nextOffset = offset + selected.length;

    const posts = selected.map((p, i) => {
      const title = String(p.title || "").trim() || `post-${offset + i + 1}`;
      const bodyHtml = String(p["content:encoded"] || "").trim();
      const excerptHtml = String(p["excerpt:encoded"] || "").trim();
      const markdown = articleHtmlToMarkdown(bodyHtml);
      const slugRaw = String(p["wp:post_name"] || "").trim();
      const slug = slugify(slugRaw || title);
      const pubRaw = String(p["wp:post_date"] || p.pubDate || "").trim();
      const pubParsed = pubRaw ? new Date(pubRaw) : null;
      const pubDate =
        pubParsed && !Number.isNaN(pubParsed.getTime())
          ? pubParsed.toISOString().slice(0, 10)
          : new Date().toISOString().slice(0, 10);
      const { category, tags } = resolveTerms(p);
      const featuredImageUrl = resolveFeaturedUrlFromItem(p, attachmentById);
      const sourceUrl = String(p.link || "").trim() || undefined;
      const description = stripHtmlToText(excerptHtml || bodyHtml || title, 160);
      return {
        sourceId: Number(String(p["wp:post_id"] || offset + i + 1)) || offset + i + 1,
        slug,
        title,
        description,
        pubDate,
        markdown,
        articleHtml: bodyHtml,
        featuredImageUrl,
        sourceUrl,
        category,
        tags,
      };
    });

    return json(
      {
        ok: true,
        posts,
        totalDiscovered,
        hasMore,
        nextOffset,
        message: `Lote XML carregado: ${posts.length} post(s).`,
      },
      200,
      auth.responseHeaders,
    );
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Falha ao processar XML WordPress." },
      500,
      auth.responseHeaders,
    );
  }
};

