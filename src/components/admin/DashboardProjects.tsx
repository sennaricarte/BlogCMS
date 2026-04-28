import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Code2, ExternalLink, LayoutDashboard, Link2, MoreHorizontal, Plus, Search, X, Zap } from "lucide-react";
import { ADMIN_CMS_TARGET_KEY, getCmsTargetFromProject } from "../../lib/admin-cms-target";
import { ADMIN_INTEGRATION_STORAGE_KEY } from "../../lib/admin-storage";
import type { ClientProject } from "../../lib/projects-data";
import {
  projectPublicSiteUrl,
  projectVercelDeploymentsUrl,
  projectVercelSpeedInsightsUrl,
} from "../../lib/vercel-project-admin-links";
import { DashboardProjectGsc } from "./DashboardProjectGsc";

const K = ADMIN_INTEGRATION_STORAGE_KEY;
const K_CMS = ADMIN_CMS_TARGET_KEY;
const K_LOCAL_PROJECTS = "blogcms-dashboard-projects-cache";

type StatusRow = {
  label: string;
  badgeClass: string;
  error?: string;
  raw?: string;
};

function readIntegration(): { vercelToken?: string; teamId?: string } {
  try {
    const raw = localStorage.getItem(K);
    if (!raw) return {};
    const j = JSON.parse(raw) as { VERCEL_TOKEN?: string; VERCEL_TEAM_ID?: string };
    return { vercelToken: j.VERCEL_TOKEN?.trim(), teamId: j.VERCEL_TEAM_ID?.trim() };
  } catch {
    return {};
  }
}

function mapReadyState(ready: string): Pick<StatusRow, "label" | "badgeClass"> {
  const u = ready.toUpperCase();
  if (u === "READY") {
    return { label: "Pronto", badgeClass: "bg-emerald-50 text-emerald-900 ring-1 ring-emerald-200/80" };
  }
  if (u === "ERROR" || u === "FAILED" || u === "CANCELED") {
    return {
      label: u === "CANCELED" ? "Cancelado" : "Erro",
      badgeClass: "bg-red-50 text-red-900 ring-1 ring-red-200/80",
    };
  }
  if (
    ["BUILDING", "QUEUED", "INITIALIZING", "PENDING", "DEPLOYING", "ANALYZING", "CANCELLING"].includes(u)
  ) {
    return { label: "Em build", badgeClass: "bg-amber-50 text-amber-900 ring-1 ring-amber-200/80" };
  }
  if (u === "UNKNOWN" || u === "—") {
    return { label: "Desconhecido", badgeClass: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200" };
  }
  return { label: ready, badgeClass: "bg-zinc-100 text-zinc-700 ring-1 ring-zinc-200" };
}

/** Grava o alvo no localStorage se o projeto tiver repo/Vercel válidos; nunca impede a navegação. */
function persistCmsTargetIfPossible(p: ClientProject) {
  const target = getCmsTargetFromProject(p);
  if (!target) return;
  try {
    localStorage.setItem(K_CMS, JSON.stringify(target));
  } catch {
    /* Navegação ainda segue; a página do projeto avisa. */
  }
}

function projectHubHref(p: ClientProject) {
  return `/admin/projects/${p.id}/`;
}

function readLocalProjectsCache(): ClientProject[] {
  try {
    const raw = localStorage.getItem(K_LOCAL_PROJECTS);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is ClientProject => {
      if (!p || typeof p !== "object") return false;
      const x = p as Partial<ClientProject>;
      return Boolean(
        x.id &&
        x.name &&
        x.siteUrl &&
        x.githubUrl &&
        x.createdAt &&
        x.vercelProjectId &&
        x.vercelProjectName &&
        x.vercelScope &&
        x.githubRepoFullName,
      );
    });
  } catch {
    return [];
  }
}

type StatusDisplay = { kind: "online" } | { kind: "line"; text: string; className: string; detail?: string };

function resolveStatus(
  s: StatusRow | undefined,
  p: ClientProject,
  hasVercelToken: boolean,
): StatusDisplay {
  const hasUrl = Boolean((p.vercelUrl || p.siteUrl || "").trim());
  if (!s) {
    if (!hasVercelToken && hasUrl) {
      return { kind: "online" };
    }
    return { kind: "line", text: "A verificar…", className: "text-slate-500" };
  }
  if (s.label === "Pronto" || s.raw === "READY") {
    return { kind: "online" };
  }
  if (s.label === "Em build") {
    return { kind: "line", text: "Em build", className: "text-amber-800 font-medium" };
  }
  if (s.label === "Desconhecido") {
    return { kind: "line", text: "A sincronizar", className: "text-amber-800/90 font-medium" };
  }
  if (s.label === "Sem ligação") {
    return { kind: "line", text: "A configurar", className: "text-slate-500" };
  }
  if (s.label === "Erro" || s.label === "Rede" || s.label === "Cancelado") {
    return {
      kind: "line",
      text: "Indisponível",
      className: "text-red-800 font-medium",
      detail: s.error,
    };
  }
  return { kind: "line", text: s.label, className: "text-slate-700" };
}

function OnlineStatusBadge() {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200/90 bg-emerald-50/95 pl-1.5 pr-2.5 py-0.5 text-xs font-medium text-emerald-900 shadow-sm ring-1 ring-emerald-200/30"
    >
      <span className="relative flex h-2 w-2" aria-hidden>
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-40" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      No ar
    </span>
  );
}

type CardMenuProps = { project: ClientProject; siteHref: string };

function CardQuickMenu({ project, siteHref }: CardMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    function h(ev: MouseEvent) {
      if (ref.current && !ref.current.contains(ev.target as Node)) close();
    }
    function esc(ev: KeyboardEvent) {
      if (ev.key === "Escape") close();
    }
    document.addEventListener("mousedown", h);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", h);
      document.removeEventListener("keydown", esc);
    };
  }, [open, close]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-slate-500 transition hover:border-slate-200 hover:bg-slate-100 hover:text-slate-900"
        aria-expanded={open}
        aria-haspopup="true"
        aria-label={`Ações para ${project.name}`}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          className="absolute right-0 z-30 mt-1 min-w-[12rem] overflow-hidden rounded-lg border border-slate-200/90 bg-white py-1 text-sm shadow-lg ring-1 ring-slate-900/5"
          role="menu"
        >
          <a
            href={siteHref}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"
            role="menuitem"
            onClick={close}
          >
            <ExternalLink className="h-3.5 w-3.5 opacity-60" />
            Abrir site (Vercel)
          </a>
          <a
            href={project.githubUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"
            role="menuitem"
            onClick={close}
          >
            <Code2 className="h-3.5 w-3.5 opacity-60" />
            Abrir repositório
          </a>
          <a
            href={projectHubHref(project)}
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"
            role="menuitem"
            onClick={() => {
              close();
              persistCmsTargetIfPossible(project);
            }}
          >
            <LayoutDashboard className="h-3.5 w-3.5 opacity-60" />
            Painel do projeto
          </a>
          <hr className="my-1 border-slate-100" />
          <a
            href={projectVercelDeploymentsUrl(project)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"
            role="menuitem"
            onClick={close}
          >
            Ver logs de deploy
          </a>
          <a
            href={projectVercelSpeedInsightsUrl(project)}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50"
            role="menuitem"
            onClick={close}
          >
            <Zap className="h-3.5 w-3.5 text-emerald-600" />
            Analytics (Speed Insights)
          </a>
        </div>
      )}
    </div>
  );
}

type Props = { projects: ClientProject[] };

export function DashboardProjects({ projects }: Props) {
  const [localProjects, setLocalProjects] = useState<ClientProject[]>([]);
  const [status, setStatus] = useState<Record<string, StatusRow | undefined>>({});
  const [hint, setHint] = useState<string | null>(null);
  const [nameQuery, setNameQuery] = useState("");

  const searchId = "dashboard-sites-search";

  useEffect(() => {
    setLocalProjects(readLocalProjectsCache());
  }, []);

  const allProjects = useMemo(() => {
    const byKey = new Map<string, ClientProject>();
    for (const p of projects) {
      const key = p.githubRepoFullName?.trim() || p.vercelProjectId?.trim() || p.id;
      byKey.set(key, p);
    }
    for (const p of localProjects) {
      const key = p.githubRepoFullName?.trim() || p.vercelProjectId?.trim() || p.id;
      if (!byKey.has(key)) {
        byKey.set(key, p);
      }
    }
    return Array.from(byKey.values()).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [projects, localProjects]);

  const filteredProjects = useMemo(() => {
    const q = nameQuery.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter((p) => p.name.toLowerCase().includes(q));
  }, [allProjects, nameQuery]);

  useEffect(() => {
    const { vercelToken, teamId } = readIntegration();
    if (!vercelToken) {
      setHint("Configure o token da Vercel em Configurações para o estado de deploy em tempo real no cartão.");
      return;
    }

    (async () => {
      const next: Record<string, StatusRow> = {};
      for (const p of allProjects) {
        if (!p.vercelProjectId?.trim()) {
          next[p.id] = {
            label: "Sem ligação",
            badgeClass: "bg-zinc-100 text-zinc-500 ring-1 ring-zinc-200",
            error: "preenche vercelProjectId",
          };
          continue;
        }
        try {
          const r = await fetch("/api/admin/vercel/deployment-status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              VERCEL_TOKEN: vercelToken,
              VERCEL_TEAM_ID: teamId || undefined,
              projectTeamId: p.vercelTeamId?.trim() || undefined,
              vercelProjectId: p.vercelProjectId.trim(),
            }),
          });
          const j = (await r.json()) as {
            ok?: boolean;
            readyState?: string;
            error?: string;
          };
          if (!r.ok || !j.ok) {
            next[p.id] = {
              label: "Erro",
              badgeClass: "bg-red-50 text-red-800 ring-1 ring-red-200/80",
              error: j.error || "API",
            };
            continue;
          }
          const m = mapReadyState(String(j.readyState || "UNKNOWN"));
          next[p.id] = { label: m.label, badgeClass: m.badgeClass, raw: j.readyState };
        } catch {
          next[p.id] = {
            label: "Rede",
            badgeClass: "bg-red-50 text-red-800 ring-1 ring-red-200/80",
            error: "Falha de rede",
          };
        }
      }
      setStatus(next);
    })();
  }, [allProjects]);

  const hasVercelToken = Boolean(readIntegration().vercelToken);

  if (!allProjects.length) {
    return (
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Estado vazio do painel">
        <div
          className="col-span-full flex flex-col items-center justify-center overflow-hidden rounded-2xl border border-slate-200/90 bg-gradient-to-b from-slate-50/95 to-white px-6 py-14 text-center shadow-sm"
        >
          <div className="mx-auto flex h-32 w-32 items-center justify-center rounded-2xl border border-slate-200/80 bg-white shadow-inner" aria-hidden>
            <svg viewBox="0 0 120 100" className="h-20 w-24 text-slate-300" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="10" y="20" width="100" height="60" rx="6" className="stroke-slate-200" strokeWidth="1.5" fill="currentColor" fillOpacity="0.06" />
              <rect x="22" y="34" width="32" height="3" rx="1" className="fill-slate-200" />
              <rect x="22" y="42" width="76" height="2" rx="1" className="fill-slate-100" />
              <rect x="22" y="48" width="50" height="2" rx="1" className="fill-slate-100" />
              <path d="M50 70 L60 60 L70 70" className="stroke-slate-300" strokeWidth="1.5" fill="none" />
              <circle cx="60" cy="52" r="8" className="stroke-slate-200" strokeWidth="1.2" fill="none" />
            </svg>
          </div>
          <h2 className="mt-4 text-lg font-bold tracking-tight text-slate-900">Ainda sem sites</h2>
          <p className="mt-1.5 max-w-md text-sm text-slate-600">
            Crie seu primeiro site com GitHub e Vercel. Depois, o resumo e os links de produção aparecem neste
            painel.
          </p>
          <a
            href="/admin/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
            aria-label="Criar novo site: GitHub e Vercel"
          >
            <span className="text-lg font-light leading-none" aria-hidden>
              +
            </span>
            Criar primeiro site
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {hint && (
        <p
          className="rounded-lg border border-amber-200/90 bg-amber-50/90 px-3 py-2 text-sm text-amber-950"
          role="status"
        >
          {hint}
        </p>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="w-full min-w-0 sm:max-w-md">
          <label htmlFor={searchId} className="mb-1.5 block text-xs font-medium text-slate-600">
            Pesquisar sites
          </label>
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              aria-hidden
            />
            <input
              id={searchId}
              type="search"
              name="site-name-filter"
              value={nameQuery}
              onChange={(e) => setNameQuery(e.target.value)}
              placeholder="Filtrar pelo nome do projeto…"
              autoComplete="off"
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-9 pr-10 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-slate-300 focus:outline-none focus:ring-2 focus:ring-slate-400/20"
              aria-label="Filtrar sites pelo nome do projeto"
            />
            {nameQuery ? (
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                onClick={() => {
                  setNameQuery("");
                  document.getElementById(searchId)?.focus();
                }}
                aria-label="Limpar pesquisa"
              >
                <X className="h-4 w-4" />
              </button>
            ) : null}
          </div>
        </div>
        <p
          id={`${searchId}-hint`}
          className="shrink-0 text-xs text-slate-500"
          role="status"
          aria-live="polite"
        >
          {filteredProjects.length} de {allProjects.length} {allProjects.length === 1 ? "site" : "sites"}
        </p>
      </div>

      {nameQuery.trim() && filteredProjects.length === 0 ? (
        <div
          className="rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-6 py-10 text-center"
          role="status"
        >
          <p className="text-sm font-medium text-slate-800">Nenhum site corresponde a &quot;{nameQuery.trim()}&quot;.</p>
          <p className="mt-1 text-sm text-slate-600">Tente outro termo ou limpe a pesquisa.</p>
          <button
            type="button"
            className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 shadow-sm transition hover:bg-slate-50"
            onClick={() => setNameQuery("")}
          >
            <X className="h-4 w-4 opacity-60" aria-hidden />
            Limpar pesquisa
          </button>
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-label="Sites na plataforma">
        {filteredProjects.map((p) => {
          const s = status[p.id];
          const st = resolveStatus(s, p, hasVercelToken);
          const siteHref = projectPublicSiteUrl(p);
          const created = (() => {
            try {
              return new Date(p.createdAt).toLocaleDateString("pt-BR", {
                year: "numeric",
                month: "short",
                day: "numeric",
              });
            } catch {
              return p.createdAt;
            }
          })();

          return (
            <li
              key={p.id}
              className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md"
            >
              <div className="flex min-h-[4.5rem] items-start justify-between gap-2 border-b border-slate-100/90 bg-slate-50/50 px-4 py-3">
                <h2 className="min-w-0 text-lg font-bold leading-snug tracking-tight text-slate-900">
                  {p.name}
                </h2>
                <div className="flex shrink-0 items-center gap-1.5">
                  {st.kind === "online" ? (
                    <OnlineStatusBadge />
                  ) : (
                    <span
                      className={["max-w-[9rem] truncate text-left text-xs", st.kind === "line" ? st.className : ""].join(
                        " ",
                      )}
                      title={s?.raw}
                    >
                      {st.kind === "line" ? st.text : "—"}
                    </span>
                  )}
                  <CardQuickMenu project={p} siteHref={siteHref} />
                </div>
              </div>

              {st.kind === "line" && st.detail && s?.label !== "Sem ligação" && (
                <p className="px-4 pt-1 text-xs text-slate-500">{st.detail}</p>
              )}

              <div className="flex flex-1 flex-col space-y-3 px-4 py-4 text-sm">
                <a
                  href={siteHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/link flex min-h-9 items-center gap-2.5 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-slate-800 transition hover:border-slate-300 hover:bg-slate-50/80"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200/80 bg-slate-50 text-slate-700 group-hover/link:border-slate-300 group-hover/link:bg-white">
                    <Link2 className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-slate-500">Produção (Vercel)</span>
                    <span className="block truncate font-medium text-slate-900" title={siteHref}>
                      {(() => {
                        try {
                          return new URL(siteHref).host;
                        } catch {
                          return siteHref;
                        }
                      })()}
                    </span>
                  </span>
                </a>
                <a
                  href={p.githubUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="group/gh flex min-h-9 items-center gap-2.5 rounded-lg border border-slate-200/80 bg-white px-3 py-2 text-slate-800 transition hover:border-slate-300 hover:bg-slate-50/80"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-slate-200/80 bg-slate-50 text-slate-700 group-hover/gh:border-slate-300 group-hover/gh:bg-white">
                    <Code2 className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-medium text-slate-500">Código (GitHub)</span>
                    <span className="block truncate text-slate-800" title={p.githubUrl}>
                      {p.githubUrl.replace("https://github.com/", "")}
                    </span>
                  </span>
                </a>

                <DashboardProjectGsc siteUrl={siteHref} projectId={p.id} />
              </div>

              <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Criado: {created}</p>

              <div className="mt-auto border-t border-slate-100 p-3">
                <a
                  href={projectHubHref(p)}
                  onClick={() => {
                    persistCmsTargetIfPossible(p);
                  }}
                  className="inline-flex w-full min-h-11 items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
                  aria-label={`Gerenciar o site: ${p.name}`}
                >
                  <Plus className="h-4 w-4 shrink-0" aria-hidden />
                  Gerenciar site
                </a>
              </div>
            </li>
          );
        })}
        </ul>
      )}
    </div>
  );
}
