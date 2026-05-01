/** URL remota (http/https) usada no frontmatter. */
export function isHeroRemoteUrl(src: unknown): src is string {
  return typeof src === "string" && /^https?:\/\//i.test(src);
}

/**
 * Imagem em `public/` referenciada por URL de site (ex.: legado `heroImage: /assets/blog/…`).
 * Usar `<img>`, não `astro:assets`. Preferir `../../assets/blog/…` + `src/assets/blog/` (importação atual).
 */
export function isHeroPublicAssetPath(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("/assets/");
}
