import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchSearchConsoleData, type SearchConsoleMockData } from "../../lib/search-console-mock";

type Props = {
  siteUrl: string;
  /** Chave estável para o efeito (ex.: id do projeto) */
  projectId: string;
};

function formatDayLabel(iso: string) {
  try {
    const d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString("pt-PT", { day: "2-digit", month: "2-digit" });
  } catch {
    return iso.slice(5);
  }
}

/**
 * Bloco Search Console (mock) no cartão do dashboard: totais + gráfico 7 dias.
 */
export function DashboardProjectGsc({ siteUrl, projectId }: Props) {
  const [data, setData] = useState<SearchConsoleMockData | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    setData(null);
    void (async () => {
      try {
        const r = await fetchSearchConsoleData(siteUrl);
        if (!cancelled) setData(r);
      } catch {
        if (!cancelled) setErr("Não foi possível carregar os dados de pesquisa.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [siteUrl, projectId]);

  const chartData =
    data?.daily.map((p) => ({
      ...p,
      label: formatDayLabel(p.date),
    })) ?? [];

  return (
    <div
      className="rounded-lg border border-slate-200/90 bg-slate-50/60 px-3 py-3"
      aria-label="Resumo Search Console (demonstração)"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Search Console</p>
        <span className="rounded bg-amber-100/90 px-1.5 py-0.5 text-[10px] font-medium uppercase text-amber-900">
          Mock
        </span>
      </div>

      {!data && !err && (
        <div className="space-y-2" role="status" aria-live="polite">
          <div className="h-3 w-2/3 animate-pulse rounded bg-slate-200" />
          <div className="h-16 animate-pulse rounded bg-slate-200/80" />
        </div>
      )}

      {err && <p className="text-xs text-red-700">{err}</p>}

      {data && (
        <>
          <dl className="mb-3 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-md border border-white/80 bg-white px-1 py-1.5 shadow-sm">
              <dt className="text-[10px] font-medium uppercase text-slate-500">Cliques</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-900">{data.totalClicks}</dd>
            </div>
            <div className="rounded-md border border-white/80 bg-white px-1 py-1.5 shadow-sm">
              <dt className="text-[10px] font-medium uppercase text-slate-500">Impressões</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-900">
                {data.totalImpressions.toLocaleString("pt-PT")}
              </dd>
            </div>
            <div className="rounded-md border border-white/80 bg-white px-1 py-1.5 shadow-sm">
              <dt className="text-[10px] font-medium uppercase text-slate-500">CTR</dt>
              <dd className="text-sm font-semibold tabular-nums text-slate-900">
                {data.ctrPercent.toLocaleString("pt-PT", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%
              </dd>
            </div>
          </dl>

          <p className="mb-1 text-[10px] font-medium text-slate-500">Tendência de cliques (7 dias)</p>
          <div className="h-[7.5rem] w-full" role="img" aria-label="Gráfico de cliques dos últimos 7 dias">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-slate-200" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  interval={0}
                  height={28}
                />
                <YAxis
                  tick={{ fontSize: 9, fill: "#64748b" }}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{
                    fontSize: "12px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                  }}
                  labelFormatter={(_lab, payload) => {
                    const row = payload?.[0]?.payload as { date?: string } | undefined;
                    if (!row?.date) return "";
                    try {
                      return new Date(row.date + "T12:00:00").toLocaleDateString("pt-PT", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                      });
                    } catch {
                      return row.date;
                    }
                  }}
                  formatter={(value: number) => [`${value}`, "Cliques"]}
                />
                <Line
                  type="monotone"
                  dataKey="clicks"
                  name="Cliques"
                  stroke="var(--client-color-primary, #0ea5e9)"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 3 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </div>
  );
}
