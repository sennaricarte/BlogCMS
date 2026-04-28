import type { APIRoute } from "astro";

export const prerender = false;

type Body = {
  GITHUB_PERSONAL_TOKEN?: string;
  githubRepoFullName?: string;
};

function json(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
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
  const full = body.githubRepoFullName?.trim();
  if (!token) return json({ ok: false, error: "GITHUB_PERSONAL_TOKEN em falta." }, 400);
  if (!full) return json({ ok: false, error: "githubRepoFullName em falta (dono/repositório)." }, 400);
  if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(full)) {
    return json({ ok: false, error: 'githubRepoFullName deve estar no formato "dono/repositório".' }, 400);
  }

  const [owner, repo] = full.split("/");
  try {
    const res = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner!)}/${encodeURIComponent(repo!)}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "BlogCMS-Admin/1.0",
      },
    });

    if (res.status === 404) {
      return json({
        ok: false,
        canDelete: false,
        error: "Repositório não encontrado para este token (ou sem acesso).",
      }, 404);
    }
    if (res.status === 401 || res.status === 403) {
      const txt = await res.text().catch(() => "");
      return json({
        ok: false,
        canDelete: false,
        error: `Token sem autorização para ler o repositório (HTTP ${res.status}). ${txt.slice(0, 160)}`,
      }, res.status);
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => "");
      return json({
        ok: false,
        canDelete: false,
        error: `Falha ao validar acesso ao repositório (HTTP ${res.status}). ${txt.slice(0, 160)}`,
      }, 502);
    }

    const j = (await res.json()) as { permissions?: { admin?: boolean; maintain?: boolean; push?: boolean } };
    const perms = j.permissions || {};
    const canDelete = Boolean(perms.admin);
    if (!canDelete) {
      return json({
        ok: false,
        canDelete: false,
        error: "Token autenticou, mas sem permissão de administração no repositório. Para apagar repo, é preciso admin/delete_repo.",
        permissions: perms,
      }, 200);
    }

    return json({
      ok: true,
      canDelete: true,
      message: "Token com permissão para exclusão de repositório (admin) neste repo.",
      permissions: perms,
    });
  } catch (e) {
    return json({ ok: false, canDelete: false, error: e instanceof Error ? e.message : "Erro de rede." }, 502);
  }
};
