import { readFile } from "node:fs/promises";
import { isAbsolute, normalize, relative, resolve } from "node:path";
import type { APIRoute } from "astro";
import { isSafeEditorImageRepoRelPath } from "../../../../lib/admin-editor-image-urls";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";

export const prerender = false;

const MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

function isInsideParentDir(parentDir: string, absoluteFile: string): boolean {
  const root = resolve(normalize(parentDir));
  const file = resolve(normalize(absoluteFile));
  const rel = relative(root, file);
  if (!rel || rel === ".") return true;
  return !rel.startsWith("..") && !isAbsolute(rel);
}

export const GET: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return new Response(null, { status: 401, headers: auth.responseHeaders });
  }

  const url = new URL(context.request.url);
  const scope = url.searchParams.get("scope");
  const rawFile = url.searchParams.get("file") || "";
  const file = decodeURIComponent(rawFile.trim());
  if (!isSafeEditorImageRepoRelPath(file)) {
    return new Response(null, { status: 400, headers: auth.responseHeaders });
  }
  if (scope !== "blog" && scope !== "cms" && scope !== "blog-public") {
    return new Response(null, { status: 400, headers: auth.responseHeaders });
  }

  const cwd = process.cwd();
  const root =
    scope === "blog"
      ? resolve(cwd, "src", "assets", "blog")
      : scope === "blog-public"
        ? resolve(cwd, "public", "assets", "blog")
        : resolve(cwd, "public", "assets", "cms");
  const full = resolve(root, file);

  if (!isInsideParentDir(root, full)) {
    return new Response(null, { status: 403, headers: auth.responseHeaders });
  }

  try {
    const buf = await readFile(full);
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    const ct = MIME[ext] || "application/octet-stream";
    const headers = new Headers(auth.responseHeaders);
    headers.set("Content-Type", ct);
    headers.set("Cache-Control", "private, max-age=120");
    return new Response(buf, { status: 200, headers });
  } catch {
    return new Response(null, { status: 404, headers: auth.responseHeaders });
  }
};
