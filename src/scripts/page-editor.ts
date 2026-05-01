import type { PageFrontmatterInput } from "../lib/cms-matter";
import type { PageBlock } from "../lib/page-blocks.zod";

const K_INTEGR = "blogcms-admin-integration";
const K_CMS = "blogcms-cms-target";
const PAGES = "src/content/pages";

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

function setMsg(text: string, isErr: boolean) {
  const m = el("p-msg");
  if (!m) return;
  m.textContent = text;
  m.className = text
    ? isErr
      ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
      : "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
    : "hidden rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900";
}

function slugRe(s: string) {
  if (!s) return "pagina";
  let t = s
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "");
  // Evitar colar o caminho completo: /p/teste2/ ou p/teste2/ → teste2
  if (t.startsWith("p/")) t = t.slice(2);
  t = t.replace(/^\/+|\/+$/g, "");
  return (
    t
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "pagina"
  );
}

let fileSha = "";
let origSlug = "";
let createMode = false;

function dStr(d: unknown) {
  if (!d) return "";
  if (d instanceof Date) return d.toISOString().slice(0, 10);
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  const x = new Date(String(d));
  return isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
}

async function loadEdit() {
  if (createMode) return;
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
    setMsg("Configure o token e o repositório em /admin/settings/.", true);
    return;
  }
  setMsg("Carregando do GitHub…", false);
  const res = await fetch("/api/admin/cms/github", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "get",
      GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
      githubRepoFullName: target.githubRepoFullName,
      branch: target.branch || "main",
      path: `${PAGES}/${origSlug}.md`,
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
    setMsg(j.error || "Erro ao carregar.", true);
    return;
  }
  fileSha = j.sha || "";
  const d = j.data || {};
  if (el<HTMLInputElement>("p-title") && d.title) el("p-title")!.value = String(d.title);
  if (el<HTMLInputElement>("p-slug")) el("p-slug")!.value = origSlug;
  if (el<HTMLTextAreaElement>("p-desc") && d.description) el("p-desc")!.value = String(d.description);
  if (el<HTMLInputElement>("p-pub") && d.pubDate) el("p-pub")!.value = dStr(d.pubDate);
  if (el<HTMLInputElement>("p-upd") && d.updatedDate) el("p-upd")!.value = dStr(d.updatedDate);
  if (el<HTMLInputElement>("p-draft")) el("p-draft")!.checked = Boolean(d.draft);
  const bodyIn = el<HTMLInputElement>("p-body");
  if (bodyIn && typeof j.content === "string") {
    bodyIn.value = j.content;
    window.dispatchEvent(
      new CustomEvent("blogcms-page-body", { detail: { markdown: j.content } }),
    );
  }
  const pb: PageBlock[] = Array.isArray(d.pageBlocks) ? (d.pageBlocks as PageBlock[]) : [];
  const pbIn = el<HTMLInputElement>("p-page-blocks");
  if (pbIn) {
    pbIn.value = JSON.stringify(pb);
    window.dispatchEvent(new CustomEvent("blogcms-page-blocks", { detail: { blocks: pb } }));
  }
  setMsg("", false);
}

function wire() {
  const root = el("page-form-root");
  if (!root) return;
  createMode = root.getAttribute("data-mode") === "create";
  origSlug = (root.getAttribute("data-initial-slug") || "nova").trim();
  if (el("p-del")) (el("p-del") as HTMLButtonElement).style.display = createMode ? "none" : "";
  if (el<HTMLInputElement>("p-pub") && !el("p-pub")?.value) {
    el("p-pub")!.value = new Date().toISOString().slice(0, 10);
  }
  const t = el<HTMLInputElement>("p-title");
  const s = el<HTMLInputElement>("p-slug");
  const a = el<HTMLInputElement>("p-auto-slug");
  if (t && s && a) {
    t.addEventListener("input", () => {
      if (a.checked) s.value = slugRe(t.value);
    });
  }
  if (s) {
    s.addEventListener("blur", () => {
      const v = s.value.trim();
      if (!v) return;
      const n = slugRe(v);
      if (n !== v) s.value = n;
    });
  }
  if (createMode) {
    if (s && !s.value) s.value = "nova-pagina";
  } else {
    void loadEdit();
  }
  el<HTMLButtonElement>("p-save")?.addEventListener("click", onSave);
  if (!createMode) el<HTMLButtonElement>("p-del")?.addEventListener("click", onDelete);
}

async function onSave() {
  setMsg("");
  const saving = el("p-saving");
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
    setMsg("Tokens e repositório em falta.", true);
    return;
  }
  if (!el<HTMLInputElement>("p-title")?.value.trim() || !el<HTMLTextAreaElement>("p-desc")?.value.trim()) {
    setMsg("Título e descrição são obrigatórios.", true);
    return;
  }
  const newSlug = slugRe(el<HTMLInputElement>("p-slug")?.value || "");
  if (!createMode && newSlug !== origSlug) {
    if (!window.confirm("O slug mudou; será criado um arquivo novo. Remova o antigo se necessário. Continuar?")) return;
  }
  let pageBlocks: PageBlock[] = [];
  const pbEl = el<HTMLInputElement>("p-page-blocks");
  if (pbEl?.value) {
    try {
      const p = JSON.parse(pbEl.value) as unknown;
      if (Array.isArray(p)) pageBlocks = p as PageBlock[];
    } catch {
      pageBlocks = [];
    }
  }
  const d: PageFrontmatterInput = {
    title: el<HTMLInputElement>("p-title")!.value,
    description: el<HTMLTextAreaElement>("p-desc")!.value,
    pubDate: el<HTMLInputElement>("p-pub")!.value,
    draft: Boolean(el<HTMLInputElement>("p-draft")?.checked),
    pageBlocks: pageBlocks.length > 0 ? pageBlocks : undefined,
  };
  if (el<HTMLInputElement>("p-upd")?.value) d.updatedDate = el("p-upd")!.value;
  if (saving) saving.textContent = "Salvando…";
  if (el<HTMLButtonElement>("p-save")) el("p-save")!.disabled = true;
  const path = `${PAGES}/${newSlug}.md`;
  try {
    const res = await fetch("/api/admin/cms/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "putPage",
        GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
        githubRepoFullName: target.githubRepoFullName,
        branch: target.branch || "main",
        path,
        sha: !createMode && newSlug === origSlug ? fileSha : undefined,
        message: "content(página): " + d.title,
        page: { data: d, body: el<HTMLInputElement>("p-body")!.value || "" },
      }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string; sha?: string };
    if (!j.ok) {
      setMsg(j.error || "Falha ao salvar", true);
      return;
    }
    fileSha = j.sha || "";
    if (createMode) {
      window.location.href = "/admin/pages/edit/" + newSlug + "/";
    } else if (newSlug !== origSlug) {
      window.location.href = "/admin/pages/edit/" + newSlug + "/";
    } else {
      const isDraft = Boolean(el<HTMLInputElement>("p-draft")?.checked);
      setMsg(
        isDraft
          ? "Salvo no GitHub. Com «Rascunho» activo, /p/… em produção continua em 404 até publicares."
          : "Salvo no GitHub. A URL pública só reflecte a alteração depois do deploy na Vercel (e com rascunho desmarcado).",
        false,
      );
    }
  } catch {
    setMsg("Falha de rede.", true);
  } finally {
    if (saving) saving.textContent = "";
    if (el<HTMLButtonElement>("p-save")) el("p-save")!.disabled = false;
  }
}

async function onDelete() {
  if (!fileSha) {
    setMsg("SHA em falta; recarregue a página.", true);
    return;
  }
  if (!window.confirm("Excluir " + origSlug + ".md?")) return;
  const integ = readJson<Record<string, string>>(K_INTEGR);
  const target = readJson<Record<string, string>>(K_CMS);
  if (!integ) return;
  if (el("p-saving")) el("p-saving")!.textContent = "Excluindo…";
  try {
    const res = await fetch("/api/admin/cms/github", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "delete",
        GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
        githubRepoFullName: target.githubRepoFullName,
        branch: target.branch || "main",
        path: `${PAGES}/${origSlug}.md`,
        sha: fileSha,
        message: "chore: remover página (CMS)",
      }),
    });
    const j = (await res.json()) as { ok: boolean; error?: string };
    if (!j.ok) {
      setMsg(j.error || "Erro", true);
      return;
    }
    window.location.href = "/admin/pages/";
  } catch {
    setMsg("Falha de rede.", true);
  } finally {
    if (el("p-saving")) el("p-saving")!.textContent = "";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", wire);
} else {
  wire();
}
