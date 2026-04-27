import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubClient, createRepository, type CreateRepositoryResult } from "./github";

/** Alinhado a `src/data/client-config.json`. */
export interface ClientConfig {
  nomeMarca: string;
  cores: {
    primaria: string;
    secundaria: string;
  };
  descricaoSeo: string;
  menuLinks: Array<{ label: string; href: string }>;
  /** Links do rodapé (global). */
  footerLinks?: Array<{ label: string; href: string }>;
  /** Texto legal / copyright (HTML não permitido; texto simples). */
  footerText?: string;
  siteUrl: string;
  imagemCompartilhamento: string;
}

/** Sempre POSIX para comparar com `r` na árvore de ficheiros. */
const CONFIG_FILE_IN_TEMPLATE = "src/data/client-config.json";

const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".astro",
  ".cursor",
  ".vscode",
  "node_modules",
  "dist",
  "coverage",
]);

const IGNORED_FILE_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

const BINARY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".eot",
  ".ttf",
  ".pdf",
  ".zip",
  ".gz",
  ".mp4",
  ".webm",
  ".mp3",
  ".wasm",
]);

function shouldSkipRelativePath(relativePosix: string, isDirectory: boolean): boolean {
  const segments = relativePosix.split("/").filter(Boolean);
  for (const seg of segments) {
    if (IGNORED_DIR_NAMES.has(seg)) return true;
  }
  if (isDirectory) return false;
  const base = segments[segments.length - 1] ?? "";
  if (IGNORED_FILE_NAMES.has(base)) return true;
  if (base === ".env" || base.startsWith(".env.")) return true;
  if (base.endsWith(".log")) return true;
  return false;
}

function defaultTemplateRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "../..");
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

export interface DeployToClientRepoOptions {
  /** Nome do repositório (slug), ex.: "site-cliente-xyz". */
  repoName: string;
  /** PAT GitHub; obrigatório (não lido de `process.env` neste módulo). */
  token: string;
  description?: string;
  private?: boolean;
  /**
   * Diretório com os arquivos do template (cópia do projeto).
   * Predefinido: raiz do repositório atual, respeitando pastas ignoradas.
   */
  templateRoot?: string;
  /**
   * Ramo inicial (GitHub costuma usar `main`).
   * @default "main"
   */
  defaultBranch?: string;
  /**
   * Mensagem do commit inicial.
   * @default "chore: deploy client template"
   */
  commitMessage?: string;
  /**
   * Etapas internas: criar repositório vazio, depois enviar blobs do template.
   * Usado por `orchestrator` para progresso (UI).
   */
  onPhase?: (e: { phase: "github_create_repo" | "github_upload_template" }) => void;
  /** Sinais de auditoria/UX consumidos por `orchestrator` (sem dados sensíveis). */
  onPipelineLog?: (status: "REPO_CREATED" | "FILES_PUSHED") => void;
}

export interface DeployToClientRepoResult {
  repository: CreateRepositoryResult;
  branch: string;
  commitSha: string;
  htmlUrl: string;
}

function requireGithubToken(override: string | undefined, context: string): string {
  const t = (override ?? "").trim();
  if (!t) {
    throw new Error(`PAT em falta: ${context}.`);
  }
  return t;
}

function isBinaryFile(path: string, buffer: Buffer): boolean {
  const ext = path.includes(".")
    ? path.slice(path.lastIndexOf(".")).toLowerCase()
    : "";
  if (BINARY_EXTENSIONS.has(ext)) return true;
  if (ext === ".lock") return true;
  const slice = buffer.subarray(0, Math.min(8000, buffer.length));
  return slice.includes(0);
}

/** Percorre o template e devolve pares (caminho POSIX no repo, conteúdo). */
async function loadTemplateFiles(
  templateRoot: string,
  clientConfig: ClientConfig,
): Promise<Array<{ path: string; buffer: Buffer; encoding: "utf-8" | "base64" }>> {
  const rootAbs = join(templateRoot);
  if (!(await pathExists(rootAbs))) {
    throw new Error(`Diretório de template inexistente: ${rootAbs}`);
  }

  const out: Array<{ path: string; buffer: Buffer; encoding: "utf-8" | "base64" }> = [];

  async function walk(currentAbs: string): Promise<void> {
    const rel = relative(rootAbs, currentAbs);
    const relPosix = rel.split(sep).join("/");
    if (relPosix !== "" && shouldSkipRelativePath(relPosix, (await stat(currentAbs)).isDirectory())) {
      return;
    }

    const entries = await readdir(currentAbs, { withFileTypes: true });
    for (const ent of entries) {
      const full = join(currentAbs, ent.name);
      const r = relative(rootAbs, full).split(sep).join("/");
      if (ent.isDirectory()) {
        if (!shouldSkipRelativePath(r, true)) {
          await walk(full);
        }
        continue;
      }
      if (shouldSkipRelativePath(r, false)) continue;

      if (r === CONFIG_FILE_IN_TEMPLATE) {
        const body = JSON.stringify(clientConfig, null, 2) + "\n";
        out.push({ path: r, buffer: Buffer.from(body, "utf-8"), encoding: "utf-8" });
        continue;
      }

      const buffer = await readFile(full);
      const binary = isBinaryFile(ent.name, buffer);
      out.push({
        path: r,
        buffer,
        encoding: binary ? "base64" : "utf-8",
      });
    }
  }

  await walk(rootAbs);
  if (out.length === 0) {
    throw new Error("Nenhum arquivo encontrado no template. Verifique templateRoot e regras de exclusão.");
  }
  return out;
}

const BLOB_CONCURRENCY = 8;

async function mapPool<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let i = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const idx = i++;
      if (idx >= items.length) return;
      results[idx] = await fn(items[idx], idx);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

/**
 * Cria um repositório no GitHub do usuário autenticado e envia o conteúdo do template
 * com `src/data/client-config.json` substituído por `clientConfig`.
 *
 * O `options.token` é obrigatório (não lido de `process.env` nesta função).
 */
export async function deployToClientRepo(
  clientConfig: ClientConfig,
  options: DeployToClientRepoOptions,
): Promise<DeployToClientRepoResult> {
  const token = requireGithubToken(
    options.token,
    "passe `token` em `deployToClientRepo` (ex.: a partir de `GithubPublisher`)",
  );
  const templateRoot = options.templateRoot
    ? join(options.templateRoot)
    : defaultTemplateRoot();
  const defaultBranch = options.defaultBranch?.trim() || "main";
  const commitMessage = options.commitMessage?.trim() || "chore: deploy client template";

  const files = await loadTemplateFiles(templateRoot, clientConfig);
  const octokit = createGitHubClient(token);

  const { data: me } = await octokit.users.getAuthenticated();
  const owner = me.login;
  if (!options.repoName?.trim()) {
    throw new Error("repoName é obrigatório.");
  }

  options.onPhase?.({ phase: "github_create_repo" });
  /** `auto_init: true` cria o primeiro commit (README); a API Git recusa blobs em repo sem histórico (409). */
  const repository = await createRepository({
    token,
    name: options.repoName.trim(),
    description: options.description,
    private: options.private ?? true,
    autoInit: true,
  });
  options.onPipelineLog?.("REPO_CREATED");

  options.onPhase?.({ phase: "github_upload_template" });

  const repo = repository.name;

  const { data: repoMeta } = await octokit.repos.get({ owner, repo });
  const branchName = repoMeta.default_branch || defaultBranch || "main";

  const { data: defaultBranchData } = await octokit.repos.getBranch({
    owner,
    repo,
    branch: branchName,
  });
  const parentCommitSha = defaultBranchData.commit.sha;

  const shas = await mapPool(files, BLOB_CONCURRENCY, async (f) => {
    const { data: blob } = await octokit.git.createBlob({
      owner,
      repo,
      content:
        f.encoding === "base64" ? f.buffer.toString("base64") : f.buffer.toString("utf-8"),
      encoding: f.encoding,
    });
    return { path: f.path, sha: blob.sha };
  });

  const { data: tree } = await octokit.git.createTree({
    owner,
    repo,
    tree: shas.map(({ path, sha }) => ({
      path,
      mode: "100644" as const,
      type: "blob" as const,
      sha,
    })),
  });

  const { data: commit } = await octokit.git.createCommit({
    owner,
    repo,
    message: commitMessage,
    tree: tree.sha,
    parents: [parentCommitSha],
  });

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: commit.sha,
  });
  options.onPipelineLog?.("FILES_PUSHED");

  const htmlUrl = `${repository.htmlUrl}/tree/${branchName}`;

  return {
    repository,
    branch: branchName,
    commitSha: commit.sha,
    htmlUrl,
  };
}
