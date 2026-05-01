/**
 * No painel, o TipTap corre em URLs como `/admin/posts/edit/slug/`.
 * Caminhos `../../assets/blog/…` (válidos no .md para Astro) resolvem mal no browser → imagens partidas.
 * Reescreve temporariamente para `/api/admin/cms/repo-asset` (autenticado); o Turndown reverte ao gravar.
 *
 * `blog` → `src/assets/blog/` · `blog-public` → `public/assets/blog/` · `cms` → `public/assets/cms/`
 */
export const ADMIN_REPO_ASSET_PATH = "/api/admin/cms/repo-asset";

/**
 * Caminho relativo seguro dentro de `src/assets/blog`, `public/assets/blog` ou `public/assets/cms`:
 * vários segmentos permitidos, sem `..`, só caracteres seguros por segmento.
 */
export function isSafeEditorImageRepoRelPath(rel: string): boolean {
  const t = (rel || "").trim().replace(/\\/g, "/");
  if (!t || t.startsWith("/") || t.includes("..")) return false;
  const parts = t.split("/").filter(Boolean);
  if (parts.length === 0) return false;
  for (const p of parts) {
    if (!/^[a-zA-Z0-9._-]+$/.test(p)) return false;
  }
  return /\.(jpe?g|png|gif|webp|svg|avif)$/i.test(parts[parts.length - 1] ?? "");
}

/**
 * Ajusta `<img src>` no HTML do TipTap para URLs que o browser consegue carregar no admin.
 */
function decodeSrcForMatch(src: string): string {
  try {
    return decodeURIComponent(src);
  } catch {
    return src;
  }
}

type SrcMatch = { start: number; len: number; quote: string; raw: string };

function matchImgSrcAttr(attrs: string): SrcMatch | null {
  const quoted = /\bsrc\s*=\s*(["'])((?:(?!\1).)*)\1/i.exec(attrs);
  if (quoted && quoted.index !== undefined) {
    return { start: quoted.index, len: quoted[0].length, quote: quoted[1], raw: quoted[2].trim() };
  }
  const bare = /\bsrc\s*=\s*([^\s>]+)/i.exec(attrs);
  if (bare && bare.index !== undefined) {
    return { start: bare.index, len: bare[0].length, quote: '"', raw: bare[1].trim() };
  }
  return null;
}

function repoAssetForRelPath(scope: "blog" | "blog-public" | "cms", relPath: string): string {
  return `${ADMIN_REPO_ASSET_PATH}?scope=${scope}&file=${encodeURIComponent(relPath)}`;
}

function tryRepoDisplaySrc(src: string): string | null {
  const dec = decodeSrcForMatch(src);

  const ddot = /^\.\.\/\.\.\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (ddot?.[1] && isSafeEditorImageRepoRelPath(ddot[1])) {
    return repoAssetForRelPath("blog", ddot[1]);
  }

  const sdot = /^\.\.\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (sdot?.[1] && isSafeEditorImageRepoRelPath(sdot[1])) {
    return repoAssetForRelPath("blog", sdot[1]);
  }

  const blogPublic = /^\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (blogPublic?.[1] && isSafeEditorImageRepoRelPath(blogPublic[1])) {
    return repoAssetForRelPath("blog-public", blogPublic[1]);
  }

  const cms = /^\/assets\/cms\/([^?"#]+)$/i.exec(dec);
  if (cms?.[1] && isSafeEditorImageRepoRelPath(cms[1])) {
    return repoAssetForRelPath("cms", cms[1]);
  }

  return null;
}

export function rewriteHtmlImagesForAdminEditor(html: string): string {
  if (!html || !html.toLowerCase().includes("<img")) return html;
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (_full, attrs: string) => {
    const sm = matchImgSrcAttr(attrs);
    if (!sm) return `<img${attrs}>`;
    const displaySrc = tryRepoDisplaySrc(sm.raw);
    if (!displaySrc) return `<img${attrs}>`;
    const newAttrs =
      attrs.slice(0, sm.start) + `src=${sm.quote}${displaySrc}${sm.quote}` + attrs.slice(sm.start + sm.len);
    return `<img${newAttrs}>`;
  });
}
