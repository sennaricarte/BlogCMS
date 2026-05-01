import { ADMIN_CMS_TARGET_KEY } from "./admin-cms-target";
import { buildGitHubRawUrl } from "./github-raw-url";

/**
 * No painel, o TipTap corre em URLs como `/admin/posts/edit/slug/`.
 * Caminhos `../../assets/blog/…` (válidos no .md para Astro) resolvem mal no browser → imagens partidas.
 * Com {@link EditorImagePreviewContext}: reescreve-se para `raw.githubusercontent.com/…` (só visualização).
 * Sem contexto: mantém `/api/admin/cms/repo-asset` (autenticado); o Turndown reverte ao gravar.
 *
 * `blog` → `src/assets/blog/` · `blog-public` → `public/assets/blog/` · `cms` → `public/assets/cms/`
 */
export const ADMIN_REPO_ASSET_PATH = "/api/admin/cms/repo-asset";

/** Dono/repo + ramo para montar URLs raw de pré-visualização no editor (não altera o Markdown guardado). */
export type EditorImagePreviewContext = {
  githubRepoFullName: string;
  branch: string;
};

/**
 * Lê o repositório alvo do CMS (localStorage) ou `PUBLIC_GITHUB_*` no build.
 * Não exige token — só owner/repo para URLs públicas raw.
 */
export function readEditorImagePreviewContext(): EditorImagePreviewContext | null {
  if (typeof localStorage !== "undefined") {
    try {
      const targetRaw = localStorage.getItem(ADMIN_CMS_TARGET_KEY);
      if (targetRaw) {
        const target = JSON.parse(targetRaw) as { githubRepoFullName?: string; branch?: string };
        const githubRepoFullName = target.githubRepoFullName?.trim();
        if (githubRepoFullName && !githubRepoFullName.includes("owner/")) {
          return {
            githubRepoFullName,
            branch: (target.branch || "main").trim() || "main",
          };
        }
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const envRepo = import.meta.env.PUBLIC_GITHUB_REPO_FULL_NAME?.trim();
    if (envRepo && !envRepo.includes("owner/")) {
      const branch = import.meta.env.PUBLIC_GITHUB_BRANCH?.trim() || "main";
      return { githubRepoFullName: envRepo, branch: branch || "main" };
    }
  } catch {
    /* ignore — SSR */
  }
  return null;
}

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

type AssetKind = "src-blog" | "public-blog" | "cms";

function matchEditorAssetSrc(dec: string): { kind: AssetKind; rel: string } | null {
  const ddot = /^\.\.\/\.\.\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (ddot?.[1] && isSafeEditorImageRepoRelPath(ddot[1])) {
    return { kind: "src-blog", rel: ddot[1] };
  }
  const sdot = /^\.\.\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (sdot?.[1] && isSafeEditorImageRepoRelPath(sdot[1])) {
    return { kind: "src-blog", rel: sdot[1] };
  }
  const blogPublic = /^\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (blogPublic?.[1] && isSafeEditorImageRepoRelPath(blogPublic[1])) {
    return { kind: "public-blog", rel: blogPublic[1] };
  }
  const cms = /^\/assets\/cms\/([^?"#]+)$/i.exec(dec);
  if (cms?.[1] && isSafeEditorImageRepoRelPath(cms[1])) {
    return { kind: "cms", rel: cms[1] };
  }
  const absBlog = /^https?:\/\/[^/?#]+\/assets\/blog\/([^?"#]+)$/i.exec(dec);
  if (absBlog?.[1] && isSafeEditorImageRepoRelPath(absBlog[1])) {
    return { kind: "public-blog", rel: absBlog[1] };
  }
  const absCms = /^https?:\/\/[^/?#]+\/assets\/cms\/([^?"#]+)$/i.exec(dec);
  if (absCms?.[1] && isSafeEditorImageRepoRelPath(absCms[1])) {
    return { kind: "cms", rel: absCms[1] };
  }
  return null;
}

function githubRawUrlForMatch(ctx: EditorImagePreviewContext, m: { kind: AssetKind; rel: string }): string | null {
  try {
    if (m.kind === "src-blog") {
      return buildGitHubRawUrl(ctx.githubRepoFullName, ctx.branch, `src/assets/blog/${m.rel}`);
    }
    if (m.kind === "public-blog") {
      return buildGitHubRawUrl(ctx.githubRepoFullName, ctx.branch, `public/assets/blog/${m.rel}`);
    }
    return buildGitHubRawUrl(ctx.githubRepoFullName, ctx.branch, `public/assets/cms/${m.rel}`);
  } catch {
    return null;
  }
}

function repoAssetUrlForMatch(m: { kind: AssetKind; rel: string }): string {
  if (m.kind === "src-blog") {
    return repoAssetForRelPath("blog", m.rel);
  }
  if (m.kind === "public-blog") {
    return repoAssetForRelPath("blog-public", m.rel);
  }
  return repoAssetForRelPath("cms", m.rel);
}

function tryRepoDisplaySrc(src: string, preview: EditorImagePreviewContext | null | undefined): string | null {
  const dec = decodeSrcForMatch(src);
  const hit = matchEditorAssetSrc(dec);
  if (!hit) return null;
  if (preview) {
    const raw = githubRawUrlForMatch(preview, hit);
    if (raw) return raw;
  }
  return repoAssetUrlForMatch(hit);
}

export function rewriteHtmlImagesForAdminEditor(
  html: string,
  previewContext?: EditorImagePreviewContext | null,
): string {
  if (!html || !html.toLowerCase().includes("<img")) return html;
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (_full, attrs: string) => {
    const sm = matchImgSrcAttr(attrs);
    if (!sm) return `<img${attrs}>`;
    const displaySrc = tryRepoDisplaySrc(sm.raw, previewContext);
    if (!displaySrc) return `<img${attrs}>`;
    const newAttrs =
      attrs.slice(0, sm.start) + `src=${sm.quote}${displaySrc}${sm.quote}` + attrs.slice(sm.start + sm.len);
    return `<img${newAttrs}>`;
  });
}
