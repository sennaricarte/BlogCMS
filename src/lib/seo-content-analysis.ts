/**
 * Análise leve de Markdown (editor de artigos) para checklist de SEO.
 * Sem dependências; seguro de executar no browser.
 */

export type SeoContentCheck = {
  /** Palavra-chave no título (H1 do artigo = front matter title no site) */
  keywordInH1: boolean;
  /** Palavra-chave no primeiro parágrafo de texto do corpo */
  keywordInFirstParagraph: boolean;
  hasInternalLink: boolean;
  hasExternalLink: boolean;
  /** Válido: não há imagens, ou todas têm alt não vazio */
  imagesHaveAlt: boolean;
  /** Sem imagens no corpo */
  hasImages: boolean;
};

/** Links Markdown, excl. imagens `![` */
const LINK_RE = /(?:^|[^!])\[([^\]]*)\]\(([^)]+)\)/gm;
const IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

function normalizeKeyword(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Conteúdo após o primeiro título de markdown (# …), se existir; caso contrário
 * retorna o texto completo. Usado para localizar o “primeiro parágrafo” de leitura.
 */
function bodyAfterFirstMdHeading(md: string): string {
  const m = /(^|\n)#\s+[^\n]+(\n|$)/.exec(md);
  if (m) return md.slice(m.index + m[0].length);
  return md;
}

/**
 * Primeiro bloco de texto (parágrafo) excluindo títulos e blocos de código.
 */
export function getFirstBodyParagraphText(md: string): string {
  const rest = bodyAfterFirstMdHeading(md);
  const blocks = rest.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  for (const block of blocks) {
    if (block.startsWith("#")) continue;
    if (/^```/.test(block)) continue;
    if (/^(\s*[-*+]|\d+\.)\s/m.test(block) && !/^[^\n]+$/m.test(block)) {
      const line = block.split("\n").find((l) => l.trim() && !/^(\s*[-*+]|\d+\.)\s/.test(l));
      if (line) return line.replace(/\*\*?|`/g, "").trim();
    }
    const oneLine = block.split("\n")[0] || block;
    return oneLine.replace(/\*\*?|`/g, "").trim();
  }
  return "";
}

function sameSiteAs(href: string, siteBase: string | undefined): boolean {
  if (!siteBase) return false;
  try {
    const u = new URL(href);
    const b = new URL(siteBase.endsWith("/") ? siteBase : siteBase + "/");
    return u.hostname === b.hostname;
  } catch {
    return false;
  }
}

function isInternalHref(href: string, siteBase: string | undefined): boolean {
  const t = href.trim();
  if (!t || t === "#" || t.startsWith("#")) return true;
  if (t.startsWith("mailto:") || t.startsWith("tel:")) return false;
  if (!/^https?:\/\//i.test(t)) return true;
  return sameSiteAs(t, siteBase);
}

function isExternalHref(href: string, siteBase: string | undefined): boolean {
  const t = href.trim();
  if (!/^https?:\/\//i.test(t)) return false;
  if (t.startsWith("mailto:") || t.startsWith("tel:")) return false;
  return !isInternalHref(t, siteBase);
}

/**
 * @param h1Text — Título do artigo (H1 do template), não o primeiro # do .md
 */
export function analyzeSeoContent(
  markdown: string,
  focusKeyword: string,
  h1Text: string,
  siteBaseForExternal?: string,
): SeoContentCheck {
  const kw = normalizeKeyword(focusKeyword);
  const hasKeyword = Boolean(kw);

  const inH1 = hasKeyword && normalizeKeyword(h1Text).includes(kw);

  const firstP = getFirstBodyParagraphText(markdown);
  const inFirst = hasKeyword && (firstP ? normalizeKeyword(firstP).includes(kw) : false);

  let hasInt = false;
  let hasExt = false;
  let m: RegExpExecArray | null;
  const linkRe = new RegExp(LINK_RE.source, LINK_RE.flags);
  while ((m = linkRe.exec(markdown)) !== null) {
    const href = m[2] || "";
    if (isInternalHref(href, siteBaseForExternal)) hasInt = true;
    if (isExternalHref(href, siteBaseForExternal)) hasExt = true;
  }

  const imgRe = new RegExp(IMAGE_RE.source, "g");
  let hasImg = false;
  let allAlt = true;
  while ((m = imgRe.exec(markdown)) !== null) {
    hasImg = true;
    if (!(m[1] || "").trim()) allAlt = false;
  }

  return {
    keywordInH1: inH1,
    keywordInFirstParagraph: inFirst,
    hasInternalLink: hasInt,
    hasExternalLink: hasExt,
    imagesHaveAlt: !hasImg || allAlt,
    hasImages: hasImg,
  };
}

export type SeoCountTone = "short" | "ideal" | "long";

export function seoTitleCountTone(len: number): SeoCountTone {
  if (len <= 0) return "short";
  if (len < 50) return "short";
  if (len <= 60) return "ideal";
  return "long";
}

export function metaDescriptionCountTone(len: number): SeoCountTone {
  if (len <= 0) return "short";
  if (len < 120) return "short";
  if (len <= 160) return "ideal";
  return "long";
}

export function countToneToClasses(tone: SeoCountTone): string {
  if (tone === "ideal") return "text-emerald-700";
  if (tone === "short") return "text-amber-700";
  return "text-red-700";
}
