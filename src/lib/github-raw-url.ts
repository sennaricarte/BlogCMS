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
