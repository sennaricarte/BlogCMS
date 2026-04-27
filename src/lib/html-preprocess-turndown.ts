import { applyNonColorStyleStripToTree } from "./inline-style-sanitize";

/**
 * Remove par <b>…</b> ou <strong>…</strong> que envolve o HTML inteiro (GDocs).
 * Várias camadas: <b><b>…</b></b>.
 */
export function stripOutermostBoldWrapperHtmlString(html: string): string {
  let t = html.trim();
  for (let i = 0; i < 16; i += 1) {
    const next = stripOneOutermostBoldPair(t);
    if (next === t) {
      break;
    }
    t = next.trim();
  }
  return t;
}

function stripOneOutermostBoldPair(s: string): string {
  const t = s.trim();
  const mB = t.match(/^<b(\s[^>]*)?>([\s\S]*)<\/b>$/i);
  if (mB && mB[2] !== undefined) {
    return mB[2].trim();
  }
  const mS = t.match(/^<strong(\s[^>]*)?>([\s\S]*)<\/strong>$/i);
  if (mS && mS[2] !== undefined) {
    return mS[2].trim();
  }
  return s;
}

/** Sem DOM: tira `font-weight` de `style="..."` no texto (útil em SSR ou fallback). */
export function removeFontWeightFromStyleAttributesInHtmlString(html: string): string {
  return html
    .replace(/style\s*=\s*"([^"]*)"/gi, (_a, inner: string) => {
      let next = inner
        .replace(/font-weight\s*:\s*[^;]+;?/gi, "")
        .replace(/;\s*;/g, ";")
        .replace(/^\s*;|;\s*$/g, "")
        .trim();
      next = next.replace(/;\s*;+/g, ";").trim();
      if (!next) {
        return "";
      }
      return ` style="${next}"`;
    })
    .replace(/\sstyle=""\s/g, " ")
    .replace(/ style=""/g, "");
}

/**
 * Desembrulha <b>/<strong> cujo texto cobre mais de `threshold` do texto total do fragmento.
 */
function depthUnderRoot(el: Element, root: HTMLElement): number {
  let d = 0;
  let p: Node | null = el.parentNode;
  while (p && p !== root) {
    d += 1;
    p = p.parentNode;
  }
  return d;
}

/** Exportado para reutilizar na colagem GDocs (`cleanPastedHtml`). */
export function unwrapBoldCoveringMostOfTree(root: HTMLElement, threshold = 0.9) {
  const totalLen = Math.max(
    1,
    (root.textContent || "").replace(/\s+/g, " ").trim().length,
  );
  for (let pass = 0; pass < 40; pass += 1) {
    const nodes = Array.from(root.querySelectorAll("strong, b")) as HTMLElement[];
    const scored: { el: HTMLElement; n: number; dep: number }[] = [];
    for (const el of nodes) {
      const n = (el.textContent || "").replace(/\s+/g, " ").trim().length;
      const r = n / totalLen;
      if (r > threshold) {
        scored.push({ el, n, dep: depthUnderRoot(el, root) });
      }
    }
    if (scored.length === 0) {
      break;
    }
    scored.sort((a, b) => b.n - a.n || a.dep - b.dep);
    const best = scored[0]?.el;
    if (!best?.parentNode) {
      break;
    }
    const p = best.parentNode;
    while (best.firstChild) {
      p.insertBefore(best.firstChild, best);
    }
    p.removeChild(best);
  }
}

/**
 * Pré-processamento antes do Turndown: regex, remoção de `font-weight` em `style`,
 * unbraid de negrito “quase global” e saneamento de estilos (mantém cores).
 */
export function preprocessHtmlForTurndown(html: string): string {
  let out = (html || "").trim();
  if (!out) {
    return "";
  }
  out = stripOutermostBoldWrapperHtmlString(out);
  out = removeFontWeightFromStyleAttributesInHtmlString(out);

  if (typeof document === "undefined" || typeof DOMParser === "undefined") {
    return out;
  }

  try {
    const wrapped = `<!DOCTYPE html><html><body><div id="__turndown_root">${out}</div></body></html>`;
    const doc = new DOMParser().parseFromString(wrapped, "text/html");
    const root = doc.getElementById("__turndown_root");
    if (!root) {
      return out;
    }
    unwrapBoldCoveringMostOfTree(root, 0.9);
    applyNonColorStyleStripToTree(root);
    return root.innerHTML;
  } catch {
    return out;
  }
}
