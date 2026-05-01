import { existsSync, mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

const ALLOWED_PREFIXES = ["src/content/blog/", "src/content/pages/"] as const;

function normalizeRepoRelative(p: string): string {
  return p.replace(/^[/\\]+/, "").replace(/\\/g, "/");
}

function isAllowedMirrorPath(repoRelative: string): boolean {
  const n = normalizeRepoRelative(repoRelative);
  if (!n || n.includes("..")) return false;
  return ALLOWED_PREFIXES.some((pre) => n.startsWith(pre));
}

/**
 * Em `astro dev`, copia o Markdown guardado no GitHub para o workspace local,
 * para listagens e rotas públicas refletirem o commit sem `git pull`.
 */
export function mirrorRepoFileToWorkspaceIfDev(repoRelativePath: string, contents: string): void {
  if (!import.meta.env.DEV) return;
  if (!isAllowedMirrorPath(repoRelativePath)) return;
  const abs = path.join(process.cwd(), normalizeRepoRelative(repoRelativePath));
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, contents, "utf-8");
}

/** Paridade com delete remoto em desenvolvimento. */
export function removeRepoFileFromWorkspaceIfDev(repoRelativePath: string): void {
  if (!import.meta.env.DEV) return;
  if (!isAllowedMirrorPath(repoRelativePath)) return;
  const abs = path.join(process.cwd(), normalizeRepoRelative(repoRelativePath));
  if (existsSync(abs)) unlinkSync(abs);
}
