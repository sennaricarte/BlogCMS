import type { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";

/** PAT sem acesso à API (org/SSO/escopos). */
export class GitHubPublishingPermissionError extends Error {
  readonly httpStatus: number;

  constructor(message: string, httpStatus: number) {
    super(message);
    this.name = "GitHubPublishingPermissionError";
    this.httpStatus = httpStatus;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function responseMessage(error: RequestError): string {
  const data = error.response?.data as { message?: string } | undefined;
  const fromData = typeof data?.message === "string" ? data.message : "";
  return `${error.message || ""} ${fromData}`.toLowerCase();
}

/** Limite primário (429), secundário (403) ou erro temporário do GitHub. */
export function isRetriableGithubRateLimitError(error: unknown): boolean {
  if (!(error instanceof RequestError)) return false;
  if (error.status === 429) return true;
  if (error.status !== undefined && error.status >= 500) return true;
  if (error.status === 403) {
    const m = responseMessage(error);
    return (
      m.includes("secondary rate limit") ||
      m.includes("abuse detection mechanism") ||
      m.includes("rate limit exceeded") ||
      m.includes("too many requests") ||
      m.includes("temporarily blocked")
    );
  }
  return false;
}

function parseRetryAfterSeconds(error: RequestError): number | null {
  const raw = error.response?.headers?.["retry-after"] ?? error.response?.headers?.["Retry-After"];
  if (raw == null) return null;
  const n = Number(String(raw).trim());
  return Number.isFinite(n) && n > 0 ? Math.min(n, 120) : null;
}

/** Espera sugerida antes de repetir o pedido (cap 120s). */
export function getGithubRetryDelayMs(error: unknown, attemptIndex: number): number {
  const base = 2000 + attemptIndex * 1500;
  if (error instanceof RequestError) {
    const ra = parseRetryAfterSeconds(error);
    if (ra != null) return Math.min(ra * 1000, 120_000);
  }
  return Math.min(base, 60_000);
}

/**
 * Repete a operação em caso de rate limit / erro temporário do GitHub.
 * Não repete 401, 422 (nome duplicado), etc.
 */
export async function withGithubRetry<T>(
  operation: () => Promise<T>,
  options?: { maxAttempts?: number; operationLabel?: string },
): Promise<T> {
  const maxAttempts = options?.maxAttempts ?? 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await operation();
    } catch (e) {
      lastError = e;
      if (!isRetriableGithubRateLimitError(e) || attempt >= maxAttempts) {
        throw e;
      }
      const delay = getGithubRetryDelayMs(e, attempt);
      await sleep(delay);
    }
  }
  throw lastError;
}

/**
 * Confirma que o PAT consegue usar a API (utilizador + endpoint de rate limit, leitura).
 * Falhas 401/403 → mensagem fixa para o utilizador (org / SSO / escopos).
 */
export async function validateGitHubPublishingToken(octokit: Octokit): Promise<{ login: string }> {
  try {
    const { data } = await octokit.rest.users.getAuthenticated();
    const login = data.login;
    await octokit.rest.rateLimit.get();
    return { login };
  } catch (e) {
    if (e instanceof RequestError && (e.status === 401 || e.status === 403)) {
      throw new GitHubPublishingPermissionError(
        "Erro de Permissão: Autorize seu Token no GitHub (definições da organização, SSO ou escopos «repo») e volte a tentar.",
        e.status,
      );
    }
    throw e;
  }
}

const RATE_LIMIT_USER_MESSAGE =
  "O GitHub está a processar muitos pedidos. Por favor, aguarde cerca de 2 minutos e tente novamente.";

/** Mensagem segura para mostrar no painel (sem detalhes técnicos longos). */
export function mapGithubErrorToUserMessage(error: unknown): { httpStatus: number; message: string } {
  if (error instanceof GitHubPublishingPermissionError) {
    return { httpStatus: error.httpStatus, message: error.message };
  }
  if (error instanceof RequestError) {
    if (error.status === 401) {
      return {
        httpStatus: 401,
        message:
          "O GitHub recusou o token. Confirme que o PAT não expirou e que tem os escopos necessários (ex.: «repo»).",
      };
    }
    if (isRetriableGithubRateLimitError(error) || error.status === 429) {
      return { httpStatus: 429, message: RATE_LIMIT_USER_MESSAGE };
    }
    if (error.status === 403) {
      return {
        httpStatus: 403,
        message:
          "Erro de Permissão: Autorize seu Token no GitHub (organização, SSO ou permissões de repositório).",
      };
    }
  }
  const raw = error instanceof Error ? error.message : String(error);
  if (/rate limit|secondary|abuse|too many requests/i.test(raw)) {
    return { httpStatus: 429, message: RATE_LIMIT_USER_MESSAGE };
  }
  return {
    httpStatus: 500,
    message: "Não foi possível concluir o pedido no GitHub. Tente novamente dentro de alguns minutos.",
  };
}
