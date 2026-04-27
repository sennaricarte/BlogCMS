import type { APIRoute } from "astro";
import { isImageFileName } from "../../../../lib/media-filename";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import { getCmsStorageBucketName, getSupabaseServiceClient } from "../../../../lib/supabase-service";

export const prerender = false;

function json(
  o: Record<string, unknown>,
  status = 200,
  extraHeaders?: Record<string, string>,
) {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (extraHeaders) {
    for (const [k, v] of Object.entries(extraHeaders)) {
      h.set(k, v);
    }
  }
  return new Response(JSON.stringify(o), { status, headers: h });
}

export const GET: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);
  }

  let service;
  try {
    service = getSupabaseServiceClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Supabase (serviço) não configurado.";
    return json({ ok: false, error: msg, items: [] }, 503, auth.responseHeaders);
  }

  const bucket = getCmsStorageBucketName();
  const { data: files, error } = await service.storage.from(bucket).list("", {
    limit: 200,
    offset: 0,
    sortBy: { column: "created_at", order: "desc" },
  });

  if (error) {
    return json({ ok: false, error: error.message, items: [] }, 502, auth.responseHeaders);
  }

  const items: Array<{ name: string; path: string; url: string }> = [];
  for (const f of files || []) {
    if (!f.name) {
      continue;
    }
    if (!isImageFileName(f.name)) {
      continue;
    }
    const { data: pub } = service.storage.from(bucket).getPublicUrl(f.name);
    items.push({
      name: f.name,
      path: f.name,
      url: pub.publicUrl,
    });
  }

  return json({ ok: true, items }, 200, auth.responseHeaders);
};
