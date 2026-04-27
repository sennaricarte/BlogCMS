/**
 * Teste manual do fluxo `deployNewSite` (GitHub + Vercel).
 *
 * Pré-requisitos (`.env` na raiz do projeto):
 * - GITHUB_TOKEN (ou GITHUB_PAT) com escopo `repo`
 * - VERCEL_TOKEN
 * - Integração Vercel ↔ GitHub instalada com acesso ao repositório
 *
 * Uso: npm run test:deploy
 * Nome do repositório: usa TEST_REPO_NAME ou gera `blog-senna-demo-<sufixo-único>`.
 */
import { config as loadEnv } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { deployNewSite } from "../src/lib/orchestrator";
import type { ClientConfig } from "../src/lib/publisher";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: join(__dirname, "../.env") });

const repoSlug =
  process.env.TEST_REPO_NAME?.trim() ||
  `blog-senna-demo-${Date.now().toString(36)}`;

const fakeConfig: ClientConfig = {
  nomeMarca: "Blog do Senna",
  cores: {
    primaria: "#1e3a8a",
    secundaria: "#e2e8f0",
  },
  descricaoSeo:
    "Homenagem em azul e branco: notícias, lembrança e legado de Ayrton Senna em texto simples, rápido e acessível nas redes.",
  menuLinks: [
    { label: "Início", href: "/" },
    { label: "Blog", href: "/blog" },
    { label: "Sobre", href: "/sobre" },
  ],
  siteUrl: "https://blog-do-senna.example.com",
  imagemCompartilhamento: "/favicon.svg",
};

async function main(): Promise<void> {
  if (!process.env.GITHUB_TOKEN?.trim() && !process.env.GITHUB_PAT?.trim()) {
    console.error("Falta GITHUB_TOKEN ou GITHUB_PAT no .env (ou no ambiente).");
    process.exit(1);
  }
  if (!process.env.VERCEL_TOKEN?.trim() && !process.env.VERCEL_ACCESS_TOKEN?.trim()) {
    console.error("Falta VERCEL_TOKEN no .env (ou no ambiente).");
    process.exit(1);
  }

  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  test-deploy — cliente fictício: Blog do Senna          ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log(`Repositório GitHub (slug): ${repoSlug}`);
  console.log("Cores: azul #1e3a8a + cinza claro (acento claro) #e2e8f0");
  console.log("");

  const githubToken = process.env.GITHUB_TOKEN?.trim() || process.env.GITHUB_PAT?.trim() || "";
  const vercelToken =
    process.env.VERCEL_TOKEN?.trim() || process.env.VERCEL_ACCESS_TOKEN?.trim() || "";
  const vercelTeamId = process.env.VERCEL_TEAM_ID?.trim() || undefined;

  const result = await deployNewSite(
    {
      repositoryName: repoSlug,
      config: fakeConfig,
      github: {
        private: true,
        description: "Demo: Blog do Senna (deploy de teste via orchestrator)",
      },
      vercel: {
        vercelProjectName: repoSlug,
        teamId: vercelTeamId,
      },
    },
    {
      targetTokens: {
        githubToken,
        vercelToken,
        vercelTeamId,
      },
    },
  );

  console.log("\n── Resultado final ──");
  console.log("GitHub (repo):     ", result.githubRepositoryUrl);
  console.log("GitHub (fullName): ", result.githubFullName);
  console.log("Vercel (id):       ", result.vercelProjectId);
  console.log("Vercel (nome):     ", result.vercelProjectName);
  if (result.vercelProjectUrl) {
    console.log("Vercel (url):     ", result.vercelProjectUrl);
  }
  if (result.vercelDeployment?.url) {
    console.log("Vercel (deploy):  ", result.vercelDeployment.url);
  }
  console.log(
    "\nA URL produção fica ativa após o build (1–2 min). Se ainda vires 404, abre o dashboard → Deployments.",
  );
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});
