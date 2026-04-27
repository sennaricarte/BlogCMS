import type { APIRoute } from "astro";
import { z } from "astro/zod";
import { pageBlockZod } from "../../../../lib/page-blocks.zod";
import { putPreviewBlockSession } from "../../../../lib/preview-session-store";

export const prerender = false;

const bodyZod = z.object({
  blocks: z.array(pageBlockZod),
  pageUrl: z.string().optional().default(""),
});

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export const POST: APIRoute = async ({ request }) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400);
  }
  const parsed = bodyZod.safeParse(body);
  if (!parsed.success) {
    return json(
      { ok: false, error: "Dados de blocos inválidos: " + parsed.error.issues.map((i) => i.message).join("; ") },
      400,
    );
  }
  const { blocks, pageUrl } = parsed.data;
  const sid = putPreviewBlockSession({ blocks, pageUrl: pageUrl || "" });
  return json({ ok: true, sid });
};
