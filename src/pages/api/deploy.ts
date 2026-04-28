import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import type { ClientConfig } from "../../lib/publisher";
import { GithubPublisher } from "../../lib/github-service";
import {
  deployNewSite,
  isInvalidTokenError,
  type DeployProgressEvent,
} from "../../lib/orchestrator";
import { VercelApiError, VercelService } from "../../lib/vercel-service";
import { addProjectFromSuccessfulDeploy } from "../../lib/project-manager";

export const prerender = false;

type ClientDataPayload = {
  repositoryName?: string;
  config?: ClientConfig;
  github?: { private?: boolean; description?: string };
  vercel?: { vercelProjectName?: string; teamId?: string; rootDirectory?: string };
};

type DeployRequestBody = {
  /** Tokens: só no corpo, processados no servidor. */
  githubToken?: string;
  vercelToken?: string;
  vercelTeamId?: string;
  /**
   * Forma recomendada: `clientData` agrupa o slug, `config` (SEO) e opções.
   * Campos no topo (`repositoryName`, `config`…) permanecem como atalhos retrocompatíveis.
   */
  clientData?: ClientDataPayload;
  repositoryName?: string;
  config?: ClientConfig;
  github?: { private?: boolean; description?: string };
  vercel?: { vercelProjectName?: string; teamId?: string; rootDirectory?: string };
};

function jsonError(message: string, status: number, extra?: Record<string, string>): Response {
  return new Response(
    JSON.stringify({ error: message, ...extra }),
    { status, headers: { "Content-Type": "application/json; charset=utf-8" } },
  );
}

const NDJSON = "application/x-ndjson; charset=utf-8";

/**
 * Opção B (infra do cliente): orquestração no servidor. Tokens vêm no corpo e não vão em logs.
 * Respostas: JSON com 401 se credenciais inválidas na pré-checagem, ou `application/x-ndjson` com progresso + resultado.
 */
export const POST: APIRoute = async ({ request }) => {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: DeployRequestBody;
  try {
    body = (await request.json()) as DeployRequestBody;
  } catch {
    return jsonError("Corpo JSON inválido.", 400);
  }

  const githubToken = body.githubToken?.trim();
  const vercelToken = body.vercelToken?.trim();
  const cd = body.clientData;
  const repositoryName =
    (cd?.repositoryName?.trim() || body.repositoryName?.trim()) ?? "";
  const teamFromRoot = body.vercelTeamId?.trim();
  const teamFromNested = cd?.vercel?.teamId?.trim() || body.vercel?.teamId?.trim();
  const vercelTeamId = teamFromNested || teamFromRoot || undefined;
  const config = cd?.config ?? body.config;
  const githubOptions = cd?.github ?? body.github;
  const vercelOptions = cd?.vercel ?? body.vercel;

  if (!githubToken || !vercelToken) {
    return jsonError("Os tokens GitHub e Vercel são obrigatórios.", 400);
  }
  if (!repositoryName) {
    return jsonError("Indica o nome do repositório (clientData.repositoryName ou repositoryName).", 400);
  }
  if (!config || typeof config !== "object") {
    return jsonError("O objeto «config» (site-config / SEO) é obrigatório (em clientData ou no topo).", 400);
  }

  try {
    const gh = new GithubPublisher({ token: githubToken });
    await gh.verifyConnection();
  } catch (e) {
    if (e instanceof RequestError && (e.status === 401 || e.status === 403)) {
      return jsonError(
        "O token do GitHub foi recusado (401). Revisa o PAT nas definições: escopos e expiração.",
        401,
        { field: "github" },
      );
    }
    return jsonError(
      e instanceof Error ? e.message : "Falha na validação do token GitHub.",
      502,
    );
  }

  try {
    const vs = new VercelService({ token: vercelToken, teamId: vercelTeamId ?? null });
    await vs.verifyConnection();
  } catch (e) {
    if (e instanceof VercelApiError && (e.status === 401 || e.status === 403)) {
      return jsonError(
        "O token da Vercel (ou a equipa indicada) foi recusado. Revisa a chave e o Team ID (401).",
        401,
        { field: "vercel" },
      );
    }
    return jsonError(
      e instanceof Error ? e.message : "Falha na validação do token Vercel.",
      502,
    );
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const line = (obj: Record<string, unknown>) => {
        controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      };

      try {
        const result = await deployNewSite(
          {
            repositoryName,
            config: config as ClientConfig,
            github: githubOptions,
            vercel: vercelOptions,
          },
          {
            targetTokens: {
              githubToken,
              vercelToken,
              vercelTeamId,
            },
            onProgress: (e: DeployProgressEvent) => {
              line({
                type: "progress" as const,
                code: e.code,
                message: e.userMessage,
                pipelineStatus: e.pipelineStatus,
              });
            },
          },
        );

        let projectsUpdate: { status: "saved"; id: string; name: string } | { status: "error"; message: string };
        try {
          const entry = await addProjectFromSuccessfulDeploy({
            result,
            config: config as ClientConfig,
            repositoryName,
            vercelTeamId,
          });
          projectsUpdate = { status: "saved", id: entry.id, name: entry.name };
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          console.error("[api/deploy] Falha a atualizar src/data/projects.json:", message);
          projectsUpdate = { status: "error", message };
        }

        line({
          type: "complete" as const,
          result: {
            githubRepositoryUrl: result.githubRepositoryUrl,
            githubFullName: result.githubFullName,
            githubTreeUrl: result.githubTreeUrl,
            githubCommitSha: result.githubCommitSha,
            vercelProjectId: result.vercelProjectId,
            vercelProjectName: result.vercelProjectName,
            vercelProjectUrl: result.vercelProjectUrl,
            vercelScope: result.vercelScope,
            vercelDeployment: result.vercelDeployment,
            vercel: result.vercel,
            templateAudit: result.templateAudit,
          },
          projectsUpdate,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Erro desconhecido no deploy.";
        if (isInvalidTokenError(e)) {
          line({
            type: "error" as const,
            httpStatus: 401,
            message:
              "Credenciais recusadas durante o deploy. Revisa o token do GitHub e o da Vercel (401 Unauthorized).",
          });
        } else {
          line({ type: "error" as const, httpStatus: 500, message });
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": NDJSON, "Cache-Control": "no-store" },
  });
};
