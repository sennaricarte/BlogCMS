import { useCallback, useEffect, useState } from "react";
import type { ClientConfig } from "../../lib/publisher";
import { ADMIN_CMS_TARGET_KEY } from "../../lib/admin-cms-target";
import { ADMIN_INTEGRATION_STORAGE_KEY } from "../../lib/admin-storage";
import { CMS_PATHS } from "../../lib/cms-paths";

const CONFIG_PATH = CMS_PATHS.clientConfigJson;

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
    menuLinks:
      base.menuLinks?.length > 0 ? base.menuLinks : [{ label: "Início", href: "/" }],
    footerLinks: Array.isArray(base.footerLinks) ? base.footerLinks : [],
    footerText: typeof base.footerText === "string" ? base.footerText : "",
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

function LinkRows({
  idPrefix,
  items,
  onChange,
  addLabel,
  pageOptions = [],
}: {
  idPrefix: string;
  items: Array<{ label: string; href: string }>;
  onChange: (next: Array<{ label: string; href: string }>) => void;
  addLabel: string;
  /** Páginas com `/p/slug/` vindas do repositório (GitHub). */
  pageOptions?: PageListItem[];
}) {
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
                  URL (href) <span className="font-normal text-zinc-500">(obrigatório)</span>
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
                <p className="text-xs font-medium text-zinc-500">Endereço (aplicado automaticamente)</p>
                <p
                  className="mt-0.5 break-all rounded-md border border-transparent bg-zinc-100/80 px-2 py-1.5 font-mono text-sm text-zinc-800"
                  id={`${idPrefix}-h-${i}`}
                >
                  {row.href || "—"}
                </p>
              </div>
            )}
            </div>
          </div>
          <div className="sm:flex sm:justify-end">
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
      setMsg("Configura o token GitHub e o repositório alvo (localStorage) em /admin/settings/ e no painel de projeto.");
      setLoading(false);
      return;
    }
    setIsErr(false);
    setMsg("A carregar do GitHub…");
    try {
      const res = await fetch("/api/admin/cms/github", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "get",
          GITHUB_PERSONAL_TOKEN: integ.GITHUB_PERSONAL_TOKEN,
          githubRepoFullName: target.githubRepoFullName,
          branch: (target as { branch?: string }).branch || "main",
          path: CONFIG_PATH,
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; text?: string; sha?: string };
      if (!j.ok || typeof j.text !== "string") {
        setIsErr(true);
        setMsg(j.error || "Não foi possível carregar client-config.json.");
        setLoading(false);
        return;
      }
      const parsed = JSON.parse(j.text) as Partial<ClientConfig>;
      setConfig(
        normalizeConfig({
          ...initialConfig,
          ...parsed,
        } as ClientConfig),
      );
      setSha(j.sha || "");
      setMsg("Dados do repositório carregados. Edita e guarda para publicar.");
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

  async function save() {
    setMsg("");
    const integ = readJson<Record<string, string>>(ADMIN_INTEGRATION_STORAGE_KEY);
    const target = readJson<Record<string, string>>(ADMIN_CMS_TARGET_KEY);
    if (!integ?.GITHUB_PERSONAL_TOKEN || !target?.githubRepoFullName) {
      setIsErr(true);
      setMsg("Token ou repositório em falta.");
      return;
    }
    if (!config.menuLinks.length) {
      setIsErr(true);
      setMsg("O menu tem de ter pelo menos uma ligação.");
      return;
    }
    const allLinks = [...config.menuLinks, ...(config.footerLinks || [])];
    if (allLinks.some((l) => !String(l?.href || "").trim())) {
      setIsErr(true);
      setMsg("Em cada item com «URL personalizada», o campo de URL tem de ser preenchido. Nas outras, escolhe uma página ou rota na lista acima.");
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
          message: "chore(layout): menu e rodapé (CMS BlogCMS)",
        }),
      });
      const j = (await res.json()) as { ok: boolean; error?: string; sha?: string };
      if (!j.ok) {
        setIsErr(true);
        setMsg(j.error || "Falha ao guardar.");
        return;
      }
      if (j.sha) setSha(j.sha);
      setMsg("Guardado no GitHub. Faz deploy para ver as alterações no site público.");
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
            <h2 className="text-base font-semibold text-zinc-900">Menu superior</h2>
            <p className="mt-1 text-sm text-zinc-500">Ligações do cabeçalho em todas as páginas (ordem = ordem de exibição).</p>
            {pagesListState === "loading" && (
              <p className="mt-2 text-xs text-zinc-500" role="status">
                A carregar lista de páginas do repositório…
              </p>
            )}
            {pagesListState === "err" && pagesListError && (
              <p className="mt-2 text-xs text-amber-800" role="alert">
                {pagesListError} Podes continuar a escrever o URL à mão.
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
          </section>

          <p className="text-xs text-zinc-500">
            Outros campos de <code className="rounded bg-zinc-100 px-1">client-config.json</code> (marca, cores, SEO)
            mantêm-se; só o menu e o rodapé são editáveis aqui. O ficheiro completo é regravado no repositório.
          </p>

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void save()}
              disabled={saving}
              className="rounded-lg bg-zinc-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-zinc-800 disabled:opacity-50"
            >
              {saving ? "A guardar…" : "Guardar no GitHub"}
            </button>
            <button
              type="button"
              onClick={() => void load()}
              disabled={saving}
              className="rounded-lg border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
            >
              Recarregar do repositório
            </button>
          </div>
        </>
      )}
    </div>
  );
}
