/** Registo em `src/data/projects.json` — sites criados / geridos pela plataforma. */
export type ClientProject = {
  id: string;
  name: string;
  /**
   * URL pública do site (produção ou preview) na Vercel.
   * Em registos antigos pode faltar: usa-se `siteUrl` como fallback.
   */
  vercelUrl?: string;
  /** Legado: URL do site; em novos deploys repete o valor de `vercelUrl`. */
  siteUrl: string;
  githubUrl: string;
  createdAt: string;
  vercelProjectId: string;
  vercelProjectName: string;
  vercelScope: string;
  vercelTeamId: string;
  githubRepoFullName: string;
  /**
   * Quando true: o repositório GitHub existe mas o site ainda não foi publicado na Vercel
   * ou a URL de produção não foi confirmada no painel.
   */
  awaitingVercelDeploy?: boolean;
  vercelLogsUrl?: string;
  /** URL manual do Speed Insights, se a automática `…/speed-insights` não servir. */
  vercelSpeedInsightsUrl?: string;
};
