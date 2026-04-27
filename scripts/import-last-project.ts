/**
 * Script temporário: insere ou actualisa a entrada do deploy **blog-teste** em
 * `src/data/projects.json` para veres os cards no Dashboard.
 *
 * 1) Preenche o bloco `EDIT` abaixo com o teu user GitHub e o scope do dashboard Vercel
 *    (normalmente o mesmo; em equipa, o slug da team).
 * 2) Na raiz: `npx tsx scripts/import-last-project.ts`
 *    (ou `IMPORT_GITHUB_USER=... IMPORT_VERCEL_SCOPE=... npx tsx ...`)
 *
 * Apaga este ficheiro quando já não precisares.
 */
import { randomUUID } from "node:crypto";
import type { ClientProject } from "../src/lib/projects-data";
import { upsertProjectInRegistry } from "../src/lib/project-manager";

const REPO_SLUG = "blog-teste";

/** ↓ substitui pelos teus (repo blog-teste no GitHub + scope Vercel) — ou usa as env IMPORT_* */
const EDIT = {
  /** Dono do repositório, ex. `sennaricarte` em github.com/.../blog-teste */
  githubUser: "demo-user",
  /** Geralmente o mesmo; em team, o slug da equipa (URL do dashboard) */
  vercelDashboardScope: "demo-user",
  /** Vercel → Project → Settings: Project ID (o card de estado de deploy precisa de um id válido) */
  vercelProjectId: "prj_import_dev_blogteste_01",
} as const;

const GITHUB_USER = (process.env.IMPORT_GITHUB_USER?.trim() || EDIT.githubUser).trim();
const VERCEL_SCOPE = (process.env.IMPORT_VERCEL_SCOPE?.trim() || EDIT.vercelDashboardScope).trim();
const VERCEL_PROJECT_ID = (process.env.IMPORT_VERCEL_PROJ_ID?.trim() || EDIT.vercelProjectId).trim();

const githubRepoFullName = `${GITHUB_USER}/${REPO_SLUG}`;

const entry: ClientProject = {
  id: randomUUID(),
  name: "Blog teste",
  siteUrl: `https://${REPO_SLUG}.vercel.app`,
  githubUrl: `https://github.com/${githubRepoFullName}`,
  createdAt: new Date().toISOString(),
  vercelProjectId: VERCEL_PROJECT_ID,
  vercelProjectName: REPO_SLUG,
  vercelScope: VERCEL_SCOPE,
  vercelTeamId: (process.env.IMPORT_VERCEL_TEAM_ID ?? "").trim(),
};

async function main() {
  if (GITHUB_USER === "demo-user") {
    console.warn(
      "[import-last-project] A usar dados de exemplo (demo-user). Edita `EDIT` no script ou IMPORT_GITHUB_USER para o teu deploy real.\n",
    );
  }

  const next = await upsertProjectInRegistry(entry);
  console.log(
    `[import-last-project] Registo “${REPO_SLUG}” (repo ${githubRepoFullName}) — ${next.projects.length} projecto(s) no ficheiro.`,
  );
  console.log("[import-last-project] Abre /admin/dashboard/ no blogcms para veres os cards.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
