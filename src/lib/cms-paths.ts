/** Caminhos de conteúdo relativos à raiz do repositório (usados com a API de ficheiros do GitHub). */
export const CMS_PATHS = {
  blog: "src/content/blog",
  pages: "src/content/pages",
  /** Catálogo global (categorias e etiquetas) — fonte do editor. */
  taxonomiesJson: "src/data/taxonomies.json",
  /** Marca, menu, rodapé e SEO de partilhamento. */
  clientConfigJson: "src/data/client-config.json",
} as const;
