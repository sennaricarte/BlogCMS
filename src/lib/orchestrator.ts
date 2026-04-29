import { RequestError } from "@octokit/request-error";
import { GithubPublisher, type CreateClientSiteOptions } from "./github-service";
import type { ClientConfig } from "./publisher";

const PREFIX = "[deployNewSite]";

/** Sinais de log de auditoria (sem tokens). A API/Admin pode mapear para a barra de progresso. */
export type DeployPipelineStatus =
  | "REPO_CREATED"
  | "FILES_PUSHED";

function logPipelineStatus(status: DeployPipelineStatus): void {
  console.log(`${PREFIX} ${status}`);
}

/** Textos para o UI (admin / stream de progresso). */
export const DEPLOY_PROGRESS_UI = {
  github_creating_repo: "Criando Repositório no seu GitHub...",
  github_injecting_template: "Injetando Template e SEO Config...",
} as const;

export type DeployProgressCode =
  | "github_creating_repo"
  | "github_injecting_template";

export interface DeployProgressEvent {
  code: DeployProgressCode;
  userMessage: string;
  /** Alinha a UI (cores por etapa) com os sinais `REPO_*` / `VERCEL_*` / `DEPLOY_*`. */
  pipelineStatus?: DeployPipelineStatus;
}

function log(step: string, detail?: string): void {
  const line = detail ? `${PREFIX} ${step} — ${detail}` : `${PREFIX} ${step}`;
  console.log(line);
}

function delayMs(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function emitProgress(
  onProgress: ((e: DeployProgressEvent) => void) | undefined,
  code: DeployProgressCode,
  pipelineStatus?: DeployPipelineStatus,
): void {
  const userMessage =
    code === "github_creating_repo"
      ? DEPLOY_PROGRESS_UI.github_creating_repo
      : DEPLOY_PROGRESS_UI.github_injecting_template;
  onProgress?.({ code, userMessage, pipelineStatus });
}

/** Dados necessários para criar o site no GitHub. */
export interface DeployNewSiteClientData {
  /** Nome do novo repositório GitHub (slug). */
  repositoryName: string;
  /** Conteúdo escrito em `src/data/site-config.json` no template. */
  config: ClientConfig;
  /** Opções extra do `GithubPublisher.createClientSite` (privacidade, template, etc.). */
  github?: CreateClientSiteOptions;
  /** Mantido por compatibilidade com payloads antigos; não é usado neste fluxo. */
  vercel?: { vercelProjectName?: string; teamId?: string; rootDirectory?: string };
}

/** Resultado agregado com URL do GitHub. */
export interface DeployNewSiteResult {
  /** Página principal do repositório no GitHub. */
  githubRepositoryUrl: string;
  /** `utilizador/repo` (útil para a API Vercel). */
  githubFullName: string;
  /** URL do ramo no GitHub (árvore de ficheiros), como no passo de deploy. */
  githubTreeUrl: string;
  /** Commit inicial do template. */
  githubCommitSha: string;
  /** Mantido por compatibilidade; fica vazio no fluxo GitHub-only. */
  vercelProjectId: string;
  /** Mantido por compatibilidade; fica vazio se não for enviado no payload. */
  vercelProjectName: string;
  /** Mantido por compatibilidade; não é calculado no fluxo GitHub-only. */
  vercelProjectUrl?: string;
  /** Mantido por compatibilidade; ausente no fluxo GitHub-only. */
  vercelDeployment?: undefined;
  /** Mantido por compatibilidade; ausente no fluxo GitHub-only. */
  vercel?: undefined;
  /** Mantido por compatibilidade; vazio no fluxo GitHub-only. */
  vercelScope: string;
  /** Auditoria do template usado para criar o repositório no GitHub. */
  templateAudit: {
    astroRootDirectory: string;
    hasPackageJsonAtRoot: boolean;
    hasAstroConfigAtRoot: boolean;
  };
}

/** Tokens de um cliente (multi-tenant). Não fazer `console.log` destes valores. */
export interface ClientTargetTokens {
  githubToken: string;
  /** Mantido por compatibilidade; ignorado no fluxo GitHub-only. */
  vercelToken?: string;
  /** Mantido por compatibilidade; ignorado no fluxo GitHub-only. */
  vercelTeamId?: string;
}

export interface DeployNewSiteOptions {
  /**
   * Obrigatório salvo se injetar `githubPublisher` (ex.: testes).
   * Os tokens vêm do pedido (front-end / API); o orquestrador não instancia com `new GithubPublisher()` vazio.
   */
  targetTokens?: ClientTargetTokens;
  /** Injecção (testes): se não fornecer, use `targetTokens`. */
  githubPublisher?: GithubPublisher;
  /**
   * Chamado a cada fase do GitHub. Não regista credenciais.
   */
  onProgress?: (e: DeployProgressEvent) => void;
}

/** Só publicadores (alias útil; `DeployNewSiteOptions` é `+ targetTokens?`). */
export type DeployNewSiteDependencies = Omit<DeployNewSiteOptions, "targetTokens">;

/**
 * Indica se o erro de orquestração corresponde a credenciais inválidas (HTTP 401 no pedido a GitHub ou Vercel).
 */
export function isInvalidTokenError(e: unknown): boolean {
  if (e instanceof RequestError) {
    return e.status === 401 || e.status === 403;
  }
  return false;
}

/**
 * Orquestra: criar repo GitHub + push do template (fluxo GitHub-only).
 */
export async function deployNewSite(
  clientData: DeployNewSiteClientData,
  options?: DeployNewSiteOptions,
): Promise<DeployNewSiteResult> {
  const onProgress = options?.onProgress;
  const repoName = clientData.repositoryName?.trim();
  if (!repoName) {
    throw new Error(`${PREFIX} «repositoryName» é obrigatório.`);
  }

  const hasGh = Boolean(options?.githubPublisher);
  let github: GithubPublisher;
  if (hasGh) {
    github = options!.githubPublisher!;
  } else {
    const tt = options?.targetTokens;
    if (!tt?.githubToken?.trim()) {
      throw new Error(
        `${PREFIX} «targetTokens.githubToken» não vazio é obrigatório (a API passa as credenciais do cliente; não leia o .env nas classes de serviço).`,
      );
    }
    github = new GithubPublisher({ token: tt.githubToken });
  }

  log("1/1 Iniciando: criar repositório no GitHub e enviar o template Astro com site-config.json personalizado…");

  const ghResult = await github.createClientSite(repoName, clientData.config, {
    ...clientData.github,
    onPhase: (p) => {
      if (p.phase === "github_create_repo") {
        emitProgress(onProgress, "github_creating_repo");
      } else {
        emitProgress(onProgress, "github_injecting_template");
      }
    },
    onPipelineLog: (status) => {
      logPipelineStatus(status);
      if (status === "REPO_CREATED") {
        onProgress?.({
          code: "github_creating_repo",
          userMessage: "Repositório GitHub criado.",
          pipelineStatus: "REPO_CREATED",
        });
      } else {
        onProgress?.({
          code: "github_injecting_template",
          userMessage: "Ficheiros do template e SEO enviados para o repositório.",
          pipelineStatus: "FILES_PUSHED",
        });
      }
    },
  });

  log(
    "1/1 Concluído: repositório GitHub disponível.",
    `${ghResult.repository.fullName} @ ${ghResult.commitSha.slice(0, 7)} (${ghResult.branch})`,
  );
  console.log(`${PREFIX}      ↳ ${ghResult.repository.htmlUrl}`);

  log("Fluxo concluído com sucesso (GitHub-only).");

  return {
    githubRepositoryUrl: ghResult.repository.htmlUrl,
    githubFullName: ghResult.repository.fullName,
    githubTreeUrl: ghResult.htmlUrl,
    githubCommitSha: ghResult.commitSha,
    vercelProjectId: "",
    vercelProjectName: (clientData.vercel?.vercelProjectName || "").trim(),
    vercelProjectUrl: undefined,
    vercelDeployment: undefined,
    vercel: undefined,
    vercelScope: "",
    templateAudit: ghResult.templateAudit,
  };
}
