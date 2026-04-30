import { useCallback, useEffect, useState } from "react";
import { ExternalLink, Rocket } from "lucide-react";
import { vercelNewCloneUrl } from "../../lib/vercel-instant-deploy";

type DeploySuccessDetail = {
  githubRepositoryUrl: string;
  githubTreeUrl?: string;
};

const EVENT = "blogcms-deploy-github-success";

/**
 * Painel pós-criação: repositório, deploy instantâneo na Vercel e link de clone.
 */
export default function DeploySuccessPanel() {
  const [data, setData] = useState<DeploySuccessDetail | null>(null);

  const onEvent = useCallback((ev: Event) => {
    const e = ev as CustomEvent<DeploySuccessDetail>;
    if (e.detail?.githubRepositoryUrl) setData(e.detail);
  }, []);

  useEffect(() => {
    window.addEventListener(EVENT, onEvent);
    return () => window.removeEventListener(EVENT, onEvent);
  }, [onEvent]);

  if (!data) return null;

  const repo = data.githubRepositoryUrl.trim();
  const cloneUrl = vercelNewCloneUrl(repo);

  return (
    <section
      className="mt-8 rounded-2xl border-2 border-emerald-200/90 bg-gradient-to-b from-emerald-50/90 to-white p-6 shadow-md ring-1 ring-emerald-100"
      aria-labelledby="deploy-success-heading"
    >
      <h2 id="deploy-success-heading" className="text-lg font-bold tracking-tight text-slate-900">
        Repositório criado no GitHub
      </h2>
      <p className="mt-2 text-sm text-slate-600">
        O código-fonte já está no seu repositório. O build do site será feito na Vercel após ligar o projeto.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <a
          href={repo}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-800 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/25"
        >
          <ExternalLink className="h-4 w-4 shrink-0" aria-hidden />
          Abrir repositório no GitHub
        </a>
        <a
          href={cloneUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 flex-[1.2] items-center justify-center gap-2 rounded-lg bg-[var(--client-color-primary)] px-5 py-3 text-sm font-bold text-white shadow-md transition hover:opacity-95 focus:outline-none focus:ring-2 focus:ring-[var(--client-color-primary)]/40"
          aria-label="Fazer deploy na Vercel — abre o assistente de importação"
        >
          <Rocket className="h-4 w-4 shrink-0" aria-hidden />
          Fazer deploy na Vercel
        </a>
      </div>

      <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-600">Deploy instantâneo (clone)</h3>
        <p className="mt-1 text-xs text-slate-600">
          A Vercel pode importar o repositório diretamente. Copie o link se preferir abrir noutro separador:
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
          <code className="block min-w-0 flex-1 break-all rounded-md border border-slate-200 bg-white px-2 py-1.5 text-[11px] leading-snug text-slate-800">
            {cloneUrl}
          </code>
          <button
            type="button"
            className="shrink-0 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-800 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-slate-400/30"
            onClick={() => void navigator.clipboard.writeText(cloneUrl).catch(() => {})}
          >
            Copiar link
          </button>
        </div>
      </div>

      <p className="mt-4 text-xs text-slate-500">
        Guia detalhado no BlogCMS:{" "}
        <a href="/admin/publicar-na-vercel/" className="font-medium text-[var(--client-color-primary)] underline-offset-2 hover:underline">
          Como publicar na Vercel
        </a>
        . No repositório do cliente existem também <span className="font-mono">instrucoes-deploy.md</span> e{" "}
        <span className="font-mono">DEPLOY-VERCEL.md</span>.
      </p>
    </section>
  );
}
