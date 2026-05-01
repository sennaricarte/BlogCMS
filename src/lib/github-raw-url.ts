import { parseOwnerRepo } from "./github-parse-repo";

const MEDIA_PREFIX = "src/assets/media/";

/**
 * URL pública `raw.githubusercontent.com` para pré-visualizar ficheiros
 * (repositórios privados: o browser só carrega a imagem com token, que não colocamos na URL;
 * o fluxo do CMS partilha o repositório alvo; para privados, use GitHub + deploy com assets).
 */
export function buildGitHubRawUrl(
  githubRepoFullName: string,
  branch: string,
  pathInRepo: string,
): string {
  const { owner, repo } = parseOwnerRepo(githubRepoFullName);
  const ref = (branch || "main").trim() || "main";
  const p = pathInRepo.replace(/^\/+/, "");
  return `https://raw.githubusercontent.com/${owner}/${repo}/${encodeURIComponent(ref)}/${p}`;
}

/** Caminho no repositório, ex. `src/assets/media/foto.jpg` */
export function repoPathForMediaFile(fileName: string): string {
  const n = (fileName || "").replace(/^\/+/, "");
  return `${MEDIA_PREFIX}${n}`.replace(/\/+/g, "/");
}

/** Uso no Markdown a partir de `src/content/blog/*.md` (ou `pages/`) */
export const MEDIA_MARKDOWN_RELATIVE_PREFIX = "../../assets/media/" as const;

export function mediaMarkdownPath(fileName: string): string {
  const n = (fileName || "").replace(/^\/+/, "");
  return `${MEDIA_MARKDOWN_RELATIVE_PREFIX}${n}`;
}

export function isRawGithubMediaPath(url: string): boolean {
  const u = (url || "").trim();
  if (!u || !u.includes("raw.githubusercontent.com")) {
    return false;
  }
  return /src\/assets\/media\//i.test(u);
}

/** Pré-visualização no editor: imagens mapeadas a partir de `public/assets/blog|cms` ou `src/assets/blog` no repo. */
export function isRawGithubBlogOrCmsPreviewUrl(url: string): boolean {
  return githubRawAssetToMarkdownRelative(url) !== null;
}

/**
 * Converte URL `raw.githubusercontent.com/owner/repo/ref/...` para o caminho usado no Markdown guardado.
 * - `public/assets/blog/x` → `/assets/blog/x`
 * - `src/assets/blog/x` → `../../assets/blog/x`
 * - `public/assets/cms/x` → `/assets/cms/x`
 */
export function githubRawAssetToMarkdownRelative(src: string): string | null {
  const raw = (src || "").trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    if (u.hostname !== "raw.githubusercontent.com") return null;
    const segments = u.pathname
      .split("/")
      .filter(Boolean)
      .map((seg) => {
        try {
          return decodeURIComponent(seg);
        } catch {
          return seg;
        }
      });
    if (segments.length < 4) return null;
    const rest = segments.slice(3).join("/");
    const prefixBlogPub = "public/assets/blog/";
    const prefixBlogSrc = "src/assets/blog/";
    const prefixCms = "public/assets/cms/";
    if (rest.startsWith(prefixBlogPub)) {
      return `/assets/blog/${rest.slice(prefixBlogPub.length)}`;
    }
    if (rest.startsWith(prefixBlogSrc)) {
      return `../../assets/blog/${rest.slice(prefixBlogSrc.length)}`;
    }
    if (rest.startsWith(prefixCms)) {
      return `/assets/cms/${rest.slice(prefixCms.length)}`;
    }
    return null;
  } catch {
    return null;
  }
}
