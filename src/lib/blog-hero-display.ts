/** URL remota (http/https) usada no frontmatter. */
export function isHeroRemoteUrl(src: unknown): src is string {
  return typeof src === "string" && /^https?:\/\//i.test(src);
}

/**
 * Imagem servida a partir de `public/` (ex.: importação que grava em `public/assets/blog/`).
 * Deve usar `<img src="...">`, não `astro:assets` Image.
 */
export function isHeroPublicAssetPath(src: unknown): src is string {
  return typeof src === "string" && src.startsWith("/assets/");
}
