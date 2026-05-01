import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readSupabasePublicConfig } from "./supabase";

/**
 * Cliente com permissões de serviço (só no servidor) para Storage e admin API.
 * Requer `SUPABASE_SERVICE_ROLE_KEY` no ambiente.
 */
export function getSupabaseServiceClient(): SupabaseClient {
  const key = (import.meta.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined)?.trim();
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY em falta (legado: Central de Mídia só em Storage). O painel actual envia imagens para o GitHub do cliente via /api/admin/media/upload com credenciais no corpo.",
    );
  }
  const pub = readSupabasePublicConfig();
  if (!pub) {
    throw new Error(
      "Configura PUBLIC_SUPABASE_URL e PUBLIC_SUPABASE_ANON_KEY no .env (além da chave de serviço).",
    );
  }
  return createClient(pub.url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getCmsStorageBucketName(): string {
  const b = (import.meta.env.SUPABASE_STORAGE_BUCKET as string | undefined)?.trim();
  return b || "cms-media";
}
