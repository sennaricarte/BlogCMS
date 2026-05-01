/**
 * No painel, o TipTap corre em URLs como `/admin/posts/edit/slug/`.
 * Caminhos `../../assets/blog/…` (válidos no .md para Astro) resolvem mal no browser → imagens partidas.
 * Reescreve temporariamente para `/api/admin/cms/repo-asset` (autenticado); o Turndown reverte ao gravar.
 *
 * `blog` → `src/assets/blog/` · `blog-public` → `public/assets/blog/` · `cms` → `public/assets/cms/`
 */
export const ADMIN_REPO_ASSET_PATH = "/api/admin/cms/repo-asset";

/** Um único segmento de ficheiro (sem path). */
export function isSafeEditorAssetFileName(name: string): boolean {
  const n = (name || "").trim();
  if (!n || n.includes("/") || n.includes("\\") || n.includes("..")) return false;
  return /^[a-zA-Z0-9._-]+\.(jpe?g|png|gif|webp|svg|avif)$/i.test(n);
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

export function rewriteHtmlImagesForAdminEditor(html: string): string {
  if (!html || !html.toLowerCase().includes("<img")) return html;
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (_full, attrs: string) => {
    const srcMatch = /\bsrc\s*=\s*(["'])((?:(?!\1).)*)\1/i.exec(attrs);
    if (!srcMatch) return `<img${attrs}>`;
    const quote = srcMatch[1];
    const rawSrc = srcMatch[2].trim();
    const src = decodeSrcForMatch(rawSrc);

    const blogRel = /^\.\.\/\.\.\/assets\/blog\/([^?"#]+)$/i.exec(src);
    if (blogRel?.[1] && isSafeEditorAssetFileName(blogRel[1])) {
      const displaySrc = `${ADMIN_REPO_ASSET_PATH}?scope=blog&file=${encodeURIComponent(blogRel[1])}`;
      return `<img${attrs.replace(/\bsrc\s*=\s*(["'])(?:(?!\1).)*\1/i, `src=${quote}${displaySrc}${quote}`)}>`;
    }

    const blogPublicRoot = /^\/assets\/blog\/([^?"#]+)$/i.exec(src);
    if (blogPublicRoot?.[1] && isSafeEditorAssetFileName(blogPublicRoot[1])) {
      const displaySrc = `${ADMIN_REPO_ASSET_PATH}?scope=blog-public&file=${encodeURIComponent(blogPublicRoot[1])}`;
      return `<img${attrs.replace(/\bsrc\s*=\s*(["'])(?:(?!\1).)*\1/i, `src=${quote}${displaySrc}${quote}`)}>`;
    }

    const cmsRoot = /^\/assets\/cms\/([^?"#]+)$/i.exec(src);
    if (cmsRoot?.[1] && isSafeEditorAssetFileName(cmsRoot[1])) {
      const displaySrc = `${ADMIN_REPO_ASSET_PATH}?scope=cms&file=${encodeURIComponent(cmsRoot[1])}`;
      return `<img${attrs.replace(/\bsrc\s*=\s*(["'])(?:(?!\1).)*\1/i, `src=${quote}${displaySrc}${quote}`)}>`;
    }

    return `<img${attrs}>`;
  });
}
