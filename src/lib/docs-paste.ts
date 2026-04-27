import { applyNonColorStyleStripToElement } from "./inline-style-sanitize";
import { unwrapBoldCoveringMostOfTree } from "./html-preprocess-turndown";

/**
 * Limpa HTML colado (ex.: Google Docs) para o editor TipTap — equivalente a um
 * `paste_preprocess` do TinyMCE: tira o “lixo” do Docs e aproxima de HTML semântico
 * (negrito/itálico/sublinhado, títulos, listas, ligações; tabelas mantêm-se básicas).
 * Executar apenas no cliente (usa DOMParser).
 */
export function cleanPastedHtml(html: string): string {
  if (typeof window === "undefined" || !html?.trim()) return html;
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.querySelectorAll("style, meta, link[rel='stylesheet'], title, xml").forEach((n) => n.remove());

    const stripBloatAttr = (el: Element) => {
      applyNonColorStyleStripToElement(el);
      el.removeAttribute("class");
      el.removeAttribute("id");
      el.removeAttribute("lang");
      el.removeAttribute("dir");
      el.removeAttribute("title");
      el.removeAttribute("role");
      for (let i = el.attributes.length - 1; i >= 0; i -= 1) {
        const n = el.attributes[i].name;
        if (n.startsWith("data-") || n.startsWith("x-") || n.startsWith("on")) {
          el.removeAttribute(n);
        }
      }
    };
    doc.querySelectorAll("*").forEach((el) => {
      stripBloatAttr(el);
    });

    /* Docs costuma deixar <span> só como recipiente; sem atributos, desembrulha. */
    let spanPasses = 0;
    while (spanPasses < 20) {
      spanPasses += 1;
      let unwrapped = false;
      doc.querySelectorAll("span").forEach((span) => {
        if (span.attributes.length > 0) return;
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        span.remove();
        unwrapped = true;
      });
      if (!unwrapped) break;
    }

    doc.querySelectorAll("b").forEach((b) => {
      const s = doc.createElement("strong");
      s.innerHTML = b.innerHTML;
      b.replaceWith(s);
    });
    doc.querySelectorAll("i").forEach((i) => {
      const em = doc.createElement("em");
      em.innerHTML = i.innerHTML;
      i.replaceWith(em);
    });
    /* Docs antigos / Word ainda podem colar <font> — tira a casca sem alterar o texto. */
    doc.querySelectorAll("font").forEach((f) => {
      const wrap = doc.createElement("span");
      wrap.innerHTML = f.innerHTML;
      f.replaceWith(wrap);
    });
    /* H5/H6 no Docs → o editor (StarterKit) usa só h1–h4. */
    doc.querySelectorAll("h5, h6").forEach((h) => {
      const h4 = doc.createElement("h4");
      h4.append(...Array.from(h.childNodes));
      h.replaceWith(h4);
    });
    /* Contêiner extra em volta de lista (comum no HTML do Docs). */
    liftListsOutOfWrapperDivs(doc);
    /* Novo passe: o Docs adiciona atributos a cada iteração de alguns nós. */
    doc.querySelectorAll("*").forEach((el) => {
      stripBloatAttr(el);
    });
    for (let i = 0; i < 6; i += 1) {
      doc.querySelectorAll("span").forEach((span) => {
        if (span.attributes.length > 0) return;
        const parent = span.parentNode;
        if (!parent) return;
        while (span.firstChild) {
          parent.insertBefore(span.firstChild, span);
        }
        span.remove();
      });
    }
    /* Enquanto o bloco tiver um único <span> filho (só cápsula do Docs), sobe o conteúdo. */
    const blockSel = "p, li, td, th, blockquote, h1, h2, h3, h4, h5, h6, div";
    doc.querySelectorAll(blockSel).forEach((el) => {
      UnwrapOnlyChildSpans(el, 12);
    });

    /**
     * O Docs exporta muitas vezes o parágrafo inteiro em <strong> (só “título” visual).
     * Se o negrito envolve 100% do bloco, remove-se a marca; negrito parcial (frases) mantém-se.
     * Inclui `div`: o colar a partir do Docs muitas vezes usa <div> em vez de <p>.
     */
    const blockHosts = "p, li, td, th, blockquote, div";
    doc.querySelectorAll(blockHosts).forEach((el) => {
      unwrapEntireBlockBold(el);
    });
    doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach((h) => {
      unwrapEntireBlockBold(h);
    });
    /* Docs muitas vezes envia o parágrafo como vários <strong> em sequência (um por frase/palavra). */
    const blockForFragment = "p, li, td, th, blockquote, div, h1, h2, h3, h4, h5, h6";
    doc.querySelectorAll(blockForFragment).forEach((el) => {
      unwrapIfBlockIsOnlyBoldStyling(el);
    });
    if (doc.body) {
      unwrapBoldCoveringMostOfTree(doc.body, 0.9);
    }

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * Sobe conteúdo quando o bloco tem só um filho e esse filho é <span> (cápsula do Docs
 * após `dir` / `class` / `id` / `data-*` removidos).
 */
function UnwrapOnlyChildSpans(block: Element, max: number) {
  for (let n = 0; n < max; n += 1) {
    if (block.children.length !== 1) return;
    const only = block.children[0];
    if (only.tagName !== "SPAN") return;
    if (only.attributes.length > 0) return;
    while (only.firstChild) {
      block.insertBefore(only.firstChild, only);
    }
    only.remove();
  }
}

/** Se um único <strong> ou <b> cobre todo o texto do bloco, desembrulha. */
function unwrapEntireBlockBold(block: Element) {
  for (let guard = 0; guard < 20; guard += 1) {
    if (block.children.length !== 1) return;
    const only = block.children[0];
    const tag = only.tagName;
    if (tag !== "STRONG" && tag !== "B") return;
    const inner = (only.textContent || "").replace(/\s+/g, " ").trim();
    const outer = (block.textContent || "").replace(/\s+/g, " ").trim();
    if (inner.length === 0 || inner !== outer) return;
    while (only.firstChild) {
      block.insertBefore(only.firstChild, only);
    }
    only.remove();
  }
}

/**
 * Cada letra fora de <strong>/<b> = texto “normal” (a colar, não tudo a negrito).
 * Se o bloco tiver <strong> e todo o texto com significado estiver em negrito
 * (Docs “título” ou vários <strong> seguidos), remove as marcas, mantendo nós/BRs.
 */
function hasNonWhitespaceTextOutsideStrongOrB(root: Element): boolean {
  const d = root.ownerDocument;
  if (!d) {
    return false;
  }
  const w = d.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = n as Text;
    if (!/\S/.test(t.textContent || "")) {
      continue;
    }
    const direct = t.parentNode;
    if (direct === root) {
      return true; /* p.ex. "Normal <strong>x</strong>" — o texto "Normal" fica fora de <strong> */
    }
    let p: Node | null = direct;
    let inside = false;
    while (p && p !== root) {
      if (p instanceof Element && (p.tagName === "STRONG" || p.tagName === "B")) {
        inside = true;
        break;
      }
      p = p.parentNode;
    }
    if (!inside) {
      return true; /* p.ex. só itálico, ou links sem negrito */
    }
  }
  return false;
}

function unwrapIfBlockIsOnlyBoldStyling(root: Element) {
  if (!root.querySelector("strong, b")) {
    return;
  }
  if (hasNonWhitespaceTextOutsideStrongOrB(root)) {
    return;
  }
  for (let p = 0; p < 32; p += 1) {
    const next = root.querySelector("strong, b");
    if (!next) {
      break;
    }
    const unwrapped = tryUnwrapNode(next);
    if (!unwrapped) {
      /* Ordem/estrutura inesperada: evita loop infinito. */
      break;
    }
  }
}

function tryUnwrapNode(n: Node): boolean {
  if (n instanceof Element) {
    const t = n.tagName;
    if (t === "STRONG" || t === "B") {
      const p = n.parentNode;
      if (p) {
        while (n.firstChild) {
          p.insertBefore(n.firstChild, n);
        }
        n.remove();
        return true;
      }
    }
  }
  return false;
}

function liftListsOutOfWrapperDivs(doc: Document) {
  for (let i = 0; i < 8; i += 1) {
    let moved = false;
    doc.querySelectorAll("div").forEach((div) => {
      if (div.children.length !== 1) {
        return;
      }
      const c = div.firstElementChild;
      if (!c || (c.tagName !== "UL" && c.tagName !== "OL")) {
        return;
      }
      const p = div.parentNode;
      if (p) {
        p.insertBefore(c, div);
        div.remove();
        moved = true;
      }
    });
    if (!moved) {
      break;
    }
  }
}
