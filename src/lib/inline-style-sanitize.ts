/**
 * GDocs/Word: remove ruído de `style` (p.ex. `font-weight:700`) e mantém só
 * o que vamos tratar no Markdown (cores / fundo, útil a SEO/identidade mínima).
 */
export function stripNonColorStylesFromStyleString(style: string | null | undefined): string {
  if (!style?.trim()) {
    return "";
  }
  const parts = style
    .split(";")
    .map((p) => p.trim())
    .filter(Boolean);
  const keep: string[] = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    if (/^font-weight\b|^font-size\b|^font-family\b|^line-height\b|^font\b|^mso-/i.test(low)) {
      continue;
    }
    if (
      /^(color|background(-color)?|opacity|text-decoration-color)\s*:/i.test(low) ||
      /^-webkit-text-fill-color\s*:/i.test(low) ||
      /^-webkit-tap-highlight-color\s*:/i.test(low)
    ) {
      keep.push(p);
    }
  }
  return keep.join("; ").trim();
}

export function applyNonColorStyleStripToElement(el: Element) {
  const st = el.getAttribute("style");
  if (st == null) {
    return;
  }
  const next = stripNonColorStylesFromStyleString(st);
  if (next) {
    el.setAttribute("style", next);
  } else {
    el.removeAttribute("style");
  }
}

export function applyNonColorStyleStripToTree(root: Element | Document) {
  root.querySelectorAll("[style]").forEach((el) => {
    applyNonColorStyleStripToElement(el);
  });
  if (root instanceof Element && root.hasAttribute("style")) {
    applyNonColorStyleStripToElement(root);
  }
}
