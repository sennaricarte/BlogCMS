import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import type { AstroCookies } from "astro";
import { readSupabasePublicConfig } from "./supabase";

type ApiContext = { request: Request; cookies: AstroCookies };

/**
 * Lê a sessão Supabase a partir dos cookies (mesmo padrão que o middleware de `/admin/`).
 * Cabeçalhos a devolver na `Response` se `getUser` atualizar a sessão.
 */
export async function getSessionUserFromApi(context: ApiContext) {
  const cfg = readSupabasePublicConfig();
  if (!cfg) {
    return {
      data: { user: null } as { user: null },
      error: null,
      responseHeaders: {} as Record<string, string>,
    };
  }
  const responseHeaders: Record<string, string> = {};
  const supabase = createServerClient(cfg.url, cfg.key, {
    cookies: {
      getAll() {
        return parseCookieHeader(context.request.headers.get("Cookie") ?? "");
      },
      setAll(cookiesToSet, extraHeaders) {
        cookiesToSet.forEach(({ name, value, options }) => {
          context.cookies.set(name, value, options);
        });
        if (extraHeaders) {
          Object.assign(responseHeaders, extraHeaders);
        }
      },
    },
  });
  const result = await supabase.auth.getUser();
  return { ...result, responseHeaders };
}
