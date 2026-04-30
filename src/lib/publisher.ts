import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubClient, createRepository, type CreateRepositoryResult } from "./github";
import { sleep, withGithubRetry } from "./github-publishing";
import { vercelNewImportUrl } from "./vercel-instant-deploy";

/** Alinhado a `src/data/site-config.json` (identidade, menu, rodapÃ©, SEO). */
export interface SiteConfig {
  nomeMarca: string;
  cores: {
    primaria: string;
    secundaria: string;
  };
  descricaoSeo: string;
  menuLinks: Array<{ label: string; href: string }>;
  /** Links do rodapÃ© (global). */
  footerLinks?: Array<{ label: string; href: string }>;
  /** Texto legal / copyright (HTML nÃ£o permitido; texto simples). */
  footerText?: string;
  /** Redes sociais (rÃ³tulo + URL). */
  socialLinks?: Array<{ label: string; href: string }>;
  siteUrl: string;
  imagemCompartilhamento: string;
  /**
   * Caminho pÃºblico da logÃ³tipo no cabeÃ§alho (ex. `/media/logo.png`).
   * Vazio = mostrar sÃ³ o nome da marca em texto.
   */
  headerLogoUrl?: string;
  /**
   * Caminho pÃºblico do favicon (ex. `/favicon.svg`, `/media/favicon.ico`).
   * Em falta, usa-se `/favicon.svg`.
   */
  faviconUrl?: string;
}

/** @deprecated Use `SiteConfig`; mantido para compatibilidade. */
export type ClientConfig = SiteConfig;

/** Sempre POSIX para comparar com `r` na Ã¡rvore de ficheiros. */
const CONFIG_FILE_IN_TEMPLATE = "src/data/site-config.json";
const DEPLOY_GUIDE_FILE_IN_TEMPLATE = "DEPLOY-VERCEL.md";
const INSTRUCOES_DEPLOY_FILE = "instrucoes-deploy.md";

const IGNORED_DIR_NAMES = new Set([
  ".git",
  ".astro",
  ".cursor",
  ".vscode",
  ".vercel",
  "node_modules",
  "dist",
  "coverage",
  /** CÃ³pia do template para o cliente; nÃ£o incluir na prÃ³pria cÃ³pia. */
  "template-astro",
]);

const IGNORED_FILE_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * ConteÃºdo editorial Ã© especÃ­fico de cada cliente e nÃ£o deve ser copiado
 * para novos repositÃ³rios criados a partir deste template SaaS.
 */
const TEMPLATE_EXCLUDED_PREFIXES = [
  "src/content/blog/",
  "src/content/pages/",
  "scripts/",
];

/**
 * Arquivos Ãºteis no repositÃ³rio SaaS, mas desnecessÃ¡rios no template final do cliente.
 * Mantemos apenas o que Ã© necessÃ¡rio para executar e editar o CMS/site.
 */
const TEMPLATE_EXCLUDED_EXACT_FILES = new Set([
  "vercel.json",
  ".vscode/launch.json",
  "public/tinymce/README.md",
  "public/tinymce/CHANGELOG.md",
  "public/tinymce/package.json",
  "public/tinymce/bower.json",
  "public/tinymce/composer.json",
  "public/tinymce/SECURITY.md",
  "public/tinymce/LICENSE.TXT",
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
  if (!isDirectory && TEMPLATE_EXCLUDED_EXACT_FILES.has(relativePosix)) {
    return true;
  }
  for (const prefix of TEMPLATE_EXCLUDED_PREFIXES) {
    if (relativePosix === prefix.slice(0, -1) || relativePosix.startsWith(prefix)) {
      return true;
    }
  }
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

const ASTRO_CONFIG_FILENAMES = [
  "astro.config.mjs",
  "astro.config.ts",
  "astro.config.js",
  "astro.config.mts",
  "astro.config.cjs",
] as const;

/** Pasta na raiz do BlogCMS com o cÃ³digo-fonte Astro enviado aos repos dos clientes (sem `dist/`). */
export const CLIENT_ASTRO_TEMPLATE_DIR_NAME = "template-astro";

function hasBlogcmsProjectRoot(dir: string): boolean {
  if (!existsSync(join(dir, "package.json"))) return false;
  if (!ASTRO_CONFIG_FILENAMES.some((f) => existsSync(join(dir, f)))) return false;
  /**
   * Na Vercel, `process.cwd()` costuma ser `/var/task` com `package.json` + `astro.config.*` da funÃ§Ã£o,
   * mas **sem** Ã¡rvore `src/` â€” sÃ³ o bundle em `server/`. Exigir o ficheiro de dados evita esse falso positivo.
   */
  if (!existsSync(join(dir, "src", "data", "site-config.json"))) return false;
  return true;
}

/** `template-astro/` empacotada ao lado de `chunks/` na funÃ§Ã£o serverless (NFT). */
function bundledTemplateAstroRoot(): string | null {
  const candidate = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    CLIENT_ASTRO_TEMPLATE_DIR_NAME,
  );
  return hasBlogcmsProjectRoot(candidate) ? candidate : null;
}

/**
 * Gera `./template-astro/` a partir da raiz do BlogCMS (exclusÃµes iguais ao push para o cliente).
 * NÃ£o executa `npm run build`: sÃ³ cÃ³pia de ficheiros-fonte. A Vercel do cliente faz o build.
 */
export async function syncTemplateAstroToProjectRoot(
  log?: { warn: (msg: string) => void },
): Promise<void> {
  const sourceRoot = join(process.cwd());
  if (!hasBlogcmsProjectRoot(sourceRoot)) {
    log?.warn(
      "[sync-template-astro] cwd nÃ£o Ã© a raiz do BlogCMS (falta src/data/site-config.json); cÃ³pia omitida.",
    );
    return;
  }
  const targetRoot = join(sourceRoot, CLIENT_ASTRO_TEMPLATE_DIR_NAME);
  await rm(targetRoot, { recursive: true, force: true });

  const rootAbs = sourceRoot;

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

      const buffer = await readFile(full);
      const dest = join(targetRoot, r);
      await mkdir(dirname(dest), { recursive: true });
      await writeFile(dest, buffer);
    }
  }

  await walk(rootAbs);
}

/**
 * Raiz do template Astro **fonte** enviado ao GitHub do cliente.
 * ProduÃ§Ã£o (Vercel): `template-astro/` incluÃ­da no bundle (NFT). Local: `./template-astro` apÃ³s `npm run sync:template`.
 */
function defaultTemplateRoot(): string {
  const bundled = bundledTemplateAstroRoot();
  if (bundled) {
    return bundled;
  }

  const fromCwd = join(process.cwd(), CLIENT_ASTRO_TEMPLATE_DIR_NAME);
  if (hasBlogcmsProjectRoot(fromCwd)) {
    return fromCwd;
  }

  throw new Error(
    `Pasta "${CLIENT_ASTRO_TEMPLATE_DIR_NAME}" em falta ou incompleta na raiz do BlogCMS. ` +
      `Execute "npm run sync:template" (ou "npm run build", que a corre no prebuild) antes de criar sites.`,
  );
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
  /** Nome do repositÃ³rio (slug), ex.: "site-cliente-xyz". */
  repoName: string;
  /** PAT GitHub; obrigatÃ³rio (nÃ£o lido de `process.env` neste mÃ³dulo). */
  token: string;
  description?: string;
  private?: boolean;
  /**
   * DiretÃ³rio com o cÃ³digo-fonte Astro do cliente.
   * Predefinido: `./template-astro` na raiz do BlogCMS (gerado por `npm run sync:template`).
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
   * Etapas internas: criar repositÃ³rio vazio, depois enviar blobs do template.
   * Usado por `orchestrator` para progresso (UI).
   */
  onPhase?: (e: { phase: "github_create_repo" | "github_upload_template" }) => void;
  /** Sinais de auditoria/UX consumidos por `orchestrator` (sem dados sensÃ­veis). */
  onPipelineLog?: (status: "REPO_CREATED" | "FILES_PUSHED") => void;
}

export interface DeployToClientRepoResult {
  repository: CreateRepositoryResult;
  branch: string;
  commitSha: string;
  htmlUrl: string;
  templateAudit: {
    astroRootDirectory: string;
    hasPackageJsonAtRoot: boolean;
    hasAstroConfigAtRoot: boolean;
  };
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

/** Percorre o template e devolve pares (caminho POSIX no repo, conteÃºdo). */
function buildInstrucoesDeployMarkdown(
  clientConfig: SiteConfig,
  options: { repoName: string; defaultBranch: string; repositoryHtmlUrl: string },
): string {
  const branch = options.defaultBranch || "main";
  const repoUrl = (options.repositoryHtmlUrl || "").trim();
  const clone = vercelNewImportUrl(repoUrl);
  const brand = (clientConfig.nomeMarca || "").trim() || options.repoName;
  return `# InstruÃ§Ãµes â€” ligar este repositÃ³rio Ã  Vercel

Este ficheiro foi gerado automaticamente quando o projeto **${brand}** foi criado no GitHub.

## O que vai acontecer

1. O cÃ³digo deste repositÃ³rio Ã© um projeto **Astro** em cÃ³digo-fonte.
2. A **Vercel** vai instalar dependÃªncias e correr \`npm run build\` na cloud (nÃ£o precisa de build local obrigatÃ³rio).

## Passo 1 â€” Conta na Vercel

1. Aceda a [vercel.com](https://vercel.com) e inicie sessÃ£o (recomendado: mesmo e-mail ou GitHub que usou para criar este repositÃ³rio).

## Passo 2 â€” Importar este repositÃ³rio

**OpÃ§Ã£o A â€” Deploy instantÃ¢neo (clone)**

1. Abra o link (jÃ¡ com o URL do repositÃ³rio):

   **${clone}**

2. Siga o assistente: confirme o nome do projeto na Vercel e clique em **Deploy**.

**OpÃ§Ã£o B â€” Import manual**

1. Aceda a [vercel.com/new](https://vercel.com/new).
2. Escolha **Import Git Repository** e selecione este repositÃ³rio.
3. Branch principal: **${branch}**.

## Passo 3 â€” DefiniÃ§Ãµes de build

- **Root Directory:** deixe vazio (a raiz do repositÃ³rio), salvo se o \`package.json\` estiver noutra pasta.
- **Build Command:** \`npm run build\`
- **Install Command:** \`npm install\`
- **Output Directory:** deixe o padrÃ£o (a Vercel deteta Astro).

## Passo 4 â€” Primeiro deploy

1. Clique em **Deploy** e aguarde o fim do build.
2. Se aparecer erro \`ENOENT\` / \`package.json\`, verifique **Project â†’ Settings â†’ General â†’ Root Directory** (deve apontar para a pasta onde estÃ¡ o \`package.json\`).

## Passo 5 â€” DomÃ­nio

1. Em **Settings â†’ Domains**, adicione o seu domÃ­nio e configure o DNS conforme as instruÃ§Ãµes da Vercel.

## ReferÃªncia

- URL do repositÃ³rio: ${repoUrl || "â€”"}
- Ficheiro complementar na raiz: \`DEPLOY-VERCEL.md\`

---

DÃºvidas: use os logs em **Deployments** na Vercel ou contacte quem lhe entregou o acesso ao BlogCMS.
`;
}

async function loadTemplateFiles(
  templateRoot: string,
  clientConfig: SiteConfig,
  options: { repoName: string; defaultBranch: string; repositoryHtmlUrl: string },
): Promise<Array<{ path: string; buffer: Buffer; encoding: "utf-8" | "base64" }>> {
  const rootAbs = join(templateRoot);
  if (!(await pathExists(rootAbs))) {
    throw new Error(`DiretÃ³rio de template inexistente: ${rootAbs}`);
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
  const deployGuide = buildVercelDeployGuide(clientConfig, options.repoName, options.defaultBranch);
  const deployGuideBuffer = Buffer.from(deployGuide, "utf-8");
  const filtered = out.filter(
    (f) => f.path !== DEPLOY_GUIDE_FILE_IN_TEMPLATE && f.path !== INSTRUCOES_DEPLOY_FILE,
  );
  filtered.push({
    path: DEPLOY_GUIDE_FILE_IN_TEMPLATE,
    buffer: deployGuideBuffer,
    encoding: "utf-8",
  });
  const instrBody = buildInstrucoesDeployMarkdown(clientConfig, options);
  filtered.push({
    path: INSTRUCOES_DEPLOY_FILE,
    buffer: Buffer.from(instrBody, "utf-8"),
    encoding: "utf-8",
  });

  if (filtered.length === 0) {
    throw new Error("Nenhum arquivo encontrado no template. Verifique templateRoot e regras de exclusÃ£o.");
  }
  return filtered;
}

/** Garante que o que sobe para o GitHub do cliente Ã© projeto Astro-fonte (nÃ£o artefactos de build). */
function assertClientRepoMandatoryFiles(files: Array<{ path: string }>): void {
  const paths = new Set(files.map((f) => f.path));
  if (!paths.has("package.json")) {
    throw new Error(`Template: falta package.json na raiz (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
  const hasAstroCfg = ASTRO_CONFIG_FILENAMES.some((f) => paths.has(f));
  if (!hasAstroCfg) {
    throw new Error(`Template: falta astro.config.(mjs|ts|â€¦) na raiz (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
  if (!Array.from(paths).some((p) => p.startsWith("src/"))) {
    throw new Error(`Template: falta pasta src/ com ficheiros (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
  if (!Array.from(paths).some((p) => p.startsWith("public/"))) {
    throw new Error(`Template: falta pasta public/ com ficheiros (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
}

/** Paralelismo moderado para reduzir picos que disparam o rate limit secundÃ¡rio do GitHub. */
const BLOB_CONCURRENCY = 4;

function detectAstroRootDirectory(
  files: Array<{ path: string }>,
): { astroRootDirectory: string; hasPackageJsonAtRoot: boolean; hasAstroConfigAtRoot: boolean } {
  const paths = new Set(files.map((f) => f.path));
  const hasRootPkg = paths.has("package.json");
  const ASTRO_CONFIG_FILES = new Set([
    "astro.config.mjs",
    "astro.config.ts",
    "astro.config.js",
    "astro.config.cjs",
    "astro.config.mts",
  ]);
  const hasRootAstroCfg = Array.from(ASTRO_CONFIG_FILES).some((f) => paths.has(f));
  if (hasRootPkg && hasRootAstroCfg) {
    return {
      astroRootDirectory: ".",
      hasPackageJsonAtRoot: true,
      hasAstroConfigAtRoot: true,
    };
  }

  const pkgDirs = new Set<string>();
  const astroDirs = new Set<string>();
  for (const p of paths) {
    const idx = p.lastIndexOf("/");
    const dir = idx > 0 ? p.slice(0, idx) : ".";
    const base = idx > 0 ? p.slice(idx + 1) : p;
    if (base === "package.json") pkgDirs.add(dir);
    if (ASTRO_CONFIG_FILES.has(base)) astroDirs.add(dir);
  }

  const intersection = Array.from(pkgDirs).filter((d) => astroDirs.has(d));
  if (intersection.length > 0) {
    intersection.sort((a, b) => a.length - b.length);
    return {
      astroRootDirectory: intersection[0]!,
      hasPackageJsonAtRoot: hasRootPkg,
      hasAstroConfigAtRoot: hasRootAstroCfg,
    };
  }

  // Fallback resiliente: nÃ£o bloqueia criaÃ§Ã£o por falso negativo de detecÃ§Ã£o.
  return {
    astroRootDirectory: ".",
    hasPackageJsonAtRoot: hasRootPkg,
    hasAstroConfigAtRoot: hasRootAstroCfg,
  };
}

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
 * Cria um repositÃ³rio no GitHub do usuÃ¡rio autenticado e envia o **cÃ³digo-fonte** do template Astro
 * (pasta `template-astro/`), com `src/data/site-config.json` substituÃ­do por `clientConfig`.
 * NÃ£o executa `npm run build`: o build do site do cliente fica a cargo da Vercel apÃ³s o `git push`.
 *
 * O `options.token` Ã© obrigatÃ³rio (nÃ£o lido de `process.env` nesta funÃ§Ã£o).
 */
export async function deployToClientRepo(
  clientConfig: SiteConfig,
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

  const octokit = createGitHubClient(token);
  const { data: me } = await withGithubRetry(() => octokit.users.getAuthenticated(), { maxAttempts: 2 });
  const owner = me.login;
  if (!options.repoName?.trim()) {
    throw new Error("repoName Ã© obrigatÃ³rio.");
  }
  const repoSlug = options.repoName.trim();
  const repositoryHtmlUrl = `https://github.com/${owner}/${repoSlug}`;

  const files = await loadTemplateFiles(templateRoot, clientConfig, {
    repoName: repoSlug,
    defaultBranch,
    repositoryHtmlUrl,
  });
  assertClientRepoMandatoryFiles(files);
  const templateAudit = detectAstroRootDirectory(files);

  options.onPhase?.({ phase: "github_create_repo" });
  /** `auto_init: true` cria o primeiro commit (README); a API Git recusa blobs em repo sem histÃ³rico (409). */
  const repository = await createRepository({
    token,
    name: repoSlug,
    description: options.description,
    private: options.private ?? true,
    autoInit: true,
  });
  options.onPipelineLog?.("REPO_CREATED");

  /** EspaÃ§o apÃ³s criar o repo para o GitHub processar o primeiro commit (README) e aliviar limites secundÃ¡rios. */
  await sleep(2000);

  options.onPhase?.({ phase: "github_upload_template" });

  const repo = repository.name;

  const { data: repoMeta } = await withGithubRetry(() => octokit.repos.get({ owner, repo }), { maxAttempts: 3 });
  const branchName = repoMeta.default_branch || defaultBranch || "main";

  const { data: defaultBranchData } = await withGithubRetry(
    () => octokit.repos.getBranch({ owner, repo, branch: branchName }),
    { maxAttempts: 3 },
  );
  const parentCommitSha = defaultBranchData.commit.sha;

  const shas = await mapPool(files, BLOB_CONCURRENCY, async (f) => {
    const { data: blob } = await withGithubRetry(
      () =>
        octokit.git.createBlob({
          owner,
          repo,
          content:
            f.encoding === "base64" ? f.buffer.toString("base64") : f.buffer.toString("utf-8"),
          encoding: f.encoding,
        }),
      { maxAttempts: 3 },
    );
    return { path: f.path, sha: blob.sha };
  });

  const { data: tree } = await withGithubRetry(
    () =>
      octokit.git.createTree({
        owner,
        repo,
        tree: shas.map(({ path, sha }) => ({
          path,
          mode: "100644" as const,
          type: "blob" as const,
          sha,
        })),
      }),
    { maxAttempts: 3 },
  );

  const { data: commit } = await withGithubRetry(
    () =>
      octokit.git.createCommit({
        owner,
        repo,
        message: commitMessage,
        tree: tree.sha,
        parents: [parentCommitSha],
      }),
    { maxAttempts: 3 },
  );

  await withGithubRetry(
    () =>
      octokit.git.updateRef({
        owner,
        repo,
        ref: `heads/${branchName}`,
        sha: commit.sha,
      }),
    { maxAttempts: 3 },
  );
  options.onPipelineLog?.("FILES_PUSHED");

  const htmlUrl = `${repository.htmlUrl}/tree/${branchName}`;

  return {
    repository,
    branch: branchName,
    commitSha: commit.sha,
    htmlUrl,
    templateAudit,
  };
}

function buildVercelDeployGuide(
  clientConfig: SiteConfig,
  repoName: string,
  defaultBranch: string,
): string {
  const branch = defaultBranch || "main";
  const brand = (clientConfig.nomeMarca || "").trim() || repoName;
  const siteUrl = (clientConfig.siteUrl || "").trim() || "https://seu-dominio.com";
  return `# Deploy manual na Vercel

Este repositÃ³rio contÃ©m **cÃ³digo-fonte** Astro (nÃ£o artefactos de build). A Vercel instala dependÃªncias e executa o build ao importar o projeto.

## 1) Importar o repositÃ³rio

1. Acesse https://vercel.com/new
2. Selecione o repositÃ³rio \`${repoName}\` no seu GitHub.
3. Confirme a branch principal: \`${branch}\`.

## 2) Root Directory (obrigatÃ³rio verificar)

Na configuraÃ§Ã£o do projeto na Vercel (**Settings â†’ General â†’ Root Directory** ou no assistente de importaÃ§Ã£o):

- Deixe **vazio** (raiz do repositÃ³rio), a menos que o \`package.json\` esteja mesmo numa **subpasta** (monorepo).
- **NÃ£o** use \`./\` nem caminhos relativos com \`../\`.
- O ficheiro \`package.json\` tem de estar **na raiz do repositÃ³rio** que estÃ¡ a importar (confirme no GitHub: pÃ¡gina principal do repo â†’ deve listar \`package.json\`).

Se o Root Directory apontar para uma pasta sem \`package.json\`, o build falha com \`ENOENT ... package.json\`.

## 3) Build and Output Settings

Use estes valores:

- **Root Directory:** vazio (raiz)
- Build Command: \`npm run build\`
- Install Command: \`npm install\`
- Output Directory: deixe em branco (padrÃ£o)

## 4) Environment Variables

Se vocÃª nÃ£o usa variÃ¡veis de ambiente customizadas, deixe vazio.

Se for usar no futuro, adicione em:
\`Vercel > Project > Settings > Environment Variables\`.

## 5) DomÃ­nio

Depois do primeiro deploy:

1. VÃ¡ em \`Settings > Domains\`
2. Adicione seu domÃ­nio principal
3. Atualize DNS conforme instruÃ§Ãµes da Vercel

## 6) ConferÃªncia final

- URL esperada do site: ${siteUrl}
- Nome da marca configurado: ${brand}
- SEO base jÃ¡ vem no arquivo \`src/data/site-config.json\`

## 7) Erro Â«Could not read package.jsonÂ» / ENOENT

Significa que a Vercel estÃ¡ a instalar na **pasta errada**. Corrija:

1. **Project â†’ Settings â†’ General â†’ Root Directory** â†’ apague tudo e guarde (raiz do repo).
2. Confirme no GitHub que o ramo \`${branch}\` tem \`package.json\` na **raiz** do repositÃ³rio.
3. FaÃ§a **Redeploy** do Ãºltimo commit.

---

Se algo falhar no deploy, abra a aba **Deployments** na Vercel e copie o log de erro para suporte.
`;
}

