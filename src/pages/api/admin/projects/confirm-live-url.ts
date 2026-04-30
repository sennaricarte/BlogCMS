import type { APIRoute } from "astro";
import { confirmProjectLiveSiteUrl } from "../../../../lib/project-manager";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  let body: { id?: string; liveSiteUrl?: string };
  try {
    body = (await request.json()) as { id?: string; liveSiteUrl?: string };
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "JSON inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const id = body.id?.trim();
  const liveSiteUrl = body.liveSiteUrl?.trim();
  if (!id || !liveSiteUrl) {
    return new Response(JSON.stringify({ ok: false, error: "Campos id e liveSiteUrl são obrigatórios." }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  try {
    const project = await confirmProjectLiveSiteUrl({ id, liveSiteUrl });
    return new Response(JSON.stringify({ ok: true, project }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao gravar.";
    return new Response(JSON.stringify({ ok: false, error: message }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
};
