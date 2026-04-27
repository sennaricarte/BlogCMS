/** Gera slug para ficheiro / URL (ASCII, minúsculas, hífens). */
export function slugifyTitle(input: string, fallback = "post"): string {
  const s = input
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s || fallback;
}

/** Nome alinhado com taxonomias (tags) — mesmo algoritmo. */
export const slugifyText = slugifyTitle;
