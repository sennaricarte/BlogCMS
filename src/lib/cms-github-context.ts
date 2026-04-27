import { ADMIN_INTEGRATION_STORAGE_KEY, type AdminIntegrationPayload } from "./admin-storage";
import { ADMIN_CMS_TARGET_KEY, type CmsTargetSettings } from "./admin-cms-target";

/**
 * Lê do `localStorage` o token e o repositório/ramo alvo (Configurações do CMS), como no editor.
 */
export function readCmsGithubContext(): {
  token: string;
  githubRepoFullName: string;
  branch: string;
} | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const integ = JSON.parse(
      localStorage.getItem(ADMIN_INTEGRATION_STORAGE_KEY) || "{}",
    ) as AdminIntegrationPayload;
    const target = JSON.parse(
      localStorage.getItem(ADMIN_CMS_TARGET_KEY) || "{}",
    ) as Partial<CmsTargetSettings>;
    const token = integ.GITHUB_PERSONAL_TOKEN?.trim();
    const githubRepoFullName = target.githubRepoFullName?.trim();
    if (!token || !githubRepoFullName) {
      return null;
    }
    const branch = (target.branch || "main").trim() || "main";
    return { token, githubRepoFullName, branch };
  } catch {
    return null;
  }
}
