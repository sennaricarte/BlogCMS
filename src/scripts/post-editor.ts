import { CMS_PATHS } from "../lib/cms-paths";
import {
  analyzeSeoContent,
  countToneToClasses,
  metaDescriptionCountTone,
  seoTitleCountTone,
} from "../lib/seo-content-analysis";
import { todayIsoDate } from "../lib/scheduled-publish-helpers";

const K_INTEGR = "blogcms-admin-integration";
const K_CMS = "blogcms-cms-target";
const BLOG_CMS = "src/content/blog";

type TaxItem = { slug: string; name: string; description?: string };
type TaxData = { categories: TaxItem[]; tags: TaxItem[] };

function readJson<T>(k: string): T | null {
  try {
    const r = localStorage.getItem(k);
    if (!r) return null;
    return JSON.parse(r) as T;
  } catch {
    return null;
  }
}

function el<T extends HTMLElement>(id: string): T | null {
  return document.getElementById(id) as T | null;
}

function slugRe(s: string, fallback: string) {
  if (!s) return fallback;
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || fallback;
}

function fileToBase64Payload(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = r.result as string;
      const i = s.indexOf(",");
      resolve(i >= 0 ? s.slice(i + 1) : s);
    };
    r.onerror = () => reject(r.error ?? new Error("leitura"));
    r.readAsDataURL(file);
  });
}

function dStr(d: unknown) {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = new Date(String(d));
  return isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
}

function setMsg(text: string, isErr: boolean) {
  const m = el("f-msg");
  if (!m) return;
  m.textContent = text;
  m.className = text
    ? isErr
      ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
      : "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
    : "hidden rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900";
}

function setWarnMsg(text: string) {
  const m = el("f-msg");
  if (!m) return;
  m.textContent = text;
  m.className = text
    ? "rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950"
    : "hidden rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900";
}

let fileSha = "";
let origSlug: string;
let selectedTagSlugs: string[] = [];
let TAX: TaxData = { categories: [], tags: [] };
let createMode = false;

function renderTagButtons() {
  const tagBox = el("f-tag-box");
  if (!tagBox) return;
  tagBox.textContent = "";
  for (const t of TAX.tags) {
    const b = document.createElement("button");
    b.type = "button";
    b.dataset.slug = t.slug;
    b.className =
      "rounded-md border px-2 py-1 text-xs font-medium transition " +
      (selectedTagSlugs.includes(t.slug)
        ? "border-slate-900 bg-slate-900 text-white"
        : "border-slate-200 bg-white text-slate-800 hover:border-slate-300");
    b.textContent = t.name;
    b.addEventListener("click", () => {
      const i = selectedTagSlugs.indexOf(t.slug);
      if (i >= 0) selectedTagSlugs.splice(i, 1);
      else selectedTagSlugs.push(t.slug);
      const hidden = el<HTMLInputElement>("f-tags-hidden");
      if (hidden) hidden.value = JSON.stringify(selectedTagSlugs);
      renderTagButtons();
    });
    tagBox.appendChild(b);
  }
}

/**
 * Inclui slugs a partir do campo de texto (vírgula), normalizando.
 */
function allTagSlugsFromForm(): string[] {
  const exRaw = el<HTMLInputElement>("f-tags");
  const extra = exRaw && exRaw.value ? exRaw.value : "";
  const fromExtra = extra
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => slugRe(s, "t"));
  const seen: Record<string, true> = Object.create(null);
  const o: string[] = [];
  for (const s of selectedTagSlugs) {
    if (s && !seen[s]) {
      seen[s] = true;
      o.push(s);
    }
  }
  for (const s of fromExtra) {
    if (s && !seen[s]) {
      seen[s] = true;
      o.push(s);
    }
  }
  return o;
}

async function appendTaxonomy(kind: "category" | "tag", displayName: string) {
  const name = displayName?.trim();
  if (!name) return;
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
    alert("Configure o GitHub e o repositório alvo (Configurações).");
    return;
  }
  const s = kind === "category" ? slugRe(name, "categoria") : slugRe(name, "tag");
  setMsg("Atualizando taxonomias no GitHub…", false);
  const res = await fetch("/api/admin/cms/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get",
      GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
      githubRepoFullName: target.githubRepoFullName,
      branch: target.branch || "main",
      path: CMS_PATHS.taxonomiesJson,
    }),
  });
  const g = (await res.json()) as { ok: boolean; text?: string; sha?: string; error?: string };
  if (!g.ok || !g.text) {
    setMsg(g.error || "Não foi possível ler taxonomias do GitHub.", true);
    return;
  }
  let data: TaxData;
  try {
    data = JSON.parse(g.text) as TaxData;
  } catch {
    setMsg("JSON de taxonomias inválido no repositório.", true);
    return;
  }
  const list = kind === "category" ? data.categories : data.tags;
  if (list.some((x) => x.slug === s)) {
    setMsg("Já existe um item com o mesmo slug.", true);
    return;
  }
  const item: TaxItem = { slug: s, name, description: `Arquivos: ${name}.` };
  if (kind === "category") data.categories.push(item);
  else data.tags.push(item);
  const body = JSON.stringify({ categories: data.categories, tags: data.tags }, null, 2) + "\n";
  const put = await fetch("/api/admin/cms/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "put",
      GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
      githubRepoFullName: target.githubRepoFullName,
      branch: target.branch || "main",
      path: CMS_PATHS.taxonomiesJson,
      sha: g.sha,
      message: `chore(taxonomia): adicionar ${kind} ${s}`,
      content: body,
    }),
  });
  const p = (await put.json()) as { ok: boolean; error?: string };
  if (!p.ok) {
    setMsg(p.error || "Falha ao salvar as taxonomias.", true);
    return;
  }
  TAX = data;
  if (kind === "tag") {
    if (!selectedTagSlugs.includes(s)) selectedTagSlugs.push(s);
  }
  rebuildCategorySelect();
  renderTagButtons();
  const hidden = el<HTMLInputElement>("f-tags-hidden");
  if (hidden) hidden.value = JSON.stringify(selectedTagSlugs);
  if (kind === "category") {
    const cat = el<HTMLSelectElement>("f-cat");
    if (cat) cat.value = s;
  }
  setMsg("Taxonomia atualizada no repositório. Faça o deploy para refletir no site.", false);
}

function rebuildCategorySelect() {
  const catSel = el<HTMLSelectElement>("f-cat");
  if (!catSel) return;
  const v = catSel.value;
  catSel.textContent = "";
  const o0 = document.createElement("option");
  o0.value = "";
  o0.textContent = "— nenhuma —";
  catSel.appendChild(o0);
  for (const c of TAX.categories) {
    const o = document.createElement("option");
    o.value = c.slug;
    o.textContent = c.name;
    catSel.appendChild(o);
  }
  catSel.value = TAX.categories.some((x) => x.slug === v) ? v : "";
}

function normalizeTagFromFrontmatter(val: string): string {
  return slugRe(val, "t");
}

type ServerInitial = {
  slug: string;
  title: string;
  seoTitle?: string;
  seoFocusKeyword?: string;
  description: string;
  body: string;
  pubDate: string;
  updatedDate: string;
  author: string;
  heroImage: string;
  tags: string[];
  category: string;
  draft: boolean;
};

function syncSeoTitleCount() {
  const input = el<HTMLInputElement>("f-seo-title");
  const count = el("f-seo-title-count");
  if (!input || !count) return;
  const n = input.value.length;
  count.textContent = `${n}/60`;
  const tone = seoTitleCountTone(n);
  count.className = "text-xs font-medium tabular-nums " + countToneToClasses(tone);
}

function syncDescCount() {
  const desc = el<HTMLTextAreaElement>("f-desc");
  const count = el("f-desc-count");
  if (desc && count) {
    const n = desc.value.length;
    count.textContent = `${n}/160`;
    const tone = metaDescriptionCountTone(n);
    count.className = "text-xs font-medium tabular-nums " + countToneToClasses(tone);
  }
}

/**
 * Compara a data de publicação com hoje: futura → força rascunho (agendado) e `scheduled` guardado.
 */
function syncScheduleUi() {
  const pub = el<HTMLInputElement>("f-pub");
  const draftEl = el<HTMLInputElement>("f-draft");
  const hint = el("f-schedule-hint");
  if (!pub || !draftEl) return;
  const today = todayIsoDate();
  const future = pub.value > today;
  if (future) {
    draftEl.checked = true;
    draftEl.disabled = true;
  } else {
    draftEl.disabled = false;
  }
  if (hint) {
    if (future) {
      hint.textContent =
        "Agendado: o artigo fica em rascunho até à data (publicação automática via API e GitHub, p.ex. cron na Vercel).";
      hint.className = "mt-1.5 min-h-[1.25rem] text-xs text-amber-800";
    } else {
      hint.textContent = "";
      hint.className = "mt-1.5 min-h-[1.25rem] text-xs";
    }
  }
}

function syncSlugFileHint() {
  const slugIn = el<HTMLInputElement>("f-slug");
  const fileEl = el("f-slug-file");
  if (slugIn && fileEl) {
    const s = slugRe(slugIn.value, "artigo");
    fileEl.textContent = s ? `${s}.md` : "—.md";
  }
}

function getPublicSiteBase(): string {
  const root = el("post-form-root");
  const fromData = root?.getAttribute("data-public-site")?.trim() ?? "";
  if (fromData && /^https?:\/\//i.test(fromData)) {
    return fromData.replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin.replace(/\/$/, "");
  }
  return "";
}

/**
 * Prévia da URL pública: site + caminho do slug à raiz (ex. `/meu-artigo/`).
 */
function syncSeoSlugPreview() {
  const slugIn = el<HTMLInputElement>("f-slug");
  const prev = el("f-seo-slug-preview");
  if (!prev) return;
  const base = getPublicSiteBase();
  const s = slugIn ? slugRe(slugIn.value, "artigo") : "";
  if (!s) {
    prev.textContent = base ? `${base}/…/` : "/…/";
    return;
  }
  prev.textContent = `${base}/${s}/`;
}

function setSeoItem(
  idMark: string,
  ok: boolean,
  hasKeyword: boolean,
  name: string,
) {
  const mark = el(idMark);
  if (!mark) return;
  if (!hasKeyword) {
    mark.textContent = "—";
    mark.setAttribute("aria-label", "—");
    mark.className = "w-4 shrink-0 text-slate-400";
    mark.removeAttribute("title");
  } else if (ok) {
    mark.textContent = "✓";
    mark.setAttribute("aria-label", "Conforme: " + name);
    mark.className = "w-4 shrink-0 text-emerald-600";
  } else {
    mark.textContent = "✗";
    mark.setAttribute("aria-label", "A melhorar: " + name);
    mark.className = "w-4 shrink-0 text-red-600";
  }
}

function runSeoCheck() {
  const kw = el<HTMLInputElement>("f-seo-keyword")?.value?.trim() ?? "";
  const bodyMd = el<HTMLInputElement>("f-body")?.value ?? "";
  const titleH1 = el<HTMLInputElement>("f-title")?.value ?? "";
  const siteB = getPublicSiteBase() || undefined;
  const r = analyzeSeoContent(bodyMd, kw, titleH1, siteB);
  const hasKw = Boolean(kw);
  setSeoItem("f-seo-c-h1", r.keywordInH1, hasKw, "palavra-chave no título (H1 do artigo)");
  setSeoItem("f-seo-c-p1", r.keywordInFirstParagraph, hasKw, "palavra-chave no primeiro parágrafo do texto");
  setSeoItem("f-seo-c-lint", r.hasInternalLink, true, "link interno no texto");
  setSeoItem("f-seo-c-lext", r.hasExternalLink, true, "link externo no texto");
  const altOk = !r.hasImages || (r.hasImages && r.imagesHaveAlt);
  setSeoItem("f-seo-c-alt", altOk, true, "texto alternativo (alt) em todas as imagens do corpo");
}

/**
 * Carga inicial a partir do ficheiro local (Astro) antes de sincronizar com o GitHub.
 */
function applyServerInitial() {
  const node = el("server-initial");
  if (!node || !node.textContent?.trim()) return;
  let init: ServerInitial;
  try {
    init = JSON.parse(node.textContent) as ServerInitial;
  } catch {
    return;
  }
  if (el<HTMLInputElement>("f-title")) el("f-title")!.value = init.title;
  if (el<HTMLInputElement>("f-slug")) el("f-slug")!.value = init.slug;
  if (el<HTMLInputElement>("f-pub") && init.pubDate) el("f-pub")!.value = init.pubDate.slice(0, 10);
  if (el<HTMLInputElement>("f-upd") && init.updatedDate) {
    el("f-upd")!.value = init.updatedDate.slice(0, 10);
  }
  if (el<HTMLInputElement>("f-seo-title")) el("f-seo-title")!.value = init.seoTitle ?? "";
  if (el<HTMLInputElement>("f-seo-keyword")) el("f-seo-keyword")!.value = init.seoFocusKeyword ?? "";
  if (el<HTMLTextAreaElement>("f-desc")) el("f-desc")!.value = init.description;
  if (el<HTMLInputElement>("f-auth") && init.author) el("f-auth")!.value = init.author;
  if (el<HTMLInputElement>("f-hero") && init.heroImage) {
    el("f-hero")!.value = init.heroImage;
  }
  if (el<HTMLInputElement>("f-draft")) el("f-draft")!.checked = init.draft;
  const cat = el<HTMLSelectElement>("f-cat");
  if (cat) {
    const cs = (init.category || "").trim().toLowerCase();
    cat.value = TAX.categories.some((x) => x.slug === cs) ? cs : "";
  }
  if (init.tags && Array.isArray(init.tags)) {
    const raw = init.tags;
    selectedTagSlugs = raw.map((t) => normalizeTagFromFrontmatter(String(t)));
    const inTax = (slug: string) => TAX.tags.some((t) => t.slug === slug);
    const onlyExtra = raw.filter((t) => !inTax(normalizeTagFromFrontmatter(String(t))));
    if (el<HTMLInputElement>("f-tags") && onlyExtra.length) {
      el("f-tags")!.value = onlyExtra.join(", ");
    } else if (el<HTMLInputElement>("f-tags")) {
      el("f-tags")!.value = "";
    }
  } else {
    selectedTagSlugs = [];
  }
  const hidden = el<HTMLInputElement>("f-tags-hidden");
  if (hidden) hidden.value = JSON.stringify(selectedTagSlugs);
  renderTagButtons();
  if (el<HTMLInputElement>("f-body") && init.body) el("f-body")!.value = init.body;
  syncSeoTitleCount();
  syncDescCount();
  syncSlugFileHint();
  syncSeoSlugPreview();
  syncScheduleUi();
  el<HTMLInputElement>("f-body")?.dispatchEvent(new Event("input"));
}

async function loadRemote() {
  if (createMode) return;
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
    setWarnMsg(
      "Exibindo o artigo a partir de src/content/blog (cópia local). Configure o token e o repositório em /admin/settings/ para sincronizar e obter o SHA ao salvar no GitHub.",
    );
    return;
  }
  const p = `${BLOG_CMS}/${origSlug}.md`;
  setMsg("Carregando do GitHub…", false);
  const res = await fetch("/api/admin/cms/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get",
      GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
      githubRepoFullName: target.githubRepoFullName,
      branch: target.branch || "main",
      path: p,
      parseFrontmatter: true,
    }),
  });
  const j = (await res.json()) as {
    ok: boolean;
    error?: string;
    sha?: string;
    data?: Record<string, unknown>;
    content?: string;
  };
  if (!j.ok) {
    setWarnMsg(
      `Não foi possível carregar o arquivo do GitHub (${j.error || "erro desconhecido"}). Editando a cópia local (workspace).`,
    );
    return;
  }
  fileSha = j.sha || "";
  const d = j.data || {};
  if (el<HTMLInputElement>("f-title") && d.title) el("f-title")!.value = String(d.title);
  if (el<HTMLInputElement>("f-slug")) el("f-slug")!.value = origSlug;
  if (el<HTMLInputElement>("f-pub") && d.pubDate) el("f-pub")!.value = dStr(d.pubDate);
  if (el<HTMLInputElement>("f-upd") && d.updatedDate) el("f-upd")!.value = dStr(d.updatedDate);
  if (el<HTMLInputElement>("f-seo-title") && d.seoTitle != null) {
    el("f-seo-title")!.value = String(d.seoTitle);
  }
  if (el<HTMLInputElement>("f-seo-keyword") && d.seoFocusKeyword != null) {
    el("f-seo-keyword")!.value = String(d.seoFocusKeyword);
  }
  if (el<HTMLTextAreaElement>("f-desc") && d.description) el("f-desc")!.value = String(d.description);
  if (el<HTMLInputElement>("f-auth") && d.author) el("f-auth")!.value = String(d.author);
  if (el<HTMLInputElement>("f-hero") && d.heroImage) el("f-hero")!.value = String(d.heroImage);
  const cat = el<HTMLSelectElement>("f-cat");
  if (cat && d.category) {
    const cs = String(d.category).trim().toLowerCase();
    cat.value = TAX.categories.some((x) => x.slug === cs) ? cs : "";
  }
  if (el<HTMLInputElement>("f-draft")) el("f-draft")!.checked = Boolean(d.draft);
  if (d.tags && Array.isArray(d.tags)) {
    const raw = d.tags as string[];
    selectedTagSlugs = raw.map((t) => normalizeTagFromFrontmatter(String(t)));
    const inTax = (slug: string) => TAX.tags.some((t) => t.slug === slug);
    const onlyExtra = raw.filter(
      (t) => !inTax(normalizeTagFromFrontmatter(String(t))),
    );
    if (el<HTMLInputElement>("f-tags") && onlyExtra.length) {
      el("f-tags")!.value = onlyExtra.join(", ");
    }
  } else {
    selectedTagSlugs = [];
  }
  const hidden = el<HTMLInputElement>("f-tags-hidden");
  if (hidden) hidden.value = JSON.stringify(selectedTagSlugs);
  renderTagButtons();
  const bodyIn = el<HTMLInputElement>("f-body");
  if (bodyIn && typeof j.content === "string") {
    const md = j.content;
    bodyIn.value = md;
    const notifyTipTap = () => {
      window.dispatchEvent(new CustomEvent("blogcms-post-body", { detail: { markdown: md } }));
    };
    notifyTipTap();
    queueMicrotask(notifyTipTap);
    setTimeout(notifyTipTap, 120);
    setTimeout(notifyTipTap, 380);
    setTimeout(notifyTipTap, 900);
    setTimeout(notifyTipTap, 2200);
  }
  setMsg("", false);
  syncSeoTitleCount();
  syncDescCount();
  syncSlugFileHint();
  syncSeoSlugPreview();
  syncScheduleUi();
  bodyIn?.dispatchEvent(new Event("input"));
}

/** Atualiza análise SEO a partir do Markdown em #f-body (sem segunda coluna de pré-visualização). */
function runSeoFromBody() {
  runSeoCheck();
}

function wire() {
  const root = el("post-form-root");
  if (!root) return;
  createMode = root.getAttribute("data-mode") === "create";
  origSlug = (root.getAttribute("data-initial-slug") || "novo").trim();
  try {
    TAX = JSON.parse(root.getAttribute("data-taxonomies") || "{}") as TaxData;
  } catch {
    TAX = { categories: [], tags: [] };
  }
  if (!Array.isArray(TAX.categories)) TAX.categories = [];
  if (!Array.isArray(TAX.tags)) TAX.tags = [];

  const titleEl = el<HTMLInputElement>("f-title");
  const slugEl = el<HTMLInputElement>("f-slug");
  const autoSlug = el<HTMLInputElement>("f-auto-slug");
  if (titleEl && slugEl && autoSlug) {
    titleEl.addEventListener("input", () => {
      if (autoSlug.checked) {
        slugEl.value = slugRe(titleEl.value, "artigo");
        syncSlugFileHint();
        syncSeoSlugPreview();
      }
    });
  }
  titleEl?.addEventListener("input", () => runSeoCheck());
  el<HTMLInputElement>("f-seo-title")?.addEventListener("input", () => {
    syncSeoTitleCount();
  });
  el<HTMLInputElement>("f-seo-keyword")?.addEventListener("input", () => {
    runSeoCheck();
  });

  if (createMode) {
    if (autoSlug) autoSlug.checked = true;
    if (el<HTMLInputElement>("f-hero") && !el("f-hero")!.value) {
      el("f-hero")!.value = "../../assets/blog/hero-primeiro.svg";
    }
  }

  rebuildCategorySelect();
  const hint = el("f-sugg-hint");
  if (hint) hint.textContent = TAX.tags.map((t) => t.name).join(", ");
  el<HTMLButtonElement>("btn-new-cat")?.addEventListener("click", () => {
    const n = window.prompt("Nome da nova categoria:");
    if (n) void appendTaxonomy("category", n);
  });
  el<HTMLButtonElement>("btn-new-tag")?.addEventListener("click", () => {
    const n = window.prompt("Nome da nova etiqueta:");
    if (n) void appendTaxonomy("tag", n);
  });

  if (createMode) {
    if (el<HTMLInputElement>("f-tags-hidden")) el("f-tags-hidden")!.value = JSON.stringify([]);
    renderTagButtons();
  } else {
    applyServerInitial();
  }

  el<HTMLTextAreaElement>("f-desc")?.addEventListener("input", () => {
    syncDescCount();
  });
  el<HTMLInputElement>("f-slug")?.addEventListener("input", () => {
    syncSlugFileHint();
    syncSeoSlugPreview();
  });
  el<HTMLInputElement>("f-pub")?.addEventListener("input", () => {
    syncScheduleUi();
  });
  syncSeoTitleCount();
  syncDescCount();
  if (!createMode) {
    syncSlugFileHint();
    syncSeoSlugPreview();
  }

  el<HTMLInputElement>("f-body")?.addEventListener("input", runSeoFromBody);
  if (el("f-delete")) (el("f-delete") as HTMLButtonElement).style.display = createMode ? "none" : "";
  if (createMode) {
    syncSeoSlugPreview();
    runSeoCheck();
  }
  if (createMode) {
    if (el<HTMLInputElement>("f-pub") && !el("f-pub")!.value) {
      el("f-pub")!.value = new Date().toISOString().slice(0, 10);
    }
    syncScheduleUi();
  } else {
    void loadRemote();
  }

  el<HTMLInputElement>("f-hero-file")?.addEventListener("change", (ev) => {
    void onHeroFileUpload(ev);
  });

  el<HTMLButtonElement>("f-save")?.addEventListener("click", onSave);
  if (!createMode) el<HTMLButtonElement>("f-delete")?.addEventListener("click", onDelete);
}

const HERO_PICK_DEFAULT = "Nenhum arquivo selecionado";

function setHeroPickLabel(text: string) {
  const n = el("f-hero-file-name");
  if (n) n.textContent = text;
}

async function onHeroFileUpload(ev: Event) {
  const input = ev.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  const status = el("f-hero-upload-status");
  setHeroPickLabel(file.name);
  if (status) status.textContent = "Enviando…";
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ?.GITHUB_PERSONAL_TOKEN) {
    if (status) status.textContent = "";
    setHeroPickLabel(HERO_PICK_DEFAULT);
    setMsg("Token do GitHub em falta. Abra /admin/settings/.", true);
    return;
  }
  if (!target?.githubRepoFullName) {
    if (status) status.textContent = "";
    setHeroPickLabel(HERO_PICK_DEFAULT);
    setMsg("Repositório alvo em falta (Configurações).", true);
    return;
  }
  let contentBase64: string;
  try {
    contentBase64 = await fileToBase64Payload(file);
  } catch {
    if (status) status.textContent = "";
    setHeroPickLabel(HERO_PICK_DEFAULT);
    setMsg("Não foi possível ler o arquivo de imagem.", true);
    return;
  }
  try {
    const res = await fetch("/api/admin/cms/upload-blog-hero", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
        githubRepoFullName: target.githubRepoFullName,
        branch: target.branch || "main",
        contentBase64,
      }),
    });
    const j = (await res.json()) as { ok?: boolean; error?: string; heroImage?: string };
    if (!res.ok || !j.ok || !j.heroImage) {
      if (status) status.textContent = "";
      setHeroPickLabel(HERO_PICK_DEFAULT);
      setMsg(j.error || "Falha no envio da imagem para o GitHub.", true);
      return;
    }
    const hero = el<HTMLInputElement>("f-hero");
    if (hero) hero.value = j.heroImage;
    if (status) status.textContent = "Imagem enviada.";
    setHeroPickLabel(HERO_PICK_DEFAULT);
    setMsg("Imagem de destaque enviada para o repositório. Salve o artigo para registrar o commit com o novo caminho.", false);
  } catch {
    if (status) status.textContent = "";
    setHeroPickLabel(HERO_PICK_DEFAULT);
    setMsg("Falha de rede ao enviar a imagem.", true);
  }
  window.setTimeout(() => {
    const st = el("f-hero-upload-status");
    if (st) st.textContent = "";
  }, 4000);
}

async function onSave() {
  setMsg("");
  const saving = el("f-saving");
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ?.GITHUB_PERSONAL_TOKEN) {
    setMsg("Token do GitHub em falta. Abra /admin/settings/.", true);
    return;
  }
  if (!target?.githubRepoFullName) {
    setMsg("Repositório alvo em falta (Configurações).", true);
    return;
  }
  if (!el<HTMLInputElement>("f-title")?.value.trim()) {
    setMsg("O título é obrigatório.", true);
    return;
  }
  const newSlug = slugRe(el<HTMLInputElement>("f-slug")!.value, "artigo");
  if (!createMode && newSlug !== origSlug) {
    if (
      !window.confirm(
        "O slug mudou; o novo arquivo será " +
        newSlug +
        ".md. Você precisa excluir o arquivo antigo se não for mais necessário. Continuar?",
      )
    ) {
      return;
    }
  }
  const pubStr = el<HTMLInputElement>("f-pub")!.value;
  const isFuturePub = pubStr > todayIsoDate();
  const blogData: import("../lib/cms-matter").BlogFrontmatterInput = {
    title: el<HTMLInputElement>("f-title")!.value,
    description: el<HTMLTextAreaElement>("f-desc")!.value,
    pubDate: pubStr,
    author: el<HTMLInputElement>("f-auth")!.value || "Equipa",
    heroImage: el<HTMLInputElement>("f-hero")!.value || "../../assets/blog/hero-primeiro.svg",
    tags: allTagSlugsFromForm(),
    draft: isFuturePub ? true : Boolean(el<HTMLInputElement>("f-draft")?.checked),
  };
  if (isFuturePub) {
    blogData.scheduled = true;
  }
  const seoT = el<HTMLInputElement>("f-seo-title")?.value?.trim();
  if (seoT) blogData.seoTitle = seoT;
  const seoK = el<HTMLInputElement>("f-seo-keyword")?.value?.trim();
  if (seoK) blogData.seoFocusKeyword = seoK;
  if (el<HTMLInputElement>("f-upd")?.value) blogData.updatedDate = el("f-upd")!.value;
  const c = el<HTMLSelectElement>("f-cat")?.value;
  if (c) blogData.category = c;
  if (saving) saving.textContent = "Salvando no GitHub…";
  el<HTMLButtonElement>("f-save")!.disabled = true;
  const path = `${BLOG_CMS}/${newSlug}.md`;
  try {
    const res = await fetch("/api/admin/cms/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "putBlog",
        GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
        githubRepoFullName: target.githubRepoFullName,
        branch: target.branch || "main",
        path,
        sha: !createMode && newSlug === origSlug ? fileSha : undefined,
        message: "content(blog): " + blogData.title,
        blog: { data: blogData, body: el<HTMLInputElement>("f-body")!.value || "" },
      }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string; sha?: string };
    if (!j.ok) {
      setMsg(j.error || "Falha ao salvar", true);
      return;
    }
    fileSha = j.sha || "";
    if (createMode) {
      window.location.href = "/admin/posts/edit/" + newSlug + "/";
      return;
    }
    if (newSlug !== origSlug) {
      window.location.href = "/admin/posts/edit/" + newSlug + "/";
    } else {
      setMsg("Alterações salvas com commit no repositório do GitHub.", false);
    }
  } catch {
    setMsg("Falha de rede ao salvar.", true);
  } finally {
    if (saving) saving.textContent = "";
    if (el<HTMLButtonElement>("f-save")) el("f-save")!.disabled = false;
  }
}

async function onDelete() {
  if (!fileSha) {
    setMsg("Não é possível excluir sem carregar o arquivo (SHA).", true);
    return;
  }
  if (!window.confirm("Excluir " + origSlug + ".md no GitHub?")) return;
  const saving = el("f-saving");
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ) return;
  if (saving) saving.textContent = "Excluindo…";
  const p = `${BLOG_CMS}/${origSlug}.md`;
  try {
    const res = await fetch("/api/admin/cms/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
        githubRepoFullName: target.githubRepoFullName,
        branch: target.branch || "main",
        path: p,
        sha: fileSha,
        message: "chore: remover " + p,
      }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string };
    if (!j.ok) {
      setMsg(j.error || "Erro ao excluir", true);
      return;
    }
    window.location.href = "/admin/posts/";
  } catch {
    setMsg("Falha de rede.", true);
  } finally {
    if (saving) saving.textContent = "";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
