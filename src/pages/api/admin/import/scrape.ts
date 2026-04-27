import type { APIRoute } from "astro";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import {
  articleHtmlToMarkdown,
  extractArticleHtml,
  extractMetaFromPage,
} from "../../../../lib/import-convert";

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

  let body: { articleUrl?: string };
  try {
    body = (await context.request.json()) as { articleUrl?: string };
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const url = (body.articleUrl || "").trim();
  if (!url || !/^https?:\/\//i.test(url)) {
    return json({ ok: false, error: "Indica uma URL absoluta (https://…)." }, 400, auth.responseHeaders);
  }

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "User-Agent": "BlogCMS-Import/1.0 (+https://github.com)",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro de rede.";
    return json({ ok: false, error: msg }, 502, auth.responseHeaders);
  }

  if (!res.ok) {
    return json({ ok: false, error: `O servidor devolveu HTTP ${res.status}.` }, 502, auth.responseHeaders);
  }

  const html = await res.text();
  const fragment = extractArticleHtml(html);
  if (!fragment) {
    return json(
      {
        ok: false,
        error: "Não foi encontrado conteúdo em <article> nem em <main>. Abre uma página de artigo comum.",
      },
      422,
      auth.responseHeaders,
    );
  }

  const meta = extractMetaFromPage(html);
  const markdown = articleHtmlToMarkdown(fragment);
  const ogImage = html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1]?.trim();

  const slugGuess =
    url
      .split("/")
      .filter(Boolean)
      .pop()
      ?.replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9-]+/gi, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || `import-${Date.now()}`;

  return json(
    {
      ok: true,
      post: {
        slug: slugGuess,
        title: meta.title,
        description: meta.description.slice(0, 160),
        pubDate: new Date().toISOString().slice(0, 10),
        markdown,
        featuredImageUrl: ogImage,
      },
    },
    200,
    auth.responseHeaders,
  );
};
