import type { APIRoute } from "astro";
import { RequestError } from "@octokit/request-error";
import { Buffer } from "node:buffer";
import * as cheerio from "cheerio";
import { serializeBlogMarkdown, type BlogFrontmatterInput } from "../../../../lib/cms-matter";
import { CMS_PATHS } from "../../../../lib/cms-paths";
import { normalizeImportedMarkdownBody } from "../../../../lib/normalize-import-markdown";
import { GithubPublisher } from "../../../../lib/github-service";
import { parseOwnerRepo } from "../../../../lib/github-repo-content";
import { getSessionUserFromApi } from "../../../../lib/supabase-server-auth";
import { detectImageKindFromBuffer, MAX_HERO_IMAGE_BYTES } from "../../../../lib/validate-hero-image";

export const prerender = false;

function json(o: Record<string, unknown>, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(o), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(headers as object) },
  });
}

function slugifyFileName(s: string): string {
  const t = (s || "").trim();
  if (!t) return "artigo-importado";
  return t
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "artigo-importado";
}

function toAbsoluteUrlOrNull(input: string): string | null {
  const v = (input || "").trim();
  if (!v) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

type ImportPost = {
  slug: string;
  title: string;
  description: string;
  pubDate: string;
  markdownBody: string;
  author?: string;
  tags?: string[];
  category?: string;
  draft?: boolean;
  featuredImageUrl?: string;
  sourceUrl?: string;
  articleHtml?: string;
  xmlAttachmentUrls?: string[];
  xmlAttachmentFileNameByUrl?: Record<string, string>;
};

type DownloadedImage = {
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

/** SHA do `blog/{slug}.md` no ramo, ou `null` se não existir (404). */
async function getBlogMarkdownShaIfExists(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slug: string,
): Promise<string | null> {
  const path = `${CMS_PATHS.blog}/${slug}.md`;
  try {
    const { sha } = await publisher.getFileText(owner, repo, path, { branch });
    return sha?.trim() || null;
  } catch (e) {
    if (e instanceof RequestError && e.status === 404) return null;
    throw e;
  }
}

async function blogPathExists(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slug: string,
): Promise<boolean> {
  const sha = await getBlogMarkdownShaIfExists(publisher, owner, repo, branch, slug);
  return sha !== null;
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

/** Várias tentativas: Referer da página, origem da imagem, sem Referer. */
async function fetchImageForImport(url: string, refererPage?: string | null): Promise<DownloadedImage | null> {
  const pageRef = (refererPage || "").trim() || null;
  const originRef = refererFromImageUrl(url);

  let img = await tryFetchImageOnce(url, pageRef);
  if (img) return img;

  if (originRef && originRef !== pageRef) {
    img = await tryFetchImageOnce(url, originRef);
    if (img) return img;
  }

  if (pageRef || originRef) {
    img = await tryFetchImageOnce(url, null);
  }
  return img;
}

async function uploadFeaturedToGithub(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  img: DownloadedImage,
): Promise<string | null> {
  const fileBase = `${slugifyFileName(slugBase)}-destaque`;
  const fileName = `${fileBase}.${img.ext}`;
  const repoPath = `public/assets/blog/${fileName}`;
  const heroImage = `/assets/blog/${fileName}`;
  const message = `content(assets): imagem destacada ${fileName}`;
  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, img.buf, message, { branch });
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

function resolveMaybeAbsoluteImageUrl(rawUrl: string, sourceUrl?: string): string | null {
  const direct = toAbsoluteUrlOrNull(rawUrl);
  if (direct) return direct;
  const base = (sourceUrl || "").trim();
  if (!base) return null;
  try {
    const u = new URL(rawUrl, base);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

async function uploadToGithubStorage(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  slugBase: string,
  index: number,
  img: DownloadedImage,
  preferredFileName?: string,
): Promise<string | null> {
  const safeSlug = slugifyFileName(slugBase);
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
  const repoPath = `public/assets/blog/${fileName}`;
  try {
    await publisher.createOrUpdateFileBytes(owner, repo, repoPath, img.buf, `content(assets): imagem ${fileName}`, { branch });
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
  return `/assets/blog/${fileName}`;
}

function normalizeLocalAssetPath(path: string): string {
  const p = (path || "").trim();
  if (!p) return p;
  const noPublic = p.replace(/^\/?public\//i, "/");
  if (noPublic.startsWith("/assets/")) return noPublic;
  if (noPublic.startsWith("assets/")) return `/${noPublic}`;
  return noPublic.startsWith("/") ? noPublic : `/${noPublic}`;
}

function pickAttrFromTagBlob(attrs: string, name: string): string {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i").exec(attrs);
  if (quoted?.[2] != null) return quoted[2].trim();
  const unquoted = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(attrs);
  return (unquoted?.[1] || "").trim();
}

/** Obtém URL da primeira candidata (lazy-load, srcset, etc.). */
function pickImgUrlFromTag(tag: string): string {
  const inner = tag.replace(/^<\s*img\b/i, "").replace(/\/?\s*>$/i, "");
  let raw =
    pickAttrFromTagBlob(inner, "src") ||
    pickAttrFromTagBlob(inner, "data-src") ||
    pickAttrFromTagBlob(inner, "data-lazy-src") ||
    pickAttrFromTagBlob(inner, "data-original") ||
    pickAttrFromTagBlob(inner, "data-zoom-image");
  if (!raw) {
    const ss = pickAttrFromTagBlob(inner, "srcset");
    if (ss) raw = ss.split(",")[0]?.trim().split(/\s+/)[0]?.trim() || "";
  }
  return raw;
}

function pickAltFromImgTag(tag: string): string {
  const q = /\balt\s*=\s*(["'])([\s\S]*?)\1/i.exec(tag);
  if (q?.[2] != null) return q[2].trim();
  return (pickAttrFromTagBlob(tag.replace(/^<\s*img\b/i, "").replace(/\/?\s*>$/i, ""), "alt") || "").trim();
}

function normalizeMarkdownImageHtml(markdown: string, sourceUrl?: string): string {
  let out = markdown || "";
  out = out.replace(/<figure[^>]*>([\s\S]*?)<\/figure>/gi, "$1");
  out = out.replace(/<img\b[^>]*\/?>/gi, (tag) => {
    const srcRaw = pickImgUrlFromTag(tag);
    if (!srcRaw) return "";
    const alt = pickAltFromImgTag(tag);
    const abs = resolveMaybeAbsoluteImageUrl(srcRaw, sourceUrl) || srcRaw;
    return `![${alt}](${abs})`;
  });
  out = out.replace(/\[(!\[[^\]]*\]\([^)]+\))\]\([^)]+\)/g, "$1");
  out = out.replace(/<a\b[^>]*>\s*(!\[[^\]]*\]\([^)]+\))\s*<\/a>/gi, "$1");
  return out;
}

function replaceImageReferenceInMarkdown(markdown: string, raw: string, abs: string, localPath: string): string {
  const escapedRaw = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const escapedAbs = abs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const local = normalizeLocalAssetPath(localPath);
  let out = markdown;
  // Substitui markdown image syntax por URL original (raw ou absoluta).
  out = out.replace(new RegExp(`(!\\[[^\\]]*\\]\\()${escapedRaw}(\\))`, "g"), `$1${local}$2`);
  out = out.replace(new RegExp(`(!\\[[^\\]]*\\]\\()${escapedAbs}(\\))`, "g"), `$1${local}$2`);
  // Substitui HTML img src remanescente.
  out = out.replace(new RegExp(`(<img\\b[^>]*\\bsrc\\s*=\\s*["'])${escapedRaw}(["'][^>]*>)`, "gi"), `$1${local}$2`);
  out = out.replace(new RegExp(`(<img\\b[^>]*\\bsrc\\s*=\\s*["'])${escapedAbs}(["'][^>]*>)`, "gi"), `$1${local}$2`);
  return out;
}

async function localizeMarkdownImages(params: {
  markdown: string;
  sourceUrl?: string;
  slugBase: string;
  publisher: GithubPublisher;
  owner: string;
  repo: string;
  branch: string;
}): Promise<string> {
  const { markdown, sourceUrl, slugBase, publisher, owner, repo, branch } = params;
  const imageRegex = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const matches = Array.from(markdown.matchAll(imageRegex));
  if (matches.length === 0) return markdown;

  const cache = new Map<string, string>();
  let imageIndex = 1;
  let output = markdown;

  for (const m of matches) {
    const full = m[0];
    const alt = m[1] || "";
    const raw = (m[2] || "").trim();
    const abs = resolveMaybeAbsoluteImageUrl(raw, sourceUrl);
    if (!abs) continue;
    let local = cache.get(abs);
    if (!local) {
      const img = await fetchImageForImport(abs, sourceUrl);
      if (!img) continue;
      local = await uploadToGithubStorage(publisher, owner, repo, branch, slugBase, imageIndex, img);
      if (!local) continue;
      cache.set(abs, local);
      imageIndex += 1;
    }
    const escapedFull = full.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    output = output.replace(new RegExp(escapedFull, "g"), `![${alt}](${local})`);
  }
  return output;
}

type HtmlImgRef = { raw: string; abs: string; alt: string };

function collectImageRefsFromMarkdown(markdown: string, sourceUrl?: string): Array<{ raw: string; abs: string }> {
  const imageRegex = /!\[[^\]]*]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
  const out: Array<{ raw: string; abs: string }> = [];
  for (const m of markdown.matchAll(imageRegex)) {
    const raw = (m[1] || "").trim();
    const abs = resolveMaybeAbsoluteImageUrl(raw, sourceUrl);
    if (raw && abs) out.push({ raw, abs });
  }
  return out;
}

/** Imagens presentes no HTML do artigo (incl. lazy-load), para upload + inserção no .md. */
function extractImageRefsFromArticleHtml(articleHtml?: string, sourceUrl?: string): HtmlImgRef[] {
  const html = (articleHtml || "").trim();
  if (!html) return [];
  const byAbs = new Map<string, HtmlImgRef>();

  const push = (raw: string, alt: string) => {
    const abs = resolveMaybeAbsoluteImageUrl(raw, sourceUrl);
    if (!abs || byAbs.has(abs)) return;
    const safeAlt = (alt || "Imagem").replace(/[\[\]]/g, "").slice(0, 200);
    byAbs.set(abs, { raw, abs, alt: safeAlt });
  };

  for (const m of html.matchAll(/<img\b[^>]*\/?>/gi)) {
    const tag = m[0];
    const raw = pickImgUrlFromTag(tag);
    if (!raw) continue;
    push(raw, pickAltFromImgTag(tag));
  }

  try {
    const $ = cheerio.load(html);
    $("img").each((_, el) => {
      const $el = $(el);
      let raw = ($el.attr("src") || "").trim();
      if (!raw) raw = ($el.attr("data-src") || "").trim();
      if (!raw) raw = ($el.attr("data-lazy-src") || "").trim();
      if (!raw) {
        const ss = ($el.attr("srcset") || "").trim();
        if (ss) raw = ss.split(",")[0]?.trim().split(/\s+/)[0] || "";
      }
      if (!raw) return;
      const alt = ($el.attr("alt") || "").trim();
      push(raw, alt);
    });
  } catch {
    /* já coberto pelo regex */
  }

  return Array.from(byAbs.values());
}

/** Insere no Markdown as imagens que só existiam no HTML (o upload já correu em `uploadedByUrl`). */
function mergeHtmlImagesIntoMarkdown(
  md: string,
  htmlRefs: HtmlImgRef[],
  markdownAbsKeys: Set<string>,
  uploadedByUrl: Map<string, string>,
): string {
  const appendix: string[] = [];
  for (const ref of htmlRefs) {
    if (markdownAbsKeys.has(ref.abs)) continue;
    const local = uploadedByUrl.get(ref.abs);
    if (!local) continue;
    const altEsc = ref.alt.replace(/[[\]]/g, "").slice(0, 200);
    appendix.push(`\n\n![${altEsc}](${local})\n\n`);
  }
  if (appendix.length === 0) return md;
  return md.trimEnd() + appendix.join("");
}

async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function extractOgOrTwitterImage(articleHtml?: string, sourceUrl?: string): string | null {
  const html = (articleHtml || "").trim();
  if (!html) return null;
  try {
    const $ = cheerio.load(html);
    const og = $('meta[property="og:image"]').attr("content")?.trim();
    const tw = $('meta[name="twitter:image"]').attr("content")?.trim();
    return resolveMaybeAbsoluteImageUrl(og || tw || "", sourceUrl);
  } catch {
    return null;
  }
}

async function processArticleAssets(params: {
  markdown: string;
  articleHtml?: string;
  sourceUrl?: string;
  featuredImageUrl?: string;
  xmlAttachmentUrls?: string[];
  xmlAttachmentFileNameByUrl?: Record<string, string>;
  slugBase: string;
  publisher: GithubPublisher;
  owner: string;
  repo: string;
  branch: string;
}): Promise<{ markdown: string; featuredPath: string; warnings: string[] }> {
  const {
    markdown,
    articleHtml,
    sourceUrl,
    featuredImageUrl,
    xmlAttachmentUrls,
    xmlAttachmentFileNameByUrl,
    slugBase,
    publisher,
    owner,
    repo,
    branch,
  } = params;
  const warnings: string[] = [];
  let processedMarkdown = normalizeMarkdownImageHtml(markdown, sourceUrl);

  // Referências no corpo Markdown (incl. <img> convertidos acima) + HTML completo (imagens só no HTML).
  const markdownRefs = collectImageRefsFromMarkdown(processedMarkdown, sourceUrl);
  const markdownAbsKeys = new Set(markdownRefs.map((r) => r.abs));
  const htmlImgRefs = extractImageRefsFromArticleHtml(articleHtml, sourceUrl);
  const ogOrTw = extractOgOrTwitterImage(articleHtml, sourceUrl);
  // Prioridade para capa vinda do XML/WordPress (_thumbnail_id -> attachment_url).
  const featuredCandidate = resolveMaybeAbsoluteImageUrl(featuredImageUrl || "", sourceUrl) || ogOrTw;
  const allAssetUrls = Array.from(
    new Set([
      ...(Array.isArray(xmlAttachmentUrls) ? xmlAttachmentUrls : []),
      ...markdownRefs.map((r) => r.abs),
      ...htmlImgRefs.map((r) => r.abs),
      ...(featuredCandidate ? [featuredCandidate] : []),
    ]),
  );
  const totalDetected = allAssetUrls.length;
  const indexByUrl = new Map<string, number>(allAssetUrls.map((u, i) => [u, i + 1]));

  const uploadedByUrl = new Map<string, string>();
  const tryUploadAsset = async (assetUrl: string): Promise<boolean> => {
    const img = await fetchImageForImport(assetUrl, sourceUrl);
    if (!img) {
      return false;
    }
    const idx = indexByUrl.get(assetUrl) || 1;
    const preferredName = xmlAttachmentFileNameByUrl?.[assetUrl];
    const local = await uploadToGithubStorage(publisher, owner, repo, branch, slugBase, idx, img, preferredName);
    if (!local) {
      return false;
    }
    uploadedByUrl.set(assetUrl, local);
    return true;
  };

  for (const assetUrl of allAssetUrls) {
    const ok = await tryUploadAsset(assetUrl);
    if (!ok) {
      console.warn("[import-media] Falha no upload serial de imagem", { slugBase, assetUrl });
    }
    // Pequeno intervalo para reduzir erros de concorrência/rate limit no GitHub.
    await sleep(180);
  }

  // 1.1) Verificação de integridade: se faltar imagem, tenta novamente antes de fechar Markdown.
  const missingUrls = allAssetUrls.filter((u) => !uploadedByUrl.has(u));
  for (const assetUrl of missingUrls) {
    const ok = await tryUploadAsset(assetUrl);
    if (!ok) {
      warnings.push(`<!-- Falha ao importar imagem: ${assetUrl} -->`);
      console.warn("[import-media] Falha após retry de imagem", { slugBase, assetUrl });
    }
    await sleep(180);
  }

  const totalUploaded = uploadedByUrl.size;
  console.info("[import-media] Auditoria de assets por post", {
    slugBase,
    detected: totalDetected,
    uploaded: totalUploaded,
    failed: Math.max(0, totalDetected - totalUploaded),
  });

  // 2) Reescreve Markdown para imagens que já estavam em sintaxe Markdown no ficheiro.
  for (const ref of markdownRefs) {
    const local = uploadedByUrl.get(ref.abs);
    if (!local) continue;
    processedMarkdown = replaceImageReferenceInMarkdown(processedMarkdown, ref.raw, ref.abs, local);
  }

  // 3) Imagens que só existiam no HTML: após upload, acrescenta ao Markdown (antes ignorávamos o corpo).
  processedMarkdown = mergeHtmlImagesIntoMarkdown(
    processedMarkdown,
    htmlImgRefs,
    markdownAbsKeys,
    uploadedByUrl,
  );

  const xmlOnly = (Array.isArray(xmlAttachmentUrls) ? xmlAttachmentUrls : []).filter((u) => {
    if (!u || typeof u !== "string") return false;
    if (featuredCandidate && u === featuredCandidate) return false;
    if (markdownAbsKeys.has(u)) return false;
    if (htmlImgRefs.some((h) => h.abs === u)) return false;
    return true;
  });
  for (const u of xmlOnly) {
    const local = uploadedByUrl.get(u);
    if (!local) continue;
    processedMarkdown = processedMarkdown.trimEnd() + `\n\n![](${local})\n\n`;
  }

  let featuredPath = "/assets/blog/destaque.jpg";
  if (featuredCandidate) {
    const localFeatured = uploadedByUrl.get(featuredCandidate);
    if (localFeatured) {
      featuredPath = normalizeLocalAssetPath(localFeatured);
    } else {
      // Tenta rota dedicada de destaque (nome semântico) se o asset foi baixado mas upload numerado não foi usado.
      const img = await fetchImageForImport(featuredCandidate, sourceUrl);
      if (img) {
        const uploadedFeatured = await uploadFeaturedToGithub(publisher, owner, repo, branch, slugBase, img);
        if (uploadedFeatured) featuredPath = normalizeLocalAssetPath(uploadedFeatured);
      }
    }
  }

  if (featuredPath === "/assets/blog/destaque.jpg") {
    const firstLocalMdImage = processedMarkdown.match(/!\[[^\]]*]\((\/assets\/blog\/[^)\s]+)\)/)?.[1];
    if (firstLocalMdImage) featuredPath = firstLocalMdImage;
  }

  if (warnings.length > 0) {
    processedMarkdown = `${processedMarkdown.trim()}\n\n${warnings.join("\n")}\n`;
  }

  return { markdown: processedMarkdown, featuredPath: normalizeLocalAssetPath(featuredPath), warnings };
}

async function uniqueBlogPath(
  publisher: GithubPublisher,
  owner: string,
  repo: string,
  branch: string,
  baseSlug: string,
): Promise<{ path: string; slug: string }> {
  const base = slugifyFileName(baseSlug);
  let n = 0;
  while (n < 40) {
    const slug = n === 0 ? base : `${base}-${n}`;
    const path = `${CMS_PATHS.blog}/${slug}.md`;
    try {
      await publisher.getFileText(owner, repo, path, { branch });
      n += 1;
    } catch (e) {
      if (e instanceof RequestError && e.status === 404) {
        return { path, slug };
      }
      throw e;
    }
  }
  const slug = `${base}-${Date.now().toString(36)}`;
  return { path: `${CMS_PATHS.blog}/${slug}.md`, slug };
}

export const POST: APIRoute = async (context) => {
  const auth = await getSessionUserFromApi(context);
  if (!auth.data.user) {
    return json({ ok: false, error: "Sessão em falta." }, 401, auth.responseHeaders);
  }

  let body: {
    GITHUB_PERSONAL_TOKEN?: string;
    githubRepoFullName?: string;
    branch?: string;
    allowDuplicates?: boolean;
    /** Se `true`, grava sempre em `blog/{slug}.md`: ficheiros já existentes são substituídos. Ignora a resolução de caminhos de `allowDuplicates`. */
    replaceExisting?: boolean;
    posts?: ImportPost[];
  };
  try {
    body = (await context.request.json()) as typeof body;
  } catch {
    return json({ ok: false, error: "JSON inválido." }, 400, auth.responseHeaders);
  }

  const token = body.GITHUB_PERSONAL_TOKEN?.trim();
  if (!token) {
    return json({ ok: false, error: "Token GitHub em falta." }, 400, auth.responseHeaders);
  }
  if (!body.githubRepoFullName?.trim()) {
    return json({ ok: false, error: "Indica o repositório (dono/repo)." }, 400, auth.responseHeaders);
  }
  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    return json({ ok: false, error: "Lista `posts` vazia." }, 400, auth.responseHeaders);
  }

  let owner: string;
  let repo: string;
  try {
    ({ owner, repo } = parseOwnerRepo(body.githubRepoFullName!));
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : "Repo inválido." }, 400, auth.responseHeaders);
  }

  const branch = (body.branch ?? "main").trim() || "main";
  const allowDuplicates = body.allowDuplicates === true;
  const replaceExisting = body.replaceExisting === true;
  const publisher = new GithubPublisher({ token });

  const created: string[] = [];
  const replaced: string[] = [];
  const errors: Array<{ slug: string; error: string }> = [];
  const skipped: Array<{ slug: string; reason: string }> = [];
  const seenInBatch = new Set<string>();

  for (const p of body.posts) {
    const slugIn = slugifyFileName(p.slug || p.title);
    if (seenInBatch.has(slugIn)) {
      skipped.push({ slug: slugIn, reason: "Duplicado no lote atual." });
      continue;
    }
    seenInBatch.add(slugIn);

    if (!allowDuplicates && !replaceExisting) {
      const exists = await blogPathExists(publisher, owner, repo, branch, slugIn);
      if (exists) {
        skipped.push({ slug: slugIn, reason: "Já existe no repositório." });
        continue;
      }
    }

    try {
      const title = (p.title || "").trim() || slugIn;
      const description = (p.description || title).trim().slice(0, 160);
      const pubDate = (p.pubDate || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
      const markdownBodyRaw = typeof p.markdownBody === "string" ? p.markdownBody : "";
      const markdownForImport = normalizeImportedMarkdownBody(markdownBodyRaw);
      const processedAssets = await processArticleAssets({
        markdown: markdownForImport,
        articleHtml: p.articleHtml,
        sourceUrl: p.sourceUrl,
        featuredImageUrl: p.featuredImageUrl,
        xmlAttachmentUrls: p.xmlAttachmentUrls,
        xmlAttachmentFileNameByUrl: p.xmlAttachmentFileNameByUrl,
        slugBase: slugIn,
        publisher,
        owner,
        repo,
        branch,
      });
      const markdownBody = processedAssets.markdown;
      const heroImage = processedAssets.featuredPath;

      const data: BlogFrontmatterInput = {
        title,
        description,
        pubDate,
        author: (p.author || "Importação CMS").trim() || "Importação CMS",
        heroImage,
        tags: Array.isArray(p.tags) ? p.tags.map((t) => String(t).trim()).filter(Boolean) : [],
        category: p.category?.trim() || undefined,
        draft: p.draft !== false,
      };
      // Compatibilidade: mantém `heroImage` (schema Astro) e adiciona alias `featured`.
      const textBase = serializeBlogMarkdown(markdownBody, data);
      const text = textBase.replace(
        /^heroImage:\s*([^\n]+)$/m,
        (_m, heroRaw: string) => {
          const heroValue = String(heroRaw || "").trim().replace(/^['"]|['"]$/g, "");
          const localHero = normalizeLocalAssetPath(heroValue);
          return `heroImage: "${localHero}"\nfeatured: "${localHero}"`;
        },
      );

      let target: { path: string; slug: string };
      /** Só preenchido quando a API do GitHub exige `sha` (atualização de ficheiro existente). */
      let existingFileSha: string | undefined;
      if (replaceExisting) {
        const sha = await getBlogMarkdownShaIfExists(publisher, owner, repo, branch, slugIn);
        existingFileSha = sha ?? undefined;
        target = { path: `${CMS_PATHS.blog}/${slugIn}.md`, slug: slugIn };
      } else if (allowDuplicates) {
        target = await uniqueBlogPath(publisher, owner, repo, branch, slugIn);
      } else {
        target = { path: `${CMS_PATHS.blog}/${slugIn}.md`, slug: slugIn };
      }
      const { path, slug } = target;
      const didReplace = replaceExisting && Boolean(existingFileSha);
      await publisher.createOrUpdateFile(
        owner,
        repo,
        path,
        text,
        didReplace
          ? `content(blog): atualizar importação «${title}» (${slug})`
          : `content(blog): importar «${title}» (${slug})`,
        { branch, sha: existingFileSha },
      );
      if (didReplace) {
        replaced.push(slug);
      } else {
        created.push(slug);
      }
    } catch (e) {
      errors.push({
        slug: slugIn,
        error: e instanceof Error ? e.message : "Erro desconhecido.",
      });
    }
  }

  const written = created.length + replaced.length;
  let summary: string;
  if (written > 0) {
    const parts: string[] = [];
    if (created.length > 0) parts.push(`${created.length} novo(s)`);
    if (replaced.length > 0) parts.push(`${replaced.length} substituído(s)`);
    summary = `${parts.join(", ")} no ramo ${branch}.`;
    if (skipped.length > 0) summary += ` ${skipped.length} ignorado(s).`;
  } else if (skipped.length > 0) {
    summary = `Nenhum artigo gravado. ${skipped.length} ignorado(s).`;
  } else {
    summary = "Nenhum artigo foi gravado.";
  }

  return json(
    {
      ok: errors.length === 0,
      created,
      replaced,
      skipped,
      errors,
      message: summary,
    },
    errors.length === body.posts!.length ? 502 : 200,
    auth.responseHeaders,
  );
};
