import { createServerClient, parseCookieHeader } from "@supabase/ssr";
import { defineMiddleware } from "astro:middleware";
import { readSupabasePublicConfig } from "./lib/supabase";

function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

function isAdminLoginPath(pathname: string): boolean {
  return pathname === "/admin/login" || pathname === "/admin/login/";
}

const DASHBOARD_ALIASES = new Set([
  "/dashboard",
  "/dashboard/",
  "/dashboard/admin",
  "/dashboard/admin/",
]);

export const onRequest = defineMiddleware(async (context, next) => {
  const pathname = context.url.pathname;
  if (DASHBOARD_ALIASES.has(pathname)) {
    return context.redirect("/admin/dashboard/", 302);
  }

  if (!isAdminPath(pathname)) {
    return next();
  }

  const cfg = readSupabasePublicConfig();
  if (!cfg) {
    if (isAdminLoginPath(pathname)) {
      return next();
    }
    return new Response(
      "Configura PUBLIC_SUPABASE_URL e PUBLIC_SUPABASE_ANON_KEY no ambiente (ex.: ficheiro .env).",
      { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } },
    );
  }

  const authResponseHeaders: Record<string, string> = {};

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
          Object.assign(authResponseHeaders, extraHeaders);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isAdminLoginPath(pathname) && user) {
    return context.redirect("/admin/dashboard/");
  }

  if (isAdminPath(pathname) && !isAdminLoginPath(pathname) && !user) {
    return context.redirect("/admin/login/");
  }

  const response = await next();
  Object.entries(authResponseHeaders).forEach(([k, v]) => {
    response.headers.set(k, v);
  });
  return response;
});
