import { RequestError } from "@octokit/request-error";
import { GithubPublisher, type CreateClientSiteOptions } from "./github-service";
import type { ClientConfig } from "./publisher";
import {
  VercelApiError,
  VercelService,
  type VercelCreateProjectResult,
  type TriggerProductionDeploymentResult,
} from "./vercel-service";

const PREFIX = "[deployNewSite]";

/**
 * Pausa fixa após o push GitHub, antes de chamar a Vercel. Sem isto, a API Vercel pode tentar
 * ligar o projeto ao repositório antes do GitHub servir a árvore/último commit, gerando
 * `DEPLOYMENT_NOT_FOUND` / 404 e falhas intermitentes no primeiro deploy.
 */
const POST_GITHUB_TO_VERCEL_DELAY_MS = 8_000;

const RETRY_VERCEL_PROJECT_DELAY_MS = 3_000;

/** Sinais de log de auditoria (sem tokens). A API/Admin pode mapear para a barra de progresso. */
export type DeployPipelineStatus =
  | "REPO_CREATED"
  | "FILES_PUSHED"
  | "PROPAGATION_WAIT"
  | "VERCEL_CONNECTED"
  | "DEPLOY_STARTED";

function logPipelineStatus(status: DeployPipelineStatus): void {
  console.log(`${PREFIX} ${status}`);
}

/** Textos para o UI (admin / stream de progresso). */
export const DEPLOY_PROGRESS_UI = {
  github_creating_repo: "Criando Repositório no seu GitHub...",
  github_injecting_template: "Injetando Template e SEO Config...",
  propagation_wait: "Aguardando propagação (8 segundos) antes da Vercel…",
  vercel_connecting: "Conectando à sua conta Vercel...",
} as const;

export type DeployProgressCode =
  | "github_creating_repo"
  | "github_injecting_template"
  | "propagation_wait"
  | "vercel_connecting";

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
      : code === "github_injecting_template"
        ? DEPLOY_PROGRESS_UI.github_injecting_template
        : code === "propagation_wait"
          ? DEPLOY_PROGRESS_UI.propagation_wait
          : DEPLOY_PROGRESS_UI.vercel_connecting;
  onProgress?.({ code, userMessage, pipelineStatus });
}

function isRetryableVercelProjectError(e: unknown): boolean {
  return e instanceof VercelApiError && e.status >= 500;
}

/** Dados necessários para criar o site no GitHub e ligar na Vercel. */
export interface DeployNewSiteClientData {
  /** Nome do novo repositório GitHub (slug). */
  repositoryName: string;
  /** Conteúdo escrito em `src/data/site-config.json` no template. */
  config: ClientConfig;
  /** Opções extra do `GithubPublisher.createClientSite` (privacidade, template, etc.). */
  github?: CreateClientSiteOptions;
  /** Nome do projeto na Vercel e/ou equipa (`teamId`). */
  vercel?: { vercelProjectName?: string; teamId?: string };
}

/** Resultado agregado com URL do GitHub e identificação / URL do projeto Vercel. */
export interface DeployNewSiteResult {
  /** Página principal do repositório no GitHub. */
  githubRepositoryUrl: string;
  /** `utilizador/repo` (útil para a API Vercel). */
  githubFullName: string;
  /** URL do ramo no GitHub (árvore de ficheiros), como no passo de deploy. */
  githubTreeUrl: string;
  /** Commit inicial do template. */
  githubCommitSha: string;
  /** ID do projeto na Vercel (ex.: `prj_…`). */
  vercelProjectId: string;
  /** Nome do projeto na Vercel. */
  vercelProjectName: string;
  /** URL devolvida pela API, se existir (dashboard / projeto). */
  vercelProjectUrl?: string;
  /** Primeiro deploy de produção (API `POST /v13/deployments`), se tiver sucesso. */
  vercelDeployment?: TriggerProductionDeploymentResult;
  /** Resposta bruta da Vercel (framework, ligação Git, etc.). */
  vercel: VercelCreateProjectResult;
  /** `username` (conta) ou `slug` (equipa) para links `vercel.com/{scope}/…`. */
  vercelScope: string;
}

/** Tokens de um cliente (multi-tenant). Não fazer `console.log` destes valores. */
export interface ClientTargetTokens {
  githubToken: string;
  vercelToken: string;
  /** Equipa Vercel `team_…`, opcional; conta pessoal se omitido. */
  vercelTeamId?: string;
}

export interface DeployNewSiteOptions {
  /**
   * Obrigatório salvo se injetar **ambos** `githubPublisher` e `vercelService` (ex.: testes).
   * Os tokens vêm do pedido (front-end / API); o orquestrador não instancia com `new GithubPublisher()` vazio.
   */
  targetTokens?: ClientTargetTokens;
  /** Injecção (testes): se fornecer um, forneça o outro; caso contrário use `targetTokens`. */
  githubPublisher?: GithubPublisher;
  vercelService?: VercelService;
  /**
   * Chamado a cada fase (GitHub, pausa, Vercel). Não regista credenciais.
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
  if (e instanceof VercelApiError) {
    return e.status === 401 || e.status === 403;
  }
  return false;
}

/**
 * Orquestra: (1) criar repo GitHub + push do template; (2) pausa fixa 8s; (3) Vercel + deploy.
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
  const hasVercel = Boolean(options?.vercelService);
  if (hasGh !== hasVercel) {
    throw new Error(
      `${PREFIX} forneça «targetTokens» **ou** injete **ambos** «githubPublisher» e «vercelService».`,
    );
  }

  let github: GithubPublisher;
  let vercel: VercelService;
  if (hasGh && hasVercel) {
    github = options!.githubPublisher!;
    vercel = options!.vercelService!;
  } else {
    const tt = options?.targetTokens;
    if (!tt?.githubToken?.trim() || !tt?.vercelToken?.trim()) {
      throw new Error(
        `${PREFIX} «targetTokens» com «githubToken» e «vercelToken» não vazios é obrigatório (a API passa as credenciais do cliente; não leia o .env nas classes de serviço).`,
      );
    }
    github = new GithubPublisher({ token: tt.githubToken });
    vercel = new VercelService({ token: tt.vercelToken, teamId: tt.vercelTeamId });
  }

  log("1/3 Iniciando: criar repositório no GitHub e enviar o template Astro com site-config.json personalizado…");

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
    "1/3 Concluído: repositório GitHub disponível.",
    `${ghResult.repository.fullName} @ ${ghResult.commitSha.slice(0, 7)} (${ghResult.branch})`,
  );
  console.log(`${PREFIX}      ↳ ${ghResult.repository.htmlUrl}`);

  log(
    `Pausa de ${POST_GITHUB_TO_VERCEL_DELAY_MS / 1000}s após o push: evita 404 / DEPLOYMENT_NOT_FOUND ` +
      "enquanto o GitHub processa a árvore e a Vercel ainda lê o remote.",
  );
  emitProgress(onProgress, "propagation_wait", "PROPAGATION_WAIT");
  await new Promise<void>((resolve) => {
    setTimeout(resolve, POST_GITHUB_TO_VERCEL_DELAY_MS);
  });

  emitProgress(onProgress, "vercel_connecting");
  log("2/3 A ligar o repositório na Vercel (framework Astro) e a pedir o primeiro deploy…");

  const teamId = clientData.vercel?.teamId ?? options?.targetTokens?.vercelTeamId;

  let vercelResult: VercelCreateProjectResult;
  try {
    vercelResult = await vercel.createProjectForGithubRepository(ghResult.repository.fullName, {
      vercelProjectName: clientData.vercel?.vercelProjectName,
      teamId,
    });
  } catch (e) {
    if (isRetryableVercelProjectError(e)) {
      log("Aviso: primeira criação do projeto Vercel falhou (5xx). Nova tentança após 3s…", String((e as Error).message));
      await delayMs(RETRY_VERCEL_PROJECT_DELAY_MS);
      vercelResult = await vercel.createProjectForGithubRepository(ghResult.repository.fullName, {
        vercelProjectName: clientData.vercel?.vercelProjectName,
        teamId,
      });
    } else {
      throw e;
    }
  }
  logPipelineStatus("VERCEL_CONNECTED");
  onProgress?.({
    code: "vercel_connecting",
    userMessage: "Projeto Vercel associado ao repositório GitHub.",
    pipelineStatus: "VERCEL_CONNECTED",
  });

  log(
    "2/3 Concluído: projeto Vercel criado e repositório associado.",
    `id=${vercelResult.id} nome=«${vercelResult.name}»`,
  );
  if (vercelResult.url) {
    console.log(`${PREFIX}      ↳ ${vercelResult.url}`);
  }

  const [ghOwner, ghRepo] = ghResult.repository.fullName.split("/");
  let vercelDeployment: TriggerProductionDeploymentResult | undefined;
  try {
    logPipelineStatus("DEPLOY_STARTED");
    onProgress?.({
      code: "vercel_connecting",
      userMessage: "A lançar deploy de produção…",
      pipelineStatus: "DEPLOY_STARTED",
    });
    log("2.5/3 A disparar deploy de produção (evita subdomínio `DEPLOYMENT_NOT_FOUND` sem DPL)…");
    vercelDeployment = await vercel.triggerProductionDeployment({
      vercelProjectId: vercelResult.id,
      projectName: vercelResult.name,
      owner: ghOwner!,
      repo: ghRepo!,
      ref: ghResult.branch,
      teamId,
    });
    if (vercelDeployment.url) {
      console.log(`${PREFIX}      ↳ ${vercelDeployment.url}`);
    } else if (vercelDeployment.id) {
      console.log(`${PREFIX}      ↳ deploy id: ${vercelDeployment.id} (estado: ${vercelDeployment.readyState ?? "—"})`);
    }
  } catch (e) {
    console.warn(
      `${PREFIX} Aviso: o disparo do deploy via API falhou. No dashboard: Deployments → Redeploy (main), ou aguarda o build do Git.`,
      e,
    );
  }

  log("3/3 Fluxo concluído com sucesso.");

  const vercelScope = await vercel.getVercelDashboardScope();

  return {
    githubRepositoryUrl: ghResult.repository.htmlUrl,
    githubFullName: ghResult.repository.fullName,
    githubTreeUrl: ghResult.htmlUrl,
    githubCommitSha: ghResult.commitSha,
    vercelProjectId: vercelResult.id,
    vercelProjectName: vercelResult.name,
    vercelProjectUrl: vercelResult.url,
    vercelDeployment,
    vercel: vercelResult,
    vercelScope,
  };
}
