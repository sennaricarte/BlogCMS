import { ADMIN_CMS_TARGET_KEY } from "./admin-cms-target";
import { ADMIN_INTEGRATION_STORAGE_KEY } from "./admin-storage";
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
 * PAT do GitHub (localStorage) só para anexar `?token=` em URLs `raw.githubusercontent.com`
 * (repos privados). O token fica visível nas DevTools — alternativa: repo público ou proxy.
 */
export function readEditorGithubPatForImagePreview(): string | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(ADMIN_INTEGRATION_STORAGE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { GITHUB_PERSONAL_TOKEN?: string };
    return j.GITHUB_PERSONAL_TOKEN?.trim() || null;
  } catch {
    return null;
  }
}

function appendTokenForRawGithubOnly(url: string, githubToken: string | null | undefined): string {
  if (!githubToken?.trim() || !url.includes("raw.githubusercontent.com")) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(githubToken.trim())}`;
}

/**
 * URL de pré-visualização no editor: `raw.githubusercontent.com/.../public/assets/...` (ou `src/assets/blog/...`)
 * a partir de caminhos canónicos `/assets/…` ou `../../assets/blog/…`. Com token opcional para repo privado.
 */
export function getDisplayUrl(
  src: string,
  ctx: EditorImagePreviewContext | null | undefined,
  githubToken?: string | null,
): string {
  const s = (src || "").trim();
  if (!s) return s;
  if (s.startsWith("data:")) return s;
  if (/^https?:\/\//i.test(s)) {
    return appendTokenForRawGithubOnly(s, githubToken ?? null);
  }
  const dec = decodeSrcForMatch(s);
  const hit = matchEditorAssetSrc(dec);
  if (!hit) return s;
  let base: string;
  if (ctx) {
    const raw = githubRawUrlForMatch(ctx, hit);
    base = raw ?? repoAssetUrlForMatch(hit);
  } else {
    base = repoAssetUrlForMatch(hit);
  }
  return appendTokenForRawGithubOnly(base, githubToken ?? null);
}

function canonicalPathForEditorAssetMatch(m: { kind: "src-blog" | "public-blog" | "cms"; rel: string }): string {
  if (m.kind === "src-blog") {
    return `../../assets/blog/${m.rel}`;
  }
  if (m.kind === "public-blog") {
    return `/assets/blog/${m.rel}`;
  }
  return `/assets/cms/${m.rel}`;
}

function matchAttrInTag(attrs: string, name: string): string | null {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])((?:(?!\\1).)*)\\1`, "i");
  const qm = quoted.exec(attrs);
  if (qm?.[2] != null) return qm[2].trim();
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i");
  const bm = bare.exec(attrs);
  if (bm?.[1]) return bm[1].replace(/^["']|["']$/g, "").trim();
  return null;
}

/**
 * Antes do Turndown: repõe `src` a partir de `data-src` (pré-visualização) para não gravar URL raw no .md.
 */
export function normalizeEditorImagesForSave(html: string): string {
  if (!html || !/<img\b/i.test(html)) return html;
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (full, attrs: string) => {
    const data = matchAttrInTag(attrs, "data-src");
    if (!data) return full;
    let canon = data;
    try {
      canon = decodeURIComponent(data);
    } catch {
      /* manter data */
    }
    if (!canon.startsWith("/assets/") && !canon.startsWith("..")) return full;
    let rest = attrs
      .replace(/\sdata-src\s*=\s*(["'])((?:(?!\1).)*)\1/gi, "")
      .replace(/\sdata-src\s*=\s*[^\s>]+/gi, "");
    rest = rest
      .replace(/\bsrc\s*=\s*(["'])((?:(?!\1).)*)\1/gi, "")
      .replace(/\bsrc\s*=\s*[^\s>]+/gi, "");
    const q = '"';
    const safe = canon.replace(/"/g, "&quot;");
    return `<img src=${q}${safe}${q}${rest.trim() ? ` ${rest.trim()}` : ""}>`;
  });
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

export function rewriteHtmlImagesForAdminEditor(
  html: string,
  previewContext?: EditorImagePreviewContext | null,
): string {
  if (!html || !html.toLowerCase().includes("<img")) return html;
  const token =
    typeof localStorage !== "undefined" ? readEditorGithubPatForImagePreview() : null;
  return html.replace(/<img\b([^>]*?)\s*\/?>/gi, (_full, attrs: string) => {
    const sm = matchImgSrcAttr(attrs);
    if (!sm) return `<img${attrs}>`;
    const dec = decodeSrcForMatch(sm.raw);
    const hit = matchEditorAssetSrc(dec);
    if (!hit) return `<img${attrs}>`;
    const canon = canonicalPathForEditorAssetMatch(hit);
    const displaySrc = getDisplayUrl(sm.raw, previewContext ?? null, token);
    const newAttrs =
      attrs.slice(0, sm.start) +
      `src=${sm.quote}${displaySrc}${sm.quote} data-src=${sm.quote}${canon}${sm.quote}` +
      attrs.slice(sm.start + sm.len);
    return `<img${newAttrs}>`;
  });
}
