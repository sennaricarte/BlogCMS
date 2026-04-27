import type { ClientProject } from "./projects-data";

/** Chave localStorage para alvo do CMS (repo + Vercel). */
export const ADMIN_CMS_TARGET_KEY = "blogcms-cms-target" as const;

export type CmsTargetSettings = {
  /** Ex.: `utilizador/nome-do-repo` */
  githubRepoFullName: string;
  /** Ex.: `main` */
  branch: string;
  /** Ex.: `prj_…` (dashboard Vercel → Projeto → Settings → General) */
  vercelProjectId: string;
  /** Slug do projeto na Vercel (nome usado na API de deploy). */
  vercelProjectName: string;
};

/** A partir de `projects.json`: alvo usado no CMS, ou `null` se o registo ainda for placeholder. */
export function getCmsTargetFromProject(p: ClientProject): CmsTargetSettings | null {
  if (!p.githubRepoFullName?.trim() || p.githubRepoFullName.includes("owner/")) {
    return null;
  }
  return {
    githubRepoFullName: p.githubRepoFullName.trim(),
    branch: "main",
    vercelProjectId: p.vercelProjectId.trim(),
    vercelProjectName: p.vercelProjectName.trim(),
  };
}
