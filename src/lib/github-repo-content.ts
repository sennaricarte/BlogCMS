import { createGitHubClient } from "./github";

export { parseOwnerRepo } from "./github-parse-repo";

type GitFileContent = {
  path: string;
  sha: string;
  size: number;
  encoding: string;
  content: string;
  type: string;
};

type GitDirItem = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | "submodule";
  sha: string;
};

/**
 * Ficheiro de texto (ex.: .md) — devolve o conteúdo UTF-8 e o `sha` para atualizar ou apagar.
 */
export async function getRepoFileText(
  token: string,
  owner: string,
  repo: string,
  path: string,
  options?: { branch?: string; signal?: AbortSignal },
): Promise<{ text: string; sha: string }> {
  const octokit = createGitHubClient(token);
  const ref = options?.branch?.trim() || "main";
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
    request: { signal: options?.signal },
  });
  if (Array.isArray(data) || data.type !== "file") {
    throw new Error(`Caminho inválido ou pasta: ${path}`);
  }
  const f = data as unknown as GitFileContent;
  if (f.encoding === "base64" && f.content) {
    const text = Buffer.from(f.content, "base64").toString("utf8");
    return { text, sha: f.sha };
  }
  throw new Error("Ficheiro sem conteúdo base64 (formato inesperado).");
}

export async function listRepoPath(
  token: string,
  owner: string,
  repo: string,
  path: string,
  options?: { branch?: string; signal?: AbortSignal },
): Promise<GitDirItem[]> {
  const octokit = createGitHubClient(token);
  const ref = options?.branch?.trim() || "main";
  const { data } = await octokit.repos.getContent({
    owner,
    repo,
    path,
    ref,
    request: { signal: options?.signal },
  });
  if (!Array.isArray(data)) {
    return [];
  }
  return data.map((d) => ({
    name: d.name,
    path: d.path,
    type: d.type,
    sha: d.sha,
  })) as GitDirItem[];
}

export async function createOrUpdateRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  text: string,
  message: string,
  options?: { branch?: string; sha?: string; signal?: AbortSignal },
): Promise<{ commitSha: string; content: { sha: string } }> {
  const octokit = createGitHubClient(token);
  const branch = options?.branch?.trim() || "main";
  const content = Buffer.from(text, "utf8").toString("base64");
  const { data } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: message.trim() || "chore: atualizar conteúdo (CMS)",
    content,
    branch,
    sha: options?.sha,
    request: { signal: options?.signal },
  });
  if (!data.commit?.sha) {
    throw new Error("Resposta sem SHA de commit (GitHub).");
  }
  return { commitSha: data.commit.sha, content: { sha: data.content?.sha || "" } };
}

/**
 * Cria ou atualiza ficheiro binário (recomendado para imagens) — o conteúdo é
 * colocado em base64 tal como a API do GitHub espera.
 */
export async function createOrUpdateRepoFileBytes(
  token: string,
  owner: string,
  repo: string,
  path: string,
  data: Buffer | Uint8Array,
  message: string,
  options?: { branch?: string; sha?: string; signal?: AbortSignal },
): Promise<{ commitSha: string; content: { sha: string } }> {
  const octokit = createGitHubClient(token);
  const branch = options?.branch?.trim() || "main";
  const content = Buffer.from(data).toString("base64");
  const { data: res } = await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    path,
    message: message.trim() || "chore: atualizar conteúdo (CMS)",
    content,
    branch,
    sha: options?.sha,
    request: { signal: options?.signal },
  });
  if (!res.commit?.sha) {
    throw new Error("Resposta sem SHA de commit (GitHub).");
  }
  return { commitSha: res.commit.sha, content: { sha: res.content?.sha || "" } };
}

export async function deleteRepoFile(
  token: string,
  owner: string,
  repo: string,
  path: string,
  message: string,
  sha: string,
  options?: { branch?: string; signal?: AbortSignal },
): Promise<void> {
  const octokit = createGitHubClient(token);
  const branch = options?.branch?.trim() || "main";
  await octokit.repos.deleteFile({
    owner,
    repo,
    path,
    message: message.trim() || "chore: remover ficheiro (CMS)",
    sha,
    branch,
    request: { signal: options?.signal },
  });
}
