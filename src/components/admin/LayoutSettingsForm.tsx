import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientConfig, SiteConfig } from "../../lib/publisher";
import { ADMIN_CMS_TARGET_KEY } from "../../lib/admin-cms-target";
import { ADMIN_INTEGRATION_STORAGE_KEY } from "../../lib/admin-storage";
import { CMS_PATHS } from "../../lib/cms-paths";
import { uploadCmsMediaFile } from "../../lib/cms-media-upload";
import { StorageImagePickerModal } from "./StorageImagePickerModal";

const CONFIG_PATH = CMS_PATHS.siteConfigJson;
const LEGACY_CONFIG_PATH = CMS_PATHS.legacyClientConfigJson;

function readJson<T>(k: string): T | null {
  try {
    const r = localStorage.getItem(k);
    if (!r) return null;
    return JSON.parse(r) as T;
  } catch {
    return null;
  }
}

function normalizeConfig(base: ClientConfig): ClientConfig {
  return {
    ...base,
    nomeMarca: String(base.nomeMarca || "").trim() || "Site",
    descricaoSeo: typeof base.descricaoSeo === "string" ? base.descricaoSeo : "",
    cores: {
      primaria: (base.cores?.primaria && String(base.cores.primaria).trim()) || "#0ea5e9",
      secundaria: (base.cores?.secundaria && String(base.cores.secundaria).trim()) || "#64748b",
    },
    menuLinks:
      base.menuLinks?.length > 0 ? base.menuLinks : [{ label: "Início", href: "/" }],
    footerLinks: Array.isArray(base.footerLinks) ? base.footerLinks : [],
    socialLinks: Array.isArray((base as SiteConfig).socialLinks)
      ? (base as SiteConfig).socialLinks!
      : [],
    footerText: typeof base.footerText === "string" ? base.footerText : "",
    headerLogoUrl: typeof base.headerLogoUrl === "string" ? base.headerLogoUrl : "",
    faviconUrl:
      typeof base.faviconUrl === "string" && base.faviconUrl.trim()
        ? base.faviconUrl.trim()
        : "/favicon.svg",
  };
}

/** Rotas estáticas frequentes; páginas dinâmicas vêm de `listPages` no repositório. */
const COMMON_ROUTES: Array<{ href: string; label: string }> = [
  { href: "/", label: "Início" },
  { href: "/blog", label: "Blog" },
  { href: "/categorias", label: "Categorias" },
  { href: "/etiquetas", label: "Etiquetas" },
];

type PageListItem = { href: string; title: string; draft: boolean };

function normalizePathForMenu(h: string) {
  const t = h.trim() || "/";
  if (t === "/") return "/";
  return t.replace(/\/+$/, "") || "/";
}

function findPresetValue(href: string, presets: PageListItem[]) {
  const n = normalizePathForMenu(href);
  const common = COMMON_ROUTES.find((c) => normalizePathForMenu(c.href) === n);
  if (common) return `common:${common.href}`;
  const pg = presets.find((p) => normalizePathForMenu(p.href) === n);
  if (pg) return `page:${pg.href}`;
  return "__custom__";
}

function reorderArray<T>(items: T[], from: number, to: number): T[] {
  if (from === to) return items;
  if (from < 0 || to < 0 || from >= items.length || to >= items.length) return items;
  const next = [...items];
  const [row] = next.splice(from, 1);
  next.splice(to, 0, row);
  return next;
}

function LinkRows({
  idPrefix,
  items,
  onChange,
  addLabel,
  pageOptions = [],
  variant = "menu",
}: {
  idPrefix: string;
  items: Array<{ label: string; href: string }>;
  onChange: (next: Array<{ label: string; href: string }>) => void;
  addLabel: string;
  pageOptions?: PageListItem[];
  /** `simple`: só rótulo + URL (ex.: redes sociais). */
  variant?: "menu" | "simple";
}) {
  if (variant === "simple") {
    return (
      <div className="space-y-3">
        {items.map((row, i) => (
          <div
            key={i}
            className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3"
          >
            <div className="grid min-w-0 gap-3 sm:grid-cols-2 sm:items-end">
              <div className="min-w-0">
                <label htmlFor={`${idPrefix}-l-${i}`} className="block text-xs font-medium text-zinc-600">
                  Rótulo
                </label>
                <input
                  id={`${idPrefix}-l-${i}`}
                  value={row.label}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange(items.map((x, j) => (j === i ? { ...x, label: v } : x)));
                  }}
                  className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm"
                />
              </div>
              <div className="min-w-0">
                <label htmlFor={`${idPrefix}-h-${i}`} className="block text-xs font-medium text-zinc-600">
                  URL
                </label>
                <input
                  id={`${idPrefix}-h-${i}`}
                  value={row.href}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange(items.map((x, j) => (j === i ? { ...x, href: v } : x)));
                  }}
                  className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                  autoComplete="off"
                  placeholder="https://… ou /caminho"
                />
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => onChange(reorderArray(items, i, i - 1))}
                disabled={i === 0}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-40"
              >
                Subir
              </button>
              <button
                type="button"
                onClick={() => onChange(reorderArray(items, i, i + 1))}
                disabled={i === items.length - 1}
                className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-40"
              >
                Descer
              </button>
              <button
                type="button"
                onClick={() => onChange(items.filter((_, j) => j !== i))}
                className="shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-800"
              >
                Remover
              </button>
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={() => onChange([...items, { label: "Rede social", href: "https://" }])}
          className="text-sm font-medium text-[var(--client-color-primary)] hover:underline"
        >
          {addLabel}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((row, i) => {
        const selectVal = findPresetValue(row.href, pageOptions);
        const isCustomUrl = selectVal === "__custom__";
        return (
        <div
          key={i}
          className="flex flex-col gap-3 rounded-lg border border-zinc-200 bg-zinc-50/50 p-3"
        >
          <div className="min-w-0 sm:flex sm:flex-1 sm:flex-wrap sm:items-end sm:gap-3">
            <div className="min-w-0 flex-1 sm:min-w-[8rem]">
            <label htmlFor={`${idPrefix}-l-${i}`} className="block text-xs font-medium text-zinc-600">
              Texto do link
            </label>
            <input
              id={`${idPrefix}-l-${i}`}
              value={row.label}
              onChange={(e) => {
                const v = e.target.value;
                onChange(items.map((x, j) => (j === i ? { ...x, label: v } : x)));
              }}
              className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            />
            </div>
            <div className="min-w-0 sm:flex-[2] sm:min-w-0 sm:pt-0">
            <label htmlFor={`${idPrefix}-sel-${i}`} className="block text-xs font-medium text-zinc-600">
              Escolher página ou rota
            </label>
            <select
              id={`${idPrefix}-sel-${i}`}
              value={selectVal}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "__custom__") return;
                if (v.startsWith("common:")) {
                  const path = v.slice("common:".length);
                  const c = COMMON_ROUTES.find((x) => x.href === path);
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            href: path,
                            label: (x.label || "").trim() ? x.label : c?.label || x.label,
                          }
                        : x,
                    ),
                  );
                  return;
                }
                if (v.startsWith("page:")) {
                  const href = v.slice("page:".length);
                  const pg = pageOptions.find((p) => p.href === href);
                  onChange(
                    items.map((x, j) =>
                      j === i
                        ? {
                            ...x,
                            href,
                            label: (x.label || "").trim() ? x.label : pg?.title || x.label,
                          }
                        : x,
                    ),
                  );
                }
              }}
              className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-sm"
            >
              <option value="__custom__">— URL personalizada (editar abaixo) —</option>
              <optgroup label="Rotas do site">
                {COMMON_ROUTES.map((c) => (
                  <option key={c.href} value={`common:${c.href}`}>
                    {c.label} ({c.href})
                  </option>
                ))}
              </optgroup>
              {pageOptions.length > 0 && (
                <optgroup label="Páginas (CMS)">
                  {pageOptions.map((p) => (
                    <option key={p.href} value={`page:${p.href}`}>
                      {p.draft ? "[Rascunho] " : ""}
                      {p.title} — {p.href}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            {isCustomUrl ? (
              <>
                <label htmlFor={`${idPrefix}-h-${i}`} className="mt-2 block text-xs font-medium text-zinc-600">
                  URL
                </label>
                <input
                  id={`${idPrefix}-h-${i}`}
                  value={row.href}
                  onChange={(e) => {
                    const v = e.target.value;
                    onChange(items.map((x, j) => (j === i ? { ...x, href: v } : x)));
                  }}
                  className="mt-0.5 w-full rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                  autoComplete="off"
                  placeholder="/p/…, /blog, /contato, …"
                />
              </>
            ) : (
              <div className="mt-2">
                <p className="text-xs font-medium text-zinc-500">URL (definida pela seleção acima)</p>
                <p
                  className="mt-0.5 break-all rounded-md border border-transparent bg-zinc-100/80 px-2 py-1.5 font-mono text-sm text-zinc-800"
                >
                  {row.href || "—"}
                </p>
              </div>
            )}
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2 sm:justify-end">
            <button
              type="button"
              onClick={() => onChange(reorderArray(items, i, i - 1))}
              disabled={i === 0}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-40"
            >
              Subir
            </button>
            <button
              type="button"
              onClick={() => onChange(reorderArray(items, i, i + 1))}
              disabled={i === items.length - 1}
              className="rounded-md border border-zinc-200 bg-white px-2 py-1.5 text-xs font-medium text-zinc-800 disabled:opacity-40"
            >
              Descer
            </button>
            <button
              type="button"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              className="w-full shrink-0 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs font-medium text-red-800 sm:w-auto"
            >
              Remover
            </button>
          </div>
        </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...items, { label: "Novo", href: "/" }])}
        className="text-sm font-medium text-[var(--client-color-primary)] hover:underline"
      >
        {addLabel}
      </button>
    </div>
  );
}

type Props = { initialConfig: ClientConfig };

export function LayoutSettingsForm({ initialConfig }: Props) {
  const [config, setConfig] = useState<ClientConfig>(() => normalizeConfig(initialConfig));
  const [sha, setSha] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [isErr, setIsErr] = useState(false);
  const [pageOptions, setPageOptions] = useState<PageListItem[]>([]);
  const [pagesListState, setPagesListState] = useState<"idle" | "loading" | "ok" | "err">("idle");
  const [pagesListError, setPagesListError] = useState<string | null>(null);
  const [brandAssetErr, setBrandAssetErr] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [uploadingFavicon, setUploadingFavicon] = useState(false);
  const logoFileRef = useRef<HTMLInputElement>(null);
  const faviconFileRef = useRef<HTMLInputElement>(null);
  const [mediaPicker, setMediaPicker] = useState<null | "logo" | "favicon">(null);

  const fetchPages = useCallback(async () => {
    const integ = readJson<Record<string, string>>(ADMIN_INTEGRATION_STORAGE_KEY);
    const target = readJson<Record<string, string>>(ADMIN_CMS_TARGET_KEY);
    if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
      setPagesListState("idle");
      return;
    }
    setPagesListState("loading");
    setPagesListError(null);
    try {
      const res = await fetch("/api/admin/cms/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "listPages",
          GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
          githubRepoFullName: target.githubRepoFullName,
          branch: (target as { branch?: string }).branch || "main",
        }),
      });
      const j = (await res.json()) as {
        ok?: boolean;
        error?: string;
        items?: Array<{ slug: string; title: string; draft: boolean }>;
      };
      if (j.ok && Array.isArray(j.items)) {
        setPageOptions(
          j.items.map((p) => ({
            href: `/p/${p.slug}/`,
            title: p.title,
            draft: p.draft,
          })),
        );
        setPagesListState("ok");
      } else {
        setPageOptions([]);
        setPagesListState("err");
        setPagesListError(j.error || "Não foi possível listar as páginas.");
      }
    } catch {
      setPageOptions([]);
      setPagesListState("err");
      setPagesListError("Erro de rede ao listar páginas.");
    }
  }, []);

  const load = useCallback(async () => {
    const integ = readJson<Record<string, string>>(ADMIN_INTEGRATION_STORAGE_KEY);
    const target = readJson<Record<string, string>>(ADMIN_CMS_TARGET_KEY);
    if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
      setIsErr(true);
      setMsg("Configura a ligação ao projeto em Definições (integração) ou no painel do site.");
      setLoading(false);
      return;
    }
    setIsErr(false);
    setMsg("A carregar…");
    try {
      const fetchFile = (path: string) =>
        fetch("/api/admin/cms/github", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "get",
            GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
            githubRepoFullName: target.githubRepoFullName,
            branch: (target as { branch?: string }).branch || "main",
            path,
          }),
        });
      let res = await fetchFile(CONFIG_PATH);
      let j = (await res.json()) as { ok: boolean; error?: string; text?: string; sha?: string };
      let fromLegacy = false;
      if (!j.ok || typeof j.text !== "string") {
        res = await fetchFile(LEGACY_CONFIG_PATH);
        j = (await res.json()) as { ok: boolean; error?: string; text?: string; sha?: string };
        if (j.ok && typeof j.text === "string") {
          fromLegacy = true;
        }
      }
      if (!j.ok || typeof j.text !== "string") {
        setIsErr(true);
        setMsg(j.error || "Não foi possível carregar as definições de aparência.");
        setLoading(false);
        return;
      }
      const parsed = JSON.parse(j.text) as Partial<ClientConfig> & Partial<SiteConfig>;
      setConfig(
        normalizeConfig({
          ...initialConfig,
          ...parsed,
        } as ClientConfig),
      );
      setSha(fromLegacy ? "" : j.sha || "");
      setMsg("Dados carregados. Podes editar e guardar abaixo.");
      setIsErr(false);
    } catch {
      setIsErr(true);
      setMsg("Erro de rede ou JSON inválido.");
    }
    setLoading(false);
  }, [initialConfig]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!loading) void fetchPages();
  }, [loading, fetchPages]);

  const onLogoFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setBrandAssetErr("Para o logótipo, escolhe um ficheiro de imagem.");
      return;
    }
    setBrandAssetErr(null);
    setUploadingLogo(true);
    const r = await uploadCmsMediaFile(file);
    setUploadingLogo(false);
    if (!r.ok) {
      setBrandAssetErr(r.error);
      return;
    }
    setConfig((c) => ({ ...c, headerLogoUrl: r.data.previewUrl }));
  }, []);

  const onFaviconFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setBrandAssetErr("Para o favicon, escolhe um ficheiro de imagem (PNG, SVG ou WebP).");
      return;
    }
    setBrandAssetErr(null);
    setUploadingFavicon(true);
    const r = await uploadCmsMediaFile(file);
    setUploadingFavicon(false);
    if (!r.ok) {
      setBrandAssetErr(r.error);
      return;
    }
    setConfig((c) => ({ ...c, faviconUrl: r.data.previewUrl }));
  }, []);

  async function save() {
    setMsg("");
    const integ = readJson<Record<string, string>>(ADMIN_INTEGRATION_STORAGE_KEY);
    const target = readJson<Record<string, string>>(ADMIN_CMS_TARGET_KEY);
    if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
      setIsErr(true);
      setMsg("Token ou projeto em falta. Abre as definições de integração.");
      return;
    }
    if (!config.menuLinks.length) {
      setIsErr(true);
      setMsg("O menu tem de ter pelo menos uma ligação.");
      return;
    }
    const allLinks = [
      ...config.menuLinks,
      ...(config.footerLinks || []),
      ...((config as SiteConfig).socialLinks || []),
    ];
    if (allLinks.some((l) => !String(l?.href || "").trim())) {
      setIsErr(true);
      setMsg("Em cada ligação, o URL tem de ser preenchido. No menu, se usares «URL personalizada», preenche o campo; nas redes sociais, indica o endereço completo.");
      return;
    }
    setSaving(true);
    setIsErr(false);
    const body = JSON.stringify(config, null, 2) + "\n";
    try {
      const res = await fetch("/api/admin/cms/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "put",
          GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
          githubRepoFullName: target.githubRepoFullName,
          branch: (target as { branch?: string }).branch || "main",
          path: CONFIG_PATH,
          content: body,
          sha: sha || undefined,
          message: "chore(appearance): identidade, menu e rodapé (BlogCMS)",
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; sha?: string };
      if (!j.ok) {
        setIsErr(true);
        setMsg(j.error || "Falha ao guardar.");
        return;
      }
      if (j.sha) setSha(j.sha);
      setMsg("Guardado com sucesso. Se não vires a alteração de imediato no site, espera um minuto e actualiza a página.");
    } catch {
      setIsErr(true);
      setMsg("Falha de rede.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-8">
      <div
        className={
          msg
            ? isErr
              ? "rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900"
              : "rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            : "hidden"
        }
        role="status"
        aria-live="polite"
      >
        {msg}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">A carregar configuração…</p>
      ) : (
        <>
          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-zinc-900">Identidade e cores</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Nome público, descrição curta e cores de marca. A cor primária aplica-se a botões, ligações e realces no
              site.
            </p>
            <div className="mt-4 grid max-w-2xl gap-4">
              <div>
                <label htmlFor="cfg-nome-marca" className="block text-xs font-medium text-zinc-600">
                  Nome do site (marca)
                </label>
                <input
                  id="cfg-nome-marca"
                  value={config.nomeMarca}
                  onChange={(e) => setConfig((c) => ({ ...c, nomeMarca: e.target.value }))}
                  className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                  autoComplete="off"
                />
              </div>
              <div>
                <label htmlFor="cfg-desc-seo" className="block text-xs font-medium text-zinc-600">
                  Descrição padrão (SEO)
                </label>
                <textarea
                  id="cfg-desc-seo"
                  value={config.descricaoSeo}
                  onChange={(e) => setConfig((c) => ({ ...c, descricaoSeo: e.target.value }))}
                  rows={2}
                  className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="cfg-cor-p" className="block text-xs font-medium text-zinc-600">
                    Cor primária
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      id="cfg-cor-p"
                      value={config.cores.primaria}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, cores: { ...c.cores, primaria: e.target.value } }))
                      }
                      className="h-10 w-14 cursor-pointer rounded border border-zinc-200 bg-white p-0.5"
                      aria-label="Seletor de cor primária"
                    />
                    <input
                      type="text"
                      value={config.cores.primaria}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, cores: { ...c.cores, primaria: e.target.value } }))
                      }
                      className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
                <div>
                  <label htmlFor="cfg-cor-s" className="block text-xs font-medium text-zinc-600">
                    Cor secundária
                  </label>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <input
                      type="color"
                      id="cfg-cor-s"
                      value={config.cores.secundaria}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, cores: { ...c.cores, secundaria: e.target.value } }))
                      }
                      className="h-10 w-14 cursor-pointer rounded border border-zinc-200 bg-white p-0.5"
                      aria-label="Seletor de cor secundária"
                    />
                    <input
                      type="text"
                      value={config.cores.secundaria}
                      onChange={(e) =>
                        setConfig((c) => ({ ...c, cores: { ...c.cores, secundaria: e.target.value } }))
                      }
                      className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-2 py-1.5 font-mono text-sm"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-zinc-900">Logótipo e favicon</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Carrega imagens novas ou escolhe ficheiros que já estejam na{" "}
              <a className="font-medium text-[var(--client-color-primary)] underline" href="/admin/media/">
                biblioteca de imagens
              </a>
              . No fim, usa <strong className="font-medium text-zinc-700">Guardar alterações</strong> para aplicar no
              site.
            </p>
            {brandAssetErr && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-900" role="alert">
                {brandAssetErr}
              </p>
            )}
            <div className="mt-4 grid max-w-2xl gap-6">
              <div>
                <p className="text-xs font-medium text-zinc-600">Logótipo do cabeçalho</p>
                <p className="mt-0.5 text-xs text-zinc-500">Vazio = mostrar só o nome da marca em texto.</p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    ref={logoFileRef}
                    type="file"
                    accept="image/*"
                    className="sr-only"
                    id="cfg-header-logo-file"
                    disabled={uploadingLogo}
                    onChange={onLogoFile}
                    aria-label="Subir ficheiro de imagem para o logótipo"
                  />
                  <button
                    type="button"
                    disabled={uploadingLogo}
                    onClick={() => logoFileRef.current?.click()}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {uploadingLogo ? "A enviar…" : "Subir imagem do logótipo"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaPicker("logo")}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-100"
                  >
                    Escolher da biblioteca
                  </button>
                  {config.headerLogoUrl?.trim() && (
                    <span className="text-xs text-emerald-700" role="status">
                      Imagem definida
                    </span>
                  )}
                </div>
                {config.headerLogoUrl?.trim() && (
                  <div className="mt-3 flex max-w-md items-start gap-3 rounded-lg border border-zinc-100 bg-zinc-50/80 p-3">
                    <img
                      src={config.headerLogoUrl}
                      alt=""
                      className="h-10 w-auto max-w-[120px] object-contain"
                    />
                    <button
                      type="button"
                      className="text-xs text-red-700 underline"
                      onClick={() => setConfig((c) => ({ ...c, headerLogoUrl: "" }))}
                    >
                      Remover logótipo
                    </button>
                  </div>
                )}
              </div>
              <div>
                <p className="text-xs font-medium text-zinc-600">Favicon</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Prefere imagem pequena e quadrada, por exemplo 32×32 ou 64×64 (PNG, SVG ou WebP).
                </p>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <input
                    ref={faviconFileRef}
                    type="file"
                    accept="image/png,image/svg+xml,image/webp,image/jpeg,image/gif,image/*"
                    className="sr-only"
                    id="cfg-favicon-file"
                    disabled={uploadingFavicon}
                    onChange={onFaviconFile}
                    aria-label="Subir ficheiro de imagem para o favicon"
                  />
                  <button
                    type="button"
                    disabled={uploadingFavicon}
                    onClick={() => faviconFileRef.current?.click()}
                    className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-50 disabled:opacity-50"
                  >
                    {uploadingFavicon ? "A enviar…" : "Subir favicon"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setMediaPicker("favicon")}
                    className="rounded-lg border border-zinc-300 bg-zinc-50 px-3 py-2 text-sm font-medium text-zinc-800 shadow-sm hover:bg-zinc-100"
                  >
                    Escolher da biblioteca
                  </button>
                </div>
                {config.faviconUrl?.trim() && config.faviconUrl !== "/favicon.svg" && (
                  <div className="mt-3 flex max-w-md items-center gap-3 rounded-lg border border-zinc-100 bg-zinc-50/80 p-3">
                    <img src={config.faviconUrl} alt="" className="h-8 w-8 object-contain" width={32} height={32} />
                    <button
                      type="button"
                      className="text-xs text-zinc-600 underline"
                      onClick={() => setConfig((c) => ({ ...c, faviconUrl: "/favicon.svg" }))}
                    >
                      Repor padrão (/favicon.svg)
                    </button>
                  </div>
                )}
                {(!config.faviconUrl?.trim() || config.faviconUrl === "/favicon.svg") && (
                  <p className="mt-2 text-xs text-zinc-500">A usar o ficheiro predefinido do projeto: /favicon.svg</p>
                )}
              </div>
            </div>
          </section>

          <StorageImagePickerModal
            open={mediaPicker !== null}
            onClose={() => setMediaPicker(null)}
            title={mediaPicker === "favicon" ? "Favicon — escolher na biblioteca" : "Logótipo — escolher na biblioteca"}
            onSelect={(url) => {
              if (mediaPicker === "logo") setConfig((c) => ({ ...c, headerLogoUrl: url }));
              if (mediaPicker === "favicon") setConfig((c) => ({ ...c, faviconUrl: url }));
            }}
          />

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-zinc-900">Menu do cabeçalho</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Cada item tem texto e destino. Usa <strong className="font-medium text-zinc-700">Subir</strong> /{" "}
              <strong className="font-medium text-zinc-700">Descer</strong> para alterar a ordem (ex.: Início, Sobre,
              Blog).
            </p>
            {pagesListState === "loading" && (
              <p className="mt-2 text-xs text-zinc-500" role="status">
                A carregar lista de páginas do repositório…
              </p>
            )}
            {pagesListState === "err" && pagesListError && (
              <p className="mt-2 text-xs text-amber-800" role="alert">
                {pagesListError} Podes preencher o URL no modo personalizado.
              </p>
            )}
            <div className="mt-4">
              <LinkRows
                idPrefix="menu"
                items={config.menuLinks}
                onChange={(menuLinks) => setConfig((c) => ({ ...c, menuLinks }))}
                addLabel="+ Adicionar item ao menu"
                pageOptions={pageOptions}
              />
            </div>
          </section>

          <section className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-zinc-900">Rodapé global</h2>
            <p className="mt-1 text-sm text-zinc-500">Links de apoio (ex.: legais) e linha de copyright final.</p>
            <div className="mt-4">
              <label htmlFor="footer-text" className="block text-xs font-medium text-zinc-600">
                Texto do rodapé (copyright / nota)
              </label>
              <textarea
                id="footer-text"
                value={config.footerText || ""}
                onChange={(e) => setConfig((c) => ({ ...c, footerText: e.target.value }))}
                rows={2}
                className="mt-1 w-full max-w-2xl rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm"
                placeholder="© 2026 Marca. Todos os direitos reservados."
              />
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-medium text-zinc-800">Ligações do rodapé</h3>
              <div className="mt-2">
                <LinkRows
                  idPrefix="foot"
                  items={config.footerLinks || []}
                  onChange={(footerLinks) => setConfig((c) => ({ ...c, footerLinks }))}
                  addLabel="+ Adicionar ligação ao rodapé"
                  pageOptions={pageOptions}
                />
              </div>
            </div>
            <div className="mt-6">
              <h3 className="text-sm font-medium text-zinc-800">Redes sociais</h3>
              <p className="mt-0.5 text-xs text-zinc-500">Opcional. Aparecem abaixo das ligações do rodapé, antes do copyright.</p>
              <div className="mt-2">
                <LinkRows
                  idPrefix="social"
                  variant="simple"
                  items={config.socialLinks || []}
                  onChange={(socialLinks) => setConfig((c) => ({ ...c, socialLinks }))}
                  addLabel="+ Adicionar rede social"
                />
              </div>
            </div>
          </section>

          <p className="text-xs text-zinc-500">
            As definições são guardadas no ficheiro <code className="rounded bg-zinc-100 px-1">site-config.json</code> do
            repositório do site. Após guardar, o próximo build do Astro aplica o menu, o rodapé, as cores e o logótipo
            publicamente.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "A guardar…" : "Guardar alterações"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={saving}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Recarregar
            </button>
          </div>
        </>
      )}
    </div>
  );
}
