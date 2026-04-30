import type { APIRoute } from "astro";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import { articleHtmlToMarkdown } from "../../../../lib/import-convert";
import { normalizeWpSiteUrl, resolveWpImportDescription, type WpRestPost } from "../../../../lib/wp-rest-types";

export const prerender = false;

function json(o: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers as object) },
  });
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);
  }

  let body: { wpSiteUrl?: string };
  try {
    body = (await context.request.json()) as { wpSiteUrl?: string };
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const base = normalizeWpSiteUrl(body.wpSiteUrl || "");
  if (!base) {
    return json(
      { ok: false, error: "Indica uma URL válida do site WordPress (ex.: https://exemplo.com)." },
      400,
      auth.responseHeaders,
    );
  }

  const apiUrl = `${base}/wp-json/wp/v2/posts?per_page=100&_embed=1`;
  let res: Response;
  try {
    res = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": "BlogCMS-Import/1.0 (+https://github.com)",
      },
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro de rede.";
    return json({ ok: false, error: `Não foi possível contactar a API: ${msg}` }, 502, auth.responseHeaders);
  }

  if (!res.ok) {
    return json(
      {
        ok: false,
        error: `A API WordPress devolveu ${res.status}. Confirma que o site expõe /wp-json/ e que não bloqueia pedidos.`,
      },
      res.status === 404 ? 404 : 502,
      auth.responseHeaders,
    );
  }

  let raw: unknown;
  try {
    const text = await res.text();
    raw = JSON.parse(text) as unknown;
  } catch {
    const contentType = res.headers.get("content-type") || "desconhecido";
    return json(
      {
        ok: false,
        error: `A resposta da API não está em JSON (content-type: ${contentType}). Verifica a URL (use https://...) e se o site expõe /wp-json/wp/v2/posts.`,
      },
      502,
      auth.responseHeaders,
    );
  }

  if (!Array.isArray(raw)) {
    return json({ ok: false, error: "Formato inesperado (esperado array de posts)." }, 502, auth.responseHeaders);
  }

  const posts = (raw as WpRestPost[]).map((p) => {
    const title = stripHtmlToText(p.title?.rendered || "", 500) || `post-${p.id}`;
    const bodyHtml = p.content?.rendered || "";
    const markdown = articleHtmlToMarkdown(bodyHtml);
    const excerptHtml = p.excerpt?.rendered || "";
    const description = resolveWpImportDescription(p, excerptHtml, bodyHtml, title);
    const pubDate = (p.date || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    const slug = (p.slug || "").trim() || `wp-${p.id}`;
    const featured =
      p._embedded?.["wp:featuredmedia"]?.[0]?.source_url?.trim() ||
      undefined;

    return {
      sourceId: p.id,
      slug,
      title,
      description,
      pubDate,
      markdown,
      featuredImageUrl: featured,
      sourceUrl: typeof p.link === "string" ? p.link.trim() || undefined : undefined,
      articleHtml: bodyHtml,
    };
  });

  return json({ ok: true, posts }, 200, auth.responseHeaders);
};
