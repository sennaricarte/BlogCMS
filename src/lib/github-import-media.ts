import { Buffer } from "node:buffer";
import { GithubPublisher } from "./github-service";
import { detectImageKindFromBuffer, MAX_HERO_IMAGE_BYTES } from "./validate-hero-image";

export type DownloadedImage = {
  buf: Buffer;
  ext: string;
  contentType: string;
  sourceUrl: string;
};

const SUPPORTED_IMAGE_MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

/** Base segura para nomes de ficheiro (importação / assets). */
export function slugifyImportFileBase(s: string): string {
  const t = (s || "").trim();
  if (!t) return "artigo-importado";
  return (
    t
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/['"]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "artigo-importado"
  );
}

/** URL canónica (sem `#fragment`) para chaves estáveis em Map/Set e pedidos HTTP. */
export function canonicalImageUrl(href: string): string {
  try {
    const u = new URL(href.trim());
    u.hash = "";
    return u.href;
  } catch {
    return href.trim();
  }
}

export function toAbsoluteUrlOrNull(input: string): string | null {
  const v = (input || "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return canonicalImageUrl(u.href);
  } catch {
    return null;
  }
}

export function resolveMaybeAbsoluteImageUrl(rawUrl: string, sourceUrl?: string): string | null {
  const direct = toAbsoluteUrlOrNull(rawUrl);
  if (direct) return direct;
  const base = (sourceUrl || "").trim();
  if (!base) return null;
  try {
    const u = new URL(rawUrl, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return canonicalImageUrl(u.toString());
  } catch {
    return null;
  }
}

/** Diretório de imagens de artigos no repositório (alinhado com upload-blog-hero e exemplos em `src/content/blog`). */
export const REPO_BLOG_ASSETS_DIR = "src/assets/blog";

/**
 * Referência em frontmatter / Markdown sob `src/content/blog/*.md` → ficheiro em {@link REPO_BLOG_ASSETS_DIR}.
 */
export const BLOG_MARKDOWN_ASSET_PREFIX = "../../assets/blog/";

export function normalizeLocalAssetPath(path: string): string {
  const p = (path || "").trim().replace(/^["']|['"]$/g, "");
  if (!p) return p;
  if (p.startsWith(BLOG_MARKDOWN_ASSET_PREFIX)) return p;

  const fromSlashAssets = p.match(/^\/?assets\/blog\/(.+)$/i);
  if (fromSlashAssets?.[1]) {
    return `${BLOG_MARKDOWN_ASSET_PREFIX}${fromSlashAssets[1].replace(/^\/+/, "")}`;
  }

  const stripped = p.replace(/^\/?public\//i, "").replace(/^src\//i, "");
  const fromNested = stripped.match(/^assets\/blog\/(.+)$/i);
  if (fromNested?.[1]) {
    return `${BLOG_MARKDOWN_ASSET_PREFIX}${fromNested[1]}`;
  }

  if (!p.includes("/") && /\.(jpe?g|png|webp|gif|svg|avif)$/i.test(p)) {
    return `${BLOG_MARKDOWN_ASSET_PREFIX}${p}`;
  }

  return p;
}

function inferImageExt(contentType: string, buf: Buffer): string | null {
  const mime = (contentType || "").toLowerCase().split(";")[0].trim();
  if (mime && SUPPORTED_IMAGE_MIME_TO_EXT[mime]) return SUPPORTED_IMAGE_MIME_TO_EXT[mime];
  if (mime.startsWith("image/")) {
    const subtype = mime.slice("image/".length).trim();
    if (subtype === "jpeg") return "jpg";
    if (subtype === "svg+xml") return "svg";
    if (/^[a-z0-9.+-]+$/i.test(subtype)) return subtype.replace(/\+/g, "-");
  }
  const byBytes = detectImageKindFromBuffer(buf);
  return byBytes?.ext || null;
}

async function tryFetchImageOnce(url: string, refererPage?: string | null): Promise<DownloadedImage | null> {
  const headers: Record<string, string> = {
    Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  };
  const ref = (refererPage || "").trim();
  if (ref && /^https?:\/\//i.test(ref)) {
    try {
      headers.Referer = ref;
      headers.Origin = new URL(ref).origin;
    } catch {
      /* ignore */
    }
  }
  try {
    const r = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) {
      console.warn("[import-media] Falha ao descarregar imagem", {
        url,
        status: r.status,
        statusText: r.statusText,
        referer: ref || "(nenhum)",
      });
      return null;
    }
    const contentType = (r.headers.get("content-type") || "").toLowerCase().trim();
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length === 0 || buf.length > MAX_HERO_IMAGE_BYTES) {
      console.warn("[import-media] Imagem inválida por tamanho", { url, bytes: buf.length });
      return null;
    }
    const ext = inferImageExt(contentType, buf);
    if (!ext) {
      console.warn("[import-media] Formato de imagem não suportado", { url, contentType });
      return null;
    }
    return { buf, ext, contentType, sourceUrl: url };
  } catch (e) {
    console.warn("[import-media] Erro no download da imagem", {
      url,
      referer: ref || "(nenhum)",
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

function refererFromImageUrl(imageUrl: string): string | null {
  try {
    return new URL(imageUrl).origin + "/";
  } catch {
    return null;
  }
}

/** CDNs (ex. Supabase Storage) frequentemente recusam pedidos com Referer de outro site. */
function shouldFetchImageWithoutRefererFirst(url: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h.endsWith(".supabase.co") || h.includes("supabase.co");
  } catch {
    return /supabase\.co\//i.test(url);
  }
}

/** Várias tentativas: Referer da página, origem da imagem, sem Referer; Supabase primeiro sem Referer. */
export async function fetchImageForImport(
  url: string,
  refererPage?: string | null,
): Promise<DownloadedImage | null> {
  const pageRef = (refererPage || "").trim() || null;
  const originRef = refererFromImageUrl(url);
  const noRefFirst = shouldFetchImageWithoutRefererFirst(url);

  const order: Array<string | null> = [];
  if (noRefFirst) {
    order.push(null);
  }
  if (pageRef) {
    order.push(pageRef);
  }
  if (originRef && originRef !== pageRef) {
    order.push(originRef);
  }
  if (!noRefFirst) {
    order.push(null);
  }

  const tried = new Set<string>();
  for (const ref of order) {
    const key = ref === null ? "\0" : ref;
    if (tried.has(key)) {
      continue;
    }
    tried.add(key);
    const img = await tryFetchImageOnce(url, ref);
    if (img) {
      return img;
    }
  }
  return null;
}

export async function uploadFeaturedToGithub(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  img: DownloadedImage,
): Promise<string | null> {
  const fileBase = `${slugifyImportFileBase(slugBase)}-destaque`;
  const fileName = `${fileBase}.${img.ext}`;
  const repoPath = `${REPO_BLOG_ASSETS_DIR}/${fileName}`;
  const heroImage = `${BLOG_MARKDOWN_ASSET_PREFIX}${fileName}`;
  const message = `content(assets): imagem destacada ${fileName}`;
  try {
    const existingSha = await publisher.getFileShaIfExists(owner, repo, repoPath, { branch });
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, img.buf, message, {
      branch,
      sha: existingSha ?? undefined,
    });
    return heroImage;
  } catch (e) {
    console.warn("[import-media] Falha ao enviar imagem destacada para o GitHub", {
      repo: `${owner}/${repo}`,
      branch,
      repoPath,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

export async function uploadToGithubStorage(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  index: number,
  img: DownloadedImage,
  preferredFileName?: string,
): Promise<string | null> {
  const safeSlug = slugifyImportFileBase(slugBase);
  const preferred = (preferredFileName || "").trim();
  const preferredBase = preferred
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  const baseName = preferredBase || `${safeSlug}-${index}`;
  const fileName = `${baseName}.${img.ext}`;
  const repoPath = `${REPO_BLOG_ASSETS_DIR}/${fileName}`;
  try {
    const existingSha = await publisher.getFileShaIfExists(owner, repo, repoPath, { branch });
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, img.buf, `content(assets): imagem ${fileName}`, {
      branch,
      sha: existingSha ?? undefined,
    });
  } catch (e) {
    console.warn("[import-media] Falha ao enviar imagem do corpo para o GitHub", {
      sourceUrl: img.sourceUrl,
      repo: `${owner}/${repo}`,
      branch,
      repoPath,
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
  return `${BLOG_MARKDOWN_ASSET_PREFIX}${fileName}`;
}
