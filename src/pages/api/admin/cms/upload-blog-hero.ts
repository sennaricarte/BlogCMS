import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { GithubPublisher } from "../../../../lib/github-service";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import {
  detectImageKindFromBuffer,
  MAX_HERO_IMAGE_BYTES,
} from "../../../../lib/validate-hero-image";

export const prerender = false;

type Body = {
  GITHUB_PERSONAL_TOKEN?: string;
  githubRepoFullName?: string;
  branch?: string;
  /** Base64 do ficheiro (sem prefixo `data:image/...;base64,`). */
  contentBase64?: string;
};

function json(o: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }

  const token = body.GITHUB_PERSONAL_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "Token GitHub em falta (GITHUB_PERSONAL_TOKEN)." }, 400);
  }

  if (!body.githubRepoFullName?.trim()) {
    return json({ ok: false, error: "Indica githubRepoFullName (dono/repositório)." }, 400);
  }

  const b64 = body.contentBase64?.trim();
  if (!b64) {
    return json({ ok: false, error: "contentBase64 em falta." }, 400);
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return json({ ok: false, error: "Base64 inválido." }, 400);
  }

  if (buf.length === 0) {
    return json({ ok: false, error: "Ficheiro vazio." }, 400);
  }
  if (buf.length > MAX_HERO_IMAGE_BYTES) {
    return json(
      {
        ok: false,
        error: `Imagem demasiado grande (máx. ${Math.round(MAX_HERO_IMAGE_BYTES / (1024 * 1024))} MB).`,
      },
      400,
    );
  }

  const kind = detectImageKindFromBuffer(buf);
  if (!kind) {
    return json(
      { ok: false, error: "Formato não suportado. Usa JPEG, PNG, GIF, WebP ou SVG." },
      400,
    );
  }

  const branch = (body.branch ?? "main").trim() || "main";
  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName!));
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Repositório inválido." },
      400,
    );
  }

  const base = `hero-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const repoPath = `src/assets/blog/${base}.${kind.ext}`;
  const heroImage = `../../assets/blog/${base}.${kind.ext}`;

  const publisher = new GithubPublisher({ token });
  const message = `content(assets): imagem de destaque ${base}.${kind.ext}`;

  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, buf, message, { branch });
    return json({
      ok: true,
      repoPath,
      heroImage,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erro ao enviar para o GitHub.";
    return json({ ok: false, error: msg }, 502);
  }
};
