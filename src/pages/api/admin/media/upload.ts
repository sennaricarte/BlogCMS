import type { APIRoute } from "astro";
import { Buffer } from "node:buffer";
import { detectImageKindFromBuffer, MAX_HERO_IMAGE_BYTES } from "../../../../lib/validate-hero-image";
import { processCmsImageBuffer } from "../../../../lib/process-cms-image";
import { seoSanitizedStorageFileName } from "../../../../lib/media-filename";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import { getCmsStorageBucketName, getSupabaseServiceClient } from "../../../../lib/supabase-service";

export const prerender = false;

type Body = {
  contentBase64?: string;
  originalFileName?: string;
};

function json(
  o: Record<string, unknown>,
  status = 200,
  extraHeaders?: Record<string, string>,
) {
  const h = new Headers({ "Content-Type": "application/json; charset=utf-8" });
  if (extraHeaders) {
    Object.entries(extraHeaders).forEach(([k, v]) => h.set(k, v));
  }
  return new Response(JSON.stringify(o), { status, headers: h });
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return json({ ok: false, error: "Sessão em falta. Inicia sessão no admin." }, 401, auth.responseHeaders);
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const b64 = body.contentBase64?.trim();
  if (!b64) {
    return json({ ok: false, error: "contentBase64 em falta." }, 400, auth.responseHeaders);
  }

  let buf: Buffer;
  try {
    buf = Buffer.from(b64, "base64");
  } catch {
    return json({ ok: false, error: "Base64 inválido." }, 400, auth.responseHeaders);
  }

  if (buf.length === 0) {
    return json({ ok: false, error: "Ficheiro vazio." }, 400, auth.responseHeaders);
  }
  if (buf.length > MAX_HERO_IMAGE_BYTES) {
    return json(
      {
        ok: false,
        error: `Imagem demasiado grande (máx. ${Math.round(MAX_HERO_IMAGE_BYTES / (1024 * 1024))} MB).`,
      },
      400,
      auth.responseHeaders,
    );
  }

  if (!detectImageKindFromBuffer(buf)) {
    return json(
      { ok: false, error: "Formato não suportado. Usa JPEG, PNG, WebP, GIF, SVG, etc." },
      400,
      auth.responseHeaders,
    );
  }

  let processed: Awaited<ReturnType<typeof processCmsImageBuffer>>;
  try {
    processed = await processCmsImageBuffer(buf);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Falha ao processar a imagem.";
    return json({ ok: false, error: msg }, 400, auth.responseHeaders);
  }

  const fromName = body.originalFileName?.trim() || `imagem.${processed.ext}`;

  let service;
  try {
    service = getSupabaseServiceClient();
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Supabase (serviço) não configurado.";
    return json({ ok: false, error: msg }, 503, auth.responseHeaders);
  }

  const bucket = getCmsStorageBucketName();
  let objectName = seoSanitizedStorageFileName(fromName, processed.ext);

  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await service.storage.from(bucket).upload(objectName, processed.buffer, {
      contentType: processed.contentType,
      cacheControl: "31536000",
      upsert: false,
    });
    if (!error) {
      const { data: pub } = service.storage.from(bucket).getPublicUrl(objectName);
      return json(
        {
          ok: true,
          fileName: objectName,
          publicUrl: pub.publicUrl,
          relativeMarkdown: pub.publicUrl,
        },
        200,
        auth.responseHeaders,
      );
    }
    const em = (error.message || "").toLowerCase();
    const duplicate = /exists|already|duplicate|409/.test(em);
    if (!duplicate) {
      return json({ ok: false, error: error.message || "Falha no Storage." }, 502, auth.responseHeaders);
    }
    const ext = objectName.split(".").pop() || processed.ext;
    const base = objectName.replace(/\.[^.]+$/, "");
    objectName = `${base}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;
  }

  return json(
    { ok: false, error: "Não foi possível criar ficheiro único no Storage." },
    502,
    auth.responseHeaders,
  );
};
