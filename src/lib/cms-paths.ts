/** Caminhos de conteúdo relativos à raiz do repositório (usados com a API de ficheiros do GitHub). */
export const CMS_PATHS = {
  blog: "src/content/blog",
  pages: "src/content/pages",
  /** Catálogo global (categorias e etiquetas) — fonte do editor. */
  taxonomiesJson: "src/data/taxonomies.json",
  /** Imagens do CMS (logótipo, editor, biblioteca) no repositório do cliente — servidas como `/assets/cms/…`. */
  clientCmsPublicDir: "public/assets/cms",
  /** Aparência global: identidade, menu, rodapé (repositório do site / Astro). */
  siteConfigJson: "src/data/site-config.json",
  /** Repositórios antigos: leitura ao migrar para `siteConfigJson`. */
  legacyClientConfigJson: "src/data/client-config.json",
} as const;
