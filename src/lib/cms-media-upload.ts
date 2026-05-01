import { ADMIN_CMS_TARGET_KEY } from "./admin-cms-target";
import { ADMIN_INTEGRATION_STORAGE_KEY } from "./admin-storage";

export function fileToBase64Content(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result;
      if (typeof s !== "string") {
        reject(new Error("Falha ao ler ficheiro."));
        return;
      }
      const i = s.indexOf("base64,");
      resolve(i === -1 ? s : s.slice(i + 7));
    };
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });
}

export type CmsMediaListItem = { name: string; path: string; url: string };

export type CmsMediaUploadSuccess = {
  /** Caminho público no site do cliente (ex. `/assets/cms/…`) */
  previewUrl: string;
  fileName: string;
  /** Igual a `previewUrl` para Markdown `![alt](url)` */
  relativeMarkdown: string;
};

function readGithubCmsCredentials():
  | { token: string; githubRepoFullName: string; branch: string }
  | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const integRaw = localStorage.getItem(ADMIN_INTEGRATION_STORAGE_KEY);
    const targetRaw = localStorage.getItem(ADMIN_CMS_TARGET_KEY);
    if (!integRaw || !targetRaw) return null;
    const integ = JSON.parse(integRaw) as { GITHUB_PERSONAL_TOKEN?: string };
    const target = JSON.parse(targetRaw) as { githubRepoFullName?: string; branch?: string };
    const token = integ.GITHUB_PERSONAL_TOKEN?.trim();
    const githubRepoFullName = target.githubRepoFullName?.trim();
    if (!token || !githubRepoFullName) return null;
    return {
      token,
      githubRepoFullName,
      branch: (target.branch || "main").trim() || "main",
    };
  } catch {
    return null;
  }
}

/**
 * Lista imagens já enviadas para `public/assets/cms/` no repositório configurado em Configurações.
 */
export async function listCmsMediaFiles(): Promise<
  { ok: true; items: CmsMediaListItem[] } | { ok: false; error: string }
> {
  const creds = readGithubCmsCredentials();
  if (!creds) {
    return {
      ok: false,
      error: "Configura o token GitHub e o repositório do site em /admin/settings/.",
    };
  }
  try {
    const res = await fetch("/api/admin/cms/list-client-media", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        GITHUB_PERSONAL_TOKEN: creds.token,
        githubRepoFullName: creds.githubRepoFullName,
        branch: creds.branch,
      }),
    });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      items?: CmsMediaListItem[];
    };
    if (!res.ok || !j.ok) {
      return { ok: false, error: j.error || `Falha ao listar (HTTP ${res.status}).` };
    }
    return { ok: true, items: j.items ?? [] };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Erro ao listar mídia no GitHub.",
    };
  }
}

/**
 * Envia imagem para `public/assets/cms/` no repositório GitHub do cliente (mesmo fluxo que o resto do CMS).
 * JPG/PNG são optimizados no servidor (WebP, largura máx. 1920px); SVG mantém-se.
 */
export async function uploadCmsMediaFile(
  file: File,
): Promise<{ ok: true; data: CmsMediaUploadSuccess } | { ok: false; error: string }> {
  if (!file.type.startsWith("image/")) {
    return { ok: false, error: "Só se aceitam ficheiros de imagem." };
  }
  const creds = readGithubCmsCredentials();
  if (!creds) {
    return {
      ok: false,
      error: "Configura o token GitHub e o repositório do site em /admin/settings/.",
    };
  }
  try {
    const b64 = await fileToBase64Content(file);
    const res = await fetch("/api/admin/media/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({
        contentBase64: b64,
        originalFileName: file.name,
        GITHUB_PERSONAL_TOKEN: creds.token,
        githubRepoFullName: creds.githubRepoFullName,
        branch: creds.branch,
      }),
    });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      fileName?: string;
      publicUrl?: string;
      relativeMarkdown?: string;
    };
    if (!res.ok || !j.ok || !j.fileName || !j.publicUrl) {
      return { ok: false, error: j.error || "Falha ao enviar para o GitHub." };
    }
    return {
      ok: true,
      data: {
        previewUrl: j.publicUrl,
        fileName: j.fileName,
        relativeMarkdown: j.relativeMarkdown || j.publicUrl,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Erro inesperado no envio." };
  }
}
