/**
 * Seed manual do primeiro projecto real no Dashboard.
 * Usa a URL de **produção** `https://<nome-projeto>.vercel.app` (não uses URLs de
 * preview com hash, ex. `projecto-abc123xyz.vercel.app` — expiram e dão 404).
 *
 * `npx tsx scripts/seed-project.ts`
 */
import { randomUUID } from "node:crypto";
import type { ClientProject } from "../src/lib/projects-data";
import { upsertProjectInRegistry } from "../src/lib/project-manager";

const entry: ClientProject = {
  id: randomUUID(),
  name: "Blog Teste SEO",
  vercelUrl: "https://blog-teste-lac.vercel.app",
  siteUrl: "https://blog-teste-lac.vercel.app",
  githubUrl: "https://github.com/desentupidoraremaxseo-stack/blog-teste",
  createdAt: new Date().toISOString(),
  vercelProjectId: "prj_seed_blog_teste_senna",
  vercelProjectName: "blog-teste-lac",
  vercelScope: "desentupidoraremaxseo-stack",
  vercelTeamId: "",
  githubRepoFullName: "desentupidoraremaxseo-stack/blog-teste",
};

async function main() {
  const { projects } = await upsertProjectInRegistry(entry);
  console.log(
    `[seed-project] Projetos no ficheiro: ${projects.length} — abre /admin/dashboard/ para ver o card.`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
