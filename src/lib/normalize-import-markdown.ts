/**
 * Evita que importações (ex.: JSON Lovable) gravem corpo que o parser Markdown trata como
 * bloco de código (indentação uniforme ≥4 espaços) ou como um único fence ```…```.
 * Nesses casos o site mostra `**negrito**`, `### títulos`, etc. como texto cru.
 */

function stripBomAndNewlines(s: string): string {
  return s.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
}

/** Se o ficheiro inteiro for um único bloco cercado por ```, devolve o interior. */
export function unwrapOuterMarkdownFence(body: string): string {
  const t = stripBomAndNewlines(body).trim();
  const m = t.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/);
  return m?.[1] != null ? m[1] : body;
}

/**
 * Remove indentação inicial idêntica em todas as linhas não vazias (tabs ou espaços),
 * só quando é uniforme e ≥4 — padrão típico de export JSON / cópia acidental.
 */
export function stripUniformLeadingIndent(body: string): string {
  const text = stripBomAndNewlines(body);
  const lines = text.split("\n");
  const indents: number[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const m = line.match(/^[ \t]+/);
    indents.push(m ? m[0].length : 0);
  }
  if (indents.length < 2) return body;
  const minI = Math.min(...indents);
  const maxI = Math.max(...indents);
  if (minI < 4 || minI !== maxI) return body;
  return lines.map((line) => (line.trim() ? line.slice(minI) : line)).join("\n");
}

/** Pipeline aplicada ao corpo antes de substituir assets e serializar o `.md`. */
export function normalizeImportedMarkdownBody(body: string): string {
  let s = typeof body === "string" ? body : String(body);
  s = unwrapOuterMarkdownFence(s);
  s = stripUniformLeadingIndent(s);
  return s.trim();
}
