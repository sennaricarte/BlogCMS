import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ClientConfig } from "./publisher";
import type { ClientProject } from "./projects-data";
import type { DeployNewSiteResult } from "./orchestrator";
import { preferStableVercelProductionUrl } from "./vercel-public-url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
/** Raiz do repositório em dev / `npm start` a partir do folder do projeto. */
const PROJECTS_RELATIVE = join("src", "data", "projects.json");
const JSON_SPACE = 2;
const UTF8 = "utf-8" as const;

type ProjectsFileShape = { projects: ClientProject[] };

/** Cadeia simples evita leitura/escrita em paralelo no mesmo ficheiro. */
let fileQueue: Promise<unknown> = Promise.resolve();

function withFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(fn, fn);
  fileQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Ficheiro `projects.json` (código-fonte), escrito a partir do servidor de API após deploy.
 * Em `process.cwd()` deve estar a raiz do BlogCMS (com pasta `src/`).
 */
export function getProjectsDataPathForWrite(): string {
  return join(process.cwd(), PROJECTS_RELATIVE);
}

/** Resolução alternativa a partir de `src/lib` (p.ex. se `cwd` for outro). */
function fallbackPathFromThisModule(): string {
  return join(MODULE_DIR, "../data/projects.json");
}

function stableStringify(data: unknown): string {
  return `${JSON.stringify(data, null, JSON_SPACE)}\n`;
}

function parseProjectsJsonRaw(raw: string): ProjectsFileShape {
  const parsed: unknown = JSON.parse(raw) as unknown;
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as ProjectsFileShape).projects)) {
    return parsed as ProjectsFileShape;
  }
  return { projects: [] };
}

/**
 * Lê o ficheiro se existir; `ENOENT` → `null`.
 */
export async function readProjectsFileIfExists(safePath: string): Promise<ProjectsFileShape | null> {
  try {
    const raw = await readFile(safePath, UTF8);
    return parseProjectsJsonRaw(raw);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw e;
  }
}

async function writeProjectsAtomic(
  data: ProjectsFileShape,
  finalPath: string,
): Promise<void> {
  const content = stableStringify(data);
  const dir = dirname(finalPath);
  await mkdir(dir, { recursive: true });
  const tmp = `${finalPath}.tmp-${randomUUID()}`;
  try {
    await writeFile(tmp, content, UTF8);
    await rename(tmp, finalPath);
  } catch (e) {
    try {
      const { unlink } = await import("node:fs/promises");
      await unlink(tmp).catch(() => undefined);
    } catch {
      /* ignore */
    }
    throw e;
  }
}

/**
 * Lê o `projects.json` a partir de `process.cwd()` ou, se necessário, do path relativo a este módulo.
 */
export async function readProjectsData(): Promise<ProjectsFileShape> {
  const primary = getProjectsDataPathForWrite();
  const alt = fallbackPathFromThisModule();
  return (
    (await readProjectsFileIfExists(primary)) ??
    (await readProjectsFileIfExists(alt)) ?? { projects: [] }
  );
}

export async function writeProjectsData(
  data: ProjectsFileShape,
  explicitPath?: string,
): Promise<void> {
  const pathToUse = explicitPath ?? getProjectsDataPathForWrite();
  await writeProjectsAtomic(data, pathToUse);
}

/**
 * Garante ficheiro no path principal do repo; em falta tenta o fallback com o mesmo conteúdo.
 */
export async function writeProjectsDataBestEffort(data: ProjectsFileShape): Promise<void> {
  const primary = getProjectsDataPathForWrite();
  const alt = fallbackPathFromThisModule();
  let lastErr: unknown;
  for (const p of [primary, alt]) {
    try {
      await writeProjectsData(data, p);
      return;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/**
 * Constrói o registo alinhado a `ClientProject` a partir do resultado do deploy.
 */
export function buildClientProjectFromDeploy(args: {
  result: DeployNewSiteResult;
  config: ClientConfig;
  /** Nome do repositório (slug) — fallback do nome a mostrar. */
  repositoryName: string;
  vercelTeamId?: string;
}): ClientProject {
  const { result, config, repositoryName, vercelTeamId } = args;
  const name =
    (config.nomeMarca && String(config.nomeMarca).trim()) || repositoryName.trim() || result.vercelProjectName;
  const siteFromConfig = (config.siteUrl || "").trim();
  const depUrl = (result.vercelDeployment?.url || "").trim();
  const sub = result.vercelProjectName.toLowerCase().replace(/[^a-z0-9-]/g, "-");
  const rawPublic =
    siteFromConfig || depUrl || (sub ? `https://${sub}.vercel.app` : "https://vercel.com");
  const publicUrl = preferStableVercelProductionUrl(rawPublic, result.vercelProjectName);

  return {
    id: randomUUID(),
    name,
    vercelUrl: publicUrl,
    siteUrl: publicUrl,
    githubUrl: result.githubRepositoryUrl,
    createdAt: new Date().toISOString(),
    vercelProjectId: result.vercelProjectId,
    vercelProjectName: result.vercelProjectName,
    vercelScope: result.vercelScope,
    vercelTeamId: (vercelTeamId ?? "").trim(),
    githubRepoFullName: result.githubFullName,
  };
}

/**
 * Adiciona ou substitui (mesmo repositório GitHub ou mesmo projeto Vercel) a entrada.
 */
export async function upsertProjectInRegistry(entry: ClientProject): Promise<ProjectsFileShape> {
  return withFileLock(async () => {
    const data = await readProjectsData();
    const list = data.projects;
    const idx = list.findIndex(
      (p) =>
        p.githubRepoFullName === entry.githubRepoFullName || p.vercelProjectId === entry.vercelProjectId,
    );
    if (idx >= 0) {
      entry = { ...entry, id: list[idx]!.id, createdAt: list[idx]!.createdAt };
      list[idx] = entry;
    } else {
      list.push(entry);
    }
    const next: ProjectsFileShape = { projects: [...list] };
    await writeProjectsDataBestEffort(next);
    return next;
  });
}

/**
 * Chamado após `deployNewSite` concluir com sucesso: persiste em `src/data/projects.json`.
 */
export async function addProjectFromSuccessfulDeploy(input: {
  result: DeployNewSiteResult;
  config: ClientConfig;
  repositoryName: string;
  vercelTeamId?: string;
}): Promise<ClientProject> {
  const entry = buildClientProjectFromDeploy({
    result: input.result,
    config: input.config,
    repositoryName: input.repositoryName,
    vercelTeamId: input.vercelTeamId,
  });
  await upsertProjectInRegistry(entry);
  return entry;
}

/**
 * Remove um projeto do registo por `id` (preferência) ou por chaves estáveis.
 */
export async function removeProjectFromRegistry(match: {
  id?: string;
  githubRepoFullName?: string;
  vercelProjectId?: string;
}): Promise<{ removed: boolean; projects: ClientProject[] }> {
  const id = match.id?.trim();
  const repo = match.githubRepoFullName?.trim();
  const vercelId = match.vercelProjectId?.trim();

  if (!id && !repo && !vercelId) {
    throw new Error("Indica id, githubRepoFullName ou vercelProjectId para remover.");
  }

  return withFileLock(async () => {
    const data = await readProjectsData();
    const prev = data.projects;
    const next = prev.filter((p) => {
      if (id && p.id === id) return false;
      if (repo && p.githubRepoFullName === repo) return false;
      if (vercelId && p.vercelProjectId === vercelId) return false;
      return true;
    });
    const removed = next.length !== prev.length;
    if (removed) {
      await writeProjectsDataBestEffort({ projects: next });
    }
    return { removed, projects: next };
  });
}
