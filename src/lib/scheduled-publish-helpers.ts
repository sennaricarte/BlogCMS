/** Data ISO YYYY-MM-DD (UTC) para hoje. */
export function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/** `pubDate` de front matter → `YYYY-MM-DD` para comparação. */
export function normalizePubDateString(raw: unknown): string {
  if (raw instanceof Date) {
    return raw.toISOString().slice(0, 10);
  }
  if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10);
  }
  const t = new Date(String(raw));
  if (!Number.isNaN(t.getTime())) {
    return t.toISOString().slice(0, 10);
  }
  return "";
}

/** Publicação ativa: data de publicação (dia de calendário) já chegou ou é hoje. */
export function isPublicationDueDate(pubDateRaw: unknown): boolean {
  const a = normalizePubDateString(pubDateRaw);
  if (!a) return false;
  return a <= todayIsoDate();
}
