import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import { GithubPublisher } from "../../../lib/github-service";
import { VercelApiError, VercelService } from "../../../lib/vercel-service";

export const prerender = false;

type Body = {
  GITHUB_PERSONAL_TOKEN?: string;
  VERCEL_TOKEN?: string;
  VERCEL_TEAM_ID?: string;
};

export const POST: APIRoute = async ({ request }) => {
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "Corpo do pedido JSON inválido." }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const ghToken = body.GITHUB_PERSONAL_TOKEN?.trim();
  const vToken = body.VERCEL_TOKEN?.trim();
  const teamRaw = body.VERCEL_TEAM_ID?.trim();
  const teamId = teamRaw ? teamRaw : undefined;

  if (!ghToken || !vToken) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: "Os campos GitHub Personal Token e Vercel Token são obrigatórios.",
        step: "input" as const,
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }

  let github: { login: string };
  try {
    const publisher = new GithubPublisher({ token: ghToken });
    github = await publisher.verifyConnection();
  } catch (e) {
    const message =
      e instanceof RequestError
        ? e.message
        : e instanceof Error
          ? e.message
          : "Falha desconhecida no GitHub.";
    const status = e instanceof RequestError && (e.status === 401 || e.status === 403) ? 401 : 400;
    return new Response(
      JSON.stringify({ ok: false, error: message, step: "github" as const }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  let vercel: { username: string; teamName?: string };
  try {
    const service = new VercelService({ token: vToken, teamId: teamId ?? null });
    vercel = await service.verifyConnection();
  } catch (e) {
    const message = e instanceof VercelApiError ? e.message : e instanceof Error ? e.message : "Falha na Vercel.";
    const status =
      e instanceof VercelApiError && e.status >= 400 && e.status < 500 ? e.status : 502;
    return new Response(
      JSON.stringify({ ok: false, error: message, step: "vercel" as const }),
      { status, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      github: { login: github.login },
      vercel: { username: vercel.username, teamName: vercel.teamName },
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
};
