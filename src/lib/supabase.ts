import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";

/**
 * O valor em Settings → API deve ser **só a raiz** do projeto, p.ex.
 * `https://abcdefgh.supabase.co` — **sem** `/auth/v1`, `/rest/v1` ou barras a mais.
 * Se copiaste um path completo, o SDK anexa `auth/v1` de novo e o pedido cai noutro
 * caminho (o gateway responde com "Invalid path" / "requested path is invalid").
 */
export function normalizeSupabaseProjectUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  try {
    return new URL(t).origin;
  } catch {
    return t;
  }
}

function normalizeAnonKey(raw: string): string {
  return raw.trim().replace(/^["']+|["']+$/g, "");
}

export function readSupabasePublicConfig(): { url: string; key: string } | null {
  const u = import.meta.env.PUBLIC_SUPABASE_URL;
  const k = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;
  if (typeof u !== "string" || !u.trim() || typeof k !== "string" || !k.trim()) {
    return null;
  }
  return {
    url: normalizeSupabaseProjectUrl(u),
    key: normalizeAnonKey(k),
  };
}

export function getSupabasePublicConfig(): { url: string; key: string } {
  const c = readSupabasePublicConfig();
  if (!c) {
    throw new Error(
      "Configura PUBLIC_SUPABASE_URL e PUBLIC_SUPABASE_ANON_KEY no ficheiro .env (página API do teu projeto Supabase).",
    );
  }
  return c;
}

function getPublicEnv(): { url: string; key: string } {
  return getSupabasePublicConfig();
}

/**
 * Cliente no browser (`@supabase/supabase-js` via `createBrowserClient` do `@supabase/ssr`).
 * Sessão em cookies, compatível com o `createServerClient` do middleware.
 */
export function createSupabaseBrowserClient(): SupabaseClient {
  const { url, key } = getPublicEnv();
  return createBrowserClient(url, key);
}
