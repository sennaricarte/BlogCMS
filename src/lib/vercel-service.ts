/**
 * Integração com a API REST da Vercel para ligar um repositório GitHub a um novo projeto.
 * Requer a app "Vercel" instalada na conta/organização GitHub com acesso ao repositório.
 *
 * Documentação: https://vercel.com/docs/rest-api/reference/endpoints/projects#create-a-new-project
 */

const VERCEL_API_BASE = "https://api.vercel.com";

export interface VercelProjectFromGitHubInput {
  /**
   * Repositório no formato `proprietario/nome` (ex.: o `fullName` devolvido pela API GitHub).
   */
  githubRepoFullName: string;
  /**
   * Nome do projeto na Vercel (único na equipa/conta). Predefinido: parte do nome do repositório.
   */
  vercelProjectName?: string;
  /**
   * Equipa Vercel (`team_…`). Se omitido, a conta pessoal (sem `teamId` no URL da API).
   * O `teamId` por defeito na instância de `VercelService` vem do construtor, não de `process.env`.
   */
  teamId?: string;
}

export interface VercelCreateProjectResult {
  id: string;
  name: string;
  accountId: string;
  url?: string;
  link?: { type: string; repo: string } | null;
  framework?: string | null;
}

export class VercelApiError extends Error {
  readonly code?: string;
  readonly status: number;
  cause?: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; cause?: unknown },
  ) {
    super(message);
    this.name = "VercelApiError";
    this.status = options.status;
    this.code = options.code;
    this.cause = options.cause;
  }
}

function requireVercelToken(explicit: string | undefined, context: string): string {
  const t = (explicit ?? "").trim();
  if (!t) {
    throw new Error(
      `Token Vercel em falta: ${context} (a API de integração não lê \`VERCEL_TOKEN\` de \`process.env\`).`,
    );
  }
  return t;
}

function parseRepoFullName(full: string): { owner: string; name: string; fullName: string } {
  const s = full.trim();
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(s)) {
    throw new Error('githubRepoFullName deve estar no formato "proprietario/repositório".');
  }
  const [owner, name] = s.split("/");
  return { owner, name, fullName: s };
}

function buildProjectsCreateUrl(teamId?: string | null): string {
  const q = new URLSearchParams();
  if (teamId) q.set("teamId", teamId);
  const qs = q.toString();
  return `${VERCEL_API_BASE}/v10/projects${qs ? `?${qs}` : ""}`;
}

type VercelErrorJson = {
  error?: { code?: string; message?: string; [k: string]: unknown };
  message?: string;
};

/**
 * Cria um projeto Vercel ligado ao repositório GitHub indicado e define o framework como Astro.
 * Dispara o primeiro deploy quando a ligação Git estiver ativa.
 */
export async function connectGithubRepoToVercelProject(
  input: VercelProjectFromGitHubInput,
  init: { token: string; signal?: AbortSignal },
): Promise<VercelCreateProjectResult> {
  const token = requireVercelToken(init.token, "passe `init.token` em `connectGithubRepoToVercelProject`");

  const { fullName, name: repoName } = parseRepoFullName(input.githubRepoFullName);
  const projectName = (input.vercelProjectName?.trim() || repoName).toLowerCase();
  if (!projectName) {
    throw new Error("Nome do projeto Vercel em falta.");
  }

  const teamId = input.teamId?.trim() || undefined;

  const body = {
    name: projectName,
    framework: "astro" as const,
    gitRepository: {
      type: "github" as const,
      repo: fullName,
    },
  };

  const res = await fetch(buildProjectsCreateUrl(teamId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init?.signal,
  });

  const json = (await res.json().catch(() => ({}))) as VercelErrorJson & Record<string, unknown>;

  if (!res.ok) {
    const msg =
      json.error?.message ??
      (typeof json.message === "string" ? json.message : `HTTP ${res.status}`);
    throw new VercelApiError(msg, {
      status: res.status,
      code: json.error?.code,
      cause: json,
    });
  }

  const data = json as {
    id?: string;
    name?: string;
    accountId?: string;
    link?: { type?: string; repo?: string } | null;
    framework?: string | null;
  };

  return {
    id: data.id ?? "",
    name: data.name ?? projectName,
    accountId: data.accountId ?? "",
    url: typeof json.url === "string" ? json.url : undefined,
    link: data.link
      ? { type: data.link.type ?? "github", repo: data.link.repo ?? fullName }
      : { type: "github", repo: fullName },
    framework: data.framework ?? "astro",
  };
}

function buildDeploymentsCreateUrl(teamId?: string | null): string {
  const q = new URLSearchParams();
  if (teamId) q.set("teamId", teamId);
  const qs = q.toString();
  return `${VERCEL_API_BASE}/v13/deployments${qs ? `?${qs}` : ""}`;
}

export interface TriggerProductionDeploymentInput {
  /** `prj_…` (campo `project` da criação do projeto) */
  vercelProjectId: string;
  /** Nome do projeto (URL slug). */
  projectName: string;
  /** Dono e nome do repositório GitHub, ex.: de `sennaricarte/reponame`. */
  owner: string;
  repo: string;
  /** Ramo de produção (normalmente `main`). */
  ref: string;
  teamId?: string;
}

export interface TriggerProductionDeploymentResult {
  id?: string;
  url?: string;
  readyState?: string;
}

/**
 * Cria um deploy de **produção** a partir do GitHub, para o caso do projeto
 * recém-criado ainda não mostrar a URL (DEPLOYMENT_NOT_FOUND).
 * @see https://vercel.com/docs/rest-api/deployments/create-a-new-deployment
 */
export async function triggerVercelProductionDeployment(
  input: TriggerProductionDeploymentInput,
  init: { token: string; signal?: AbortSignal },
): Promise<TriggerProductionDeploymentResult> {
  const token = requireVercelToken(
    init.token,
    "passe `init.token` em `triggerVercelProductionDeployment`",
  );
  const teamId = input.teamId?.trim() || undefined;
  const ref = input.ref?.trim() || "main";
  const body = {
    name: input.projectName,
    project: input.vercelProjectId,
    target: "production" as const,
    gitSource: {
      type: "github" as const,
      ref,
      org: input.owner,
      repo: input.repo,
    },
  };
  const res = await fetch(buildDeploymentsCreateUrl(teamId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: init?.signal,
  });
  const json = (await res.json().catch(() => ({}))) as VercelErrorJson & Record<string, unknown>;
  if (!res.ok) {
    const msg =
      json.error?.message ??
      (typeof json.message === "string" ? json.message : `HTTP ${res.status}`);
    throw new VercelApiError(msg, {
      status: res.status,
      code: json.error?.code,
      cause: json,
    });
  }
  return {
    id: typeof (json as { id?: string }).id === "string" ? (json as { id: string }).id : undefined,
    url: typeof (json as { url?: string }).url === "string" ? (json as { url: string }).url : undefined,
    readyState: typeof (json as { readyState?: string }).readyState === "string"
      ? (json as { readyState: string }).readyState
      : undefined,
  };
}

/**
 * Token Vercel obrigatório no construtor; não lê `VERCEL_TOKEN` / `VERCEL_TEAM_ID` de `process.env`.
 */
export class VercelService {
  private readonly token: string;
  private readonly teamId: string | undefined;

  constructor(options: { token: string; teamId?: string | null }) {
    this.token = requireVercelToken(
      options.token,
      "passe `token` em `new VercelService({ token: '...' })`",
    );
    if (options.teamId === null) {
      this.teamId = undefined;
    } else if (options.teamId != null && String(options.teamId).trim() !== "") {
      this.teamId = String(options.teamId).trim();
    } else {
      this.teamId = undefined;
    }
  }

  /**
   * Valida o token com `GET /v2/user` e, se `teamId` foi passado no construtor, com `GET /v1/teams/:id`.
   */
  async verifyConnection(): Promise<{ username: string; teamName?: string }> {
    const userRes = await fetch(`${VERCEL_API_BASE}/v2/user`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!userRes.ok) {
      const body = (await userRes.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const msg = body.error?.message ?? `Falha ao validar token Vercel (HTTP ${userRes.status}).`;
      throw new VercelApiError(msg, {
        status: userRes.status,
        code: body.error?.code,
        cause: body,
      });
    }
    const userJson = (await userRes.json()) as {
      user?: { username?: string; name?: string | null } | null;
    };
    const u = userJson.user;
    const username = (u?.username ?? u?.name ?? "").trim() || "utilizador";

    if (!this.teamId) {
      return { username };
    }

    const teamRes = await fetch(
      `${VERCEL_API_BASE}/v1/teams/${encodeURIComponent(this.teamId)}`,
      { headers: { Authorization: `Bearer ${this.token}` } },
    );
    if (!teamRes.ok) {
      const body = (await teamRes.json().catch(() => ({}))) as { error?: { code?: string; message?: string } };
      const msg =
        body.error?.message ?? `Não foi possível aceder à equipa «${this.teamId}» (HTTP ${teamRes.status}).`;
      throw new VercelApiError(msg, {
        status: teamRes.status,
        code: body.error?.code,
        cause: body,
      });
    }
    const teamJson = (await teamRes.json()) as { name?: string };
    return { username, teamName: teamJson.name ?? this.teamId };
  }

  /**
   * Slug de conta pessoal (`username`) ou de equipa (`slug`) usado no URL
   * do dashboard, ex. `vercel.com/{scope}/nome-projeto`.
   */
  async getVercelDashboardScope(): Promise<string> {
    if (this.teamId) {
      const res = await fetch(
        `${VERCEL_API_BASE}/v1/teams/${encodeURIComponent(this.teamId!)}`,
        { headers: { Authorization: `Bearer ${this.token}` } },
      );
      if (!res.ok) {
        return this.teamId!;
      }
      const data = (await res.json().catch(() => ({}))) as { slug?: string; id?: string };
      if (data.slug && String(data.slug).trim()) {
        return String(data.slug).trim();
      }
      return this.teamId!;
    }
    const userRes = await fetch(`${VERCEL_API_BASE}/v2/user`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });
    if (!userRes.ok) {
      return "vercel";
    }
    const j = (await userRes.json()) as { user?: { username?: string; name?: string | null } };
    const u = j.user;
    return ((u?.username ?? u?.name) ?? "vercel").toString().trim() || "vercel";
  }

  /**
   * Cria o projeto e associa o repositório GitHub, com `framework: "astro"`.
   */
  async createProjectForGithubRepository(
    githubRepoFullName: string,
    options?: { vercelProjectName?: string; teamId?: string; signal?: AbortSignal },
  ): Promise<VercelCreateProjectResult> {
    return connectGithubRepoToVercelProject(
      {
        githubRepoFullName,
        vercelProjectName: options?.vercelProjectName,
        teamId: options?.teamId ?? this.teamId,
      },
      { token: this.token, signal: options?.signal },
    );
  }

  /**
   * Dispara um deploy de produção a partir de Git (útil se o subdomínio ainda
   * responde `DEPLOYMENT_NOT_FOUND`).
   */
  async triggerProductionDeployment(
    input: TriggerProductionDeploymentInput,
    init?: { signal?: AbortSignal },
  ): Promise<TriggerProductionDeploymentResult> {
    return triggerVercelProductionDeployment(
      { ...input, teamId: input.teamId ?? this.teamId },
      { token: this.token, signal: init?.signal },
    );
  }

  /**
   * Último deploy (todo o ambiente) de um projeto — útil para o painel (estado Ready / Building / Error).
   * @see https://vercel.com/docs/rest-api/reference/endpoints/deployments/list-deployments
   */
  async getLatestDeploymentState(
    projectId: string,
    init?: { signal?: AbortSignal },
  ): Promise<{ readyState: string; url?: string } | null> {
    return fetchLatestDeploymentForProject(projectId, {
      token: this.token,
      teamId: this.teamId ?? null,
      signal: init?.signal,
    });
  }
}

/**
 * Último registo de deployment (lista v6) para um `projectId` Vercel.
 */
export async function fetchLatestDeploymentForProject(
  projectId: string,
  init: { token: string; teamId?: string | null; signal?: AbortSignal },
): Promise<{ readyState: string; url?: string } | null> {
  const id = projectId?.trim();
  if (!id) {
    return null;
  }
  const token = requireVercelToken(
    init.token,
    "passe `init.token` em `fetchLatestDeploymentForProject`",
  );
  const teamId = init.teamId?.trim() || undefined;
  const q = new URLSearchParams();
  q.set("projectId", id);
  q.set("limit", "1");
  q.set("target", "production");
  if (teamId) {
    q.set("teamId", teamId);
  }
  const res = await fetch(`${VERCEL_API_BASE}/v6/deployments?${q.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: init.signal,
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
    const msg = err.error?.message ?? `HTTP ${res.status}`;
    throw new VercelApiError(msg, { status: res.status, cause: err });
  }
  const data = (await res.json()) as {
    deployments?: Array<{ readyState?: string; url?: string }>;
  };
  const d = data.deployments?.[0];
  if (!d) {
    return { readyState: "UNKNOWN" };
  }
  return {
    readyState: d.readyState ?? "UNKNOWN",
    url: typeof d.url === "string" ? d.url : undefined,
  };
}
