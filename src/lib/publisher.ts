import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createGitHubClient, createRepository, type CreateRepositoryResult } from "./github";
import { sleep, withGithubRetry } from "./github-publishing";
import { vercelNewCloneUrl } from "./vercel-instant-deploy";

/** Alinhado a `src/data/site-config.json` (identidade, menu, rodapé, SEO). */
export interface SiteConfig {
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
  /** Redes sociais (rótulo + URL). */
  socialLinks?: Array<{ label: string; href: string }>;
  siteUrl: string;
  imagemCompartilhamento: string;
  /**
   * Caminho público da logótipo no cabeçalho (ex. `/media/logo.png`).
   * Vazio = mostrar só o nome da marca em texto.
   */
  headerLogoUrl?: string;
  /**
   * Caminho público do favicon (ex. `/favicon.svg`, `/media/favicon.ico`).
   * Em falta, usa-se `/favicon.svg`.
   */
  faviconUrl?: string;
}

/** @deprecated Use `SiteConfig`; mantido para compatibilidade. */
export type ClientConfig = SiteConfig;

/** Sempre POSIX para comparar com `r` na árvore de ficheiros. */
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
  /** Cópia do template para o cliente; não incluir na própria cópia. */
  "template-astro",
]);

const IGNORED_FILE_NAMES = new Set([
  ".DS_Store",
  "Thumbs.db",
]);

/**
 * Conteúdo editorial é específico de cada cliente e não deve ser copiado
 * para novos repositórios criados a partir deste template SaaS.
 */
const TEMPLATE_EXCLUDED_PREFIXES = [
  "src/content/blog/",
  "src/content/pages/",
  "scripts/",
];

/**
 * Arquivos úteis no repositório SaaS, mas desnecessários no template final do cliente.
 * Mantemos apenas o que é necessário para executar e editar o CMS/site.
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

/** Pasta na raiz do BlogCMS com o código-fonte Astro enviado aos repos dos clientes (sem `dist/`). */
export const CLIENT_ASTRO_TEMPLATE_DIR_NAME = "template-astro";

function hasBlogcmsProjectRoot(dir: string): boolean {
  if (!existsSync(join(dir, "package.json"))) return false;
  if (!ASTRO_CONFIG_FILENAMES.some((f) => existsSync(join(dir, f)))) return false;
  /**
   * Na Vercel, `process.cwd()` costuma ser `/var/task` com `package.json` + `astro.config.*` da função,
   * mas **sem** árvore `src/` — só o bundle em `server/`. Exigir o ficheiro de dados evita esse falso positivo.
   */
  if (!existsSync(join(dir, "src", "data", "site-config.json"))) return false;
  return true;
}

/** `template-astro/` empacotada ao lado de `chunks/` na função serverless (NFT). */
function bundledTemplateAstroRoot(): string | null {
  const candidate = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    CLIENT_ASTRO_TEMPLATE_DIR_NAME,
  );
  return hasBlogcmsProjectRoot(candidate) ? candidate : null;
}

/**
 * Gera `./template-astro/` a partir da raiz do BlogCMS (exclusões iguais ao push para o cliente).
 * Não executa `npm run build`: só cópia de ficheiros-fonte. A Vercel do cliente faz o build.
 */
export async function syncTemplateAstroToProjectRoot(
  log?: { warn: (msg: string) => void },
): Promise<void> {
  const sourceRoot = join(process.cwd());
  if (!hasBlogcmsProjectRoot(sourceRoot)) {
    log?.warn(
      "[sync-template-astro] cwd não é a raiz do BlogCMS (falta src/data/site-config.json); cópia omitida.",
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
 * Produção (Vercel): `template-astro/` incluída no bundle (NFT). Local: `./template-astro` após `npm run sync:template`.
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
  /** Nome do repositório (slug), ex.: "site-cliente-xyz". */
  repoName: string;
  /** PAT GitHub; obrigatório (não lido de `process.env` neste módulo). */
  token: string;
  description?: string;
  private?: boolean;
  /**
   * Diretório com o código-fonte Astro do cliente.
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

/** Percorre o template e devolve pares (caminho POSIX no repo, conteúdo). */
function buildInstrucoesDeployMarkdown(
  clientConfig: SiteConfig,
  options: { repoName: string; defaultBranch: string; repositoryHtmlUrl: string },
): string {
  const branch = options.defaultBranch || "main";
  const repoUrl = (options.repositoryHtmlUrl || "").trim();
  const clone = vercelNewCloneUrl(repoUrl);
  const brand = (clientConfig.nomeMarca || "").trim() || options.repoName;
  return `# Instruções — ligar este repositório à Vercel

Este ficheiro foi gerado automaticamente quando o projeto **${brand}** foi criado no GitHub.

## O que vai acontecer

1. O código deste repositório é um projeto **Astro** em código-fonte.
2. A **Vercel** vai instalar dependências e correr \`npm run build\` na cloud (não precisa de build local obrigatório).

## Passo 1 — Conta na Vercel

1. Aceda a [vercel.com](https://vercel.com) e inicie sessão (recomendado: mesmo e-mail ou GitHub que usou para criar este repositório).

## Passo 2 — Importar este repositório

**Opção A — Deploy instantâneo (clone)**

1. Abra o link (já com o URL do repositório):

   **${clone}**

2. Siga o assistente: confirme o nome do projeto na Vercel e clique em **Deploy**.

**Opção B — Import manual**

1. Aceda a [vercel.com/new](https://vercel.com/new).
2. Escolha **Import Git Repository** e selecione este repositório.
3. Branch principal: **${branch}**.

## Passo 3 — Definições de build

- **Root Directory:** deixe vazio (a raiz do repositório), salvo se o \`package.json\` estiver noutra pasta.
- **Build Command:** \`npm run build\`
- **Install Command:** \`npm install\`
- **Output Directory:** deixe o padrão (a Vercel deteta Astro).

## Passo 4 — Primeiro deploy

1. Clique em **Deploy** e aguarde o fim do build.
2. Se aparecer erro \`ENOENT\` / \`package.json\`, verifique **Project → Settings → General → Root Directory** (deve apontar para a pasta onde está o \`package.json\`).

## Passo 5 — Domínio

1. Em **Settings → Domains**, adicione o seu domínio e configure o DNS conforme as instruções da Vercel.

## Referência

- URL do repositório: ${repoUrl || "—"}
- Ficheiro complementar na raiz: \`DEPLOY-VERCEL.md\`

---

Dúvidas: use os logs em **Deployments** na Vercel ou contacte quem lhe entregou o acesso ao BlogCMS.
`;
}

async function loadTemplateFiles(
  templateRoot: string,
  clientConfig: SiteConfig,
  options: { repoName: string; defaultBranch: string; repositoryHtmlUrl: string },
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
    throw new Error("Nenhum arquivo encontrado no template. Verifique templateRoot e regras de exclusão.");
  }
  return filtered;
}

/** Garante que o que sobe para o GitHub do cliente é projeto Astro-fonte (não artefactos de build). */
function assertClientRepoMandatoryFiles(files: Array<{ path: string }>): void {
  const paths = new Set(files.map((f) => f.path));
  if (!paths.has("package.json")) {
    throw new Error(`Template: falta package.json na raiz (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
  const hasAstroCfg = ASTRO_CONFIG_FILENAMES.some((f) => paths.has(f));
  if (!hasAstroCfg) {
    throw new Error(`Template: falta astro.config.(mjs|ts|…) na raiz (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
  if (!Array.from(paths).some((p) => p.startsWith("src/"))) {
    throw new Error(`Template: falta pasta src/ com ficheiros (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
  if (!Array.from(paths).some((p) => p.startsWith("public/"))) {
    throw new Error(`Template: falta pasta public/ com ficheiros (pasta ${CLIENT_ASTRO_TEMPLATE_DIR_NAME}).`);
  }
}

/** Paralelismo moderado para reduzir picos que disparam o rate limit secundário do GitHub. */
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

  // Fallback resiliente: não bloqueia criação por falso negativo de detecção.
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
 * Cria um repositório no GitHub do usuário autenticado e envia o **código-fonte** do template Astro
 * (pasta `template-astro/`), com `src/data/site-config.json` substituído por `clientConfig`.
 * Não executa `npm run build`: o build do site do cliente fica a cargo da Vercel após o `git push`.
 *
 * O `options.token` é obrigatório (não lido de `process.env` nesta função).
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
    throw new Error("repoName é obrigatório.");
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
  /** `auto_init: true` cria o primeiro commit (README); a API Git recusa blobs em repo sem histórico (409). */
  const repository = await createRepository({
    token,
    name: repoSlug,
    description: options.description,
    private: options.private ?? true,
    autoInit: true,
  });
  options.onPipelineLog?.("REPO_CREATED");

  /** Espaço após criar o repo para o GitHub processar o primeiro commit (README) e aliviar limites secundários. */
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

Este repositório contém **código-fonte** Astro (não artefactos de build). A Vercel instala dependências e executa o build ao importar o projeto.

## 1) Importar o repositório

1. Acesse https://vercel.com/new
2. Selecione o repositório \`${repoName}\` no seu GitHub.
3. Confirme a branch principal: \`${branch}\`.

## 2) Root Directory (obrigatório verificar)

Na configuração do projeto na Vercel (**Settings → General → Root Directory** ou no assistente de importação):

- Deixe **vazio** (raiz do repositório), a menos que o \`package.json\` esteja mesmo numa **subpasta** (monorepo).
- **Não** use \`./\` nem caminhos relativos com \`../\`.
- O ficheiro \`package.json\` tem de estar **na raiz do repositório** que está a importar (confirme no GitHub: página principal do repo → deve listar \`package.json\`).

Se o Root Directory apontar para uma pasta sem \`package.json\`, o build falha com \`ENOENT ... package.json\`.

## 3) Build and Output Settings

Use estes valores:

- **Root Directory:** vazio (raiz)
- Build Command: \`npm run build\`
- Install Command: \`npm install\`
- Output Directory: deixe em branco (padrão)

## 4) Environment Variables

Se você não usa variáveis de ambiente customizadas, deixe vazio.

Se for usar no futuro, adicione em:
\`Vercel > Project > Settings > Environment Variables\`.

## 5) Domínio

Depois do primeiro deploy:

1. Vá em \`Settings > Domains\`
2. Adicione seu domínio principal
3. Atualize DNS conforme instruções da Vercel

## 6) Conferência final

- URL esperada do site: ${siteUrl}
- Nome da marca configurado: ${brand}
- SEO base já vem no arquivo \`src/data/site-config.json\`

## 7) Erro «Could not read package.json» / ENOENT

Significa que a Vercel está a instalar na **pasta errada**. Corrija:

1. **Project → Settings → General → Root Directory** → apague tudo e guarde (raiz do repo).
2. Confirme no GitHub que o ramo \`${branch}\` tem \`package.json\` na **raiz** do repositório.
3. Faça **Redeploy** do último commit.

---

Se algo falhar no deploy, abra a aba **Deployments** na Vercel e copie o log de erro para suporte.
`;
}
