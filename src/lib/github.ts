import { Octokit } from "@octokit/rest";
import { RequestError } from "@octokit/request-error";
import { withGithubRetry } from "./github-publishing";

/** Lançada quando a API GitHub rejeita a criação com nome já usado (HTTP 422). */
export class RepositoryAlreadyExistsError extends Error {
  readonly code = "REPOSITORY_ALREADY_EXISTS" as const;
  readonly repositoryName: string;
  cause?: unknown;

  constructor(repositoryName: string, options?: { cause?: unknown }) {
    super(
      `Já existe um repositório com o nome «${repositoryName}» nesta conta do GitHub. Escolhe outro nome ou apaga/renomeia o repositório existente.`,
    );
    this.name = "RepositoryAlreadyExistsError";
    this.repositoryName = repositoryName;
    this.cause = options?.cause;
  }
}

function isRepositoryNameAlreadyTakenError(error: unknown): boolean {
  if (!(error instanceof RequestError) || error.status !== 422) {
    return false;
  }
  const lower = (error.message ?? "").toLowerCase();
  if (lower.includes("name already") || lower.includes("already exists")) {
    return true;
  }
  const errors = (error as RequestError & { response?: { data?: { errors?: Array<{ field?: string; message?: string }> } } })
    .response?.data?.errors;
  return (
    errors?.some((e) => e.field === "name" && /already exists|taken|use/i.test(String(e.message ?? ""))) === true
  );
}

export interface CreateRepositoryInput {
  token: string;
  name: string;
  description?: string;
  private?: boolean;
  homepage?: string;
  /** Padrão: true. Use false para enviar o primeiro commit via API Git (p.ex. publicador de template). */
  autoInit?: boolean;
}

export interface CreateRepositoryResult {
  id: number;
  name: string;
  fullName: string;
  htmlUrl: string;
  private: boolean;
}

/**
 * Cria uma instância autenticada do Octokit usando um Personal Access Token.
 */
export function createGitHubClient(token: string): Octokit {
  if (!token?.trim()) {
    throw new Error("GitHub token is required.");
  }

  return new Octokit({ auth: token.trim() });
}

/**
 * Cria um novo repositório na conta autenticada do GitHub.
 * Requer permissões adequadas no PAT (ex.: repo).
 */
export async function createRepository(
  input: CreateRepositoryInput,
): Promise<CreateRepositoryResult> {
  const token = input.token?.trim();
  const repositoryName = input.name?.trim();

  if (!token) {
    throw new Error("GitHub token is required.");
  }

  if (!repositoryName) {
    throw new Error("Repository name is required.");
  }

  const octokit = createGitHubClient(token);

  try {
    const { data } = await withGithubRetry(
      () =>
        octokit.repos.createForAuthenticatedUser({
          name: repositoryName,
          description: input.description?.trim() || undefined,
          private: input.private ?? true,
          homepage: input.homepage?.trim() || undefined,
          auto_init: input.autoInit !== false,
        }),
      { maxAttempts: 3, operationLabel: "repos.createForAuthenticatedUser" },
    );

    return {
      id: data.id,
      name: data.name,
      fullName: data.full_name,
      htmlUrl: data.html_url,
      private: data.private,
    };
  } catch (error) {
    if (isRepositoryNameAlreadyTakenError(error)) {
      throw new RepositoryAlreadyExistsError(repositoryName, { cause: error });
    }
    // Preserva 401/403 para o chamador (UI pode distinguir token inválido vs SSO/org).
    if (error instanceof RequestError && (error.status === 401 || error.status === 403)) {
      throw error;
    }
    const message = error instanceof Error ? error.message : "Unknown GitHub API error.";
    throw new Error(`Failed to create repository: ${message}`);
  }
}
