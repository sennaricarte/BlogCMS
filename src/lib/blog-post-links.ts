/**
 * URLs legadas dos artigos usavam `/blog/<slug>/`. A canónica é `/<slug>/`.
 * A listagem e paginação mantêm-se em `/blog/` e `/blog/page/…` — não alterar.
 */

/** `true` se o caminho deve manter o prefixo `/blog` (índice ou paginação). */
export function isBlogListingOrPaginationPath(pathname: string): boolean {
  const p = pathname.replace(/\/$/, "") || "/";
  if (p === "/blog" || p === "") return true;
  return p.startsWith("/blog/page");
}

/**
 * Converte href path relativo `/blog/artigo/` → `/artigo/`. Devolve o mesmo se não for post legado.
 */
export function normalizeLegacyBlogPostHref(href: string): string {
  const raw = (href || "").trim();
  if (!raw.startsWith("/blog")) return raw;

  try {
    const u = new URL(raw, "https://normalize.invalid");
    const path = u.pathname;
    if (isBlogListingOrPaginationPath(path)) return raw;
    if (!path.startsWith("/blog/")) return raw;
    const rest = path.slice("/blog".length);
    const normalizedPath = rest.startsWith("/") ? rest : `/${rest}`;
    u.pathname = normalizedPath.endsWith("/") ? normalizedPath : `${normalizedPath}/`;
    return u.pathname + u.search + u.hash;
  } catch {
    return raw;
  }
}

/**
 * Substitui em Markdown: `](/blog/slug)`, links absolutos `](https://host/blog/slug)`, e variantes.
 */
export function normalizeLegacyBlogPostMarkdownLinks(md: string): string {
  if (!md || !md.includes("/blog/")) return md;
  let s = md;

  // [text](https://origem/blog/slug/…) — não tocar em …/blog/page/…
  s = s.replace(
    /\]\((https?:\/\/[^/]+)\/blog\/(?!page\/)([^)\]\s]+)\)/gi,
    (_m, origin: string, rest: string) => {
      const path = legacyRestToRootPath(rest);
      return `](${String(origin).replace(/\/$/, "")}${path})`;
    },
  );

  // [text](/blog/slug/…)
  s = s.replace(/\]\(\/blog\/(?!page\/)([^)\]\s]+)\)/g, (_m, rest: string) => {
    return `](${legacyRestToRootPath(rest)})`;
  });

  return s;
}

function legacyRestToRootPath(rest: string): string {
  const t = rest.trim();
  const hashIdx = t.indexOf("#");
  const qIdx = t.indexOf("?");
  let pathPart = t;
  let suffix = "";
  if (hashIdx !== -1) {
    pathPart = t.slice(0, hashIdx);
    suffix = t.slice(hashIdx);
  } else if (qIdx !== -1) {
    pathPart = t.slice(0, qIdx);
    suffix = t.slice(qIdx);
  }
  let slug = pathPart.replace(/^\/+|\/+$/g, "");
  if (!slug) return `/` + suffix;
  const path = `/${slug}/`;
  return path + suffix;
}

/**
 * Normaliza `href` em `<a>` (HTML gerado pelo marked ou colado no TipTap).
 */
export function normalizeLegacyBlogPostAnchorsInHtml(html: string): string {
  if (!html || !html.toLowerCase().includes("href")) return html;
  return html.replace(/<a\b([^>]*?)\s*href\s*=\s*(["'])((?:(?!\2).)*)\2/gi, (_full, attrs: string, quote: string, href: string) => {
    const h = (href || "").trim();
    if (!h.startsWith("/blog")) return `<a${attrs}href=${quote}${href}${quote}`;
    const next = normalizeLegacyBlogPostHref(h);
    if (next === h) return `<a${attrs}href=${quote}${href}${quote}`;
    return `<a${attrs}href=${quote}${next}${quote}`;
  });
}
