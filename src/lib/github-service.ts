import { createGitHubClient, RepositoryAlreadyExistsError } from "./github";
import { validateGitHubPublishingToken } from "./github-publishing";
import {
  createOrUpdateRepoFile,
  createOrUpdateRepoFileBytes,
  deleteRepoFile,
  getRepoFileText,
  listRepoPath,
} from "./github-repo-content";
import {
  deployToClientRepo,
  type ClientConfig,
  type SiteConfig,
  type DeployToClientRepoOptions,
  type DeployToClientRepoResult,
} from "./publisher";

/** Opções de `createClientSite` (o token vem do construtor, não do `.env` nesta classe). */
export type CreateClientSiteOptions = Omit<DeployToClientRepoOptions, "repoName" | "token">;

export { RepositoryAlreadyExistsError };

/**
 * Orquestra a criação de repositórios e o envio do template, com
 * `src/data/site-config.json` injetado a partir de `ClientConfig` / `SiteConfig`.
 */
export class GithubPublisher {
  private readonly token: string;

  /**
   * @param options.token – PAT do GitHub (o chamador, ex. a API, obtém o valor a partir
   * do corpo do pedido / credenciais; esta classe não lê `process.env`).
   */
  constructor(options: { token: string }) {
    const t = options.token?.trim() ?? "";
    if (!t) {
      throw new Error(
        "Token em falta: `new GithubPublisher({ token: '...' })` requer um PAT com escopo `repo`.",
      );
    }
    this.token = t;
  }

  /**
   * Valida o PAT (utilizador + API) antes de criar repositórios.
   * 401/403 → `GitHubPublishingPermissionError` com mensagem para o painel.
   */
  async verifyConnection(): Promise<{ login: string }> {
    const octokit = createGitHubClient(this.token);
    return validateGitHubPublishingToken(octokit);
  }

  /**
   * Cria o repositório (público ou privado), gera o primeiro commit com o template
   * atual a partir da raiz do projeto (pastas como `node_modules` são ignoradas) e
   * escreve `clientConfig` em `src/data/site-config.json`.
   *
   * @throws {RepositoryAlreadyExistsError} Resposta 422 de nome duplicado no GitHub.
   */
  async createClientSite(
    repositoryName: string,
    clientConfig: ClientConfig,
    options?: CreateClientSiteOptions,
  ): Promise<DeployToClientRepoResult> {
    const name = repositoryName?.trim();
    if (!name) {
      throw new Error("O nome do repositório é obrigatório.");
    }

    return deployToClientRepo(clientConfig, {
      token: this.token,
      repoName: name,
      description: options?.description,
      private: options?.private ?? true,
      templateRoot: options?.templateRoot,
      defaultBranch: options?.defaultBranch,
      commitMessage: options?.commitMessage,
      onPhase: options?.onPhase,
      onPipelineLog: options?.onPipelineLog,
    });
  }

  /**
   * API de ficheiros do repositório (Conteúdo / CMS) — o mesmo token do construtor.
   * Encaminha para `github-repo-content` (Contents API, não env).
   */
  getFileText(
    owner: string,
    repo: string,
    path: string,
    options?: { branch?: string; signal?: AbortSignal },
  ) {
    return getRepoFileText(this.token, owner, repo, path, options);
  }

  listPath(
    owner: string,
    repo: string,
    path: string,
    options?: { branch?: string; signal?: AbortSignal },
  ) {
    return listRepoPath(this.token, owner, repo, path, options);
  }

  createOrUpdateFile(
    owner: string,
    repo: string,
    path: string,
    text: string,
    message: string,
    options?: { branch?: string; sha?: string; signal?: AbortSignal },
  ) {
    return createOrUpdateRepoFile(this.token, owner, repo, path, text, message, options);
  }

  createOrUpdateFileBytes(
    owner: string,
    repo: string,
    path: string,
    data: Buffer | Uint8Array,
    message: string,
    options?: { branch?: string; sha?: string; signal?: AbortSignal },
  ) {
    return createOrUpdateRepoFileBytes(
      this.token,
      owner,
      repo,
      path,
      data,
      message,
      options,
    );
  }

  deleteFile(
    owner: string,
    repo: string,
    path: string,
    message: string,
    sha: string,
    options?: { branch?: string; signal?: AbortSignal },
  ) {
    return deleteRepoFile(this.token, owner, repo, path, message, sha, options);
  }
}
