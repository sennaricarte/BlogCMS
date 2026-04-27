/**
 * Tipos e mock para Google Search Console (dashboard).
 * Quando a API real existir, substituir a implementação de `fetchSearchConsoleData`.
 */

export type SearchConsoleDailyPoint = {
  /** ISO YYYY-MM-DD */
  date: string;
  clicks: number;
  impressions: number;
};

export type SearchConsoleMockData = {
  siteUrl: string;
  periodDays: 7;
  /** Últimos 7 dias (hoje = último ponto) */
  daily: SearchConsoleDailyPoint[];
  totalClicks: number;
  totalImpressions: number;
  /** Percentagem 0–100 (cliques / impressões no período) */
  ctrPercent: number;
};

function hashToSeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Dados simulados para validar o layout. Valores **estáveis** por `siteUrl` (mesmo ecrã em refreshes).
 * Substitui por chamada à API GSC (OAuth, Search Analytics) quando estiver pronto.
 */
export async function fetchSearchConsoleData(siteUrl: string): Promise<SearchConsoleMockData> {
  const url = (siteUrl || "https://example.com").trim();
  const rand = mulberry32(hashToSeed(url));

  const daily: SearchConsoleDailyPoint[] = [];
  const now = new Date();
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const date = d.toISOString().slice(0, 10);
    const base = 20 + Math.floor(rand() * 120);
    const wobble = 0.6 + rand() * 0.7;
    const clicks = Math.max(0, Math.round(base * wobble));
    const impFactor = 8 + rand() * 25;
    const impressions = Math.max(clicks, Math.round(clicks * impFactor));
    daily.push({ date, clicks, impressions });
  }

  const totalClicks = daily.reduce((a, p) => a + p.clicks, 0);
  const totalImpressions = daily.reduce((a, p) => a + p.impressions, 0);
  const ctrPercent =
    totalImpressions > 0 ? Math.round((10000 * totalClicks) / totalImpressions) / 100 : 0;

  return {
    siteUrl: url,
    periodDays: 7,
    daily,
    totalClicks,
    totalImpressions,
    ctrPercent,
  };
}
