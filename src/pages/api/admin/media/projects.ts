import type { APIRoute } from "astro";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ClientProject } from "../../../../lib/projects-data";

export const prerender = false;

function json(o: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const GET: APIRoute = () => {
  try {
    const abs = path.join(process.cwd(), "src/data/projects.json");
    const raw = readFileSync(abs, "utf-8");
    const data = JSON.parse(raw) as { projects?: ClientProject[] };
    const projects = Array.isArray(data.projects) ? data.projects : [];
    return json({
      ok: true,
      projects: projects.map((p) => ({ id: p.id, name: p.name })),
    });
  } catch (e) {
    return json(
      { ok: false, error: e instanceof Error ? e.message : "Falha ao ler projetos." },
      500,
    );
  }
};
