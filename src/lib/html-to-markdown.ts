import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";
import { normalizeLegacyBlogPostMarkdownLinks } from "./blog-post-links";
import { ADMIN_REPO_ASSET_PATH } from "./admin-editor-image-urls";
import { MEDIA_MARKDOWN_RELATIVE_PREFIX, isRawGithubMediaPath } from "./github-raw-url";
import { preprocessHtmlForTurndown } from "./html-preprocess-turndown";

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
  fence: "`",
});

turndown.addRule("underline", {
  filter: "u",
  replacement: (content) => `_${content}_`,
});

/**
 * Iframes (YouTube, etc.): o Markdown padrão não tem sintaxe; mantém o HTML
 * no .md (blocos HTML costumam ser renderizados por marked/Astro no site final).
 */
turndown.addRule("rawIframe", {
  filter: (node) => node.nodeName === "IFRAME",
  replacement: (_content, node) => {
    const el = node as unknown as HTMLElement;
    const raw = el.outerHTML || "";
    return raw ? `\n\n${raw}\n\n` : "";
  },
});

/**
 * Cores/estilos inline (forecolor, etc.): <span style="..."> passa a Markdown híbrido
 * (HTML em linha), em vez de perder a cor por conversão a texto simples.
 */
turndown.addRule("rawStyledSpan", {
  filter: (node) => {
    if (node.nodeName !== "SPAN") {
      return false;
    }
    const el = node as unknown as HTMLElement;
    const st = (el.getAttribute("style") || "").trim();
    if (!st) {
      return false;
    }
    return /color|background|text-decoration|font-size|letter-spacing|vertical-align/.test(st);
  },
  replacement: (_content, node) => {
    const el = node as unknown as HTMLElement;
    return el.outerHTML || "";
  },
});

/**
 * Contentor só com <iframe> (p.ex. resposta alinhada do diálogo de media).
 */
turndown.addRule("rawMediaDiv", {
  filter: (node) => {
    if (node.nodeName !== "DIV") {
      return false;
    }
    const el = node as unknown as HTMLElement;
    const ifr = el.querySelector("iframe");
    if (!ifr || el.children.length !== 1 || el.firstElementChild !== ifr) {
      return false;
    }
    return true;
  },
  replacement: (_content, node) => {
    const el = node as unknown as HTMLElement;
    return `\n\n${el.outerHTML || ""}\n\n`;
  },
});

turndown.use(gfm);

/**
 * Imagens servidas de `raw.githubusercontent.com/.../src/assets/media/...` (pré-visualização
 * no admin) passam a caminho relativo no `.md` (mesmo padrão que `heroImage` em `src/assets/blog/`).
 */
/**
 * Pré-visualização no admin: imagens apontam para {@link ADMIN_REPO_ASSET_PATH}; no .md guardamos
 * `../../assets/blog/…`, `/assets/blog/…` (public) ou `/assets/cms/…`.
 */
turndown.addRule("imgRepoAssetPreviewToRelative", {
  filter: (node) => {
    if (node.nodeName !== "IMG") return false;
    const el = node as unknown as HTMLImageElement;
    const src = (el.getAttribute("src") || "").trim();
    return src.includes(ADMIN_REPO_ASSET_PATH);
  },
  replacement: (content, node) => {
    const el = node as unknown as HTMLImageElement;
    const src = (el.getAttribute("src") || "").trim();
    const alt = (el.getAttribute("alt") || content || "").trim() || "Imagem";
    try {
      const u = new URL(src, "https://preview.invalid");
      const scope = u.searchParams.get("scope");
      const file = u.searchParams.get("file");
      if (!file) return `![${alt}](${src})`;
      const decoded = decodeURIComponent(file);
      if (scope === "blog") {
        return `![${alt}](../../assets/blog/${decoded})`;
      }
      if (scope === "blog-public") {
        return `![${alt}](/assets/blog/${decoded})`;
      }
      if (scope === "cms") {
        return `![${alt}](/assets/cms/${decoded})`;
      }
    } catch {
      /* ignore */
    }
    return `![${alt}](${src})`;
  },
});

turndown.addRule("imgGithubMediaToRelative", {
  filter: (node) => {
    if (node.nodeName !== "IMG") {
      return false;
    }
    const el = node as unknown as HTMLImageElement;
    const href = (el.getAttribute("src") || "").trim();
    return isRawGithubMediaPath(href);
  },
  replacement: (content, node) => {
    const el = node as unknown as HTMLImageElement;
    const href = (el.getAttribute("src") || "").trim();
    const m = href.match(/\/src\/assets\/media\/(.+?)(?:[?#]|$)/i);
    if (!m?.[1]) {
      return `![${(el.getAttribute("alt") || content || "").trim() || "Imagem"}](${href})`;
    }
    const file = decodeURIComponent(m[1].split("/").pop() || m[1]);
    const rel = `${MEDIA_MARKDOWN_RELATIVE_PREFIX}${file}`;
    const alt = (el.getAttribute("alt") || content || "").trim() || "Imagem";
    return `![${alt}](${rel})`;
  },
});

/**
 * GDocs / TipTap: <span> sem atributos e <div> decorativos não devem poluir o .md.
 * (Regras específicas como iframes vêm antes; estas são genéricas para Markdown limpo.)
 */
turndown.addRule("unwrapBareSpan", {
  filter: (node) => {
    if (node.nodeName !== "SPAN") {
      return false;
    }
    const el = node as unknown as HTMLElement;
    return el.attributes.length === 0;
  },
  replacement: (content) => content,
});

turndown.addRule("dropEmptySpanOrDiv", {
  filter: (node) => {
    const t = node.nodeName;
    if (t !== "SPAN" && t !== "DIV") {
      return false;
    }
    return node.childNodes.length === 0;
  },
  replacement: () => "",
});

turndown.addRule("unwrapPlainDiv", {
  filter: (node) => {
    if (node.nodeName !== "DIV") {
      return false;
    }
    const el = node as unknown as HTMLElement;
    if (el.getAttribute("style")?.trim() || el.getAttribute("class")?.trim()) {
      return false;
    }
    if (el.querySelector("iframe")) {
      return false;
    }
    if (el.querySelector("[data-youtube-video], [data-vimeo-video]")) {
      return false;
    }
    return true;
  },
  replacement: (content) => {
    const c = (content || "").trim();
    return c ? `\n\n${c}\n\n` : "";
  },
});

/**
 * Segurança extra (p.ex. se o pré-processador não tiver `document`):
 * <strong>/<b> cujo texto cobre >90% de todo o `body` do fragmento = negrito “global” do GDocs → texto normal.
 */
turndown.addRule("strongOrBIfAlmostEntireBody", {
  filter: (node) => {
    if (node.nodeName !== "STRONG" && node.nodeName !== "B") {
      return false;
    }
    const d = (node as unknown as Node).ownerDocument;
    if (!d?.body) {
      return false;
    }
    const a = (node.textContent || "").replace(/\s+/g, " ").trim().length;
    const b = (d.body.textContent || "").replace(/\s+/g, " ").trim().length;
    if (a < 1 || b < 1) {
      return false;
    }
    return a / b > 0.9;
  },
  replacement: (content) => content,
});

/**
 * Converte o HTML do editor rico em corpo híbrido: Markdown (GFM) + HTML em linha/bloco
 * onde a conversão perderia cor de texto, vídeos, etc. O ficheiro .md serve ao Astro/marked
 * (HTML embutido é habitualmente respeitado no site final).
 */
export function htmlToMarkdown(html: string): string {
  const trimmed = (html || "").trim();
  if (!trimmed) {
    return "";
  }
  const pre = preprocessHtmlForTurndown(trimmed);
  let md = turndown.turndown(pre.html).replace(/\n{3,}/g, "\n\n").trim();
  for (let i = 0; i < pre.preservedTables.length; i += 1) {
    const token = `BLOGCMS-TBL-${i}`;
    const chunk = pre.preservedTables[i]?.trim();
    if (!chunk) continue;
    md = md.split(token).join(`\n\n${chunk}\n\n`);
  }
  md = normalizeLegacyBlogPostMarkdownLinks(md);
  md = normalizeMarkdownAbsoluteAssetImageUrls(md);
  return md.replace(/\n{3,}/g, "\n\n").trim();
}

/** Reduz `![](https://site/assets/blog/x)` para `](/assets/blog/x)` ao gravar (consistente com o site). */
function normalizeMarkdownAbsoluteAssetImageUrls(md: string): string {
  if (!md || (!md.includes("https://") && !md.includes("http://"))) {
    return md;
  }
  let s = md;
  s = s.replace(/\]\(https?:\/\/[^/]+\/assets\/blog\/([^)\]\s]+)\)/gi, "](/assets/blog/$1)");
  s = s.replace(/\]\(https?:\/\/[^/]+\/assets\/cms\/([^)\]\s]+)\)/gi, "](/assets/cms/$1)");
  return s;
}
